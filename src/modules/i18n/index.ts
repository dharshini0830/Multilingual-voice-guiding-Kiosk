import type { LanguageCode } from '@/src/types/kiosk';
import type { TranslationDictionary } from './types';
import { en } from './en';
import { ta } from './ta';
import { hi } from './hi';
import { te } from './te';
import { kn } from './kn';
import { ml } from './ml';
import { bn } from './bn';
import { mr } from './mr';
import { gu } from './gu';
import { pa } from './pa';
import { or } from './or';
import { ur } from './ur';

const TRANSLATIONS: Record<LanguageCode, TranslationDictionary> = {
  en,
  ta,
  hi,
  te,
  kn,
  ml,
  bn,
  mr,
  gu,
  pa,
  or,
  ur,
};

export function getDictionary(lang: LanguageCode): TranslationDictionary {
  return TRANSLATIONS[lang] ?? TRANSLATIONS.en;
}

export function interpolate(
  template: string,
  params: Record<string, string | number>
): string {
  return Object.entries(params).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{${key}}`, String(value));
  }, template);
}

export type { TranslationDictionary };
