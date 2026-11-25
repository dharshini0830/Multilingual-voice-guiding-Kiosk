import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { createEmptyFormData, mergeExtractedFieldsIntoForm } from '@/src/modules/form/formSchema';
import { getDictionary, type TranslationDictionary } from '@/src/modules/i18n';
import { getLanguageConfig, type LanguageConfig } from '@/src/modules/language/languages';
import { voiceGuidanceManager } from '@/src/modules/voice/voiceGuidanceManager';
import { clearSessionToken, ensureSessionToken } from '@/src/services/apiClient';
import type {
  CitizenFormData,
  ExtractionResultMap,
  FieldKey,
  LanguageCode,
  OcrScanResult,
  QrScanResult,
  SubmissionRecord,
  VoiceState,
  WorkflowStage,
} from '@/src/types/kiosk';

interface KioskContextValue {
  language: LanguageCode;
  languageConfig: LanguageConfig;
  t: TranslationDictionary;
  stage: WorkflowStage;
  formData: CitizenFormData;
  extractionMeta: ExtractionResultMap;
  ocrResult: OcrScanResult | null;
  qrResult: QrScanResult | null;
  consentGiven: boolean;
  submission: SubmissionRecord | null;
  voiceState: VoiceState;
  setLanguage: (lang: LanguageCode, options?: { announce?: boolean }) => void;
  setStage: (stage: WorkflowStage) => void;
  updateField: (key: FieldKey, value: string, source?: 'ocr' | 'qr' | 'voice' | 'manual') => void;
  setFormData: React.Dispatch<React.SetStateAction<CitizenFormData>>;
  applyExtractedFields: (fields: ExtractionResultMap) => void;
  setOcrResult: (res: OcrScanResult | null) => void;
  setQrResult: (res: QrScanResult | null) => void;
  setConsentGiven: (accepted: boolean) => void;
  setSubmission: (rec: SubmissionRecord | null) => void;
  resetSession: () => void;
  speak: (text: string, force?: boolean) => void;
}

const KioskContext = createContext<KioskContextValue | null>(null);

export function KioskProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [stage, setStageState] = useState<WorkflowStage>('welcome');
  const [formData, setFormData] = useState<CitizenFormData>(createEmptyFormData);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionResultMap>({});
  const [ocrResult, setOcrResult] = useState<OcrScanResult | null>(null);
  const [qrResult, setQrResult] = useState<QrScanResult | null>(null);
  const [consentGiven, setConsentGiven] = useState<boolean>(false);
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>(() => voiceGuidanceManager.getState());

  // Initialize secure server Bearer session in memory
  useEffect(() => {
    void ensureSessionToken().catch(() => {
      // Handled gracefully when user triggers protected actions
    });
  }, []);

  // Subscribe to centralized Voice Guidance Manager
  useEffect(() => {
    return voiceGuidanceManager.subscribe(setVoiceState);
  }, []);

  // Sync <html lang="..." dir="..."> when language changes
  useEffect(() => {
    const cfg = getLanguageConfig(language);
    document.documentElement.lang = cfg.code;
    document.documentElement.dir = cfg.dir;
    voiceGuidanceManager.setLanguage(language);
  }, [language]);

  const languageConfig = useMemo(() => getLanguageConfig(language), [language]);
  const t = useMemo(() => getDictionary(language), [language]);

  const setLanguage = useCallback(
    (nextLang: LanguageCode, options?: { announce?: boolean }) => {
      setLanguageState(nextLang);
      voiceGuidanceManager.setLanguage(nextLang);
      if (options?.announce) {
        const nextDict = getDictionary(nextLang);
        void voiceGuidanceManager.speak(nextDict.languageScreen.voiceConfirmed, {
          force: true,
          language: nextLang,
        });
      }
    },
    []
  );

  const setStage = useCallback((nextStage: WorkflowStage) => {
    setStageState(nextStage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const updateField = useCallback(
    (key: FieldKey, value: string, source: 'ocr' | 'qr' | 'voice' | 'manual' = 'manual') => {
      const normalizedValue = key === 'dob' ? normalizeDobFormat(value) || value : value;
      setFormData((prev) => ({ ...prev, [key]: normalizedValue }));
      setExtractionMeta((prev) => ({
        ...prev,
        [key]: {
          value: normalizedValue,
          confidence: normalizedValue.trim() ? 'high' : 'missing',
          score: normalizedValue.trim() ? 100 : 0,
          source,
          needsReview: false,
        },
      }));
    },
    []
  );

  const applyExtractedFields = useCallback((fields: ExtractionResultMap) => {
    setFormData((prev) => mergeExtractedFieldsIntoForm(prev, fields));
    setExtractionMeta((prev) => ({ ...prev, ...fields }));
  }, []);

  const resetSession = useCallback(() => {
    voiceGuidanceManager.stop();
    clearSessionToken();
    void ensureSessionToken().catch(() => {});
    setFormData(createEmptyFormData());
    setExtractionMeta({});
    setOcrResult(null);
    setQrResult(null);
    setConsentGiven(false);
    setSubmission(null);
    setStageState('welcome');
  }, []);

  const speak = useCallback(
    (text: string, force = false) => {
      void voiceGuidanceManager.speak(text, { force, language });
    },
    [language]
  );

  const value: KioskContextValue = {
    language,
    languageConfig,
    t,
    stage,
    formData,
    extractionMeta,
    ocrResult,
    qrResult,
    consentGiven,
    submission,
    voiceState,
    setLanguage,
    setStage,
    updateField,
    setFormData,
    applyExtractedFields,
    setOcrResult,
    setQrResult,
    setConsentGiven,
    setSubmission,
    resetSession,
    speak,
  };

  return <KioskContext.Provider value={value}>{children}</KioskContext.Provider>;
}

export function useKiosk(): KioskContextValue {
  const ctx = useContext(KioskContext);
  if (!ctx) throw new Error('useKiosk must be used inside KioskProvider');
  return ctx;
}
