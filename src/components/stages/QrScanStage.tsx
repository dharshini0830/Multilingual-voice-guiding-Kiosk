import { AlertTriangle, ArrowRight, Camera, CheckCircle2, FileUp, Loader2, ShieldAlert, X, ZoomIn } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import {
  decodeQrFromFrameAsync,
  decodeQrFromImageFile,
  parseQrPayload,
} from '@/src/modules/qr/qrScanner';

const ZOOM_OPTIONS = [1, 1.5, 2] as const;

export function QrScanStage() {
  const { t, qrResult, setQrResult, applyExtractedFields, setStage, speak } = useKiosk();

  const [cameraActive, setCameraActive] = useState(false);
  const [isCheckingSnap, setIsCheckingSnap] = useState(false);
  const [isProcessingUpload, setIsProcessingUpload] = useState(false);
  const [zoom, setZoom] = useState<(typeof ZOOM_OPTIONS)[number]>(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanActiveRef = useRef(false);
  const frameCounterRef = useRef(0);
  const zoomRef = useRef<(typeof ZOOM_OPTIONS)[number]>(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = () => {
    scanActiveRef.current = false;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!qrResult) {
      speak(t.qr.voiceGuide);
    }
    return () => {
      stopCamera();
    };
  }, []);

  const handleDecodedPayload = (decoded: string) => {
    stopCamera();
    setErrorMsg(null);
    const parsed = parseQrPayload(decoded);
    setQrResult(parsed);
    if (parsed.isStructuredIdentity) {
      speak(t.qr.voiceSuccess, true);
    } else {
      setErrorMsg(t.qr.unsupportedFormat);
      speak(t.qr.voiceError, true);
    }
  };

  const runAsyncScanTick = async () => {
    if (!scanActiveRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !streamRef.current) return;

    frameCounterRef.current += 1;
    try {
      const decoded = await decodeQrFromFrameAsync(video, canvas, frameCounterRef.current, {
        exhaustive: false,
        zoom: zoomRef.current,
      });
      if (decoded && scanActiveRef.current) {
        handleDecodedPayload(decoded);
        return;
      }
    } catch {
      // ignore transient frame error and continue scanning
    }

    if (scanActiveRef.current) {
      timerRef.current = setTimeout(() => {
        void runAsyncScanTick();
      }, 110);
    }
  };

  useEffect(() => {
    if (!cameraActive) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    let cancelled = false;
    video.srcObject = stream;

    const beginLoop = () => {
      if (cancelled || !scanActiveRef.current) return;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void runAsyncScanTick();
    };

    const handleLoadedMetadata = () => {
      void video.play().then(beginLoop).catch(beginLoop);
    };

    if (video.readyState >= 1) {
      handleLoadedMetadata();
    } else {
      video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [cameraActive]);

  const handleZoomChange = (nextZoom: (typeof ZOOM_OPTIONS)[number]) => {
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  };

  const handleManualSnapDecode = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    setIsCheckingSnap(true);
    setErrorMsg(null);
    try {
      const decoded = await decodeQrFromFrameAsync(video, canvas, 1, {
        exhaustive: true,
        zoom: zoomRef.current,
      });
      if (decoded) {
        handleDecodedPayload(decoded);
      } else {
        setErrorMsg(t.qr.invalidQrError);
        speak(t.qr.voiceError, true);
      }
    } finally {
      setIsCheckingSnap(false);
    }
  };

  const startCamera = async () => {
    setErrorMsg(null);
    setQrResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(t.qr.cameraError);
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

      // Enable continuous autofocus if the camera hardware supports it
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        try {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
          });
        } catch {
          // Focus constraint unsupported on this webcam; ignore
        }
      }

      streamRef.current = stream;
      scanActiveRef.current = true;
      frameCounterRef.current = 0;
      setCameraActive(true);
    } catch {
      setErrorMsg(t.qr.cameraError);
      speak(t.qr.voiceError, true);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    stopCamera();
    setErrorMsg(null);
    setQrResult(null);
    setIsProcessingUpload(true);

    try {
      const parsed = await decodeQrFromImageFile(file);
      setQrResult(parsed);
      if (parsed.isStructuredIdentity) {
        speak(t.qr.voiceSuccess, true);
      } else {
        setErrorMsg(t.qr.unsupportedFormat);
        speak(t.qr.voiceError, true);
      }
    } catch {
      setErrorMsg(t.qr.invalidQrError);
      speak(t.qr.voiceError, true);
    } finally {
      setIsProcessingUpload(false);
    }
  };

  const handleApplyAndContinue = () => {
    if (!qrResult) return;
    applyExtractedFields(qrResult.fields);
    setStage('voice-form');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.qr.title}</h1>
            <p className="mt-1.5 text-base text-slate-600">{t.qr.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setStage('dashboard');
            }}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
          >
            {t.app.backToDashboard}
          </button>
        </div>

        <p className="mt-5 text-sm sm:text-base font-medium text-slate-700">{t.qr.instructions}</p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!cameraActive ? (
            <button
              type="button"
              disabled={isProcessingUpload}
              onClick={startCamera}
              className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl bg-slate-900 px-5 py-3 text-base font-bold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
              <span>{t.qr.startCameraBtn}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-5 py-3 text-base font-bold text-red-800 hover:bg-red-100 cursor-pointer"
            >
              <X className="h-5 w-5" aria-hidden="true" />
              <span>{t.qr.stopCameraBtn}</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            disabled={isProcessingUpload}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-[52px] items-center gap-2.5 rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-base font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
          >
            {isProcessingUpload ? (
              <Loader2 className="h-5 w-5 animate-spin text-blue-900" aria-hidden="true" />
            ) : (
              <FileUp className="h-5 w-5 text-blue-900" aria-hidden="true" />
            )}
            <span>{isProcessingUpload ? t.ocr.processingStatus : t.qr.uploadQrBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopCamera();
              setStage('voice-form');
            }}
            className="inline-flex min-h-[52px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <span>{t.qr.manualFallbackBtn}</span>
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm sm:text-base font-medium text-red-900"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {cameraActive && (
          <div className="mt-6 rounded-xl border border-slate-300 bg-slate-950 p-4">
            <div className="relative mx-auto max-w-lg overflow-hidden rounded-lg flex items-center justify-center bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ transform: zoom > 1 ? `scale(${zoom})` : undefined }}
                className="w-full max-h-[420px] object-cover transition-transform duration-150"
              />
              {/* Centered square target matching physical Aadhaar QR proportions */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="aspect-square w-56 sm:w-64 rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.38)]" />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <p className="text-sm font-semibold text-white">{t.qr.scanningActive}</p>

              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1">
                <ZoomIn className="ml-1.5 mr-1 h-4 w-4 text-slate-300" aria-hidden="true" />
                {ZOOM_OPTIONS.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => handleZoomChange(z)}
                    className={`min-h-[36px] rounded-md px-2.5 py-1 text-xs font-bold cursor-pointer ${
                      zoom === z
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
                disabled={isCheckingSnap}
                onClick={() => void handleManualSnapDecode()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
              >
                {isCheckingSnap ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Camera className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{isCheckingSnap ? t.ocr.processingStatus : t.ocr.captureBtn}</span>
              </button>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {qrResult && (
          <div className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                <span>{t.qr.detectedTitle}</span>
              </div>
              <span className="text-xs font-semibold text-slate-600 font-mono">
                {t.qr.formatLabel}: {qrResult.format}
              </span>
            </div>

            {/* Mandatory Untrusted QR Data Warning */}
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-sm font-medium text-amber-950">
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5 text-amber-800" aria-hidden="true" />
              <span>{t.qr.unverifiedWarning}</span>
            </div>

            {qrResult.warnings.length > 0 && (
              <div className="space-y-1 text-sm font-medium text-slate-700">
                {qrResult.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}

            {qrResult.isStructuredIdentity ? (
              <>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(qrResult.fields).map(([key, meta]) => {
                    if (!meta?.value) return null;
                    const label =
                      t.form.fields[key as keyof typeof t.form.fields]?.label ?? key;
                    return (
                      <div key={key} className="rounded-lg border border-slate-200 bg-white p-3.5">
                        <dt className="text-xs font-semibold text-slate-500">{label}</dt>
                        <dd className="mt-1 text-base font-bold text-slate-900 break-words">
                          {meta.value}
                        </dd>
                      </div>
                    );
                  })}
                </dl>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleApplyAndContinue}
                    className="inline-flex min-h-[54px] items-center gap-2.5 rounded-xl bg-blue-900 px-7 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
                  >
                    <span>{t.qr.applyBtn}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700 break-all">
                {qrResult.rawPayload}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
