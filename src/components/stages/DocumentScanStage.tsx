import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileUp,
  Loader2,
  Mic,
  MicOff,
  Plus,
  RotateCcw,
  RotateCw,
  ScanText,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import { autoFormatDobInput, normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { interpolate } from '@/src/modules/i18n';
import { mergeOcrFieldMaps } from '@/src/modules/ocr/fieldParser';
import { scanDocumentPagesWithOcr } from '@/src/modules/ocr/ocrScanner';
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

const CAMERA_ZOOM_OPTIONS = [1, 1.5, 2] as const;
const MAX_DOCUMENT_PAGES = 4;

interface QueuedDocumentPage {
  id: string;
  dataUrl: string;
  rotation: 0 | 90 | 180 | 270;
}

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

  const [pages, setPages] = useState<QueuedDocumentPage[]>([]);
  const [appendToExisting, setAppendToExisting] = useState(false);
  const [useAiVerification, setUseAiVerification] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanningPageInfo, setScanningPageInfo] = useState<{ current: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraZoom, setCameraZoom] = useState<(typeof CAMERA_ZOOM_OPTIONS)[number]>(1);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
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
  const previousOcrResultRef = useRef<typeof ocrResult>(null);

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
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!cameraActive) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    const handleReady = () => {
      void video.play().catch(() => {
        // Autoplay blocked fallback handled by user interaction
      });
    };

    if (video.readyState >= 1) {
      handleReady();
    } else {
      video.addEventListener('loadedmetadata', handleReady, { once: true });
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleReady);
    };
  }, [cameraActive]);

  const startCamera = async () => {
    setErrorMsg(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(t.ocr.cameraDenied);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 2560 },
          height: { ideal: 1440 },
        },
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        } catch {
          // Focus mode constraint not supported on all cameras; ignore
        }
      }

      streamRef.current = stream;
      setCameraZoom(1);
      setCameraActive(true);
    } catch {
      setErrorMsg(t.ocr.cameraDenied);
    }
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || isCapturingPhoto) return;
    setIsCapturingPhoto(true);
    setErrorMsg(null);

    try {
      const cropSourceToCanvas = (
        source: CanvasImageSource,
        srcW: number,
        srcH: number
      ): string | null => {
        const zoomFactor = cameraZoom > 1 ? cameraZoom : 1;
        // Trim outer 4% border at 1x to align closer to the dashed guide box and exclude desk shadows
        const margin = zoomFactor === 1 ? 0.04 : 0;
        const cw = Math.max(1, Math.round((srcW / zoomFactor) * (1 - margin * 2)));
        const ch = Math.max(1, Math.round((srcH / zoomFactor) * (1 - margin * 2)));
        const sx = Math.max(0, Math.round((srcW - cw) / 2));
        const sy = Math.max(0, Math.round((srcH - ch) / 2));

        const targetW = Math.min(2400, Math.max(1600, cw));
        const targetH = Math.round(targetW * (ch / cw));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, sx, sy, cw, ch, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/jpeg', 0.95);
      };

      let dataUrl: string | null = null;

      // Prefer full-sensor hardware still photo when ImageCapture is available
      const track = streamRef.current?.getVideoTracks()[0];
      const ImageCaptureCtor = (
        window as unknown as {
          ImageCapture?: new (tr: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
        }
      ).ImageCapture;

      if (track && ImageCaptureCtor) {
        try {
          const cap = new ImageCaptureCtor(track);
          const photoBlob = await cap.takePhoto();
          const bitmap = await createImageBitmap(photoBlob);
          dataUrl = cropSourceToCanvas(bitmap, bitmap.width, bitmap.height);
          bitmap.close();
        } catch {
          // Fall back cleanly to video stream canvas
        }
      }

      if (!dataUrl) {
        dataUrl = cropSourceToCanvas(video, video.videoWidth, video.videoHeight);
      }

      if (dataUrl) {
        setPages((prev) => {
          if (prev.length >= MAX_DOCUMENT_PAGES) {
            setErrorMsg(t.ocr.maxPagesNotice);
            return prev;
          }
          return [
            ...prev,
            {
              id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              dataUrl,
              rotation: 0,
            },
          ];
        });
        setOcrResult(null);
        stopCamera();
      }
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (fileList.length === 0) return;
    setErrorMsg(null);

    const remainingSlots = MAX_DOCUMENT_PAGES - pages.length;
    if (remainingSlots <= 0) {
      setErrorMsg(t.ocr.maxPagesNotice);
      return;
    }

    const acceptedFiles = fileList.slice(0, remainingSlots);
    if (fileList.length > remainingSlots) {
      setErrorMsg(t.ocr.maxPagesNotice);
    }

    const readPromises = acceptedFiles.map(
      (file) =>
        new Promise<QueuedDocumentPage | null>((resolve) => {
          const validType =
            file.type === 'image/jpeg' ||
            file.type === 'image/jpg' ||
            file.type === 'image/png' ||
            file.type === 'image/webp';
          if (!validType || file.size > 10 * 1024 * 1024) {
            setErrorMsg(t.ocr.invalidFileError);
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              dataUrl: String(reader.result),
              rotation: 0,
            });
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        })
    );

    const loaded = (await Promise.all(readPromises)).filter(
      (p): p is QueuedDocumentPage => p !== null
    );
    if (loaded.length > 0) {
      setPages((prev) => [...prev, ...loaded].slice(0, MAX_DOCUMENT_PAGES));
      setOcrResult(null);
    }
  };

  const rotatePage = (pageId: string, delta: 90 | 270) => {
    setPages((prev) =>
      prev.map((p) =>
        p.id === pageId
          ? { ...p, rotation: ((p.rotation + delta) % 360) as 0 | 90 | 180 | 270 }
          : p
      )
    );
  };

  const removePage = (pageId: string) => {
    setPages((prev) => prev.filter((p) => p.id !== pageId));
  };

  const handleRunOcr = async () => {
    if (pages.length === 0) return;
    if (!consentGiven) {
      setConsentGiven(true);
    }

    setErrorMsg(null);
    setVoiceErrorBanner(null);
    setAllResultBanner(null);
    setIsScanning(true);
    setProgress(0);
    setScanningPageInfo({ current: 1, total: pages.length });
    speak(t.ocr.voiceScanning, true);

    try {
      const prevFields: ExtractionResultMap = appendToExisting ? { ...draftFields } : {};
      const prevRaw = appendToExisting && previousOcrResultRef.current?.rawText
        ? previousOcrResultRef.current.rawText.trim()
        : '';

      const result = await scanDocumentPagesWithOcr(
        pages.map((p) => ({ dataUrl: p.dataUrl, rotationDeg: p.rotation })),
        {
          language,
          useAiVerification,
          consentGiven: true,
          onProgress: (pct) => setProgress(pct),
          onPageProgress: (current, total, pct) => {
            setScanningPageInfo({ current, total });
            setProgress(pct);
          },
        }
      );

      let combinedFields = appendToExisting
        ? mergeOcrFieldMaps(prevFields, result.fields)
        : { ...result.fields };

      if (combinedFields.dob?.value) {
        const normDob = normalizeDobFormat(combinedFields.dob.value);
        if (normDob) {
          combinedFields.dob = { ...combinedFields.dob, value: normDob };
        }
      }

      const foundCount = Object.values(combinedFields).filter((f) => f && f.value).length;
      const combinedRawText = [prevRaw, result.rawText.trim()].filter(Boolean).join('\n\n');
      if (foundCount === 0 && combinedRawText.trim().length < 4) {
        setErrorMsg(t.ocr.noTextFound);
        speak(t.ocr.voiceFailed, true);
        setIsScanning(false);
        setScanningPageInfo(null);
        return;
      }

      const warnings = new Set<string>(result.warnings);
      if (appendToExisting && previousOcrResultRef.current?.warnings) {
        previousOcrResultRef.current.warnings.forEach((w) => warnings.add(w));
      }

      setOcrResult({
        rawText: combinedRawText,
        fields: combinedFields,
        overallConfidence: result.overallConfidence,
        engine: result.engine,
        preprocessedDataUrl: result.preprocessedDataUrl || pages[0].dataUrl,
        warnings: Array.from(warnings),
      });
      setDraftFields(combinedFields);
      setAppendToExisting(false);
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
      setScanningPageInfo(null);
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
            <div className="space-y-1">
              <p className="text-sm sm:text-base font-medium text-slate-700">{t.ocr.instructions}</p>
              <p className="text-xs sm:text-sm text-blue-900 font-medium">{t.ocr.multiPageHint}</p>
            </div>

            {/* Upload / Camera action buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={(e) => void handleFileChange(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={pages.length >= MAX_DOCUMENT_PAGES || isScanning}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl bg-blue-900 px-5 py-3 text-base font-bold text-white hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
              >
                <FileUp className="h-5 w-5" aria-hidden="true" />
                <span>{t.ocr.uploadBtn}</span>
              </button>

              {!cameraActive ? (
                <button
                  type="button"
                  disabled={pages.length >= MAX_DOCUMENT_PAGES || isScanning}
                  onClick={startCamera}
                  className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-base font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
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

              {appendToExisting && previousOcrResultRef.current && (
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setPages([]);
                    setAppendToExisting(false);
                    setOcrResult(previousOcrResultRef.current);
                    previousOcrResultRef.current = null;
                  }}
                  className="inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <span>{t.app.cancelBtn}</span>
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
                <div className="relative mx-auto aspect-video w-full max-w-2xl overflow-hidden rounded-lg bg-black flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ transform: cameraZoom > 1 ? `scale(${cameraZoom})` : undefined }}
                    className="h-full w-full object-contain transition-transform duration-150"
                  />
                  {/* Framing guide overlay aligned with 4% inner capture crop */}
                  <div className="pointer-events-none absolute inset-4 rounded-lg border-2 border-dashed border-white/85" />
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <div className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
                    <ZoomIn className="ml-1.5 mr-1 h-4 w-4 text-slate-300" aria-hidden="true" />
                    {CAMERA_ZOOM_OPTIONS.map((z) => (
                      <button
                        key={z}
                        type="button"
                        onClick={() => setCameraZoom(z)}
                        className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer ${
                          cameraZoom === z
                            ? 'bg-white text-slate-900'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {z}x
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={isCapturingPhoto}
                    onClick={() => void captureFromCamera()}
                    className="inline-flex min-h-[52px] items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                  >
                    {isCapturingPhoto ? (
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Camera className="h-5 w-5" aria-hidden="true" />
                    )}
                    <span>{isCapturingPhoto ? t.ocr.processingStatus : t.ocr.captureBtn}</span>
                  </button>
                </div>
              </div>
            )}

            {/* Selected Multi-Page Image Queue + Per-Page Rotation + AI Toggle */}
            {pages.length > 0 && !cameraActive && (
              <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {pages.length < MAX_DOCUMENT_PAGES && (
                      <>
                        <button
                          type="button"
                          disabled={isScanning}
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-900 bg-white px-3.5 py-2 text-sm font-bold text-blue-900 hover:bg-blue-50 disabled:opacity-50 cursor-pointer"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          <span>{t.ocr.addAnotherBtn}</span>
                        </button>
                        <button
                          type="button"
                          disabled={isScanning}
                          onClick={startCamera}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                        >
                          <Camera className="h-4 w-4 text-blue-900" aria-hidden="true" />
                          <span>{t.ocr.cameraBtn}</span>
                        </button>
                      </>
                    )}
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

                <div className={`grid gap-4 ${pages.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
                  {pages.map((page, index) => (
                    <div
                      key={page.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center rounded-md bg-blue-900 px-2.5 py-1 text-xs font-bold text-white">
                          {interpolate(t.ocr.pageLabel, { num: index + 1 })}
                        </span>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isScanning}
                            onClick={() => rotatePage(page.id, 270)}
                            aria-label={`${t.ocr.rotateLeft} (${interpolate(t.ocr.pageLabel, { num: index + 1 })})`}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{t.ocr.rotateLeft}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isScanning}
                            onClick={() => rotatePage(page.id, 90)}
                            aria-label={`${t.ocr.rotateRight} (${interpolate(t.ocr.pageLabel, { num: index + 1 })})`}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                          >
                            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{t.ocr.rotateRight}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isScanning}
                            onClick={() => removePage(page.id)}
                            aria-label={`${t.ocr.removePageBtn} (${interpolate(t.ocr.pageLabel, { num: index + 1 })})`}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <img
                          src={page.dataUrl}
                          alt={interpolate(t.ocr.pageLabel, { num: index + 1 })}
                          style={{ transform: `rotate(${page.rotation}deg)` }}
                          className="max-h-[280px] object-contain transition-transform"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {isScanning ? (
                  <div className="space-y-2 py-2">
                    <div className="flex items-center justify-center gap-2.5 text-base font-semibold text-blue-900">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                      <span>
                        {scanningPageInfo && scanningPageInfo.total > 1
                          ? interpolate(t.ocr.scanProgressPage, {
                              current: scanningPageInfo.current,
                              total: scanningPageInfo.total,
                            })
                          : t.ocr.processingStatus}{' '}
                        ({progress}%)
                      </span>
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
                      onClick={() => void handleRunOcr()}
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
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    stopAllVoiceCaptures();
                    previousOcrResultRef.current = ocrResult;
                    setPages([]);
                    setAppendToExisting(true);
                    setOcrResult(null);
                    setErrorMsg(null);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-900 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-900 hover:bg-blue-100 cursor-pointer"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>{t.ocr.addAnotherBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopAllVoiceCaptures();
                    previousOcrResultRef.current = null;
                    setPages([]);
                    setAppendToExisting(false);
                    setOcrResult(null);
                    setErrorMsg(null);
                  }}
                  className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                >
                  {t.ocr.rescanBtn}
                </button>
              </div>
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
