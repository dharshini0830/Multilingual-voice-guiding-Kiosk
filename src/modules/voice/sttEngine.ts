import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { getLanguageConfig } from '@/src/modules/language/languages';
import { requestServerTranscribe } from '@/src/services/apiClient';
import type { FieldKey, LanguageCode } from '@/src/types/kiosk';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isBrowserSttSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

export interface SttCallbacks {
  language: LanguageCode;
  continuous?: boolean;
  onInterim?: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onError: (reason: 'not-supported' | 'permission-denied' | 'no-speech' | 'network' | 'aborted') => void;
  onEnd?: () => void;
}

export function startBrowserSpeechRecognition(callbacks: SttCallbacks): { stop: () => void } | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    callbacks.onError('not-supported');
    return null;
  }

  const recognition = new Ctor();
  const cfg = getLanguageConfig(callbacks.language);
  const isContinuous = Boolean(callbacks.continuous);
  recognition.lang = cfg.speechCode;
  recognition.interimResults = true;
  recognition.continuous = isContinuous;
  recognition.maxAlternatives = 3;

  let deliveredFinal = false;
  let hadError = false;
  let latestTranscript = '';
  let latestConfidence = 0.85;

  recognition.onresult = (event) => {
    let interim = '';
    let finalTranscript = '';

    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) {
        finalTranscript += (finalTranscript ? ' ' : '') + text;
        if (result[0]?.confidence) {
          latestConfidence = result[0].confidence;
        }
      } else {
        interim += (interim ? ' ' : '') + text;
      }
    }

    const combined = `${finalTranscript}${finalTranscript && interim ? ' ' : ''}${interim}`.trim();
    if (combined) {
      latestTranscript = combined;
      callbacks.onInterim?.(combined);
    }

    if (!isContinuous && finalTranscript.trim()) {
      deliveredFinal = true;
      callbacks.onFinal(finalTranscript.trim(), latestConfidence);
    }
  };

  recognition.onerror = (ev) => {
    hadError = true;
    const code = ev.error;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      callbacks.onError('permission-denied');
    } else if (code === 'language-not-supported') {
      callbacks.onError('not-supported');
    } else if (code === 'no-speech') {
      if (!deliveredFinal && latestTranscript.trim()) {
        deliveredFinal = true;
        callbacks.onFinal(latestTranscript.trim(), 0.72);
      } else {
        callbacks.onError('no-speech');
      }
    } else if (code === 'aborted') {
      if (!deliveredFinal && isContinuous && latestTranscript.trim()) {
        deliveredFinal = true;
        callbacks.onFinal(latestTranscript.trim(), latestConfidence);
      } else {
        callbacks.onError('aborted');
      }
    } else {
      callbacks.onError('network');
    }
  };

  recognition.onend = () => {
    if (!deliveredFinal && latestTranscript.trim() && (!hadError || isContinuous)) {
      deliveredFinal = true;
      callbacks.onFinal(latestTranscript.trim(), latestConfidence);
    } else if (!deliveredFinal) {
      callbacks.onEnd?.();
    }
  };

  try {
    recognition.start();
    return {
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch {
    callbacks.onError('not-supported');
    return null;
  }
}

export interface ClipRecorderOptions {
  maxDurationMs?: number;
  silenceTimeoutMs?: number;
  onAutoSilence?: () => void;
  onVolume?: (level: number) => void;
}

export interface ClipRecorderHandle {
  stopAndGetAudio: () => Promise<{ audioBase64: string; mimeType: string }>;
  stopAndTranscribe: () => Promise<string>;
  cancel: () => void;
}

export async function startVoiceClipRecorder(
  language: LanguageCode,
  fieldHint: string,
  options?: ClipRecorderOptions
): Promise<ClipRecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MediaRecorder.isTypeSupported('audio/webm')
    ? 'audio/webm'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : '';

  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start(250);

  let audioCtx: AudioContext | null = null;
  let silenceRafId = 0;
  let maxTimerId: ReturnType<typeof setTimeout> | null = null;
  let silenceTriggered = false;
  let cancelled = false;

  const cleanupMonitoring = () => {
    if (silenceRafId) {
      cancelAnimationFrame(silenceRafId);
      silenceRafId = 0;
    }
    if (maxTimerId) {
      clearTimeout(maxTimerId);
      maxTimerId = null;
    }
    if (audioCtx) {
      void audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  const stopTracks = () => {
    cleanupMonitoring();
    stream.getTracks().forEach((t) => t.stop());
  };

  if (options?.maxDurationMs && options.maxDurationMs > 0) {
    maxTimerId = setTimeout(() => {
      if (!silenceTriggered && !cancelled && options.onAutoSilence) {
        silenceTriggered = true;
        options.onAutoSilence();
      }
    }, options.maxDurationMs);
  }

  // Monitor speech activity via Web Audio AnalyserNode for optional auto-stop after pause
  if (typeof window !== 'undefined' && (options?.onAutoSilence || options?.onVolume)) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.fftSize);
        let heardSpeech = false;
        let silenceStart = 0;
        const silenceThresholdMs = options.silenceTimeoutMs ?? 2200;

        const pollAudio = () => {
          if (cancelled || silenceTriggered) return;
          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const norm = (dataArray[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          options.onVolume?.(Math.min(1, rms * 6));

          if (rms > 0.025) {
            heardSpeech = true;
            silenceStart = 0;
          } else if (heardSpeech && options.onAutoSilence) {
            const now = performance.now();
            if (!silenceStart) {
              silenceStart = now;
            } else if (now - silenceStart >= silenceThresholdMs) {
              silenceTriggered = true;
              options.onAutoSilence();
              return;
            }
          }
          silenceRafId = requestAnimationFrame(pollAudio);
        };
        silenceRafId = requestAnimationFrame(pollAudio);
      }
    } catch {
      // Analyser optional; manual stop remains active
    }
  }

  const stopAndGetAudio = (): Promise<{ audioBase64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        stopTracks();
        if (cancelled) {
          resolve({ audioBase64: '', mimeType: recorder.mimeType || 'audio/webm' });
          return;
        }
        try {
          const outMime = recorder.mimeType || 'audio/webm';
          const blob = new Blob(chunks, { type: outMime });
          if (blob.size < 200) {
            resolve({ audioBase64: '', mimeType: outMime });
            return;
          }
          const arrayBuf = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          resolve({ audioBase64: btoa(binary), mimeType: outMime });
        } catch (err) {
          reject(err);
        }
      };

      if (recorder.state !== 'inactive') {
        recorder.stop();
      } else {
        stopTracks();
        resolve({ audioBase64: '', mimeType: recorder.mimeType || 'audio/webm' });
      }
    });

  return {
    cancel: () => {
      cancelled = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } finally {
        stopTracks();
      }
    },
    stopAndGetAudio,
    stopAndTranscribe: async () => {
      const { audioBase64, mimeType: outMime } = await stopAndGetAudio();
      if (!audioBase64) return '';
      const res = await requestServerTranscribe({
        audioBase64,
        mimeType: outMime,
        language,
        fieldHint,
      });
      return res.transcript ?? '';
    },
  };
}

