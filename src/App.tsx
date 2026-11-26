import { X } from 'lucide-react';
import { useState } from 'react';
import { ErrorBoundary } from '@/src/components/ErrorBoundary';
import { PrintableReceipt } from '@/src/components/PrintableReceipt';
import { TopBar } from '@/src/components/TopBar';
import { VoiceControlBar } from '@/src/components/VoiceControlBar';
import { CompletionStage } from '@/src/components/stages/CompletionStage';
import { DashboardStage } from '@/src/components/stages/DashboardStage';
import { DocumentScanStage } from '@/src/components/stages/DocumentScanStage';
import { LanguageStage } from '@/src/components/stages/LanguageStage';
import { ReviewSubmitStage } from '@/src/components/stages/ReviewSubmitStage';
import { VoiceFormStage } from '@/src/components/stages/VoiceFormStage';
import { WelcomeStage } from '@/src/components/stages/WelcomeStage';
import { FirebaseProvider } from '@/src/context/FirebaseContext';
import { KioskProvider, useKiosk } from '@/src/context/KioskContext';

function KioskShell() {
  const { stage, t, languageConfig } = useKiosk();
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 flex flex-col"
      dir={languageConfig.dir}
    >
      <TopBar onOpenLanguageSwitcher={() => setShowLanguageModal(true)} />
      <VoiceControlBar />

      <main className="flex-1 pb-12">
        {stage === 'welcome' && <WelcomeStage />}
        {stage === 'language' && <LanguageStage />}
        {stage === 'dashboard' && <DashboardStage />}
        {(stage === 'document-scan' || stage === 'ocr-review') && <DocumentScanStage />}
        {stage === 'voice-form' && <VoiceFormStage />}
        {stage === 'review' && <ReviewSubmitStage />}
        {stage === 'completion' && <CompletionStage />}
      </main>

      <PrintableReceipt />

      {/* Mid-workflow lossless language switcher overlay */}
      {showLanguageModal && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label={t.app.changeLanguage}
        >
          <div className="relative w-full max-w-4xl rounded-2xl border border-slate-200 bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <span className="text-lg font-bold text-slate-900">{t.app.changeLanguage}</span>
              <button
                type="button"
                onClick={() => setShowLanguageModal(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label={t.app.cancelBtn}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <LanguageStage onDone={() => setShowLanguageModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <KioskProvider>
          <KioskShell />
        </KioskProvider>
      </FirebaseProvider>
    </ErrorBoundary>
  );
}
