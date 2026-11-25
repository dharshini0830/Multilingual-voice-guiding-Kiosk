import jsQR from 'jsqr';
import { inflate as pakoInflate } from 'pako';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { verifyVerhoeffChecksum } from '@/src/modules/validation/formValidator';
import type { ExtractedFieldMeta, ExtractionResultMap, QrScanResult } from '@/src/types/kiosk';

let zxingPrepared = false;

function ensureZxingWasmConfigured(): void {
  if (zxingPrepared) return;
  zxingPrepared = true;
  if (typeof window !== 'undefined') {
    prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => {
          if (path.endsWith('.wasm')) {
            return '/wasm/zxing_reader.wasm';
          }
          return prefix + path;
        },
      },
    });
  }
}

interface NativeBarcodeDetector {
  detect(image: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
}

let cachedBarcodeDetector: NativeBarcodeDetector | null | undefined;

function getNativeBarcodeDetector(): NativeBarcodeDetector | null {
  if (cachedBarcodeDetector !== undefined) return cachedBarcodeDetector;
  if (typeof window === 'undefined') {
    cachedBarcodeDetector = null;
    return null;
  }
  const ctor = (
    window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => NativeBarcodeDetector;
    }
  ).BarcodeDetector;
  if (!ctor) {
    cachedBarcodeDetector = null;
    return null;
  }
  try {
    cachedBarcodeDetector = new ctor({ formats: ['qr_code'] });
  } catch {
    cachedBarcodeDetector = null;
  }
  return cachedBarcodeDetector;
}

function makeQrMeta(value: string, score = 80): ExtractedFieldMeta {
  const clean = value.trim();
  return {
    value: clean,
    score: clean ? score : 0,
    confidence: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low',
    source: 'qr',
    needsReview: true, // Always mark decoded QR fields for user review (untrusted external payload)
  };
}

function normalizeGender(val: string): 'Male' | 'Female' | 'Other' | '' {
  const v = val.trim().toUpperCase();
  if (v === 'M' || v === 'MALE') return 'Male';
  if (v === 'F' || v === 'FEMALE') return 'Female';
  if (v === 'T' || v === 'O' || v === 'TRANSGENDER' || v === 'OTHER') return 'Other';
  return '';
}

function normalizeDob(val: string): string {
  const clean = val.trim();
  return normalizeDobFormat(clean) || clean;
}

// Convert UIDAI Secure QR base-10 BigInt string into byte array
function bigIntDecimalToBytes(decimalStr: string): Uint8Array {
  let num = BigInt(decimalStr);
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num & 0xffn));
    num >>= 8n;
  }
  bytes.reverse();
  return new Uint8Array(bytes);
}

