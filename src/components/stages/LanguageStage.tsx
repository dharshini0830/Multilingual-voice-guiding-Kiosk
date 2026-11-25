import { ArrowRight, Check, Volume2 } from 'lucide-react';
import { useEffect } from 'react';
import { useKiosk } from '@/src/context/KioskContext';
import { getDictionary } from '@/src/modules/i18n';
import { SUPPORTED_LANGUAGES } from '@/src/modules/language/languages';
import { voiceGuidanceManager } from '@/src/modules/voice/voiceGuidanceManager';
import type { LanguageCode } from '@/src/types/kiosk';

interface LanguageStageProps {
  returnToStage?: 'dashboard' | null;
  onDone?: () => void;
}

export function LanguageStage({ returnToStage, onDone }: LanguageStageProps) {
  const { language, t, setLanguage, setStage, speak } = useKiosk();

  useEffect(() => {
    speak(t.languageScreen.voiceGuide);
  }, [speak, t.languageScreen.voiceGuide]);

  const handleSelectLanguage = (code: LanguageCode) => {
    setLanguage(code, { announce: false });
    const dict = getDictionary(code);
    void voiceGuidanceManager.speak(dict.languageScreen.selectedBanner, {
      force: true,
      language: code,
    });
  };

  const handleConfirm = () => {
    const dict = getDictionary(language);
    void voiceGuidanceManager.speak(dict.languageScreen.voiceConfirmed, {
      force: true,
      language,
    });
    if (onDone) {
      onDone();
    } else {
      setStage(returnToStage ?? 'dashboard');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
              {t.languageScreen.title}
            </h1>
            <p className="mt-1.5 text-base text-slate-600">{t.languageScreen.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => speak(t.languageScreen.voiceGuide, true)}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 cursor-pointer shrink-0"
          >
            <Volume2 className="h-4 w-4 text-blue-900" aria-hidden="true" />
            <span>{t.languageScreen.listenInstruction}</span>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {SUPPORTED_LANGUAGES.map((lang) => {
            const isSelected = language === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                dir={lang.dir}
                onClick={() => handleSelectLanguage(lang.code)}
                className={`flex min-h-[82px] items-center justify-between gap-3 rounded-xl border-2 px-5 py-4 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-blue-900 bg-blue-50/70 text-slate-900'
                    : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xl font-bold text-slate-900">{lang.nativeName}</div>
                  <div className="mt-0.5 text-sm font-medium text-slate-600">
                    {lang.englishName} · {lang.regionHint}
                  </div>
                </div>
                {isSelected && (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-white shrink-0">
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-t border-slate-200 pt-6">
          <p className="text-base font-semibold text-blue-900">
            {t.languageScreen.selectedBanner}
          </p>
          <button
            type="button"
            onClick={handleConfirm}
            className="inline-flex min-h-[56px] items-center justify-center gap-3 rounded-xl bg-blue-900 px-8 py-3.5 text-lg font-bold text-white hover:bg-blue-800 transition-colors cursor-pointer"
          >
            <span>{t.languageScreen.confirmSelection}</span>
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
