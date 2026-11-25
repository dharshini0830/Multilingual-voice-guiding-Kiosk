import { createWorker } from 'tesseract.js';
import { getLanguageConfig } from '@/src/modules/language/languages';
import { requestAiOcrExtraction } from '@/src/services/apiClient';
import type { LanguageCode, OcrScanResult } from '@/src/types/kiosk';
import {
  mergeOcrFieldMaps,
  normalizeServerAiFields,
  parseOcrTextToFields,
} from './fieldParser';
import { preprocessDocumentImage, type PreprocessOptions } from './imagePreprocessor';

export interface RunOcrOptions extends PreprocessOptions {
  language: LanguageCode;
  useAiVerification: boolean;
  consentGiven: boolean;
  onProgress?: (pct: number) => void;
}

async function runTesseractPass(
  imageDataUrl: string,
  tessLangs: string,
  onProgress?: (pct: number) => void
): Promise<{ text: string; confidence: number }> {
  let worker;
  try {
    worker = await createWorker(tessLangs, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress?.(Math.round(m.progress * 100));
        }
      },
    });
  } catch {
    worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress?.(Math.round(m.progress * 100));
        }
      },
    });
  }

  try {
    const result = await worker.recognize(imageDataUrl);
    return {
      text: result.data.text ?? '',
      confidence: result.data.confidence ?? 0,
    };
  } finally {
    await worker.terminate();
  }
}

export async function scanDocumentWithOcr(
  sourceDataUrl: string,
  options: RunOcrOptions
): Promise<OcrScanResult> {
  if (!options.consentGiven) {
    throw new Error('Explicit user consent is required before scanning a document.');
  }

  options.onProgress?.(5);
  const preprocessed = await preprocessDocumentImage(sourceDataUrl, {
    rotationDeg: options.rotationDeg ?? 0,
    cropMarginPercent: options.cropMarginPercent ?? 0,
    applyNoiseReduction: true,
  });

  options.onProgress?.(18);
  const warnings: string[] = [];

  // Primary: Server AI Vision OCR using crisp full-color rotated JPEG
  if (options.useAiVerification) {
    try {
      const aiRes = await requestAiOcrExtraction({
        imageBase64: preprocessed.colorBase64,
        mimeType: preprocessed.colorMimeType,
        language: options.language,
        consentGiven: options.consentGiven,
      });

      const fields = normalizeServerAiFields(aiRes.extracted as Record<string, unknown>);
      const populatedCount = Object.values(fields).filter((f) => f && f.value).length;

      if (populatedCount > 0) {
        const scores = Object.values(fields)
          .filter((f): f is NonNullable<typeof f> => Boolean(f?.value))
          .map((f) => f.score);
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        options.onProgress?.(100);
        return {
          rawText: aiRes.extracted.rawText ?? '',
          fields,
          overallConfidence: avg,
          engine: 'gemini-enhanced',
          preprocessedDataUrl: preprocessed.colorDataUrl,
          warnings,
        };
      }
    } catch {
      warnings.push('AI verification unavailable; completed extraction with local Tesseract OCR.');
    }
  }

  // Local Tesseract Pass 1: Pure 'eng' on clean color image (prevents regional script hallucinations on English text)
  const engPass = await runTesseractPass(preprocessed.colorDataUrl, 'eng', (p) => {
    options.onProgress?.(18 + Math.round(p * 0.3));
  });
  let fields = parseOcrTextToFields(engPass.text, engPass.confidence);
  let bestText = engPass.text;
  let bestConf = engPass.confidence;

  // Local Tesseract Pass 2: Contrast-stretched grayscale 'eng' if fewer than 5 fields
  if (Object.keys(fields).length < 5) {
    const grayEngPass = await runTesseractPass(preprocessed.enhancedDataUrl, 'eng', (p) => {
      options.onProgress?.(48 + Math.round(p * 0.22));
    });
    const grayFields = parseOcrTextToFields(grayEngPass.text, grayEngPass.confidence);
    fields = mergeOcrFieldMaps(fields, grayFields);
    if (grayEngPass.confidence > bestConf && grayEngPass.text.trim().length > bestText.trim().length) {
      bestText = grayEngPass.text;
      bestConf = grayEngPass.confidence;
    }
  }

  // Local Tesseract Pass 3: Regional script pass (when non-English UI language is selected and fields remain missing)
  const langCfg = getLanguageConfig(options.language);
  if (langCfg.tesseractCode && langCfg.tesseractCode !== 'eng' && Object.keys(fields).length < 6) {
    const regionalPass = await runTesseractPass(
      preprocessed.colorDataUrl,
      `${langCfg.tesseractCode}+eng`,
      (p) => {
        options.onProgress?.(70 + Math.round(p * 0.25));
      }
    );
    const regionalFields = parseOcrTextToFields(regionalPass.text, regionalPass.confidence);
    fields = mergeOcrFieldMaps(fields, regionalFields);
    if (regionalPass.text.trim()) {
      bestText = `${bestText}\n\n--- ${langCfg.englishName} OCR ---\n${regionalPass.text}`.trim();
    }
  }

  options.onProgress?.(100);

  const fieldCount = Object.keys(fields).length;
  if (bestConf < 50 && fieldCount > 0) {
    warnings.push('Image lighting or sharpness was low. Please double-check every extracted field.');
  }

  return {
    rawText: bestText,
    fields,
    overallConfidence: Math.max(0, Math.min(100, Math.round(bestConf))),
    engine: 'tesseract-local',
    preprocessedDataUrl: preprocessed.colorDataUrl,
    warnings,
  };
}
