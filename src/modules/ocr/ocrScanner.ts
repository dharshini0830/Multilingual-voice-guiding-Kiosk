import { createWorker } from 'tesseract.js';
import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { getLanguageConfig } from '@/src/modules/language/languages';
import { requestAiOcrExtraction } from '@/src/services/apiClient';
import type { ExtractionResultMap, LanguageCode, OcrScanResult } from '@/src/types/kiosk';
import {
  mergeOcrFieldMaps,
  normalizeServerAiFields,
  parseOcrTextToFields,
} from './fieldParser';
import {
  preprocessDocumentImage,
  type PreprocessOptions,
  type PreprocessedImageOutput,
} from './imagePreprocessor';

export interface RunOcrOptions extends PreprocessOptions {
  language: LanguageCode;
  useAiVerification: boolean;
  consentGiven: boolean;
  onProgress?: (pct: number) => void;
  onPageProgress?: (current: number, total: number, pct: number) => void;
}

export interface DocumentPageInput {
  dataUrl: string;
  rotationDeg?: 0 | 90 | 180 | 270;
}

function needsMoreLocalPasses(fields: ExtractionResultMap): boolean {
  if (!fields.fullName?.value || fields.fullName.score < 70) return true;
  if (!fields.idNumber?.value) return true;
  if (!fields.dob?.value) return true;
  if (!fields.gender?.value) return true;
  if (!fields.address?.value || fields.address.score < 70) return true;
  return false;
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

async function runLocalTesseractForPage(
  preprocessed: PreprocessedImageOutput,
  language: LanguageCode,
  onProgress?: (pct: number) => void
): Promise<{
  fields: ExtractionResultMap;
  rawText: string;
  confidence: number;
  lowQuality: boolean;
}> {
  // Pass 1: Pure 'eng' on gently sharpened color image
  const engPass = await runTesseractPass(preprocessed.colorDataUrl, 'eng', (p) => {
    onProgress?.(18 + Math.round(p * 0.25));
  });
  let fields = parseOcrTextToFields(engPass.text, engPass.confidence);
  let bestText = engPass.text;
  let bestConf = engPass.confidence;

  // Pass 2: Contrast-stretched sharpened grayscale 'eng' if key fields remain missing or weak
  if (needsMoreLocalPasses(fields)) {
    const grayEngPass = await runTesseractPass(preprocessed.enhancedDataUrl, 'eng', (p) => {
      onProgress?.(43 + Math.round(p * 0.2));
    });
    const grayFields = parseOcrTextToFields(grayEngPass.text, grayEngPass.confidence);
    fields = mergeOcrFieldMaps(fields, grayFields);
    if (grayEngPass.confidence >= bestConf && grayEngPass.text.trim().length > bestText.trim().length) {
      bestText = grayEngPass.text;
      bestConf = grayEngPass.confidence;
    }
  }

  // Pass 3: Adaptive binarized B&W pass (handles shadows/uneven lighting)
  if (needsMoreLocalPasses(fields)) {
    const binPass = await runTesseractPass(preprocessed.binarizedDataUrl, 'eng', (p) => {
      onProgress?.(63 + Math.round(p * 0.17));
    });
    const binFields = parseOcrTextToFields(binPass.text, binPass.confidence);
    fields = mergeOcrFieldMaps(fields, binFields);
    if (binPass.text.trim().length > bestText.trim().length) {
      bestText = binPass.text;
      bestConf = Math.max(bestConf, binPass.confidence);
    }
  }

  // Pass 4: Regional script + 'eng' on contrast-stretched grayscale when non-English UI selected & fields still missing
  const langCfg = getLanguageConfig(language);
  if (
    langCfg.tesseractCode &&
    langCfg.tesseractCode !== 'eng' &&
    (needsMoreLocalPasses(fields) || Object.keys(fields).length < 7)
  ) {
    const regionalPass = await runTesseractPass(
      preprocessed.enhancedDataUrl,
      `${langCfg.tesseractCode}+eng`,
      (p) => {
        onProgress?.(80 + Math.round(p * 0.18));
      }
    );
    const regionalFields = parseOcrTextToFields(regionalPass.text, regionalPass.confidence);
    fields = mergeOcrFieldMaps(fields, regionalFields);
    if (regionalPass.text.trim()) {
      bestText = `${bestText}\n\n--- ${langCfg.englishName} OCR ---\n${regionalPass.text}`.trim();
    }
  }

  const fieldCount = Object.values(fields).filter((f) => f && f.value).length;
  return {
    fields,
    rawText: bestText,
    confidence: Math.max(0, Math.min(100, Math.round(bestConf))),
    lowQuality: bestConf < 50 && fieldCount > 0,
  };
}

export async function scanDocumentPagesWithOcr(
  pages: DocumentPageInput[],
  options: RunOcrOptions
): Promise<OcrScanResult & { pageCount: number }> {
  if (!options.consentGiven) {
    throw new Error('Explicit user consent is required before scanning a document.');
  }
  if (pages.length === 0) {
    throw new Error('At least one document image is required.');
  }

  options.onProgress?.(5);
  options.onPageProgress?.(1, pages.length, 5);

  const preprocessedList = await Promise.all(
    pages.map((page) =>
      preprocessDocumentImage(page.dataUrl, {
        rotationDeg: page.rotationDeg ?? 0,
        cropMarginPercent: options.cropMarginPercent ?? 0,
        applyNoiseReduction: true,
      })
    )
  );

  options.onProgress?.(18);
  options.onPageProgress?.(1, pages.length, 18);
  const warnings: string[] = [];

  // Primary: Single multimodal Server AI Vision OCR across all queued pages (Front + Back together)
  if (options.useAiVerification) {
    try {
      const aiRes = await requestAiOcrExtraction({
        images: preprocessedList.map((p) => ({
          imageBase64: p.aiBase64,
          mimeType: p.aiMimeType,
        })),
        language: options.language,
        consentGiven: options.consentGiven,
      });

      let fields = normalizeServerAiFields(aiRes.extracted as Record<string, unknown>);
      const aiRawText = aiRes.extracted.rawText ?? '';

      if (aiRawText && Object.values(fields).filter((f) => f?.value).length < 7) {
        fields = mergeOcrFieldMaps(fields, parseOcrTextToFields(aiRawText, 78));
      }

      if (fields.dob?.value) {
        const normDob = normalizeDobFormat(fields.dob.value);
        if (normDob) {
          fields.dob = { ...fields.dob, value: normDob };
        }
      }

      const populatedCount = Object.values(fields).filter((f) => f && f.value).length;
      if (populatedCount > 0) {
        const scores = Object.values(fields)
          .filter((f): f is NonNullable<typeof f> => Boolean(f?.value))
          .map((f) => f.score);
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        options.onProgress?.(100);
        options.onPageProgress?.(pages.length, pages.length, 100);
        return {
          rawText: aiRawText,
          fields,
          overallConfidence: avg,
          engine: 'gemini-enhanced',
          preprocessedDataUrl: preprocessedList[0].colorDataUrl,
          warnings,
          pageCount: pages.length,
        };
      }
    } catch {
      warnings.push('AI verification unavailable; completed extraction with local Tesseract OCR.');
    }
  }

  // Fallback: Local Tesseract multi-pass per page
  let combinedFields: ExtractionResultMap = {};
  const rawChunks: string[] = [];
  const confidences: number[] = [];
  let hasLowQuality = false;

  for (let i = 0; i < preprocessedList.length; i++) {
    options.onPageProgress?.(i + 1, preprocessedList.length, Math.round((i / preprocessedList.length) * 100));
    const pageOut = await runLocalTesseractForPage(
      preprocessedList[i],
      options.language,
      (pct) => {
        const overall = Math.round(((i + pct / 100) / preprocessedList.length) * 100);
        options.onProgress?.(overall);
        options.onPageProgress?.(i + 1, preprocessedList.length, overall);
      }
    );

    combinedFields = mergeOcrFieldMaps(combinedFields, pageOut.fields);
    confidences.push(pageOut.confidence);
    if (pageOut.lowQuality) hasLowQuality = true;
    if (pageOut.rawText.trim()) {
      const header = preprocessedList.length > 1 ? `--- Page ${i + 1} ---\n` : '';
      rawChunks.push(`${header}${pageOut.rawText.trim()}`);
    }
  }

  if (combinedFields.dob?.value) {
    const normDob = normalizeDobFormat(combinedFields.dob.value);
    if (normDob) {
      combinedFields.dob = { ...combinedFields.dob, value: normDob };
    }
  }

  if (hasLowQuality) {
    warnings.push('Image lighting or sharpness was low. Please double-check every extracted field.');
  }

  options.onProgress?.(100);
  options.onPageProgress?.(pages.length, pages.length, 100);

  const avgConf =
    confidences.length > 0
      ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)
      : 0;

  return {
    rawText: rawChunks.join('\n\n'),
    fields: combinedFields,
    overallConfidence: Math.max(0, Math.min(100, avgConf)),
    engine: 'tesseract-local',
    preprocessedDataUrl: preprocessedList[0].colorDataUrl,
    warnings,
    pageCount: pages.length,
  };
}

export async function scanDocumentWithOcr(
  sourceDataUrl: string,
  options: RunOcrOptions
): Promise<OcrScanResult> {
  const res = await scanDocumentPagesWithOcr(
    [{ dataUrl: sourceDataUrl, rotationDeg: options.rotationDeg ?? 0 }],
    options
  );
  return {
    rawText: res.rawText,
    fields: res.fields,
    overallConfidence: res.overallConfidence,
    engine: res.engine,
    preprocessedDataUrl: res.preprocessedDataUrl,
    warnings: res.warnings,
  };
}