function tryDecodeAadhaarSecureQr(payload: string): QrScanResult | null {
  const trimmed = payload.trim();
  if (!/^\d{40,}$/.test(trimmed)) return null;

  try {
    const compressedBytes = bigIntDecimalToBytes(trimmed);
    const decompressed = pakoInflate(compressedBytes);

    // Split bytes on 0xFF delimiter (UIDAI Secure QR V2/V3/V4/V5 specification)
    const decoder = new TextDecoder('iso-8859-1');
    const tokens: string[] = [];
    let start = 0;
    for (let i = 0; i < decompressed.length; i++) {
      if (decompressed[i] === 0xff) {
        tokens.push(decoder.decode(decompressed.slice(start, i)).trim());
        start = i + 1;
        if (tokens.length >= 20) break;
      }
    }

    if (tokens.length < 6) return null;

    let idx = 0;
    if (/^V\d+$/i.test(tokens[0])) {
      idx = 1;
    }

    // Standard order: [emailMobileFlag, refId, name, dob, gender, careOf, district, landmark, house, location, pincode, postOffice, state, street, subDistrict, vtc]
    const refId = tokens[idx + 1] ?? '';
    const name = tokens[idx + 2] ?? '';
    const dob = normalizeDob(tokens[idx + 3] ?? '');
    const gender = normalizeGender(tokens[idx + 4] ?? '');
    const careOf = tokens[idx + 5] ?? '';
    const district = tokens[idx + 6] ?? '';
    const landmark = tokens[idx + 7] ?? '';
    const house = tokens[idx + 8] ?? '';
    const location = tokens[idx + 9] ?? '';
    const pincode = (tokens[idx + 10] ?? '').replace(/\D/g, '').slice(0, 6);
    const postOffice = tokens[idx + 11] ?? '';
    const state = tokens[idx + 12] ?? '';
    const street = tokens[idx + 13] ?? '';
    const vtc = tokens[idx + 15] ?? '';

    const addrParts = [house, street, landmark, location, vtc, postOffice, district, state]
      .map((s) => s.trim())
      .filter(Boolean);

    const fields: ExtractionResultMap = {};
    if (name) fields.fullName = makeQrMeta(name, 88);
    if (dob) fields.dob = makeQrMeta(dob, 88);
    if (gender) fields.gender = makeQrMeta(gender, 90);
    if (careOf) {
      fields.fatherName = makeQrMeta(careOf.replace(/^(S\/O|D\/O|W\/O|C\/O)\s*[:\-]?\s*/i, ''), 82);
    }
    if (addrParts.length > 0) fields.address = makeQrMeta(addrParts.join(', '), 85);
    if (/^\d{6}$/.test(pincode)) fields.pincode = makeQrMeta(pincode, 90);

    const warnings: string[] = [];
    if (refId && /^\d{4}/.test(refId)) {
      warnings.push(
        `Secure QR contains masked reference ID (${refId.slice(0, 4)}). Please enter your full 12-digit ID number manually.`
      );
    }

    return {
      rawPayload: trimmed.slice(0, 120) + '…',
      format: 'aadhaar-secure',
      fields,
      isStructuredIdentity: Object.keys(fields).length > 0,
      warnings,
    };
  } catch {
    return null;
  }
}

function tryDecodeAadhaarXml(payload: string): QrScanResult | null {
  if (!payload.includes('PrintLetterBarcodeData')) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(payload, 'text/xml');
    const node = doc.querySelector('PrintLetterBarcodeData');
    if (!node) return null;

    const uid = (node.getAttribute('uid') ?? '').replace(/\D/g, '');
    const name = node.getAttribute('name') ?? '';
    const gender = normalizeGender(node.getAttribute('gender') ?? '');
    const dobRaw = node.getAttribute('dob') ?? node.getAttribute('yob') ?? '';
    const co = node.getAttribute('co') ?? '';
    const house = node.getAttribute('house') ?? '';
    const street = node.getAttribute('street') ?? '';
    const lm = node.getAttribute('lm') ?? '';
    const loc = node.getAttribute('loc') ?? '';
    const vtc = node.getAttribute('vtc') ?? '';
    const dist = node.getAttribute('dist') ?? '';
    const state = node.getAttribute('state') ?? '';
    const pc = (node.getAttribute('pc') ?? '').replace(/\D/g, '').slice(0, 6);

    const fields: ExtractionResultMap = {};
    if (name) fields.fullName = makeQrMeta(name, 88);
    if (uid.length === 12) {
      fields.idNumber = makeQrMeta(uid, verifyVerhoeffChecksum(uid) ? 92 : 60);
    }
    if (dobRaw) {
      const normDob = normalizeDob(dobRaw);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(normDob)) {
        fields.dob = makeQrMeta(normDob, 88);
      }
    }
    if (gender) fields.gender = makeQrMeta(gender, 90);
    if (co) {
      fields.fatherName = makeQrMeta(co.replace(/^(S\/O|D\/O|W\/O|C\/O)\s*[:\-]?\s*/i, ''), 82);
    }
    const addr = [house, street, lm, loc, vtc, dist, state].map((s) => s.trim()).filter(Boolean).join(', ');
    if (addr) fields.address = makeQrMeta(addr, 85);
    if (/^\d{6}$/.test(pc)) fields.pincode = makeQrMeta(pc, 90);

    return {
      rawPayload: payload,
      format: 'aadhaar-xml',
      fields,
      isStructuredIdentity: Object.keys(fields).length > 0,
      warnings: [],
    };
  } catch {
    return null;
  }
}

