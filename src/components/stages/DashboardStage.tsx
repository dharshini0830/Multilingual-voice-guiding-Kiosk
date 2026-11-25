import { ArrowRight, FileCheck2, FileScan, Mic, QrCode, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConsentModal } from '@/src/components/ConsentModal';
import { useKiosk } from '@/src/context/KioskContext';
import { interpolate } from '@/src/modules/i18n';
import { countCompletedFields } from '@/src/modules/form/formSchema';
import type { ServiceType, WorkflowStage } from '@/src/types/kiosk';

const SERVICE_TYPES: ServiceType[] = [
  'citizen_certificate',
  'pension_welfare',
  'ration_card',
  'bank_kyc',
];

export function DashboardStage() {
  const {
    t,
    formData,
    setFormData,
    setStage,
    consentGiven,
    setConsentGiven,
    speak,
    resetSession,
  } = useKiosk();

  const [pendingConsentTarget, setPendingConsentTarget] = useState<WorkflowStage | null>(null);

  useEffect(() => {
    speak(t.dashboard.voicePrompt);
  }, [speak, t.dashboard.voicePrompt]);

  const progress = countCompletedFields(formData);

  const openProtectedFlow = (target: WorkflowStage) => {
    if (target === 'document-scan' && !consentGiven) {
      setPendingConsentTarget(target);
      return;
    }
    setStage(target);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{t.dashboard.title}</h1>
            <p className="mt-1.5 text-base text-slate-600">{t.dashboard.subtitle}</p>
          </div>
          <div className="text-sm font-semibold text-slate-700 tabular-nums shrink-0">
            {interpolate(t.dashboard.filledProgress, {
              filled: progress.filled,
              total: progress.total,
            })}
          </div>
        </div>

        {/* Service Type Selection */}
        <div className="mt-6">
          <label className="block text-base font-bold text-slate-900">
            {t.dashboard.serviceTypeLabel}
          </label>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SERVICE_TYPES.map((svc) => {
              const active = formData.serviceType === svc;
              return (
                <button
                  key={svc}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, serviceType: svc }))}
                  className={`min-h-[52px] rounded-xl border-2 px-4 py-3 text-left text-base font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'border-blue-900 bg-blue-50 text-blue-950'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                  }`}
                >
                  {t.dashboard.services[svc]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3 Primary Input Methods */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Option 1: OCR Document Scan */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-300 bg-slate-50/70 p-6">
            <div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-900 text-white">
                <FileScan className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                {t.dashboard.cards.ocrTitle}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-700 leading-relaxed">
                {t.dashboard.cards.ocrDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openProtectedFlow('document-scan')}
              className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-blue-900 px-4 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
            >
              <span>{t.dashboard.cards.ocrBtn}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Option 2: QR Code Scan */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-300 bg-slate-50/70 p-6">
            <div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-white">
                <QrCode className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                {t.dashboard.cards.qrTitle}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-700 leading-relaxed">
                {t.dashboard.cards.qrDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStage('qr-scan')}
              className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-base font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              <span>{t.dashboard.cards.qrBtn}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Option 3: Voice-Guided Form Filling */}
          <div className="flex flex-col justify-between rounded-xl border border-slate-300 bg-slate-50/70 p-6">
            <div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-orange-700 text-white">
                <Mic className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-xl font-bold text-slate-900">
                {t.dashboard.cards.voiceTitle}
              </h2>
              <p className="mt-2 text-sm sm:text-base text-slate-700 leading-relaxed">
                {t.dashboard.cards.voiceDesc}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStage('voice-form')}
              className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-orange-700 px-4 py-3 text-base font-bold text-white hover:bg-orange-800 cursor-pointer"
            >
              <span>{t.dashboard.cards.voiceBtn}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Bottom Review / Clear Strip */}
        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={resetSession}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span>{t.dashboard.resetDraftBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => setStage('review')}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-2 border-blue-900 bg-white px-6 py-3 text-base font-bold text-blue-900 hover:bg-blue-50 cursor-pointer"
          >
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
            <span>{t.dashboard.reviewNowBtn}</span>
          </button>
        </div>
      </div>

      <ConsentModal
        open={pendingConsentTarget !== null}
        onDecline={() => setPendingConsentTarget(null)}
        onAccept={() => {
          setConsentGiven(true);
          const next = pendingConsentTarget;
          setPendingConsentTarget(null);
          if (next) setStage(next);
        }}
      />
    </div>
  );
}
