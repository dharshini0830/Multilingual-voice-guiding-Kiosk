import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileUp,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  RotateCw,
  ScanText,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import { autoFormatDobInput, normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { interpolate } from '@/src/modules/i18n';
import { scanDocumentWithOcr } from '@/src/modules/ocr/ocrScanner';
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
import type { ExtractedFieldMeta, ExtractionResultMap, FieldKey } from '@/src/types/kiosk';

const EDITABLE_OCR_FIELDS: Array<Exclude<FieldKey, 'serviceType'>> = [
  'fullName',
  'idNumber',
  'dob',
  'gender',
  'fatherName',
  'phoneNumber',
  'address',
  'pincode',
];

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

export function DocumentScanStage() {
  const {
    language,
    t,
    consentGiven,
    setConsentGiven,
    ocrResult,
    setOcrResult,
    applyExtractedFields,
    setStage,
    speak,
  } = useKiosk();

  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [useAiVerification, setUseAiVerification] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [showRawText, setShowRawText] = useState(false);

  // Editable extraction draft (user reviews and corrects via keyboard or voice before applying)
  const [draftFields, setDraftFields] = useState<ExtractionResultMap>({});

  // Voice-fill inside OCR Review state
  const [browserSttAvailable, setBrowserSttAvailable] = useState(() => isBrowserSttSupported());
  const [activeVoiceField, setActiveVoiceField] = useState<Exclude<FieldKey, 'serviceType'> | null>(null);
  const [fieldVoiceMode, setFieldVoiceMode] = useState<'idle' | 'listening' | 'recording' | 'transcribing'>('idle');
  const [fieldInterim, setFieldInterim] = useState('');
  const [voiceErrorBanner, setVoiceErrorBanner] = useState<string | null>(null);

  // Multi-field ("Speak All Details") inside OCR Review state
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const fieldSttRef = useRef<{ stop: () => void } | null>(null);
  const fieldRecorderRef = useRef<ClipRecorderHandle | null>(null);
  const stopFieldClipRef = useRef<((key: Exclude<FieldKey, 'serviceType'>) => Promise<void>) | null>(null);

  const allSttRef = useRef<{ stop: () => void } | null>(null);
  const allRecorderRef = useRef<ClipRecorderHandle | null>(null);
  const stopAllClipRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (ocrResult) {
      // Ensure any DOB extracted from OCR is formatted cleanly on load
      const nextDraft = { ...ocrResult.fields };
      if (nextDraft.dob?.value) {
        const normDob = normalizeDobFormat(nextDraft.dob.value);
        if (normDob) {
          nextDraft.dob = { ...nextDraft.dob, value: normDob };
        }
      }
      setDraftFields(nextDraft);
    } else {
      speak(t.ocr.voiceStartGuide);
    }
  }, []);

  const stopAllVoiceCaptures = () => {
    voiceGuidanceManager.stop();
    fieldSttRef.current?.stop();
    fieldSttRef.current = null;
    fieldRecorderRef.current?.cancel();
    fieldRecorderRef.current = null;
    setActiveVoiceField(null);
    setFieldVoiceMode('idle');
    setFieldInterim('');

    allSttRef.current?.stop();
    allSttRef.current = null;
    allRecorderRef.current?.cancel();
    allRecorderRef.current = null;
    setIsAllListening(false);
    setIsAllRecording(false);
    setAllInterimText('');
    setAllAudioLevel(0);
  };

  // Stop camera & voice capture on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      stopAllVoiceCaptures();
    };
  }, []);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  const startCamera = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(t.ocr.cameraDenied);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch {
      setErrorMsg(t.ocr.cameraDenied);
    }
  };

  const captureFromCamera = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    setSourceImageUrl(dataUrl);
    setRotation(0);
    setOcrResult(null);
    stopCamera();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);

    const validType =
      file.type === 'image/jpeg' ||
      file.type === 'image/jpg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp';
    if (!validType || file.size > 10 * 1024 * 1024) {
      setErrorMsg(t.ocr.invalidFileError);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSourceImageUrl(String(reader.result));
      setRotation(0);
      setOcrResult(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRunOcr = async () => {
    if (!sourceImageUrl) return;
    if (!consentGiven) {
      setConsentGiven(true);
    }

    setErrorMsg(null);
    setVoiceErrorBanner(null);
    setAllResultBanner(null);
    setIsScanning(true);
    setProgress(0);
    speak(t.ocr.voiceScanning, true);

    try {
      const result = await scanDocumentWithOcr(sourceImageUrl, {
        language,
        rotationDeg: rotation,
        useAiVerification,
        consentGiven: true,
        onProgress: setProgress,
      });

      const foundCount = Object.values(result.fields).filter((f) => f && f.value).length;
      if (foundCount === 0 && result.rawText.trim().length < 4) {
        setErrorMsg(t.ocr.noTextFound);
        speak(t.ocr.voiceFailed, true);
        setIsScanning(false);
        return;
      }

      const normalizedFields = { ...result.fields };
      if (normalizedFields.dob?.value) {
        const normDob = normalizeDobFormat(normalizedFields.dob.value);
        if (normDob) {
          normalizedFields.dob = { ...normalizedFields.dob, value: normDob };
        }
      }

      setOcrResult({ ...result, fields: normalizedFields });
      setDraftFields(normalizedFields);
      if (foundCount >= 4) {
        speak(t.ocr.voiceSuccess, true);
      } else {
        speak(t.ocr.voicePartial, true);
      }
    } catch {
      setErrorMsg(t.ocr.noTextFound);
      speak(t.ocr.voiceFailed, true);
    } finally {
      setIsScanning(false);
    }
  };

  const updateDraftField = (
    key: Exclude<FieldKey, 'serviceType'>,
    val: string,
    source: 'ocr' | 'voice' = 'ocr'
  ) => {
    const prevVal = draftFields[key]?.value ?? '';
    const nextVal = key === 'dob' ? autoFormatDobInput(val, prevVal) : val;

    setDraftFields((prev) => ({
      ...prev,
      [key]: {
        value: nextVal,
        confidence: nextVal.trim() ? 'high' : 'missing',
        score: nextVal.trim() ? 100 : 0,
        source,
        needsReview: false,
      },
    }));
  };

  // --- Per-field Voice Refill inside OCR Review ---
  const applySpokenToField = (key: Exclude<FieldKey, 'serviceType'>, rawTranscript: string) => {
    const cleaned = normalizeSpokenAnswer(rawTranscript, key);
    if (!cleaned) {
      speak(t.form.voiceUnclear, true);
      return;
    }
    const finalVal = key === 'dob' ? normalizeDobFormat(cleaned) || cleaned : cleaned;
    setDraftFields((prev) => ({
      ...prev,
      [key]: {
        value: finalVal,
        confidence: 'high',
        score: 100,
        source: 'voice',
        needsReview: false,
      },
    }));

    const spokenVal =
      key === 'gender' && (finalVal === 'Male' || finalVal === 'Female' || finalVal === 'Other')
        ? t.form.genders[finalVal]
        : finalVal;
    speak(`${t.form.fields[key].label}: ${spokenVal}`, true);
  };

  const finishFieldClipRecording = async (key: Exclude<FieldKey, 'serviceType'>) => {
    const rec = fieldRecorderRef.current;
    if (!rec) return;
    fieldRecorderRef.current = null;
    setFieldVoiceMode('transcribing');
    try {
      const transcript = await rec.stopAndTranscribe();
      if (transcript) {
        applySpokenToField(key, transcript);
      } else {
        speak(t.form.voiceUnclear, true);
      }
    } catch {
      setVoiceErrorBanner(t.form.sttUnavailableNotice);
    } finally {
      setActiveVoiceField(null);
      setFieldVoiceMode('idle');
      setFieldInterim('');
    }
  };
  stopFieldClipRef.current = finishFieldClipRecording;

  const startFieldClipFallback = async (key: Exclude<FieldKey, 'serviceType'>) => {
    if (!isMediaRecorderSupported()) {
      setVoiceErrorBanner(t.form.sttUnavailableNotice);
      setActiveVoiceField(null);
      setFieldVoiceMode('idle');
      return;
    }
    try {
      voiceGuidanceManager.stop();
      const rec = await startVoiceClipRecorder(language, t.form.fields[key].label, {
        maxDurationMs: 20000,
        silenceTimeoutMs: 2000,
        onAutoSilence: () => {
          void stopFieldClipRef.current?.(key);
        },
      });
      fieldRecorderRef.current = rec;
      setActiveVoiceField(key);
      setFieldVoiceMode('recording');
    } catch (err) {
      setActiveVoiceField(null);
      setFieldVoiceMode('idle');
      setVoiceErrorBanner(isMicPermissionError(err) ? t.form.micDenied : t.form.sttUnavailableNotice);
    }
  };

  const handleToggleFieldVoice = async (key: Exclude<FieldKey, 'serviceType'>) => {
    // If clicking Stop on currently active field
    if (activeVoiceField === key) {
      if (fieldVoiceMode === 'listening') {
        fieldSttRef.current?.stop();
      } else if (fieldVoiceMode === 'recording') {
        await finishFieldClipRecording(key);
      }
      return;
    }

    stopAllVoiceCaptures();
    setVoiceErrorBanner(null);
    setAllResultBanner(null);

    if (!browserSttAvailable) {
      await startFieldClipFallback(key);
      return;
    }

    setActiveVoiceField(key);
    setFieldVoiceMode('listening');
    setFieldInterim('');

    const handle = startBrowserSpeechRecognition({
      language,
      onInterim: (txt) => setFieldInterim(txt),
      onFinal: (txt) => {
        fieldSttRef.current = null;
        setActiveVoiceField(null);
        setFieldVoiceMode('idle');
        setFieldInterim('');
        applySpokenToField(key, txt);
      },
      onError: (reason) => {
        fieldSttRef.current = null;
        setFieldInterim('');
        if (reason === 'not-supported' || reason === 'network') {
          if (reason === 'not-supported') setBrowserSttAvailable(false);
          void startFieldClipFallback(key);
        } else if (reason === 'permission-denied') {
          setActiveVoiceField(null);
          setFieldVoiceMode('idle');
          setVoiceErrorBanner(t.form.micDenied);
        } else if (reason === 'no-speech') {
          setActiveVoiceField(null);
          setFieldVoiceMode('idle');
          speak(t.form.voiceUnclear, true);
        } else {
          setActiveVoiceField(null);
          setFieldVoiceMode('idle');
          if (reason !== 'aborted') {
            setVoiceErrorBanner(t.form.sttUnavailableNotice);
          }
        }
      },
      onEnd: () => {
        setActiveVoiceField((curr) => (curr === key ? null : curr));
        setFieldVoiceMode('idle');
      },
    });
    fieldSttRef.current = handle;
  };

  // --- Multi-Field ("Speak All Details") inside OCR Review ---
  const processAllOcrSpokenInput = async (input: {
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

      const updatedEntries = EDITABLE_OCR_FIELDS.filter((k) =>
        Boolean(extractedFields[k]?.value?.trim())
      );

      if (updatedEntries.length === 0) {
        setAllResultBanner({
          type: 'warn',
          message: t.form.speakAllNoMatch,
          transcript: transcript || input.transcript,
        });
        speak(t.form.speakAllNoMatch, true);
        return;
      }

      setDraftFields((prev) => {
        const next = { ...prev };
        for (const key of updatedEntries) {
          const meta = extractedFields[key]!;
          const cleanVal = key === 'dob' ? normalizeDobFormat(meta.value) || meta.value : meta.value;
          next[key] = {
            ...meta,
            value: cleanVal,
            score: 96,
            confidence: 'high',
            source: 'voice',
            needsReview: false,
          };
        }
        return next;
      });

      const msg = interpolate(t.form.speakAllSuccess, { count: updatedEntries.length });
      setAllResultBanner({
        type: 'success',
        message: msg,
        transcript: transcript || input.transcript,
      });
      speak(msg, true);
    } catch {
      setAllResultBanner({ type: 'warn', message: t.form.speakAllNoMatch });
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
      await processAllOcrSpokenInput({ audioBase64, mimeType });
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
      const rec = await startVoiceClipRecorder(language, 'correct scanned document details', {
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

  const handleToggleAllVoice = () => {
    if (isAllListening) {
      allSttRef.current?.stop();
      return;
    }
    if (isAllRecording) {
      void stopAndProcessAllClip();
      return;
    }

    stopAllVoiceCaptures();
    setVoiceErrorBanner(null);
    setAllResultBanner(null);

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
        void processAllOcrSpokenInput({ transcript: txt });
      },
      onError: (reason) => {
        allSttRef.current = null;
        setIsAllListening(false);
        setAllInterimText('');
        if (reason === 'permission-denied') {
          setAllResultBanner({ type: 'warn', message: t.form.micDenied });
        } else if (reason === 'not-supported' || reason === 'network') {
          if (reason === 'not-supported') setBrowserSttAvailable(false);
          void startAllClipRecorder();
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

  const handleApplyAndContinue = () => {
    stopAllVoiceCaptures();
    const cleanedDraft = { ...draftFields };
    if (cleanedDraft.dob?.value) {
      const norm = normalizeDobFormat(cleanedDraft.dob.value);
      if (norm) {
        cleanedDraft.dob = { ...cleanedDraft.dob, value: norm };
      }
    }
    applyExtractedFields(cleanedDraft);
    setStage('voice-form');
  };

  const renderConfidenceLabel = (meta?: ExtractedFieldMeta) => {
    if (!meta || !meta.value) {
      return <span className="text-xs font-semibold text-slate-500">{t.ocr.confidenceMissing}</span>;
    }
    if (meta.confidence === 'high') {
      return <span className="text-xs font-semibold text-emerald-700">{t.ocr.confidenceHigh} ({meta.score}%)</span>;
    }
    if (meta.confidence === 'medium') {
      return <span className="text-xs font-semibold text-amber-700">{t.ocr.confidenceMedium} ({meta.score}%)</span>;
    }
    return <span className="text-xs font-semibold text-red-700">{t.ocr.confidenceLow} ({meta.score}%)</span>;
  };

  const anyAllActive = isAllListening || isAllRecording;
  const anyFieldActive = activeVoiceField !== null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.ocr.title}</h1>
            <p className="mt-1.5 text-base text-slate-600">{t.ocr.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              stopAllVoiceCaptures();
              setStage('dashboard');
            }}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
          >
            {t.app.backToDashboard}
          </button>
        </div>

        {/* Step A: Upload / Camera Capture (when not yet reviewed) */}
        {!ocrResult && (
          <div className="mt-6 space-y-6">
            <p className="text-sm sm:text-base font-medium text-slate-700">{t.ocr.instructions}</p>

            {/* Upload / Camera action buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl bg-blue-900 px-5 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
              >
                <FileUp className="h-5 w-5" aria-hidden="true" />
                <span>{t.ocr.uploadBtn}</span>
              </button>

              {!cameraActive ? (
                <button
                  type="button"
                  onClick={startCamera}
                  className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-base font-bold text-slate-900 hover:bg-slate-100 cursor-pointer"
                >
                  <Camera className="h-5 w-5 text-blue-900" aria-hidden="true" />
                  <span>{t.ocr.cameraBtn}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-5 py-3 text-base font-bold text-red-800 hover:bg-red-100 cursor-pointer"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                  <span>{t.ocr.stopCameraBtn}</span>
                </button>
              )}
            </div>

            {errorMsg && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm sm:text-base font-medium text-red-900">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Live Camera Preview */}
            {cameraActive && (
              <div className="space-y-4 rounded-xl border border-slate-300 bg-slate-950 p-4">
                <div className="relative overflow-hidden rounded-lg">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="mx-auto max-h-[380px] w-full object-contain"
                  />
                  {/* Framing guide overlay */}
                  <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/80" />
                </div>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={captureFromCamera}
                    className="inline-flex min-h-[52px] items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-bold text-slate-900 hover:bg-slate-100 cursor-pointer"
                  >
                    <Camera className="h-5 w-5" aria-hidden="true" />
                    <span>{t.ocr.captureBtn}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Selected Image Preview + Rotation + AI Toggle */}
            {sourceImageUrl && !cameraActive && (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (((r + 270) % 360) as 0 | 90 | 180 | 270))}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span>{t.ocr.rotateLeft}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270))}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                    >
                      <RotateCw className="h-4 w-4" aria-hidden="true" />
                      <span>{t.ocr.rotateRight}</span>
                    </button>
                  </div>

                  <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAiVerification}
                      onChange={(e) => setUseAiVerification(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-400 text-blue-900"
                    />
                    <span>{t.ocr.aiEnhanceToggle}</span>
                  </label>
                </div>

                <div className="flex justify-center overflow-hidden rounded-lg border border-slate-300 bg-white p-3">
                  <img
                    src={sourceImageUrl}
                    alt="Document preview"
                    style={{ transform: `rotate(${rotation}deg)` }}
                    className="max-h-[340px] object-contain transition-transform"
                  />
                </div>

                {isScanning ? (
                  <div className="space-y-2 py-2">
                    <div className="flex items-center justify-center gap-2.5 text-base font-semibold text-blue-900">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <span>{t.ocr.processingStatus} ({progress}%)</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-blue-900 transition-all duration-200"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleRunOcr}
                      className="inline-flex min-h-[54px] items-center gap-2.5 rounded-xl bg-blue-900 px-7 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
                    >
                      <ScanText className="h-5 w-5" aria-hidden="true" />
                      <span>{t.ocr.processBtn}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step B: OCR Review & Voice / Manual Correction */}
        {ocrResult && (
          <div className="mt-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{t.ocr.reviewTitle}</h2>
                <p className="mt-1 text-sm sm:text-base text-slate-600">{t.ocr.reviewSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopAllVoiceCaptures();
                  setOcrResult(null);
                  setErrorMsg(null);
                }}
                className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                {t.ocr.rescanBtn}
              </button>
            </div>

            {ocrResult.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
                {ocrResult.warnings.map((w, idx) => (
                  <p key={idx}>{w}</p>
                ))}
              </div>
            )}

            {/* Integrated Voice Re-fill Module inside OCR Review */}
            <div className="rounded-xl border-2 border-blue-200 bg-blue-50/70 p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-blue-950 font-bold text-lg">
                    <Sparkles className="h-5 w-5 text-blue-800 shrink-0" aria-hidden="true" />
                    <h3>{t.ocr.voiceRefillTitle}</h3>
                  </div>
                  <p className="text-sm text-slate-700">{t.ocr.voiceRefillDesc}</p>
                  <p className="text-xs sm:text-sm italic text-slate-600">{t.form.speakAllExample}</p>
                </div>

                <button
                  type="button"
                  disabled={isAllProcessing || anyFieldActive}
                  onClick={handleToggleAllVoice}
                  className={`inline-flex min-h-[52px] shrink-0 items-center justify-center gap-2.5 rounded-xl px-5 py-3 text-base font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
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
                <p className="mt-3 rounded-lg border border-blue-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-800">
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
                  <p className="font-bold">{allResultBanner.message}</p>
                  {allResultBanner.transcript && (
                    <p className="mt-1 text-xs opacity-90">“{allResultBanner.transcript}”</p>
                  )}
                </div>
              )}
            </div>

            {voiceErrorBanner && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm font-medium text-amber-950">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{voiceErrorBanner}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {EDITABLE_OCR_FIELDS.map((key) => {
                const meta = draftFields[key];
                const fieldText = t.form.fields[key];
                const value = meta?.value ?? '';
                const isThisFieldActive = activeVoiceField === key;
                const isThisFieldBusy =
                  isThisFieldActive &&
                  (fieldVoiceMode === 'listening' ||
                    fieldVoiceMode === 'recording' ||
                    fieldVoiceMode === 'transcribing');

                return (
                  <div
                    key={key}
                    className={`rounded-xl border p-4 transition-colors ${
                      isThisFieldActive
                        ? 'border-blue-900 bg-blue-50/40'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <label htmlFor={`ocr-${key}`} className="text-sm font-bold text-slate-900 block">
                          {fieldText.label}
                        </label>
                        {renderConfidenceLabel(meta)}
                      </div>

                      <button
                        type="button"
                        disabled={anyAllActive || isAllProcessing || (anyFieldActive && !isThisFieldActive)}
                        onClick={() => void handleToggleFieldVoice(key)}
                        aria-label={`${t.ocr.speakFieldBtn}: ${fieldText.label}`}
                        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 ${
                          isThisFieldActive && fieldVoiceMode === 'transcribing'
                            ? 'border-blue-900 bg-blue-900 text-white'
                            : isThisFieldActive
                              ? 'border-red-700 bg-red-700 text-white'
                              : 'border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100'
                        }`}
                      >
                        {isThisFieldActive && fieldVoiceMode === 'transcribing' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : isThisFieldActive ? (
                          <MicOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Mic className="h-4 w-4 text-orange-700" aria-hidden="true" />
                        )}
                        <span>
                          {isThisFieldActive && fieldVoiceMode === 'transcribing'
                            ? t.form.transcribingStatus
                            : isThisFieldActive
                              ? t.form.stopListeningBtn
                              : t.ocr.speakFieldBtn}
                        </span>
                      </button>
                    </div>

                    {isThisFieldBusy && (
                      <p className="mt-2 text-xs font-semibold text-blue-900">
                        {fieldVoiceMode === 'transcribing'
                          ? t.form.transcribingStatus
                          : fieldInterim
                            ? `${t.form.listeningBtn}: ${fieldInterim}`
                            : t.form.listeningBtn}
                      </p>
                    )}

                    {key === 'gender' ? (
                      <select
                        id={`ocr-${key}`}
                        value={value}
                        onChange={(e) => updateDraftField(key, e.target.value)}
                        className="mt-2 min-h-[46px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                      >
                        <option value="">—</option>
                        <option value="Male">{t.form.genders.Male}</option>
                        <option value="Female">{t.form.genders.Female}</option>
                        <option value="Other">{t.form.genders.Other}</option>
                      </select>
                    ) : key === 'address' ? (
                      <textarea
                        id={`ocr-${key}`}
                        rows={2}
                        value={value}
                        onChange={(e) => updateDraftField(key, e.target.value)}
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                      />
                    ) : (
                      <input
                        id={`ocr-${key}`}
                        type="text"
                        maxLength={key === 'dob' ? 24 : undefined}
                        placeholder={key === 'dob' ? fieldText.hint : undefined}
                        value={value}
                        onChange={(e) => {
                          let next = e.target.value;
                          if (key === 'idNumber' || key === 'phoneNumber' || key === 'pincode') {
                            next = next.replace(/\D/g, '');
                          }
                          updateDraftField(key, next);
                        }}
                        onBlur={() => {
                          if (key === 'dob' && value) {
                            const norm = normalizeDobFormat(value);
                            if (norm && norm !== value) {
                              updateDraftField('dob', norm);
                            }
                          }
                        }}
                        className="mt-2 min-h-[46px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {ocrResult.rawText && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowRawText((s) => !s)}
                  className="text-sm font-semibold text-blue-900 hover:underline cursor-pointer"
                >
                  {t.ocr.rawTextToggle}
                </button>
                {showRawText && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700 whitespace-pre-wrap">
                    {ocrResult.rawText}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={handleApplyAndContinue}
                className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-xl bg-blue-900 px-7 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
              >
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                <span>{t.ocr.applyToFormBtn}</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
