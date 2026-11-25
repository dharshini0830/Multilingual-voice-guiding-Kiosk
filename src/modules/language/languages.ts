import type { LanguageCode } from '@/src/types/kiosk';

export interface LanguageConfig {
  code: LanguageCode;
  englishName: string;
  nativeName: string;
  regionHint: string;
  speechCode: string; // BCP-47 tag for Web Speech TTS & STT
  altSpeechCodes: string[]; // Secondary BCP-47 prefixes/tags to match device voices
  tesseractCode: string; // Tesseract traineddata code (fallback alongside eng)
  dir: 'ltr' | 'rtl';
  sampleGreeting: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageConfig[] = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    regionHint: 'India (Standard)',
    speechCode: 'en-IN',
    altSpeechCodes: ['en-IN', 'en-GB', 'en-US', 'en'],
    tesseractCode: 'eng',
    dir: 'ltr',
    sampleGreeting: 'Welcome to JanSeva Voice',
  },
  {
    code: 'ta',
    englishName: 'Tamil',
    nativeName: 'தமிழ்',
    regionHint: 'தமிழ்நாடு / புதுச்சேரி',
    speechCode: 'ta-IN',
    altSpeechCodes: ['ta-IN', 'ta'],
    tesseractCode: 'tam+eng',
    dir: 'ltr',
    sampleGreeting: 'ஜனசேவா குரல் சேவைக்கு நல்வரவு',
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    regionHint: 'भारत',
    speechCode: 'hi-IN',
    altSpeechCodes: ['hi-IN', 'hi'],
    tesseractCode: 'hin+eng',
    dir: 'ltr',
    sampleGreeting: 'जनसेवा वॉयस में आपका स्वागत है',
  },
  {
    code: 'te',
    englishName: 'Telugu',
    nativeName: 'తెలుగు',
    regionHint: 'ఆంధ్రప్రదేశ్ / తెలంగాణ',
    speechCode: 'te-IN',
    altSpeechCodes: ['te-IN', 'te'],
    tesseractCode: 'tel+eng',
    dir: 'ltr',
    sampleGreeting: 'జనసేవ వాయిస్‌కు స్వాగతం',
  },
  {
    code: 'kn',
    englishName: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    regionHint: 'ಕರ್ನಾಟಕ',
    speechCode: 'kn-IN',
    altSpeechCodes: ['kn-IN', 'kn'],
    tesseractCode: 'kan+eng',
    dir: 'ltr',
    sampleGreeting: 'ಜನಸೇವಾ ಧ್ವನಿ ಸೇವೆಗೆ ಸ್ವಾಗತ',
  },
  {
    code: 'ml',
    englishName: 'Malayalam',
    nativeName: 'മലയാളം',
    regionHint: 'കേരളം',
    speechCode: 'ml-IN',
    altSpeechCodes: ['ml-IN', 'ml'],
    tesseractCode: 'mal+eng',
    dir: 'ltr',
    sampleGreeting: 'ജനസേവ വോയ്‌സിലേക്ക് സ്വാഗതം',
  },
  {
    code: 'bn',
    englishName: 'Bengali',
    nativeName: 'বাংলা',
    regionHint: 'পশ্চিমবঙ্গ / ত্রিপুরা',
    speechCode: 'bn-IN',
    altSpeechCodes: ['bn-IN', 'bn-BD', 'bn'],
    tesseractCode: 'ben+eng',
    dir: 'ltr',
    sampleGreeting: 'জনসেবা ভয়েসে আপনাকে স্বাগতম',
  },
  {
    code: 'mr',
    englishName: 'Marathi',
    nativeName: 'मराठी',
    regionHint: 'महाराष्ट्र',
    speechCode: 'mr-IN',
    altSpeechCodes: ['mr-IN', 'mr'],
    tesseractCode: 'mar+eng',
    dir: 'ltr',
    sampleGreeting: 'जनसेवा व्हॉइसमध्ये आपले स्वागत आहे',
  },
  {
    code: 'gu',
    englishName: 'Gujarati',
    nativeName: 'ગુજરાતી',
    regionHint: 'ગુજરાત',
    speechCode: 'gu-IN',
    altSpeechCodes: ['gu-IN', 'gu'],
    tesseractCode: 'guj+eng',
    dir: 'ltr',
    sampleGreeting: 'જનસેવા વૉઇસમાં આપનું સ્વાગત છે',
  },
  {
    code: 'pa',
    englishName: 'Punjabi',
    nativeName: 'ਪੰਜਾਬੀ',
    regionHint: 'ਪੰਜਾਬ',
    speechCode: 'pa-IN',
    altSpeechCodes: ['pa-IN', 'pa-Guru-IN', 'pa'],
    tesseractCode: 'pan+eng',
    dir: 'ltr',
    sampleGreeting: 'ਜਨਸੇਵਾ ਵਾਇਸ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ',
  },
  {
    code: 'or',
    englishName: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    regionHint: 'ଓଡ଼ିଶା',
    speechCode: 'or-IN',
    altSpeechCodes: ['or-IN', 'od-IN', 'or'],
    tesseractCode: 'ori+eng',
    dir: 'ltr',
    sampleGreeting: 'ଜନସେବା ଭଏସ୍‌କୁ ସ୍ୱାଗତ',
  },
  {
    code: 'ur',
    englishName: 'Urdu',
    nativeName: 'اردو',
    regionHint: 'اردو (بھارت)',
    speechCode: 'ur-IN',
    altSpeechCodes: ['ur-IN', 'ur-PK', 'ur'],
    tesseractCode: 'urd+eng',
    dir: 'rtl',
    sampleGreeting: 'جن سیوا وائس میں خوش آمدید',
  },
] as const;

export const LANGUAGE_MAP: Record<LanguageCode, LanguageConfig> = SUPPORTED_LANGUAGES.reduce(
  (acc, lang) => {
    acc[lang.code] = lang;
    return acc;
  },
  {} as Record<LanguageCode, LanguageConfig>
);

export function getLanguageConfig(code: LanguageCode): LanguageConfig {
  return LANGUAGE_MAP[code] ?? SUPPORTED_LANGUAGES[0];
}

export function isSupportedLanguage(code: string): code is LanguageCode {
  return code in LANGUAGE_MAP;
}
