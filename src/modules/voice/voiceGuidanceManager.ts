import { getDictionary } from '@/src/modules/i18n';
import type { LanguageCode, VoiceGender, VoiceState } from '@/src/types/kiosk';
import { startSpeechPlayback, type TtsProvider } from './ttsEngine';

type Listener = (state: VoiceState) => void;

class VoiceGuidanceManager {
  private state: VoiceState = {
    isSpeaking: false,
    isPaused: false,
    isMuted: false,
    rate: 1.0,
    voiceGender: 'female',
    currentText: '',
    previousText: '',
    provider: 'browser',
    voiceUnavailableNotice: null,
  };

  private language: LanguageCode = 'en';
  private listeners = new Set<Listener>();
  private activePlayback: {
    stop: () => void;
    pause: () => void;
    resume: () => void;
    setRate: (rate: number) => void;
  } | null = null;
  private speechToken = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  getState(): VoiceState {
    return this.state;
  }

  setLanguage(lang: LanguageCode): void {
    if (this.language !== lang) {
      this.stop();
      this.language = lang;
      this.emit({ voiceUnavailableNotice: null });
    }
  }

  stop(): void {
    this.speechToken++;
    if (this.activePlayback) {
      try {
        this.activePlayback.stop();
      } catch {
        // ignore
      }
      this.activePlayback = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.emit({ isSpeaking: false, isPaused: false });
  }

  async speak(text: string, options?: { force?: boolean; language?: LanguageCode }): Promise<void> {
    const cleanText = text.trim();
    if (!cleanText) return;

    const targetLang = options?.language ?? this.language;

    // Prevent unnecessary repetition of identical immediate instruction unless forced
    if (
      !options?.force &&
      this.state.isSpeaking &&
      this.state.currentText === cleanText &&
      targetLang === this.language
    ) {
      return;
    }

    if (options?.language) {
      this.language = options.language;
    }

    // Stop previous speech cleanly to prevent overlapping voices
    this.stop();
    const myToken = this.speechToken;

    const prev =
      this.state.currentText && this.state.currentText !== cleanText
        ? this.state.currentText
        : this.state.previousText;

    this.emit({
      currentText: cleanText,
      previousText: prev,
      voiceUnavailableNotice: null,
    });

    if (this.state.isMuted) {
      this.emit({ isSpeaking: false, isPaused: false });
      return;
    }

    const { playback, provider } = await startSpeechPlayback({
      text: cleanText,
      language: targetLang,
      rate: this.state.rate,
      voiceGender: this.state.voiceGender,
      onStart: (prov: TtsProvider) => {
        if (myToken !== this.speechToken) return;
        if (prov === 'text-only') {
          this.emit({
            isSpeaking: false,
            isPaused: false,
            provider: 'text-only',
            voiceUnavailableNotice: getDictionary(targetLang).voiceBar.unavailableNotice,
          });
        } else {
          this.emit({
            isSpeaking: true,
            isPaused: false,
            provider: prov,
            voiceUnavailableNotice: null,
          });
        }
      },
      onEnd: () => {
        if (myToken !== this.speechToken) return;
        this.activePlayback = null;
        this.emit({ isSpeaking: false, isPaused: false });
      },
      onError: () => {
        if (myToken !== this.speechToken) return;
        this.activePlayback = null;
        this.emit({
          isSpeaking: false,
          isPaused: false,
          provider: 'text-only',
          voiceUnavailableNotice: getDictionary(targetLang).voiceBar.unavailableNotice,
        });
      },
    });

    if (myToken !== this.speechToken) {
      playback?.stop();
      return;
    }

    this.activePlayback = playback;
    if (provider === 'text-only') {
      this.emit({
        isSpeaking: false,
        isPaused: false,
        provider: 'text-only',
        voiceUnavailableNotice: getDictionary(targetLang).voiceBar.unavailableNotice,
      });
    }
  }

  replay(): void {
    if (this.state.currentText) {
      void this.speak(this.state.currentText, { force: true });
    }
  }

  repeatPrevious(): void {
    const target = this.state.previousText || this.state.currentText;
    if (target) {
      void this.speak(target, { force: true });
    }
  }

  pause(): void {
    if (this.activePlayback && this.state.isSpeaking && !this.state.isPaused) {
      this.activePlayback.pause();
      this.emit({ isPaused: true });
    }
  }

  resume(): void {
    if (this.activePlayback && this.state.isPaused) {
      this.activePlayback.resume();
      this.emit({ isPaused: false });
    }
  }

  toggleMute(): void {
    const nextMuted = !this.state.isMuted;
    if (nextMuted) {
      this.stop();
      this.emit({ isMuted: true });
    } else {
      this.emit({ isMuted: false });
      if (this.state.currentText) {
        void this.speak(this.state.currentText, { force: true });
      }
    }
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.75, Math.min(1.5, rate));
    this.emit({ rate: clamped });
    this.activePlayback?.setRate(clamped);
  }

  setVoiceGender(voiceGender: VoiceGender): void {
    if (this.state.voiceGender !== voiceGender) {
      this.emit({ voiceGender });
      if (this.state.isSpeaking && this.state.currentText) {
        void this.speak(this.state.currentText, { force: true });
      }
    }
  }
}

export const voiceGuidanceManager = new VoiceGuidanceManager();
