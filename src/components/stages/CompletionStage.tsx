import { CheckCircle2, Download, LogOut, PlusCircle, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import { generateApplicationPdf } from '@/src/modules/pdf/pdfGenerator';

export function CompletionStage() {
  const { language, languageConfig, t, submission, resetSession, speak } = useKiosk();
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (submission) {
      speak(t.completion.voiceSuccess, true);
    }
  }, [submission]);

  if (!submission) return null;

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      await generateApplicationPdf(submission, language);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleVoiceExit = () => {
    speak(t.completion.voiceExit, true);
    setTimeout(() => {
      resetSession();
    }, 1800);
  };

  return (
    <div className="no-print mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
        <div className="flex items-start gap-4 border-b border-slate-200 pb-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              {t.completion.title}
            </h1>
            <p className="mt-1.5 text-base text-slate-700">{t.completion.subtitle}</p>
          </div>
        </div>

        {/* Official Confirmation Details */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <div>
            <div className="text-xs font-semibold text-slate-500">
              {t.completion.referenceLabel}
            </div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
              {submission.referenceId}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">
              {t.completion.submittedAtLabel}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">
              {new Date(submission.submittedAt).toLocaleString(languageConfig.speechCode)}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">{t.completion.statusLabel}</div>
            <div className="mt-1 text-sm font-bold text-emerald-800">
              {t.completion.statusConfirmed}
            </div>
          </div>
        </div>

        {/* Summary Snapshot */}
        <dl className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200">
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1 px-5 py-3.5">
            <dt className="text-sm font-semibold text-slate-600">
              {t.form.fields.serviceType.label}
            </dt>
            <dd className="text-base font-bold text-slate-900">
              {t.dashboard.services[submission.formSummary.serviceType]}
            </dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1 px-5 py-3.5">
            <dt className="text-sm font-semibold text-slate-600">
              {t.form.fields.fullName.label}
            </dt>
            <dd className="text-base font-bold text-slate-900">
              {submission.formSummary.fullName}
            </dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1 px-5 py-3.5">
            <dt className="text-sm font-semibold text-slate-600">
              {t.form.fields.idNumber.label}
            </dt>
            <dd className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {submission.maskedIdNumber}
            </dd>
          </div>
          <div className="flex flex-col sm:flex-row sm:justify-between gap-1 px-5 py-3.5">
            <dt className="text-sm font-semibold text-slate-600">
              {t.form.fields.phoneNumber.label}
            </dt>
            <dd className="font-mono text-base font-bold text-slate-900 tabular-nums">
              {submission.formSummary.phoneNumber}
            </dd>
          </div>
        </dl>

        {/* Download PDF & Direct Print */}
        <div className="mt-8 flex flex-wrap items-center gap-3.5">
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDownloadPdf}
            className="inline-flex min-h-[54px] items-center gap-2.5 rounded-xl bg-blue-900 px-6 py-3 text-base font-bold text-white hover:bg-blue-800 cursor-pointer"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            <span>{t.completion.downloadPdfBtn}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex min-h-[54px] items-center gap-2.5 rounded-xl border-2 border-slate-900 bg-white px-6 py-3 text-base font-bold text-slate-900 hover:bg-slate-50 cursor-pointer"
          >
            <Printer className="h-5 w-5" aria-hidden="true" />
            <span>{t.completion.printBtn}</span>
          </button>
        </div>

        {/* New Form / Voice-Guided Exit */}
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={resetSession}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-base font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            <span>{t.completion.newApplicationBtn}</span>
          </button>

          <button
            type="button"
            onClick={handleVoiceExit}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-5 py-2.5 text-base font-semibold text-slate-900 hover:bg-slate-200 cursor-pointer"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>{t.completion.exitVoiceBtn}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