export function parseQrPayload(rawPayload: string): QrScanResult {
  const payload = rawPayload.trim();

  // 1. Aadhaar Secure QR
  const secure = tryDecodeAadhaarSecureQr(payload);
  if (secure) return secure;

  // 2. Aadhaar XML QR
  const xml = tryDecodeAadhaarXml(payload);
  if (xml) return xml;

  // 3. JSON Structured QR
  if (payload.startsWith('{') && payload.endsWith('}')) {
    try {
      const obj = JSON.parse(payload) as Record<string, unknown>;
      const fields: ExtractionResultMap = {};
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const val = obj[k];
          if (typeof val === 'string' && val.trim()) return val.trim();
          if (typeof val === 'number') return String(val);
        }
        return '';
      };

      const name = pick('fullName', 'name', 'applicantName');
      const id = pick('idNumber', 'aadhaar', 'aadhaarNumber', 'uid').replace(/\D/g, '');
      const dob = normalizeDob(pick('dob', 'dateOfBirth', 'birthDate'));
      const gender = normalizeGender(pick('gender', 'sex'));
      const father = pick('fatherName', 'careOf', 'guardianName', 'co');
      const phone = pick('phoneNumber', 'phone', 'mobile').replace(/\D/g, '').slice(-10);
      const address = pick('address', 'residentialAddress');
      const pincode = pick('pincode', 'pin', 'postalCode').replace(/\D/g, '').slice(0, 6);

      if (name) fields.fullName = makeQrMeta(name, 85);
      if (id.length === 12) fields.idNumber = makeQrMeta(id, verifyVerhoeffChecksum(id) ? 90 : 58);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) fields.dob = makeQrMeta(dob, 85);
      if (gender) fields.gender = makeQrMeta(gender, 85);
      if (father) fields.fatherName = makeQrMeta(father, 80);
      if (/^[6-9]\d{9}$/.test(phone)) fields.phoneNumber = makeQrMeta(phone, 85);
      if (address) fields.address = makeQrMeta(address, 82);
      if (/^[1-9]\d{5}$/.test(pincode)) fields.pincode = makeQrMeta(pincode, 85);

      return {
        rawPayload: payload,
        format: 'json',
        fields,
        isStructuredIdentity: Object.keys(fields).length > 0,
        warnings: [],
      };
    } catch {
      // fall through
    }
  }

  // 4. vCard QR
  if (/BEGIN:VCARD/i.test(payload)) {
    const fields: ExtractionResultMap = {};
    const fn = /^FN:(.*)$/im.exec(payload)?.[1]?.trim();
    const tel = /^TEL[^:]*:(.*)$/im.exec(payload)?.[1]?.replace(/\D/g, '').slice(-10);
    const adr = /^ADR[^:]*:(.*)$/im.exec(payload)?.[1]?.replace(/;+/g, ', ').replace(/^,\s*|,\s*$/g, '').trim();
    if (fn) fields.fullName = makeQrMeta(fn, 82);
    if (tel && /^[6-9]\d{9}$/.test(tel)) fields.phoneNumber = makeQrMeta(tel, 82);
    if (adr) fields.address = makeQrMeta(adr, 75);
    return {
      rawPayload: payload,
      format: 'vcard',
      fields,
      isStructuredIdentity: Object.keys(fields).length > 0,
      warnings: [],
    };
  }

  // 5. Key-Value text lines
  const kvFields: ExtractionResultMap = {};
  const lines = payload.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    const m = /^([A-Za-z\s]+)\s*[:=]\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase().trim();
    const val = m[2].trim();
    if (key.includes('name') && !key.includes('father')) kvFields.fullName = makeQrMeta(val, 80);
    else if (key.includes('father') || key.includes('guardian')) kvFields.fatherName = makeQrMeta(val, 80);
    else if (key === 'id' || key.includes('aadhaar') || key.includes('uid')) {
      const digits = val.replace(/\D/g, '');
      if (digits.length === 12) kvFields.idNumber = makeQrMeta(digits, 80);
    } else if (key.includes('dob') || key.includes('birth')) {
      const d = normalizeDob(val);
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) kvFields.dob = makeQrMeta(d, 80);
    } else if (key.includes('gender') || key === 'sex') {
      const g = normalizeGender(val);
      if (g) kvFields.gender = makeQrMeta(g, 80);
    } else if (key.includes('phone') || key.includes('mobile')) {
      const p = val.replace(/\D/g, '').slice(-10);
      if (/^[6-9]\d{9}$/.test(p)) kvFields.phoneNumber = makeQrMeta(p, 80);
    } else if (key.includes('addr')) {
      kvFields.address = makeQrMeta(val, 78);
    } else if (key.includes('pin')) {
      const pin = val.replace(/\D/g, '').slice(0, 6);
      if (/^[1-9]\d{5}$/.test(pin)) kvFields.pincode = makeQrMeta(pin, 80);
    }
  }
  if (Object.keys(kvFields).length >= 2) {
    return {
      rawPayload: payload,
      format: 'key-value',
      fields: kvFields,
      isStructuredIdentity: true,
      warnings: [],
    };
  }

  // 6. URL or unstructured text
  const isUrl = /^https?:\/\//i.test(payload);
  return {
    rawPayload: payload,
    format: isUrl ? 'url' : 'text',
    fields: {},
    isStructuredIdentity: false,
    warnings: ['Decoded QR code does not contain structured identity or form fields.'],
  };
}

