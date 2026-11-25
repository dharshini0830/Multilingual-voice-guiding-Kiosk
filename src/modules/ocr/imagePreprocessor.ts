export interface PreprocessOptions {
  rotationDeg?: 0 | 90 | 180 | 270;
  cropMarginPercent?: number; // e.g., 0 for full image, 0.04 for slight edge trim
  applyNoiseReduction?: boolean;
}

export interface PreprocessedImageOutput {
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
  // Mild sharpening kernel so ID card guilloche backgrounds do not become speckles
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        out[idx] = gray[idx];
        continue;
      }
      const center = gray[idx] * 1.4;
      const neighbors =
        (gray[(y - 1) * w + x] +
          gray[(y + 1) * w + x] +
          gray[y * w + (x - 1)] +
          gray[y * w + (x + 1)]) *
        0.1;
      const val = center - neighbors;
      out[idx] = val < 0 ? 0 : val > 255 ? 255 : Math.round(val);
    }
  }
  return out;
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

  // Upscale small images so OCR sees crisp character glyphs, cap max at 1800px
  let scale = 1;
  if (baseW < 1400) {
    scale = Math.min(2.2, 1400 / baseW);
  } else if (baseW > 1800) {
    scale = 1800 / baseW;
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

  // High-quality clean color image for AI Vision & primary color Tesseract pass
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

  // 4. Gentle sharpening
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
