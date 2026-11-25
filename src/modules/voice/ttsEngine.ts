import { getLanguageConfig } from '@/src/modules/language/languages';
import { requestServerTts } from '@/src/services/apiClient';
import type { LanguageCode, VoiceGender } from '@/src/types/kiosk';

export type TtsProvider = 'browser' | 'server-neural' | 'text-only';

interface ActivePlayback {
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
}

const audioCache = new Map<string, string>(); // key -> data:audio/wav;base64,...
const FEMALE_HINTS = ['female', 'woman', 'lekha', 'heera', 'kalpana', 'veena', 'aditi', 'raveena', 'priya', 'shruti', 'pallavi', 'valluvar', 'swara', 'vani', 'kanya', 'google', 'natural'];
const MALE_HINTS = ['male', 'man', 'rishi', 'hemant', 'prabhat', 'ravi', 'madhur', 'arjun', 'surya', 'niraj'];

function getBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices();
}

export function findStrictBrowserVoice(
  langCode: LanguageCode,
  gender: VoiceGender
): SpeechSynthesisVoice | null {
  const voices = getBrowserVoices();
  if (voices.length === 0) return null;

  const cfg = getLanguageConfig(langCode);
  const targetPrefixes = cfg.altSpeechCodes.map((c) => c.toLowerCase());

  // Strictly match voices belonging to this language (never fall back to English for regional languages)
  const matching = voices.filter((v) => {
    const vl = v.lang.toLowerCase().replace('_', '-');
    return targetPrefixes.some((p) => vl === p || vl.startsWith(`${p}-`) || vl.split('-')[0] === p.split('-')[0]);
  });

  if (matching.length === 0) return null;

  const hints = gender === 'male' ? MALE_HINTS : FEMALE_HINTS;
  const preferred = matching.find((v) =>
    hints.some((h) => v.name.toLowerCase().includes(h))
  );
  if (preferred) return preferred;

  // Prefer exact region match (e.g. ta-IN / hi-IN / en-IN)
  const exactRegion = matching.find(
    (v) => v.lang.toLowerCase().replace('_', '-') === cfg.speechCode.toLowerCase()
  );
  return exactRegion ?? matching[0];
}

export async function waitForVoicesReady(timeoutMs = 600): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  if (window.speechSynthesis.getVoices().length > 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        window.speechSynthesis.removeEventListener?.('voiceschanged', done);
        resolve();
      }
    };
    window.speechSynthesis.addEventListener?.('voiceschanged', done);
    setTimeout(done, timeoutMs);
  });
}

export interface SpeakOptions {
  text: string;
  language: LanguageCode;
  rate: number;
  voiceGender: VoiceGender;
  onStart?: (provider: TtsProvider) => void;
  onEnd?: () => void;
  onError?: () => void;
}

export async function startSpeechPlayback(
  opts: SpeakOptions
): Promise<{ playback: ActivePlayback | null; provider: TtsProvider }> {
  const { text, language, rate, voiceGender, onStart, onEnd, onError } = opts;

  await waitForVoicesReady();

  // Tier 1: Try strict native browser voice matching the selected language
  const matchedVoice = findStrictBrowserVoice(language, voiceGender);
  if (matchedVoice && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = matchedVoice;
      utterance.lang = getLanguageConfig(language).speechCode;
      utterance.rate = Math.max(0.6, Math.min(1.5, rate));
      // Subtle pitch offset if only one gender voice exists on the device
      utterance.pitch = voiceGender === 'male' ? 0.92 : 1.04;

      let ended = false;
      utterance.onstart = () => onStart?.('browser');
      utterance.onend = () => {
        if (!ended) {
          ended = true;
          onEnd?.();
        }
      };
      utterance.onerror = () => {
        if (!ended) {
          ended = true;
          onError?.();
        }
      };

      window.speechSynthesis.speak(utterance);
      onStart?.('browser');

      return {
        provider: 'browser',
        playback: {
          stop: () => {
            ended = true;
            window.speechSynthesis.cancel();
          },
          pause: () => window.speechSynthesis.pause(),
          resume: () => window.speechSynthesis.resume(),
          setRate: () => {
            // Browser utterance rate applies on next utterance cleanly
          },
        },
      };
    } catch {
      // Fall through to server neural TTS
    }
  }

  // Tier 2: Server Neural TTS (Gemini 3.8 Flash Lite TTS) for guaranteed 12-language support
  try {
    const cacheKey = `${language}::${voiceGender}::${text}`;
    let audioDataUrl = audioCache.get(cacheKey);
    if (!audioDataUrl) {
      const res = await requestServerTts({ text, language, voiceGender });
      audioDataUrl = `data:${res.mimeType};base64,${res.audioBase64}`;
      if (audioCache.size > 60) {
        const oldestKey = audioCache.keys().next().value;
        if (oldestKey) audioCache.delete(oldestKey);
      }
      audioCache.set(cacheKey, audioDataUrl);
    }

    const audio = new Audio(audioDataUrl);
    audio.playbackRate = Math.max(0.6, Math.min(1.5, rate));

    let stopped = false;
    audio.onplay = () => onStart?.('server-neural');
    audio.onended = () => {
      if (!stopped) onEnd?.();
    };
    audio.onerror = () => {
      if (!stopped) onError?.();
    };

    await audio.play();

    return {
      provider: 'server-neural',
      playback: {
        stop: () => {
          stopped = true;
          audio.pause();
          audio.currentTime = 0;
        },
        pause: () => audio.pause(),
        resume: () => {
          void audio.play();
        },
        setRate: (newRate: number) => {
          audio.playbackRate = Math.max(0.6, Math.min(1.5, newRate));
        },
      },
    };
  } catch {
    // Tier 3: Neither device regional voice nor server TTS is available
    onStart?.('text-only');
    return {
      provider: 'text-only',
      playback: null,
    };
  }
}
