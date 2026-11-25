import { ArrowRight, CheckCircle2, Volume2 } from 'lucide-react';
import { useEffect } from 'react';
import { useKiosk } from '@/src/context/KioskContext';

export function WelcomeStage() {
  const { t, setStage, speak } = useKiosk();

  useEffect(() => {
    speak(t.welcome.voicePrompt);
  }, [speak, t.welcome.voicePrompt]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
        <p className="text-sm font-semibold text-blue-900">{t.app.brandTagline}</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
          {t.welcome.headline}
        </h1>
        <p className="mt-4 text-lg text-slate-700 leading-relaxed max-w-2xl">
          {t.welcome.subtitle}
        </p>

        <div className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-base font-bold text-slate-900">{t.welcome.purposeTitle}</h2>
          <ul className="mt-4 space-y-3">
            {t.welcome.purposeItems.map((item, idx) => (
              <li key={idx} className="flex items-start gap-3 text-base text-slate-800">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700 shrink-0" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <button
            type="button"
            onClick={() => setStage('language')}
            className="inline-flex min-h-[56px] items-center justify-center gap-3 rounded-xl bg-blue-900 px-8 py-4 text-lg font-bold text-white hover:bg-blue-800 transition-colors cursor-pointer"
          >
            <span>{t.welcome.startButton}</span>
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => speak(t.welcome.voicePrompt, true)}
            className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-6 py-4 text-base font-semibold text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <Volume2 className="h-5 w-5 text-blue-900" aria-hidden="true" />
            <span>{t.welcome.hearWelcomeAgain}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
