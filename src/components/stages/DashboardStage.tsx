import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Download,
  FileCheck2,
  FileScan,
  LogIn,
  Mic,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConsentModal } from '@/src/components/ConsentModal';
import { useFirebase } from '@/src/context/FirebaseContext';
import { useKiosk } from '@/src/context/KioskContext';
import { countCompletedFields } from '@/src/modules/form/formSchema';
import { interpolate } from '@/src/modules/i18n';
import { generateApplicationPdf } from '@/src/modules/pdf/pdfGenerator';
import type { ServiceType, WorkflowStage } from '@/src/types/kiosk';

const SERVICE_TYPES: ServiceType[] = [
  'citizen_certificate',
  'pension_welfare',
  'ration_card',
  'bank_kyc',
];

export function DashboardStage() {
  const {
    language,
    languageConfig,
    t,
    formData,
    setFormData,
    setStage,
    consentGiven,
    setConsentGiven,
    draftRestored,
    speak,
    resetSession,
  } = useKiosk();

  const { user, signingIn, authError, savedSubmissions, signInWithGoogle } = useFirebase();
  const [pendingConsentTarget, setPendingConsentTarget] = useState<WorkflowStage | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-6">
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

        {draftRestored && (
          <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <span>{t.account.draftRestoredNotice}</span>
          </div>
        )}

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

        {/* 2 Primary Input Methods */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-5">
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

          {/* Option 2: Voice-Guided Form Filling */}
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

      {/* Firebase Cloud Draft Sync & Saved Applications */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        {!user ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-900 shrink-0">
                <Cloud className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t.account.cloudPromptTitle}</h2>
                <p className="mt-1 text-sm text-slate-600">{t.account.cloudPromptDesc}</p>
                {authError && (
                  <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
                    {t.account.signInError}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void signInWithGoogle()}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50 shrink-0 cursor-pointer"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              <span>{signingIn ? t.account.signingInStatus : t.account.signInBtn}</span>
            </button>
          </div>
        ) : (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
              <div className="flex items-center gap-2.5">
                <Cloud className="h-5 w-5 text-emerald-700 shrink-0" aria-hidden="true" />
                <h2 className="text-lg font-bold text-slate-900">
                  {t.account.savedApplicationsTitle}
                </h2>
              </div>
              <span className="text-sm font-semibold text-slate-600">
                {interpolate(t.account.signedInAs, {
                  name: user.displayName || user.email || '',
                })}
              </span>
            </div>

            {savedSubmissions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">{t.account.noSavedApplications}</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {savedSubmissions.map((rec) => (
                  <li
                    key={rec.referenceId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                  >
                    <div>
                      <div className="text-base font-bold text-slate-900">
                        {t.dashboard.services[rec.formSummary.serviceType]}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-600 tabular-nums">
                        <span className="font-mono font-semibold text-slate-800">
                          {rec.referenceId}
                        </span>
                        {' · '}
                        <span>
                          {new Date(rec.submittedAt).toLocaleString(languageConfig.speechCode)}
                        </span>
                        {' · '}
                        <span className="font-semibold text-emerald-800">
                          {t.completion.statusConfirmed}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={downloadingId === rec.referenceId}
                      onClick={async () => {
                        setDownloadingId(rec.referenceId);
                        try {
                          await generateApplicationPdf(rec, language);
                        } finally {
                          setDownloadingId(null);
                        }
                      }}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-50 shrink-0 cursor-pointer"
                    >
                      <Download className="h-4 w-4 text-blue-900" aria-hidden="true" />
                      <span>{t.account.downloadReceiptBtn}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
