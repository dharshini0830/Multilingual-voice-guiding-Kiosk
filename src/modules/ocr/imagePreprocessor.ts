export interface PreprocessOptions {
  rotationDeg?: 0 | 90 | 180 | 270;
  cropMarginPercent?: number; // e.g., 0 for full image, 0.04 for slight edge trim
  applyNoiseReduction?: boolean;
}

export interface PreprocessedImageOutput {
  aiDataUrl: string;
  aiBase64: string;
  aiMimeType: 'image/jpeg';
  colorDataUrl: string;
  colorBase64: string;
  colorMimeType: 'image/jpeg';
  enhancedDataUrl: string;
  enhancedBase64: string;
  binarizedDataUrl: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for preprocessing.'));
    img.src = src;
  });
}

function applyMedianNoiseReduction(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  const windowArr = new Uint8Array(9);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[y * w + x] = gray[y * w + x];
        continue;
      }
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          windowArr[k++] = gray[(y + dy) * w + (x + dx)];
        }
      }
      windowArr.sort();
      out[y * w + x] = windowArr[4];
    }
  }
  return out;
}

function stretchContrastPercentile(gray: Uint8ClampedArray): Uint8ClampedArray {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[gray[i]]++;
  }

  const total = gray.length;
  const lowTarget = Math.floor(total * 0.02);
  const highTarget = Math.floor(total * 0.98);

  let cumulative = 0;
  let minVal = 0;
  let maxVal = 255;

  for (let i = 0; i < 256; i++) {
    cumulative += hist[i];
    if (cumulative >= lowTarget) {
      minVal = i;
      break;
    }
  }

  cumulative = 0;
  for (let i = 255; i >= 0; i--) {
    cumulative += hist[i];
    if (cumulative >= total - highTarget) {
      maxVal = i;
      break;
    }
  }

  const range = Math.max(16, maxVal - minVal);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const scaled = ((gray[i] - minVal) * 255) / range;
    out[i] = scaled < 0 ? 0 : scaled > 255 ? 255 : Math.round(scaled);
  }
  return out;
}

function applyGentleSharpen(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length);
  // Crisp sharpening kernel tuned for webcam/mobile document photos
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[idx] = gray[idx];
        continue;
      }
      const center = gray[idx] * 1.68;
      const neighbors =
        (gray[(y - 1) * w + x] +
          gray[(y + 1) * w + x] +
          gray[y * w + (x - 1)] +
          gray[y * w + (x + 1)]) *
        0.17;
      const val = center - neighbors;
      out[idx] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
    }
  }
  return out;
}

/**
 * Enhances blurry/dim camera color frames on luminance only (preserving colors & accents)
 * so both AI Vision and primary color Tesseract OCR see crisp character edges.
 */
function enhanceColorCameraRgba(rgba: Uint8ClampedArray, w: number, h: number): void {
  const lum = new Float32Array(w * h);
  const hist = new Uint32Array(256);

  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    lum[p] = l;
    const bin = l < 0 ? 0 : l > 255 ? 255 : Math.round(l);
    hist[bin]++;
  }

  // Gentle 1%..99% luminance levels normalization (fixes dim/low-contrast webcam lighting without clipping whites)
  const total = w * h;
  let cum = 0;
  let low = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= total * 0.01) {
      low = i;
      break;
    }
  }
  cum = 0;
  for (let i = 255; i >= 0; i--) {
    cum += hist[i];
    if (cum >= total * 0.01) {
      high = i;
      break;
    }
  }

  const doStretch = high - low >= 24 && (low > 12 || high < 238);
  const scale = doStretch ? 255 / Math.max(24, high - low) : 1;

  const stretched = new Float32Array(total);
  for (let p = 0; p < total; p++) {
    const l = doStretch ? Math.max(0, Math.min(255, (lum[p] - low) * scale)) : lum[p];
    stretched[p] = l;
  }

  // Unsharp mask on luminance channel (5x5 box mean via row/col offsets approximated by 3x3 + 5-tap)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const origLum = lum[p];
      if (origLum < 1) continue;

      const localBlur =
        (stretched[p] * 2 +
          stretched[p - 1] +
          stretched[p + 1] +
          stretched[p - w] +
          stretched[p + w] +
          (stretched[p - w - 1] + stretched[p - w + 1] + stretched[p + w - 1] + stretched[p + w + 1]) * 0.5) /
        8;

      const enhancedLum = Math.max(0, Math.min(255, stretched[p] + 0.48 * (stretched[p] - localBlur)));
      const delta = enhancedLum - origLum;
      const idx = p * 4;
      rgba[idx] = Math.max(0, Math.min(255, Math.round(rgba[idx] + delta)));
      rgba[idx + 1] = Math.max(0, Math.min(255, Math.round(rgba[idx + 1] + delta)));
      rgba[idx + 2] = Math.max(0, Math.min(255, Math.round(rgba[idx + 2] + delta)));
    }
  }
}