// Convert Indic/Arabic-Indic numerals to ASCII digits
function normalizeIndicDigits(text: string): string {
  const digitRanges = [
    0x0966, // Devanagari
    0x09e6, // Bengali
    0x0a66, // Gurmukhi
    0x0ae6, // Gujarati
    0x0b66, // Odia
    0x0be6, // Tamil
    0x0c66, // Telugu
    0x0ce6, // Kannada
    0x0d66, // Malayalam
    0x06f0, // Extended Arabic-Indic (Urdu)
    0x0660, // Arabic-Indic
  ];

  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    let converted = ch;
    for (const base of digitRanges) {
      if (code >= base && code <= base + 9) {
        converted = String(code - base);
        break;
      }
    }
    out += converted;
  }
  return out;
}

const SPOKEN_DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', शून्य: '0', पूज्य: '0', பூஜ்ஜியம்: '0',
  one: '1', एक: '1', ஒன்று: '1', ఒకటి: '1', ಒಂದು: '1', ഒന്ന്: '1', এক: '1',
  two: '2', दो: '2', இரண்டு: '2', రెండు: '2', ಎರಡು: '2', രണ്ട്: '2', দুই: '2',
  three: '3', तीन: '3', மூன்று: '3', మూడు: '3', ಮೂರು: '3', മൂന്ന്: '3', তিন: '3',
  four: '4', चार: '4', நான்கு: '4', నాలుగు: '4', ನಾಲ್ಕು: '4', നാല്: '4', চার: '4',
  five: '5', पांच: '5', पाँच: '5', ஐந்து: '5', ఐదు: '5', ಐದು: '5', അഞ്ച്: '5', পাঁচ: '5',
  six: '6', छह: '6', छ: '6', ஆறு: '6', ఆరు: '6', ಆರು: '6', ആറ്: '6', ছয়: '6',
  seven: '7', सात: '7', ஏழு: '7', ఏడు: '7', ಏಳು: '7', ഏഴ്: '7', সাত: '7',
  eight: '8', आठ: '8', எட்டு: '8', ఎనిమిది: '8', ಎಂಟು: '8', എട്ട്: '8', আট: '8',
  nine: '9', नौ: '9', ஒன்பது: '9', తొమ్మిది: '9', ಒಂಬತ್ತು: '9', ഒമ്പത്: '9', নয়: '9',
};

