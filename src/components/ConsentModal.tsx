import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useKiosk } from '@/src/context/KioskContext';

interface ConsentModalProps {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function ConsentModal({ open, onAccept, onDecline }: ConsentModalProps) {
  const { t, speak } = useKiosk();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (open) {
      setChecked(false);
      speak(t.consent.voicePrompt);
    }
  }, [open, speak, t.consent.voicePrompt]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-blue-50 p-2.5 text-blue-900 shrink-0">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 id="consent-dialog-title" className="text-xl font-bold text-slate-900">
              {t.consent.title}
            </h2>
            <p className="mt-2 text-base text-slate-700 leading-relaxed">{t.consent.body}</p>
          </div>
        </div>

        <ul className="mt-5 space-y-2.5 border-y border-slate-200 py-4 text-sm sm:text-base text-slate-800">
          {t.consent.points.map((pt, idx) => (
            <li key={idx} className="flex items-start gap-2.5">
              <span className="mt-1 font-bold text-blue-900">{idx + 1}.</span>
              <span>{pt}</span>
            </li>
          ))}
        </ul>

        <label className="mt-5 flex min-h-[48px] items-start gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3.5 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-slate-400 text-blue-900 shrink-0 cursor-pointer"
          />
          <span className="text-sm sm:text-base font-medium text-slate-900">
            {t.consent.checkboxLabel}
          </span>
        </label>

        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <button
            type="button"
            onClick={onDecline}
            className="min-h-[48px] rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-base font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
          >
            {t.consent.declineBtn}
          </button>
          <button
            type="button"
            disabled={!checked}
            onClick={onAccept}
            className="min-h-[48px] rounded-lg bg-blue-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {t.consent.acceptBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