/**
 * Computes O(W*H) integral-image box mean for any window radius, allowing fast
 * multi-radius unsharp deblurring + local contrast normalization for blurry QRs.
 */
function buildIntegral(buf: Float32Array, w: number, h: number): Float64Array {
  const integral = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += buf[y * w + x];
      integral[y * w + x] = (y > 0 ? integral[(y - 1) * w + x] : 0) + rowSum;
    }
  }
  return integral;
}

function boxMean(integral: Float64Array, w: number, h: number, x: number, y: number, r: number): number {
  const x1 = Math.max(0, x - r);
  const x2 = Math.min(w - 1, x + r);
  const y1 = Math.max(0, y - r);
  const y2 = Math.min(h - 1, y + r);
  const count = (x2 - x1 + 1) * (y2 - y1 + 1);
  const sum =
    integral[y2 * w + x2] -
    (y1 > 0 ? integral[(y1 - 1) * w + x2] : 0) -
    (x1 > 0 ? integral[y2 * w + (x1 - 1)] : 0) +
    (y1 > 0 && x1 > 0 ? integral[(y1 - 1) * w + (x1 - 1)] : 0);
  return sum / count;
}

/**
 * Restores soft/blurry/low-contrast QR pixels using optional mild denoising,
 * multi-radius unsharp masking (O(W*H) via integral images), and local contrast stretching.
 */
function buildRestoredQrImageData(
  src: ImageData,
  options: {
    blurRadius?: number;
    sharpenStrength?: number;
    denoise?: boolean;
    binarizeBias?: number; // 0 = continuous grayscale stretched, >0 = adaptive threshold ratio (e.g. 0.91)
  }
): ImageData {
  const { width: w, height: h, data } = src;
  const gray = new Float32Array(w * h);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // Optional light 3x3 Gaussian blur to suppress sensor grain before sharpening
  let working: Float32Array<ArrayBufferLike> = gray;
  if (options.denoise) {
    const smooth = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
          smooth[idx] = gray[idx];
          continue;
        }
        smooth[idx] =
          (gray[idx] * 4 +
            (gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w]) * 2 +
            (gray[idx - w - 1] + gray[idx - w + 1] + gray[idx + w - 1] + gray[idx + w + 1])) /
          16;
      }
    }
    working = smooth;
  }

  // Unsharp mask using configurable blur radius (r=2..3 recovers out-of-focus QRs)
  const strength = options.sharpenStrength ?? 2.0;
  const blurRadius = options.blurRadius ?? 2;
  const workIntegral = buildIntegral(working, w, h);
  const sharp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const localBlur = boxMean(workIntegral, w, h, x, y, blurRadius);
      const val = working[idx] + strength * (working[idx] - localBlur);
      sharp[idx] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }

  // Integral image for fast O(W*H) local window normalization/thresholding
  const sharpIntegral = buildIntegral(sharp, w, h);
  const normRadius = Math.max(8, Math.round(Math.min(w, h) / 24));
  const out = new Uint8ClampedArray(data.length);
  const bias = options.binarizeBias ?? 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mean = boxMean(sharpIntegral, w, h, x, y, normRadius);
      const idx = y * w + x;

      let pixel: number;
      if (bias > 0) {
        pixel = sharp[idx] < mean * bias ? 0 : 255;
      } else {
        // Local contrast stretch around local mean (great for washed-out blurry QRs)
        const stretched = 128 + (sharp[idx] - mean) * 2.6;
        pixel = stretched < 0 ? 0 : stretched > 255 ? 255 : stretched;
      }

      const outIdx = idx * 4;
      out[outIdx] = pixel;
      out[outIdx + 1] = pixel;
      out[outIdx + 2] = pixel;
      out[outIdx + 3] = 255;
    }
  }

  return new ImageData(out, w, h);
}

