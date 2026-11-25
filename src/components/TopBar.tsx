import { Globe, Home } from 'lucide-react';
import { useKiosk } from '@/src/context/KioskContext';
import type { WorkflowStage } from '@/src/types/kiosk';

interface TopBarProps {
  onOpenLanguageSwitcher: () => void;
}

const ORDERED_STEPS: WorkflowStage[] = [
  'welcome',
  'language',
  'dashboard',
  'voice-form',
  'review',
  'completion',
];

function getStepIndex(stage: WorkflowStage): number {
  if (stage === 'document-scan' || stage === 'ocr-review' || stage === 'qr-scan') {
    return 3;
  }
  const idx = ORDERED_STEPS.indexOf(stage);
  return idx >= 0 ? idx + 1 : 1;
}

export function TopBar({ onOpenLanguageSwitcher }: TopBarProps) {
  const { t, stage, setStage, languageConfig } = useKiosk();
  const currentStep = getStepIndex(stage);

  return (
    <header className="no-print sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Zone 1: Single-line Brand Title */}
        <button
          type="button"
          onClick={() => setStage('dashboard')}
          className="text-left text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-blue-900 transition-colors cursor-pointer"
        >
          {t.app.brandName}
        </button>

        {/* Zone 2: Clean Step Progress & Main Menu link */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <span className="tabular-nums text-slate-500 whitespace-nowrap shrink-0">
            {t.app.stepOf
              .replace('{current}', String(currentStep))
              .replace('{total}', String(ORDERED_STEPS.length))}
          </span>
          {stage !== 'welcome' && stage !== 'language' && (
            <button
              type="button"
              onClick={() => setStage('dashboard')}
              className="inline-flex items-center gap-1.5 text-slate-700 hover:text-blue-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              <span>{t.app.backToDashboard}</span>
            </button>
          )}
        </nav>

        {/* Zone 3: Single Primary Language Switcher Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenLanguageSwitcher}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            aria-label={t.app.changeLanguage}
          >
            <Globe className="h-4 w-4 text-blue-900" aria-hidden="true" />
            <span>{languageConfig.nativeName}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
