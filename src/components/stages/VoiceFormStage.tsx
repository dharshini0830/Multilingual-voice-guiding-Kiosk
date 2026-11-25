import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCheck2,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import { autoFormatDobInput, normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { FORM_FIELDS_ORDER, mergeExtractedFieldsIntoForm } from '@/src/modules/form/formSchema';
import { interpolate } from '@/src/modules/i18n';
import { validateEntireForm, validateField } from '@/src/modules/validation/formValidator';
import {
  isBrowserSttSupported,
  isMediaRecorderSupported,
  normalizeSpokenAnswer,
  startBrowserSpeechRecognition,
  startVoiceClipRecorder,
  type ClipRecorderHandle,
} from '@/src/modules/voice/sttEngine';
import { parseSpokenDetailsToForm } from '@/src/modules/voice/voiceFormParser';
import { voiceGuidanceManager } from '@/src/modules/voice/voiceGuidanceManager';
import type { FieldKey } from '@/src/types/kiosk';

function isMicPermissionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const msg = (err as { message?: string }).message ?? '';
  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    /permission|denied|not allowed/i.test(msg)
  );
}

export function VoiceFormStage() {
  const { language, t, formData, updateField, applyExtractedFields, setStage, speak } = useKiosk();

  const [fieldIdx, setFieldIdx] = useState(0);

  // Single-field voice state
  const [isListening, setIsListening] = useState(false);
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<string | null>(null);
  const [sttNotice, setSttNotice] = useState<string | null>(null);
  const [browserSttAvailable, setBrowserSttAvailable] = useState(() => isBrowserSttSupported());

  // Multi-field ("Tell All Details by Voice") state
  const [isAllListening, setIsAllListening] = useState(false);
  const [isAllRecording, setIsAllRecording] = useState(false);
  const [isAllProcessing, setIsAllProcessing] = useState(false);
  const [allInterimText, setAllInterimText] = useState('');
  const [allAudioLevel, setAllAudioLevel] = useState(0);
  const [allResultBanner, setAllResultBanner] = useState<{
    type: 'success' | 'warn';
    message: string;
    transcript?: string;
  } | null>(null);

  const activeSttRef = useRef<{ stop: () => void } | null>(null);
  const clipRecorderRef = useRef<ClipRecorderHandle | null>(null);
  const stopSingleClipRef = useRef<(() => Promise<void>) | null>(null);

  const allSttRef = useRef<{ stop: () => void } | null>(null);
  const allRecorderRef = useRef<ClipRecorderHandle | null>(null);
  const stopAllClipRef = useRef<(() => Promise<void>) | null>(null);

  const suppressFieldSpeakRef = useRef(false);
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  const currentDescriptor = FORM_FIELDS_ORDER[fieldIdx];
  const currentKey = currentDescriptor.key as Exclude<FieldKey, 'serviceType'>;
  const fieldCopy = t.form.fields[currentKey];
  const currentValue = formData[currentKey] ?? '';

  // Speak question whenever field or language changes
  useEffect(() => {
    setPendingConfirmation(null);
    setInterimText('');
    setSttNotice(null);

    if (suppressFieldSpeakRef.current) {
      suppressFieldSpeakRef.current = false;
    } else {
      speak(fieldCopy.voiceQuestion, true);
    }

    return () => {
      activeSttRef.current?.stop();
      clipRecorderRef.current?.cancel();
      clipRecorderRef.current = null;
      setIsListening(false);
      setIsRecordingClip(false);
    };
  }, [fieldIdx, language]);

  // Cleanup multi-field listeners only on unmount or language change
  useEffect(() => {
    return () => {
      allSttRef.current?.stop();
      allRecorderRef.current?.cancel();
      allRecorderRef.current = null;
    };
  }, [language]);

  const stopAnyActiveCapture = () => {
    voiceGuidanceManager.stop();
    activeSttRef.current?.stop();
    activeSttRef.current = null;
    clipRecorderRef.current?.cancel();
    clipRecorderRef.current = null;
    setIsListening(false);
    setIsRecordingClip(false);

    allSttRef.current?.stop();
    allSttRef.current = null;
    allRecorderRef.current?.cancel();
    allRecorderRef.current = null;
    setIsAllListening(false);
    setIsAllRecording(false);
    setAllAudioLevel(0);
  };

  // --- Multi-Field ("Speak All Details") Logic ---
  const processAllSpokenInput = async (input: {
    transcript?: string;
    audioBase64?: string;
    mimeType?: string;
  }) => {
    setIsAllProcessing(true);
    setAllInterimText('');
    try {
      const { transcript, extractedFields } = await parseSpokenDetailsToForm({
        ...input,
        language,
      });

      const filledKeys = Object.keys(extractedFields).filter(
        (k) => Boolean(extractedFields[k as FieldKey]?.value?.trim())
      );

      if (filledKeys.length === 0) {
        setAllResultBanner({
          type: 'warn',
          message: t.form.speakAllNoMatch,
          transcript: transcript || input.transcript,
        });
        speak(t.form.speakAllNoMatch, true);
        return;
      }

      const nextSnapshot = mergeExtractedFieldsIntoForm(formDataRef.current, extractedFields);
      applyExtractedFields(extractedFields);

      const countMsg = interpolate(t.form.speakAllSuccess, { count: filledKeys.length });
      setAllResultBanner({
        type: 'success',
        message: countMsg,
        transcript: transcript || input.transcript,
      });
      speak(countMsg, true);

      // Move focus to the first field that still needs attention, if any
      const validation = validateEntireForm(nextSnapshot, t);
      if (!validation.isValid) {
        const firstMissingIdx = FORM_FIELDS_ORDER.findIndex((f) =>
          validation.invalidFields.includes(f.key)
        );
        if (firstMissingIdx >= 0 && firstMissingIdx !== fieldIdx) {
          suppressFieldSpeakRef.current = true;
          setFieldIdx(firstMissingIdx);
        }
      }
    } catch {
      setAllResultBanner({
        type: 'warn',
        message: t.form.speakAllNoMatch,
      });
      speak(t.form.speakAllNoMatch, true);
    } finally {
      setIsAllProcessing(false);
    }
  };

  const stopAndProcessAllClip = async () => {
    const rec = allRecorderRef.current;
    if (!rec) return;
    allRecorderRef.current = null;
    setIsAllRecording(false);
    setAllAudioLevel(0);
    setIsAllProcessing(true);
    try {
      const { audioBase64, mimeType } = await rec.stopAndGetAudio();
      if (!audioBase64) {
        setIsAllProcessing(false);
        setAllResultBanner({ type: 'warn', message: t.form.speakAllNoMatch });
        speak(t.form.speakAllNoMatch, true);
        return;
      }
      await processAllSpokenInput({ audioBase64, mimeType });
    } catch {
      setIsAllProcessing(false);
      setAllResultBanner({ type: 'warn', message: t.form.sttUnavailableNotice });
    }
  };
  stopAllClipRef.current = stopAndProcessAllClip;

  const startAllClipRecorder = async () => {
    if (!isMediaRecorderSupported()) {
      setAllResultBanner({ type: 'warn', message: t.form.sttUnavailableNotice });
      return;
    }
    try {
      const rec = await startVoiceClipRecorder(language, 'complete citizen form details', {
        maxDurationMs: 45000,
        silenceTimeoutMs: 2800,
        onVolume: (lvl) => setAllAudioLevel(lvl),
        onAutoSilence: () => {
          void stopAllClipRef.current?.();
        },
      });
      allRecorderRef.current = rec;
      setIsAllRecording(true);
    } catch (err) {
      setAllResultBanner({
        type: 'warn',
        message: isMicPermissionError(err) ? t.form.micDenied : t.form.sttUnavailableNotice,
      });
    }
  };

  const handleStartSpeakAll = () => {
    stopAnyActiveCapture();
    setAllResultBanner(null);
    setAllInterimText('');

    if (!browserSttAvailable) {
      void startAllClipRecorder();
      return;
    }

    setIsAllListening(true);
    const handle = startBrowserSpeechRecognition({
      language,
      continuous: true,
      onInterim: (txt) => setAllInterimText(txt),
      onFinal: (txt) => {
        allSttRef.current = null;
        setIsAllListening(false);
        void processAllSpokenInput({ transcript: txt });
      },
      onError: (reason) => {
        allSttRef.current = null;
        setIsAllListening(false);
        setAllInterimText('');
        if (reason === 'permission-denied') {
          setAllResultBanner({ type: 'warn', message: t.form.micDenied });
        } else if (reason === 'not-supported' || reason === 'network') {
          if (reason === 'not-supported') setBrowserSttAvailable(false);
          if (isMediaRecorderSupported()) {
            void startAllClipRecorder();
          } else {
            setAllResultBanner({ type: 'warn', message: t.form.sttUnavailableNotice });
          }
        } else if (reason === 'no-speech') {
          setAllResultBanner({ type: 'warn', message: t.form.speakAllNoMatch });
          speak(t.form.speakAllNoMatch, true);
        } else if (reason !== 'aborted') {
          setAllResultBanner({ type: 'warn', message: t.form.sttUnavailableNotice });
        }
      },
      onEnd: () => {
        setIsAllListening(false);
      },
    });
    allSttRef.current = handle;
  };

  const handleStopSpeakAll = () => {
    if (isAllListening) {
      allSttRef.current?.stop();
    } else if (isAllRecording) {
      void stopAndProcessAllClip();
    }
  };

  // --- Single-Field Voice Logic ---
  const handleRecognizedAnswer = (rawTranscript: string) => {
    const cleaned = normalizeSpokenAnswer(rawTranscript, currentKey);
    if (!cleaned) {
      speak(t.form.voiceUnclear, true);
      return;
    }

    // Immediately populate the form field so spoken data is never lost when moving fields
    updateField(currentKey, cleaned, 'voice');
    setPendingConfirmation(cleaned);

    const displayValue =
      currentKey === 'gender' && (cleaned === 'Male' || cleaned === 'Female' || cleaned === 'Other')
        ? t.form.genders[cleaned]
        : cleaned;
    speak(interpolate(t.form.voiceReadback, { value: displayValue }), true);
  };

  const finishSingleClipRecording = async () => {
    const rec = clipRecorderRef.current;
    if (!rec) return;
    clipRecorderRef.current = null;
    setIsRecordingClip(false);
    setIsTranscribing(true);
    try {
      const transcript = await rec.stopAndTranscribe();
      if (transcript) {
        handleRecognizedAnswer(transcript);
      } else {
        speak(t.form.voiceUnclear, true);
      }
    } catch {
      setSttNotice(t.form.sttUnavailableNotice);
    } finally {
      setIsTranscribing(false);
    }
  };
  stopSingleClipRef.current = finishSingleClipRecording;

  const startClipFallback = async () => {
    if (!isMediaRecorderSupported()) {
      setSttNotice(t.form.sttUnavailableNotice);
      return;
    }
    try {
      voiceGuidanceManager.stop();
      const rec = await startVoiceClipRecorder(language, fieldCopy.label, {
        maxDurationMs: 20000,
        silenceTimeoutMs: 2000,
        onAutoSilence: () => {
          void stopSingleClipRef.current?.();
        },
      });
      clipRecorderRef.current = rec;
      setIsRecordingClip(true);
    } catch (err) {
      setSttNotice(isMicPermissionError(err) ? t.form.micDenied : t.form.sttUnavailableNotice);
    }
  };

  const handleStartListening = () => {
    stopAnyActiveCapture();
    setSttNotice(null);
    setPendingConfirmation(null);
    setInterimText('');

    if (!browserSttAvailable) {
      void startClipFallback();
      return;
    }

    setIsListening(true);
    const handle = startBrowserSpeechRecognition({
      language,
      onInterim: (txt) => setInterimText(txt),
      onFinal: (txt) => {
        activeSttRef.current = null;
        setIsListening(false);
        setInterimText('');
        handleRecognizedAnswer(txt);
      },
      onError: (reason) => {
        activeSttRef.current = null;
        setIsListening(false);
        setInterimText('');
        if (reason === 'not-supported' || reason === 'network') {
          if (reason === 'not-supported') {
            setBrowserSttAvailable(false);
          }
          if (isMediaRecorderSupported()) {
            void startClipFallback();
          } else {
            setSttNotice(t.form.sttUnavailableNotice);
          }
        } else if (reason === 'permission-denied') {
          setSttNotice(t.form.micDenied);
        } else if (reason === 'no-speech') {
          speak(t.form.voiceUnclear, true);
        } else if (reason !== 'aborted') {
          setSttNotice(t.form.sttUnavailableNotice);
        }
      },
      onEnd: () => {
        setIsListening(false);
      },
    });
    activeSttRef.current = handle;
  };

  const handleStopListening = () => {
    activeSttRef.current?.stop();
    setIsListening(false);
  };

  const handleToggleClipRecord = async () => {
    if (!isRecordingClip) {
      stopAnyActiveCapture();
      setSttNotice(null);
      setPendingConfirmation(null);
      await startClipFallback();
    } else {
      await finishSingleClipRecording();
    }
  };

  const handleConfirmSpoken = () => {
    if (pendingConfirmation === null) return;
    updateField(currentKey, pendingConfirmation, 'voice');
    setPendingConfirmation(null);
    if (fieldIdx < FORM_FIELDS_ORDER.length - 1) {
      setFieldIdx((i) => i + 1);
    } else {
      handleFinishToReview(pendingConfirmation);
    }
  };

  const handleFinishToReview = (overrideCurrentValue?: string) => {
    const snapshot =
      overrideCurrentValue !== undefined
        ? { ...formData, [currentKey]: overrideCurrentValue }
        : formData;
    const summary = validateEntireForm(snapshot, t);
    if (!summary.isValid) {
      const missingNames = summary.invalidFields
        .map((k) => t.form.fields[k].label)
        .join(', ');
      speak(interpolate(t.validation.voiceMissingSummary, { fields: missingNames }), true);
      const firstInvalid = FORM_FIELDS_ORDER.findIndex((f) =>
        summary.invalidFields.includes(f.key)
      );
      if (firstInvalid >= 0) {
        setFieldIdx(firstInvalid);
      }
      return;
    }
    speak(t.form.voiceAllComplete, true);
    setStage('review');
  };

  const currentValidation = validateField(currentKey, currentValue, t);
  const overallSummary = validateEntireForm(formData, t);
  const anyAllActive = isAllListening || isAllRecording;
  const anySingleActive = isListening || isRecordingClip;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        {/* Header & Progress */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.form.title}</h1>
            <p className="mt-1 text-base text-slate-600">{t.form.subtitle}</p>
          </div>
          <div className="text-sm font-bold text-blue-900 tabular-nums shrink-0">
            {interpolate(t.form.questionProgress, {
              current: fieldIdx + 1,
              total: FORM_FIELDS_ORDER.length,
            })}
          </div>
        </div>

        {/* Tell All Details by Voice (Multi-Field Conversational Autofill) */}
        <div className="mt-5 rounded-xl border-2 border-blue-200 bg-blue-50/70 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-blue-950 font-bold text-lg">
                <Sparkles className="h-5 w-5 text-blue-800 shrink-0" aria-hidden="true" />
                <h2>{t.form.speakAllTitle}</h2>
              </div>
              <p className="text-sm text-slate-700">{t.form.speakAllDesc}</p>
              <p className="text-xs sm:text-sm italic text-slate-600">{t.form.speakAllExample}</p>
            </div>

            <button
              type="button"
              disabled={isAllProcessing || anySingleActive || isTranscribing}
              onClick={anyAllActive ? handleStopSpeakAll : handleStartSpeakAll}
              className={`inline-flex min-h-[54px] shrink-0 items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-base font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
                anyAllActive
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-blue-900 hover:bg-blue-800'
              }`}
            >
              {isAllProcessing ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : anyAllActive ? (
                <MicOff className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Mic className="h-5 w-5" aria-hidden="true" />
              )}
              <span>
                {isAllProcessing
                  ? t.form.transcribingStatus
                  : anyAllActive
                    ? t.form.stopListeningBtn
                    : t.form.speakAllBtn}
              </span>
            </button>
          </div>

          {isAllRecording && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs font-bold uppercase tracking-wide text-red-700">
                {t.form.listeningBtn}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-blue-200">
                <div
                  className="h-full bg-red-600 transition-all duration-100"
                  style={{ width: `${Math.max(10, Math.round(allAudioLevel * 100))}%` }}
                />
              </div>
            </div>
          )}

          {allInterimText && (
            <p className="mt-3 rounded-lg bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800 border border-blue-200">
              <span className="font-bold text-blue-900">{t.form.listeningBtn}: </span>
              {allInterimText}
            </p>
          )}

          {allResultBanner && (
            <div
              className={`mt-3 rounded-lg border p-3.5 text-sm font-medium ${
                allResultBanner.type === 'success'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                  : 'border-amber-300 bg-amber-50 text-amber-950'
              }`}
            >
              <div className="flex items-start gap-2">
                {allResultBanner.type === 'success' ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700 mt-0.5" aria-hidden="true" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber-700 mt-0.5" aria-hidden="true" />
                )}
                <div>
                  <p className="font-bold">{allResultBanner.message}</p>
                  {allResultBanner.transcript && (
                    <p className="mt-1 text-xs opacity-90">“{allResultBanner.transcript}”</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Field Jump Bar */}
        <div className="mt-5 flex flex-wrap gap-2">
          {FORM_FIELDS_ORDER.map((f, idx) => {
            const val = formData[f.key as Exclude<FieldKey, 'serviceType'>] ?? '';
            const valid = validateField(f.key, val, t).valid;
            const active = idx === fieldIdx;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFieldIdx(idx)}
                className={`min-h-[40px] rounded-lg border px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-blue-900 bg-blue-900 text-white'
                    : valid
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {idx + 1}. {t.form.fields[f.key].label}
              </button>
            );
          })}
        </div>

        {/* Active Question Card */}
        <div className="mt-6 rounded-xl border border-slate-300 bg-slate-50 p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                {fieldCopy.label}
              </h2>
              <p className="mt-1 text-base font-medium text-slate-700">{fieldCopy.voiceQuestion}</p>
              <p className="mt-1 text-sm text-slate-500">{fieldCopy.hint}</p>
            </div>
            <button
              type="button"
              onClick={() => speak(fieldCopy.voiceQuestion, true)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <Volume2 className="h-4 w-4 text-blue-900" aria-hidden="true" />
              <span>{t.voiceBar.replay}</span>
            </button>
          </div>

          {/* Speech Controls */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {browserSttAvailable && !isRecordingClip && (
              <button
                type="button"
                disabled={isTranscribing || anyAllActive || isAllProcessing}
                onClick={isListening ? handleStopListening : handleStartListening}
                className={`inline-flex min-h-[56px] items-center gap-2.5 rounded-xl px-6 py-3.5 text-base font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
                  isListening
                    ? 'bg-red-700 hover:bg-red-800'
                    : 'bg-orange-700 hover:bg-orange-800'
                }`}
              >
                {isListening ? (
                  <MicOff className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Mic className="h-5 w-5" aria-hidden="true" />
                )}
                <span>{isListening ? t.form.stopListeningBtn : t.form.speakAnswerBtn}</span>
              </button>
            )}

            {isMediaRecorderSupported() && !isListening && (
              <button
                type="button"
                disabled={isTranscribing || anyAllActive || isAllProcessing}
                onClick={handleToggleClipRecord}
                className={`inline-flex min-h-[56px] items-center gap-2.5 rounded-xl border px-5 py-3.5 text-base font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                  isRecordingClip
                    ? 'border-red-700 bg-red-700 text-white'
                    : browserSttAvailable
                      ? 'border-slate-300 bg-white text-slate-900 hover:bg-slate-100'
                      : 'border-orange-700 bg-orange-700 text-white hover:bg-orange-800'
                }`}
              >
                {isTranscribing ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Mic
                    className={`h-5 w-5 ${isRecordingClip || !browserSttAvailable ? 'text-white' : 'text-blue-900'}`}
                    aria-hidden="true"
                  />
                )}
                <span>
                  {isTranscribing
                    ? t.form.transcribingStatus
                    : isRecordingClip
                      ? t.form.stopListeningBtn
                      : browserSttAvailable
                        ? t.form.recordFallbackBtn
                        : t.form.speakAnswerBtn}
                </span>
              </button>
            )}
          </div>

          {interimText && (
            <p className="mt-3 text-sm font-medium text-slate-700">
              {t.form.listeningBtn}: <span className="font-bold text-slate-900">{interimText}</span>
            </p>
          )}

          {sttNotice && (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm font-medium text-amber-950">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{sttNotice}</span>
            </div>
          )}

          {/* Read-back Confirmation Box for Spoken Input */}
          {pendingConfirmation !== null && (
            <div className="mt-5 rounded-xl border-2 border-blue-900 bg-white p-5">
              <p className="text-sm font-semibold text-blue-900">{t.form.recognizedPrefix}</p>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {currentKey === 'gender' &&
                (pendingConfirmation === 'Male' ||
                  pendingConfirmation === 'Female' ||
                  pendingConfirmation === 'Other')
                  ? t.form.genders[pendingConfirmation]
                  : pendingConfirmation}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {interpolate(t.form.confirmPrompt, { value: pendingConfirmation })}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleConfirmSpoken}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-base font-bold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  <Check className="h-5 w-5" aria-hidden="true" />
                  <span>{t.form.yesCorrectBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateField(currentKey, '', 'voice');
                    setPendingConfirmation(null);
                    handleStartListening();
                  }}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-base font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  <span>{t.form.repeatVoiceBtn}</span>
                </button>
              </div>
            </div>
          )}

          {/* Manual Input Fallback / Live Voice-Populated Field */}
          <div className="mt-6 border-t border-slate-200 pt-5">
            <label
              htmlFor={`field-input-${currentKey}`}
              className="block text-sm font-bold text-slate-800"
            >
              {t.form.typeInsteadLabel}
            </label>

            {currentKey === 'gender' ? (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(['Male', 'Female', 'Other'] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => updateField('gender', g, 'manual')}
                    className={`min-h-[52px] rounded-xl border-2 px-4 py-3 text-base font-bold cursor-pointer ${
                      currentValue === g
                        ? 'border-blue-900 bg-blue-50 text-blue-950'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {t.form.genders[g]}
                  </button>
                ))}
              </div>
            ) : currentDescriptor.inputType === 'textarea' ? (
              <textarea
                id={`field-input-${currentKey}`}
                rows={3}
                value={currentValue}
                maxLength={currentDescriptor.maxLength}
                onChange={(e) => updateField(currentKey, e.target.value, 'manual')}
                placeholder={fieldCopy.hint}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900"
              />
            ) : (
              <input
                id={`field-input-${currentKey}`}
                type={currentDescriptor.inputType}
                value={currentValue}
                maxLength={currentDescriptor.maxLength}
                onChange={(e) => {
                  let val = e.target.value;
                  if (currentKey === 'idNumber' || currentKey === 'phoneNumber' || currentKey === 'pincode') {
                    val = val.replace(/\D/g, '');
                  } else if (currentKey === 'dob') {
                    val = autoFormatDobInput(val, currentValue);
                  }
                  updateField(currentKey, val, 'manual');
                }}
                onBlur={() => {
                  if (currentKey === 'dob' && currentValue) {
                    const normalized = normalizeDobFormat(currentValue);
                    if (normalized && normalized !== currentValue) {
                      updateField('dob', normalized, 'manual');
                    }
                  }
                }}
                placeholder={fieldCopy.hint}
                className="mt-2 min-h-[54px] w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg font-medium text-slate-900"
              />
            )}

            {/* Field Validation Status */}
            {currentValue && !currentValidation.valid && currentValidation.error && (
              <p className="mt-2 text-sm font-semibold text-red-700">{currentValidation.error}</p>
            )}
            {currentValidation.warning && (
              <p className="mt-2 text-sm font-semibold text-amber-800">{currentValidation.warning}</p>
            )}
          </div>
        </div>

        {/* Overall Validation Banner */}
        <div className="mt-5 flex items-center justify-between gap-3 text-sm font-semibold">
          {overallSummary.isValid ? (
            <span className="text-emerald-800">{t.form.allFieldsValid}</span>
          ) : (
            <span className="text-amber-800">
              {interpolate(t.form.missingFieldsAlert, {
                count: overallSummary.invalidFields.length,
              })}
            </span>
          )}
        </div>

        {/* Navigation Footer */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            disabled={fieldIdx === 0}
            onClick={() => setFieldIdx((i) => Math.max(0, i - 1))}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{t.form.prevFieldBtn}</span>
          </button>

          <div className="flex flex-col sm:flex-row gap-3">
            {fieldIdx < FORM_FIELDS_ORDER.length - 1 && (
              <button
                type="button"
                onClick={() => setFieldIdx((i) => Math.min(FORM_FIELDS_ORDER.length - 1, i + 1))}
                className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-blue-900 px-6 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
              >
                <span>{t.form.nextFieldBtn}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => handleFinishToReview()}
              className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-base font-bold text-white hover:bg-emerald-800 cursor-pointer"
            >
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
              <span>{t.form.finishToReviewBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