function applyAdaptiveBinarization(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] =
        integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }

  const radius = Math.max(12, Math.round(Math.min(w, h) * 0.025));
  const thresholdBias = 0.08;
  const out = new Uint8ClampedArray(gray.length);

  for (let y = 0; y < h; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(w - 1, x + radius);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      const localMean = sum / count;
      out[y * w + x] = gray[y * w + x] < localMean * (1 - thresholdBias) ? 0 : 255;
    }
  }
  return out;
}

export async function preprocessDocumentImage(
  sourceDataUrl: string,
  options: PreprocessOptions = {}
): Promise<PreprocessedImageOutput> {
  const img = await loadImageElement(sourceDataUrl);
  const rotation = options.rotationDeg ?? 0;
  const cropMargin = Math.max(0, Math.min(0.2, options.cropMarginPercent ?? 0));

  const srcCropX = Math.round(img.width * cropMargin);
  const srcCropY = Math.round(img.height * cropMargin);
  const srcCropW = Math.max(1, Math.round(img.width * (1 - cropMargin * 2)));
  const srcCropH = Math.max(1, Math.round(img.height * (1 - cropMargin * 2)));

  const isRotated90 = rotation === 90 || rotation === 270;
  const baseW = isRotated90 ? srcCropH : srcCropW;
  const baseH = isRotated90 ? srcCropW : srcCropH;

  // Upscale smaller/webcam images so OCR sees crisp character glyphs, cap max at 2000px
  let scale = 1;
  if (baseW < 1500) {
    scale = Math.min(2.4, 1500 / baseW);
  } else if (baseW > 2000) {
    scale = 2000 / baseW;
  }

  const targetW = Math.max(1, Math.round(baseW * scale));
  const targetH = Math.max(1, Math.round(baseH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable.');
  }

  // Paint white backdrop for transparent PNGs before drawing rotated document
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.translate(targetW / 2, targetH / 2);
  ctx.rotate((rotation * Math.PI) / 180);

  const drawW = isRotated90 ? targetH : targetW;
  const drawH = isRotated90 ? targetW : targetH;
  ctx.drawImage(img, srcCropX, srcCropY, srcCropW, srcCropH, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  // Generate clean, artifact-free JPEG (max 1440px) for AI Vision OCR so Gemini sees natural typography
  const aiMaxDim = 1440;
  const aiScale = Math.max(targetW, targetH) > aiMaxDim ? aiMaxDim / Math.max(targetW, targetH) : 1;
  let aiDataUrl: string;
  if (aiScale < 1) {
    const aiCanvas = document.createElement('canvas');
    aiCanvas.width = Math.max(1, Math.round(targetW * aiScale));
    aiCanvas.height = Math.max(1, Math.round(targetH * aiScale));
    const aiCtx = aiCanvas.getContext('2d');
    if (aiCtx) {
      aiCtx.imageSmoothingEnabled = true;
      aiCtx.imageSmoothingQuality = 'high';
      aiCtx.drawImage(canvas, 0, 0, aiCanvas.width, aiCanvas.height);
      aiDataUrl = aiCanvas.toDataURL('image/jpeg', 0.88);
    } else {
      aiDataUrl = canvas.toDataURL('image/jpeg', 0.88);
    }
  } else {
    aiDataUrl = canvas.toDataURL('image/jpeg', 0.88);
  }
  const aiBase64 = aiDataUrl.split(',')[1] ?? '';

  // Apply luminance-only edge sharpening & mild contrast normalization for local Tesseract OCR
  const colorImgData = ctx.getImageData(0, 0, targetW, targetH);
  enhanceColorCameraRgba(colorImgData.data, targetW, targetH);
  ctx.putImageData(colorImgData, 0, 0);

  // High-quality crisp color image for primary color Tesseract pass
  const colorDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const colorBase64 = colorDataUrl.split(',')[1] ?? '';

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const rgba = imgData.data;

  // 1. Grayscale luminance conversion
  let gray: Uint8ClampedArray = new Uint8ClampedArray(targetW * targetH);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    gray[p] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }

  // 2. Mild noise reduction
  if (options.applyNoiseReduction !== false) {
    gray = applyMedianNoiseReduction(gray, targetW, targetH);
  }

  // 3. Contrast stretch (2%-98%)
  gray = stretchContrastPercentile(gray);

  // 4. Sharpening tuned for card typography
  gray = applyGentleSharpen(gray, targetW, targetH);

  // Write enhanced grayscale image
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const v = gray[p];
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const enhancedDataUrl = canvas.toDataURL('image/png');
  const enhancedBase64 = enhancedDataUrl.split(',')[1] ?? '';

  // 5. Adaptive thresholded B&W image for tertiary Tesseract pass
  const binary = applyAdaptiveBinarization(gray, targetW, targetH);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const v = binary[p];
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const binarizedDataUrl = canvas.toDataURL('image/png');

  return {
    aiDataUrl,
    aiBase64,
    aiMimeType: 'image/jpeg',
    colorDataUrl,
    colorBase64,
    colorMimeType: 'image/jpeg',
    enhancedDataUrl,
    enhancedBase64,
    binarizedDataUrl,
    mimeType: 'image/png',
    width: targetW,
    height: targetH,
  };
}