async function tryZxingWasmDecode(
  imageData: ImageData,
  binarizer: ReaderOptions['binarizer'] = 'LocalAverage'
): Promise<string | null> {
  ensureZxingWasmConfigured();
  try {
    const results = await readBarcodes(imageData, {
      formats: ['QRCode'],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
      tryDownscale: true,
      tryDenoise: true,
      textMode: 'Plain',
      binarizer,
    });
    const hit = results.find((r) => r.isValid && r.text && r.text.trim().length > 0);
    return hit?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

function tryJsQrDecode(imageData: ImageData): string | null {
  const hit = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return hit?.data?.trim() || null;
}

async function decodeImageDataWithRestoration(
  imgData: ImageData,
  exhaustive: boolean
): Promise<string | null> {
  // 1. Raw zxing-wasm C++ reader (built-in local average + denoise + downscale)
  const zRaw = await tryZxingWasmDecode(imgData, 'LocalAverage');
  if (zRaw) return zRaw;

  // 2. Fast jsQR raw check
  const jRaw = tryJsQrDecode(imgData);
  if (jRaw) return jRaw;

  // 3. Multi-radius (r=2) unsharp deblur + local contrast stretch (recovers blurry/low-contrast QRs)
  const restored = buildRestoredQrImageData(imgData, {
    blurRadius: 2,
    sharpenStrength: 2.0,
    denoise: false,
    binarizeBias: 0,
  });
  const zRestored = await tryZxingWasmDecode(restored, 'LocalAverage');
  if (zRestored) return zRestored;

  const jRestored = tryJsQrDecode(restored);
  if (jRestored) return jRestored;

  if (!exhaustive) return null;

  // 4. Exhaustive recovery passes for heavier out-of-focus blur / noise / glare
  const widerDeblur = buildRestoredQrImageData(imgData, {
    blurRadius: 3,
    sharpenStrength: 2.4,
    denoise: true,
    binarizeBias: 0,
  });
  const zWider = await tryZxingWasmDecode(widerDeblur, 'LocalAverage');
  if (zWider) return zWider;

  const bwSharp = buildRestoredQrImageData(imgData, {
    blurRadius: 2,
    sharpenStrength: 2.2,
    denoise: true,
    binarizeBias: 0.91,
  });
  const jBw = tryJsQrDecode(bwSharp);
  if (jBw) return jBw;

  const zBw = await tryZxingWasmDecode(bwSharp, 'FixedThreshold');
  if (zBw) return zBw;

  const zHist = await tryZxingWasmDecode(restored, 'GlobalHistogram');
  if (zHist) return zHist;

  const bwAlt = buildRestoredQrImageData(imgData, {
    blurRadius: 2,
    sharpenStrength: 1.5,
    denoise: true,
    binarizeBias: 0.95,
  });
  return tryJsQrDecode(bwAlt);
}

function extractCenterRoiImageData(
  sourceCanvas: HTMLCanvasElement,
  fraction: number,
  targetSize: number
): ImageData | null {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const side = Math.round(Math.min(sw, sh) * fraction);
  if (side < 64) return null;

  const sx = Math.round((sw - side) / 2);
  const sy = Math.round((sh - side) / 2);

  const roiCanvas = document.createElement('canvas');
  roiCanvas.width = targetSize;
  roiCanvas.height = targetSize;
  const rctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  if (!rctx) return null;

  rctx.imageSmoothingEnabled = true;
  rctx.imageSmoothingQuality = 'high';
  rctx.drawImage(sourceCanvas, sx, sy, side, side, 0, 0, targetSize, targetSize);

  return rctx.getImageData(0, 0, targetSize, targetSize);
}

export async function decodeQrFromCanvasAsync(
  canvas: HTMLCanvasElement,
  exhaustive = false
): Promise<string | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) return null;

  const fullImgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const fullHit = await decodeImageDataWithRestoration(fullImgData, exhaustive);
  if (fullHit) return fullHit;

  const cropFractions = exhaustive ? [0.76, 0.58, 0.44] : [0.64];
  for (const frac of cropFractions) {
    const roiData = extractCenterRoiImageData(canvas, frac, 840);
    if (!roiData) continue;
    const hit = await decodeImageDataWithRestoration(roiData, exhaustive);
    if (hit) return hit;
  }

  return null;
}