function extractSpokenDigits(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[,.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  let out = '';
  for (const tok of tokens) {
    if (/^\d+$/.test(tok)) {
      out += tok;
    } else if (SPOKEN_DIGIT_WORDS[tok] !== undefined) {
      out += SPOKEN_DIGIT_WORDS[tok];
    } else {
      const embeddedDigits = tok.replace(/\D/g, '');
      if (embeddedDigits) out += embeddedDigits;
    }
  }
  return out || text.replace(/\D/g, '');
}

const MONTH_MAP: Record<string, string> = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
};

const MALE_KEYWORDS = [
  'male', 'man', 'boy', 'mail', 'मेल', 'ஆண்', 'पुरुष', 'पुल्लिंग', 'పురుషుడు', 'ಪುರುಷ', 'പുരുഷൻ',
  'পুরুষ', 'ਮਰਦ', 'ਪੁਰਸ਼', 'ପୁରୁଷ', 'مرد',
];
const FEMALE_KEYWORDS = [
  'female', 'woman', 'girl', 'फीमेल', 'பெண்', 'महिला', 'स्त्री', 'స్త్రీ', 'మహిళ', 'ಮಹಿಳೆ', 'ಸ್ತ್ರೀ',
  'സ്ത്രീ', 'മഹിള', 'মহিলা', 'নারী', 'ਔਰਤ', 'ਮਹਿਲਾ', 'ମହିଳା', 'عورت', 'خاتون',
];
const OTHER_KEYWORDS = [
  'other', 'transgender', 'மற்றவை', 'अन्य', 'ఇతరులు', 'ಇತರೆ', 'മറ്റുള്ളവ',
  'অন্যান্য', 'इतर', 'અન્ય', 'ਹੋਰ', 'ଅନ୍ୟାନ୍ୟ', 'دیگر',
];

export function normalizeSpokenAnswer(rawTranscript: string, field: FieldKey): string {
  const normalized = normalizeIndicDigits(rawTranscript).trim();
  if (!normalized) return '';

  if (field === 'idNumber') {
    return extractSpokenDigits(normalized).slice(0, 12);
  }

  if (field === 'phoneNumber') {
    const digits = extractSpokenDigits(normalized);
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  if (field === 'pincode') {
    return extractSpokenDigits(normalized).slice(0, 6);
  }

  if (field === 'gender') {
    const lower = normalized.toLowerCase().replace(/[.,!?]+/g, '');
    if (FEMALE_KEYWORDS.some((kw) => lower.includes(kw))) return 'Female';
    if (MALE_KEYWORDS.some((kw) => lower.includes(kw))) return 'Male';
    if (OTHER_KEYWORDS.some((kw) => lower.includes(kw))) return 'Other';
    return normalized;
  }

  if (field === 'dob') {
    return normalizeDobFormat(normalized) || normalized;
  }

  if (field === 'fullName' || field === 'fatherName') {
    return normalized
      .replace(/^(?:my\s+(?:full\s+)?name\s+is|my\s+father(?:'s)?\s+name\s+is|i\s+am|name\s+is)\s+/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[.,!?]+$/, '')
      .trim();
  }

  if (field === 'address') {
    return normalized
      .replace(/^(?:my\s+address\s+is|i\s+live\s+(?:in|at)|address\s+is)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return normalized.replace(/\s+/g, ' ').trim();
}
