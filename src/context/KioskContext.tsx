import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFirebase } from '@/src/context/FirebaseContext';
import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import {
  countCompletedFields,
  createEmptyFormData,
  mergeExtractedFieldsIntoForm,
} from '@/src/modules/form/formSchema';
import { getDictionary, type TranslationDictionary } from '@/src/modules/i18n';
import { getLanguageConfig, type LanguageConfig } from '@/src/modules/language/languages';
import { voiceGuidanceManager } from '@/src/modules/voice/voiceGuidanceManager';
import { clearSessionToken, ensureSessionToken } from '@/src/services/apiClient';
import {
  clearActiveDraft,
  ensureUserAccountDocs,
  loadActiveDraft,
  saveActiveDraft,
  saveUserPreferredLanguage,
} from '@/src/services/firebaseService';
import type {
  CitizenFormData,
  ExtractionResultMap,
  FieldKey,
  LanguageCode,
  OcrScanResult,
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
  consentGiven: boolean;
  submission: SubmissionRecord | null;
  voiceState: VoiceState;
  draftRestored: boolean;
  setLanguage: (lang: LanguageCode, options?: { announce?: boolean }) => void;
  setStage: (stage: WorkflowStage) => void;
  updateField: (key: FieldKey, value: string, source?: 'ocr' | 'voice' | 'manual') => void;
  setFormData: React.Dispatch<React.SetStateAction<CitizenFormData>>;
  applyExtractedFields: (fields: ExtractionResultMap) => void;
  setOcrResult: (res: OcrScanResult | null) => void;
  setConsentGiven: (accepted: boolean) => void;
  setSubmission: (rec: SubmissionRecord | null) => void;
  resetSession: () => void;
  speak: (text: string, force?: boolean) => void;
}

const KioskContext = createContext<KioskContextValue | null>(null);

export function KioskProvider({ children }: { children: React.ReactNode }) {
  const { user, authReady } = useFirebase();

  const [language, setLanguageState] = useState<LanguageCode>('en');
  const [stage, setStageState] = useState<WorkflowStage>('welcome');
  const [formData, setFormData] = useState<CitizenFormData>(createEmptyFormData);
  const [extractionMeta, setExtractionMeta] = useState<ExtractionResultMap>({});
  const [ocrResult, setOcrResult] = useState<OcrScanResult | null>(null);
  const [consentGiven, setConsentGiven] = useState<boolean>(false);
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>(() => voiceGuidanceManager.getState());
  const [draftRestored, setDraftRestored] = useState(false);

  const syncedUidRef = useRef<string | null>(null);
  const formDataRef = useRef<CitizenFormData>(formData);
  const languageRef = useRef<LanguageCode>(language);
  formDataRef.current = formData;
  languageRef.current = language;

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

  // Bootstrap Firestore user profile and restore cloud draft on sign-in
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      syncedUidRef.current = null;
      setDraftRestored(false);
      return;
    }
    if (syncedUidRef.current === user.uid) return;
    syncedUidRef.current = user.uid;

    let cancelled = false;
    (async () => {
      try {
        await ensureUserAccountDocs(user, languageRef.current);
        const cloudDraft = await loadActiveDraft(user.uid);
        if (cancelled || !cloudDraft) return;

        // Only restore if the user hasn't already entered fields locally
        if (countCompletedFields(formDataRef.current).filled === 0) {
          const draftProgress = countCompletedFields(cloudDraft.formData);
          if (draftProgress.filled > 0) {
            setFormData(cloudDraft.formData);
            setConsentGiven(cloudDraft.consentGiven);
            setDraftRestored(true);
          }
        }
      } catch (err) {
        console.error('Failed to sync user profile or draft:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  // Debounced auto-save of active form draft to Firestore when signed in
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;
    if (syncedUidRef.current !== user.uid) return;
    if (submission) return;

    const progress = countCompletedFields(formData);
    if (progress.filled === 0 && !consentGiven) return;

    const timer = setTimeout(() => {
      void saveActiveDraft(user.uid, formData, language, consentGiven).catch((err) => {
        console.error('Auto-save draft failed:', err);
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [authReady, user, formData, language, consentGiven, submission]);

  const languageConfig = useMemo(() => getLanguageConfig(language), [language]);
  const t = useMemo(() => getDictionary(language), [language]);

  const setLanguage = useCallback(
    (nextLang: LanguageCode, options?: { announce?: boolean }) => {
      setLanguageState(nextLang);
      voiceGuidanceManager.setLanguage(nextLang);
      if (user && user.emailVerified && syncedUidRef.current === user.uid) {
        void saveUserPreferredLanguage(
          user.uid,
          nextLang,
          user.displayName || 'Citizen User'
        ).catch(() => {});
      }
      if (options?.announce) {
        const nextDict = getDictionary(nextLang);
        void voiceGuidanceManager.speak(nextDict.languageScreen.voiceConfirmed, {
          force: true,
          language: nextLang,
        });
      }
    },
    [user]
  );

  const setStage = useCallback((nextStage: WorkflowStage) => {
    setStageState(nextStage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const updateField = useCallback(
    (key: FieldKey, value: string, source: 'ocr' | 'voice' | 'manual' = 'manual') => {
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
    if (user && user.emailVerified) {
      void clearActiveDraft(user.uid).catch(() => {});
    }
    setFormData(createEmptyFormData());
    setExtractionMeta({});
    setOcrResult(null);
    setConsentGiven(false);
    setSubmission(null);
    setDraftRestored(false);
    setStageState('welcome');
  }, [user]);

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
    consentGiven,
    submission,
    voiceState,
    draftRestored,
    setLanguage,
    setStage,
    updateField,
    setFormData,
    applyExtractedFields,
    setOcrResult,
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