export async function decodeQrFromFrameAsync(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameIndex: number,
  options?: { exhaustive?: boolean; zoom?: number }
): Promise<string | null> {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const exhaustive = Boolean(options?.exhaustive);
  const zoom = options?.zoom && options.zoom > 1 ? options.zoom : 1;

  // 1. Hardware-accelerated native BarcodeDetector on live video frame
  const detector = getNativeBarcodeDetector();
  if (detector && zoom === 1) {
    try {
      const barcodes = await detector.detect(video);
      const hit = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim().length > 0);
      if (hit?.rawValue) return hit.rawValue;
    } catch {
      // Fall through to canvas / WASM decoders
    }
  }

  // Draw sensor frame (applying digital zoom crop if selected by user)
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cropW = Math.round(vw / zoom);
  const cropH = Math.round(vh / zoom);
  const sx = Math.round((vw - cropW) / 2);
  const sy = Math.round((vh - cropH) / 2);

  canvas.width = zoom > 1 ? Math.max(900, cropW) : vw;
  canvas.height = zoom > 1 ? Math.round(Math.max(900 * (cropH / cropW), cropH)) : vh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);

  if (detector) {
    try {
      const barcodes = await detector.detect(canvas);
      const hit = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim().length > 0);
      if (hit?.rawValue) return hit.rawValue;
    } catch {
      // ignore
    }
  }

  // In live mode, alternate full-frame & tight ROI restoration passes so each frame stays snappy
  if (!exhaustive) {
    if (frameIndex % 2 === 0) {
      const fullImgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const hit = await decodeImageDataWithRestoration(fullImgData, false);
      if (hit) return hit;
    } else {
      const frac = frameIndex % 4 === 1 ? 0.68 : 0.50;
      const roiData = extractCenterRoiImageData(canvas, frac, 840);
      if (roiData) {
        const hit = await decodeImageDataWithRestoration(roiData, true);
        if (hit) return hit;
      }
    }
    return null;
  }

  return decodeQrFromCanvasAsync(canvas, true);
}

export async function decodeQrFromImageFile(file: File): Promise<QrScanResult> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Unable to read uploaded QR image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Invalid image format.'));
    el.src = dataUrl;
  });

  const detector = getNativeBarcodeDetector();
  if (detector) {
    try {
      const barcodes = await detector.detect(img);
      const hit = barcodes.find((b) => typeof b.rawValue === 'string' && b.rawValue.trim().length > 0);
      if (hit?.rawValue) {
        return parseQrPayload(hit.rawValue);
      }
    } catch {
      // continue to multi-scale CV + zxing-wasm passes
    }
  }

  const attempts = [1, 1.8, 0.65, 2.5];
  for (const scale of attempts) {
    const w = Math.min(2000, Math.max(360, Math.round(img.width * scale)));
    const h = Math.min(2000, Math.max(360, Math.round(img.height * scale)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) continue;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const decoded = await decodeQrFromCanvasAsync(canvas, true);
    if (decoded) {
      return parseQrPayload(decoded);
    }
  }

  throw new Error('NO_QR_FOUND');
}
