import {
  AlertCircle,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useKiosk } from '@/src/context/KioskContext';
import { voiceGuidanceManager } from '@/src/modules/voice/voiceGuidanceManager';

export function VoiceControlBar() {
  const { t, voiceState } = useKiosk();

  const statusText = voiceState.isMuted
    ? t.voiceBar.mutedStatus
    : voiceState.isPaused
      ? t.voiceBar.pausedStatus
      : voiceState.isSpeaking
        ? t.voiceBar.speakingStatus
        : t.voiceBar.readyStatus;

  const providerLabel =
    voiceState.provider === 'server-neural'
      ? t.voiceBar.neuralProvider
      : voiceState.provider === 'browser'
        ? t.voiceBar.browserProvider
        : t.voiceBar.textOnlyProvider;

  return (
    <section
      aria-label={t.voiceBar.assistantLabel}
      className="no-print border-b border-slate-200 bg-slate-100/90"
    >
      <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Spoken Guidance Caption & Status */}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
              <Volume2 className="h-4 w-4 text-blue-900 shrink-0" aria-hidden="true" />
              <span>{t.voiceBar.assistantLabel}</span>
              <span aria-hidden="true">·</span>
              <span className={voiceState.isSpeaking ? 'text-blue-900' : 'text-slate-700'}>
                {statusText}
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-500">{providerLabel}</span>
            </div>
            {voiceState.currentText && (
              <p className="mt-1 text-sm sm:text-base font-medium text-slate-900 leading-relaxed">
                {voiceState.currentText}
              </p>
            )}
            {voiceState.voiceUnavailableNotice && (
              <p className="mt-1.5 flex items-start gap-2 text-xs sm:text-sm font-medium text-amber-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{voiceState.voiceUnavailableNotice}</span>
              </p>
            )}
          </div>

          {/* Accessible Voice Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => voiceGuidanceManager.replay()}
              disabled={!voiceState.currentText}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>{t.voiceBar.replay}</span>
            </button>

            <button
              type="button"
              onClick={() => voiceGuidanceManager.repeatPrevious()}
              disabled={!voiceState.previousText && !voiceState.currentText}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              <SkipBack className="h-4 w-4" aria-hidden="true" />
              <span>{t.voiceBar.repeatPrevious}</span>
            </button>

            {voiceState.isSpeaking && !voiceState.isPaused && (
              <button
                type="button"
                onClick={() => voiceGuidanceManager.pause()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                <span>{t.voiceBar.pause}</span>
              </button>
            )}

            {voiceState.isPaused && (
              <button
                type="button"
                onClick={() => voiceGuidanceManager.resume()}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-blue-900 bg-blue-900 px-3 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-blue-800 cursor-pointer whitespace-nowrap"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                <span>{t.voiceBar.resume}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => voiceGuidanceManager.toggleMute()}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap ${
                voiceState.isMuted
                  ? 'border-amber-700 bg-amber-50 text-amber-900'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
            >
              {voiceState.isMuted ? (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{voiceState.isMuted ? t.voiceBar.unmute : t.voiceBar.mute}</span>
            </button>

            {/* Voice Speed Selector */}
            <div className="flex items-center rounded-lg border border-slate-300 bg-white p-0.5">
              <span className="px-2 text-xs font-medium text-slate-500 whitespace-nowrap">
                {t.voiceBar.speedLabel}
              </span>
              {[0.85, 1.0, 1.2].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => voiceGuidanceManager.setRate(r)}
                  className={`min-h-[38px] rounded-md px-2 text-xs font-semibold tabular-nums cursor-pointer ${
                    Math.abs(voiceState.rate - r) < 0.05
                      ? 'bg-blue-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {r}x
                </button>
              ))}
            </div>

            {/* Male / Female Voice Selector */}
            <div className="flex items-center rounded-lg border border-slate-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => voiceGuidanceManager.setVoiceGender('female')}
                className={`min-h-[38px] rounded-md px-2.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  voiceState.voiceGender === 'female'
                    ? 'bg-blue-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.voiceBar.femaleVoice}
              </button>
              <button
                type="button"
                onClick={() => voiceGuidanceManager.setVoiceGender('male')}
                className={`min-h-[38px] rounded-md px-2.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  voiceState.voiceGender === 'male'
                    ? 'bg-blue-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.voiceBar.maleVoice}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
