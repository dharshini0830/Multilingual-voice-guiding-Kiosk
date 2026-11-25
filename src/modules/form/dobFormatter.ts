const INDIC_DIGIT_RANGES = [
  0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x06f0, 0x0660,
];

function toAsciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    let rep = ch;
    for (const base of INDIC_DIGIT_RANGES) {
      if (code >= base && code <= base + 9) {
        rep = String(code - base);
        break;
      }
    }
    out += rep;
  }
  return out;
}

const MONTH_NAME_TO_MM: Record<string, string> = {
  january: '01', jan: '01', ஜனவரி: '01', जनवरी: '01', జనవరి: '01', ಜನವರಿ: '01', ജനുവരി: '01', জানুয়ারি: '01', जानेवारी: '01', જાન્યુઆરી: '01', ਜਨਵਰੀ: '01', ଜାନୁଆରୀ: '01', جنوری: '01',
  february: '02', feb: '02', பிப்ரவரி: '02', फरवरी: '02', ఫిబ్రవరి: '02', ಫೆಬ್ರವರಿ: '02', ഫെബ്രുവരി: '02', ফেব্রুয়ারি: '02', फेब्रुवारी: '02', ફેબ્રુઆરી: '02', ਫਰਵਰੀ: '02', ଫେବୃଆରୀ: '02', فروری: '02',
  march: '03', mar: '03', மார்ச்: '03', मार्च: '03', మార్చి: '03', ಮಾರ್ಚ್: '03', മാർച്ച്: '03', মার্চ: '03', માર્ચ: '03', ਮਾਰਚ: '03', ମାର୍ଚ୍ଚ: '03', مارچ: '03',
  april: '04', apr: '04', ஏப்ரல்: '04', अप्रैल: '04', ఏప్రిల్: '04', ಏಪ್ರಿಲ್: '04', ഏപ്രിൽ: '04', এপ্রিল: '04', एप्रिल: '04', એપ્રિલ: '04', ਅਪ੍ਰੈਲ: '04', ଅପ୍ରେଲ: '04', اپریل: '04',
  may: '05', மே: '05', मई: '05', మే: '05', ಮೇ: '05', മേയ്: '05', মে: '05', मे: '05', મે: '05', ਮਈ: '05', ମଇ: '05', مئی: '05',
  june: '06', jun: '06', ஜூன்: '06', जून: '06', జూన్: '06', ಜೂನ್: '06', ജൂൺ: '06', জুন: '06', જૂન: '06', ਜੂਨ: '06', ଜୁନ: '06', جون: '06',
  july: '07', jul: '07', ஜூலை: '07', जुलाई: '07', జూలై: '07', ಜುಲೈ: '07', ജൂലൈ: '07', জুলাই: '07', जुलै: '07', જુલાઈ: '07', ਜੁਲਾਈ: '07', ଜୁଲାଇ: '07', جولائی: '07',
  august: '08', aug: '08', ஆகஸ்ட்: '08', अगस्त: '08', ఆగస్టు: '08', ಆಗಸ್ಟ್: '08', ഓഗസ്റ്റ്: '08', আগস্ট: '08', ऑगस्ट: '08', ઓગસ્ટ: '08', ਅਗਸਤ: '08', ଅଗଷ୍ଟ: '08', اگست: '08',
  september: '09', sep: '09', sept: '09', செப்டம்பர்: '09', सितंबर: '09', సెప్టెంబర్: '09', ಸೆಪ್ಟೆಂಬರ್: '09', സെപ്റ്റംബർ: '09', সেপ্টেম্বর: '09', सप्टेंबर: '09', સપ્ટેમ્બર: '09', ਸਤੰਬਰ: '09', ସେପ୍ଟେମ୍ବର: '09', ستمبر: '09',
  october: '10', oct: '10', அக்டோபர்: '10', अक्टूबर: '10', అక్టోబర్: '10', ಅಕ್ಟೋಬರ್: '10', ഒക്ടോബർ: '10', অক্টোবর: '10', ऑक्टोबर: '10', ઓક્ટોબર: '10', ਅਕਤੂਬਰ: '10', ଅକ୍ଟୋବର: '10', اکتوبر: '10',
  november: '11', nov: '11', நவம்பர்: '11', नवंबर: '11', నవంబర్: '11', ನವೆಂಬರ್: '11', നവംബർ: '11', নভেম্বর: '11', नोव्हेंबर: '11', નવેમ્બર: '11', ਨਵੰਬਰ: '11', ନଭେମ୍ବର: '11', نومبر: '11',
  december: '12', dec: '12', டிசம்பர்: '12', दिसंबर: '12', డిసెంబర్: '12', ಡಿಸೆಂಬರ್: '12', ഡിസംബർ: '12', ডিসেম্বর: '12', डिसेंबर: '12', ડિસેમ્બર: '12', ਦਸੰਬਰ: '12', ଡିસેମ୍ବର: '12', دسمبر: '12',
};

// Spoken small number words (0..99) across English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali
const SPOKEN_NUMBER_WORDS: Record<string, { val: number; isTens?: boolean }> = {
  // English
  zero: { val: 0 }, oh: { val: 0 }, o: { val: 0 },
  one: { val: 1 }, first: { val: 1 }, two: { val: 2 }, second: { val: 2 },
  three: { val: 3 }, third: { val: 3 }, four: { val: 4 }, fourth: { val: 4 },
  five: { val: 5 }, fifth: { val: 5 }, six: { val: 6 }, sixth: { val: 6 },
  seven: { val: 7 }, seventh: { val: 7 }, eight: { val: 8 }, eighth: { val: 8 },
  nine: { val: 9 }, ninth: { val: 9 }, ten: { val: 10 }, tenth: { val: 10 },
  eleven: { val: 11 }, twelve: { val: 12 }, thirteen: { val: 13 }, fourteen: { val: 14 },
  fifteen: { val: 15 }, sixteen: { val: 16 }, seventeen: { val: 17 }, eighteen: { val: 18 },
  nineteen: { val: 19 },
  twenty: { val: 20, isTens: true }, thirty: { val: 30, isTens: true },
  forty: { val: 40, isTens: true }, fifty: { val: 50, isTens: true },
  sixty: { val: 60, isTens: true }, seventy: { val: 70, isTens: true },
  eighty: { val: 80, isTens: true }, ninety: { val: 90, isTens: true },

  // Tamil (literary & spoken colloquial forms)
  பூஜ்ஜியம்: { val: 0 }, சைபர்: { val: 0 },
  ஒன்று: { val: 1 }, ஒன்னு: { val: 1 }, ஒண்ணு: { val: 1 }, ஒன்றாம்: { val: 1 },
  இரண்டு: { val: 2 }, ரெண்டு: { val: 2 }, இரண்டாம்: { val: 2 }, ரெண்டாம்: { val: 2 },
  மூன்று: { val: 3 }, மூணு: { val: 3 }, மூன்றாம்: { val: 3 },
  நான்கு: { val: 4 }, நாலு: { val: 4 }, நான்காம்: { val: 4 },
  ஐந்து: { val: 5 }, அஞ்சு: { val: 5 }, ஐந்தாம்: { val: 5 },
  ஆறு: { val: 6 }, ஆறாம்: { val: 6 },
  ஏழு: { val: 7 }, ஏழாம்: { val: 7 },
  எட்டு: { val: 8 }, எட்டாம்: { val: 8 }, எட்டாவது: { val: 8 },
  ஒன்பது: { val: 9 }, ஒன்பதாம்: { val: 9 },
  பத்து: { val: 10 }, பத்தாம்: { val: 10 },
  பதினொன்று: { val: 11 }, பதினொண்ணு: { val: 11 },
  பன்னிரண்டு: { val: 12 }, பன்னெண்டு: { val: 12 },
  பதிமூன்று: { val: 13 }, பதிமூணு: { val: 13 },
  பதினான்கு: { val: 14 }, பதினாலு: { val: 14 },
  பதினைந்து: { val: 15 }, பதினஞ்சு: { val: 15 },
  பதினாறு: { val: 16 }, பதினேழு: { val: 17 }, பதினெட்டு: { val: 18 }, பத்தொன்பது: { val: 19 },
  இருபது: { val: 20, isTens: true }, இருபத்து: { val: 20, isTens: true }, இருபத்தி: { val: 20, isTens: true },
  முப்பது: { val: 30, isTens: true }, முப்பத்து: { val: 30, isTens: true }, முப்பத்தி: { val: 30, isTens: true },
  நாற்பது: { val: 40, isTens: true }, நாற்பத்து: { val: 40, isTens: true }, நாற்பத்தி: { val: 40, isTens: true },
  ஐம்பது: { val: 50, isTens: true }, ஐம்பத்து: { val: 50, isTens: true }, ஐம்பத்தி: { val: 50, isTens: true },
  அறுபது: { val: 60, isTens: true }, அறுபத்து: { val: 60, isTens: true }, அறுபத்தி: { val: 60, isTens: true },
  எழுபது: { val: 70, isTens: true }, எழுபத்து: { val: 70, isTens: true }, எழுபத்தி: { val: 70, isTens: true },
  எண்பது: { val: 80, isTens: true }, எண்பத்து: { val: 80, isTens: true }, எண்பத்தி: { val: 80, isTens: true },
  தொண்ணூறு: { val: 90, isTens: true }, தொண்ணூற்று: { val: 90, isTens: true }, தொண்ணூற்றி: { val: 90, isTens: true },

  // Hindi
  शून्य: { val: 0 }, एक: { val: 1 }, दो: { val: 2 }, तीन: { val: 3 }, चार: { val: 4 },
  पांच: { val: 5 }, पाँच: { val: 5 }, छह: { val: 6 }, छ: { val: 6 }, सात: { val: 7 }, आठ: { val: 8 }, नौ: { val: 9 },
  दस: { val: 10 }, ग्यारह: { val: 11 }, बारह: { val: 12 }, तेरह: { val: 13 }, चौदह: { val: 14 },
  पंद्रह: { val: 15 }, सोलह: { val: 16 }, सत्रह: { val: 17 }, अठारह: { val: 18 }, उन्नीस: { val: 19 },
  बीस: { val: 20 }, इक्कीस: { val: 21 }, बाईस: { val: 22 }, तेईस: { val: 23 }, चौबीस: { val: 24 },
  पच्चीस: { val: 25 }, छब्बीस: { val: 26 }, सत्ताईस: { val: 27 }, अट्ठाईस: { val: 28 }, उनतीस: { val: 29 },
  तीस: { val: 30 }, इकतीस: { val: 31 }, चालीस: { val: 40 }, पचास: { val: 50 },
  साठ: { val: 60 }, सत्तर: { val: 70 }, अस्सी: { val: 80 }, नब्बे: { val: 90 },

  // Telugu / Kannada / Malayalam / Bengali / Marathi common 1-12
  ఒకటి: { val: 1 }, రెండు: { val: 2 }, మూడు: { val: 3 }, నాలుగు: { val: 4 }, ఐదు: { val: 5 },
  ఆరు: { val: 6 }, ఏడు: { val: 7 }, ఎనిమిది: { val: 8 }, తొమ్మిది: { val: 9 }, పది: { val: 10 },
  ಒಂದು: { val: 1 }, ಎರಡು: { val: 2 }, ಮೂರು: { val: 3 }, ನಾಲ್ಕು: { val: 4 }, ಐದು: { val: 5 },
  ಆರು: { val: 6 }, ಏಳು: { val: 7 }, ಎಂಟು: { val: 8 }, ಒಂಬತ್ತು: { val: 9 }, ಹತ್ತು: { val: 10 },
  ഒന്ന്: { val: 1 }, രണ്ട്: { val: 2 }, മൂന്ന്: { val: 3 }, നാല്: { val: 4 }, അഞ്ച്: { val: 5 },
  ആറ്: { val: 6 }, ഏഴ്: { val: 7 }, എട്ട്: { val: 8 }, ഒമ്പത്: { val: 9 }, പത്ത്: { val: 10 },
  এক: { val: 1 }, দুই: { val: 2 }, তিন: { val: 3 }, চার: { val: 4 }, পাঁচ: { val: 5 },
  ছয়: { val: 6 }, সাত: { val: 7 }, আট: { val: 8 }, নয়: { val: 9 }, দশ: { val: 10 },
};

// Large magnitude multipliers / direct year prefixes (hundred / thousand)
const SPOKEN_SCALE_WORDS: Record<string, { val: number; mode: 'direct' | 'multiplier' }> = {
  // English
  hundred: { val: 100, mode: 'multiplier' },
  thousand: { val: 1000, mode: 'multiplier' },
  // Tamil
  நூறு: { val: 100, mode: 'direct' }, நூற்று: { val: 100, mode: 'direct' }, நூற்றி: { val: 100, mode: 'direct' },
  இருநூறு: { val: 200, mode: 'direct' }, இருநூற்று: { val: 200, mode: 'direct' },
  முந்நூறு: { val: 300, mode: 'direct' }, முந்நூற்று: { val: 300, mode: 'direct' },
  நானூறு: { val: 400, mode: 'direct' }, நானூற்று: { val: 400, mode: 'direct' },
  ஐநூறு: { val: 500, mode: 'direct' }, ஐநூற்று: { val: 500, mode: 'direct' },
  அறுநூறு: { val: 600, mode: 'direct' }, அறுநூற்று: { val: 600, mode: 'direct' },
  எழுநூறு: { val: 700, mode: 'direct' }, எழுநூற்று: { val: 700, mode: 'direct' },
  எண்ணூறு: { val: 800, mode: 'direct' }, எண்ணூற்று: { val: 800, mode: 'direct' },
  தொள்ளாயிரம்: { val: 900, mode: 'direct' }, தொள்ளாயிரத்து: { val: 900, mode: 'direct' }, தொள்ளாயிரத்தி: { val: 900, mode: 'direct' },
  ஆயிரம்: { val: 1000, mode: 'direct' }, ஆயிரத்து: { val: 1000, mode: 'direct' }, ஆயிரத்தி: { val: 1000, mode: 'direct' },
  இரண்டாயிரம்: { val: 2000, mode: 'direct' }, இரண்டாயிரத்து: { val: 2000, mode: 'direct' }, இரண்டாயிரத்தி: { val: 2000, mode: 'direct' },
  ரெண்டாயிரம்: { val: 2000, mode: 'direct' }, ரெண்டாயிரத்து: { val: 2000, mode: 'direct' }, ரெண்டாயிரத்தி: { val: 2000, mode: 'direct' },
  ரெண்டாயிரத்தொன்று: { val: 2001, mode: 'direct' }, இரண்டாயிரத்தொன்று: { val: 2001, mode: 'direct' },
  ரெண்டாயிரத்திரண்டு: { val: 2002, mode: 'direct' }, இரண்டாயிரத்திரண்டு: { val: 2002, mode: 'direct' },
  ரெண்டாயிரத்துமூன்று: { val: 2003, mode: 'direct' }, ரெண்டாயிரத்துநான்கு: { val: 2004, mode: 'direct' },
  ரெண்டாயிரத்தைந்து: { val: 2005, mode: 'direct' }, ரெண்டாயிரத்தாறு: { val: 2006, mode: 'direct' },
  ரெண்டாயிரத்தேழு: { val: 2007, mode: 'direct' }, ரெண்டாயிரத்தெட்டு: { val: 2008, mode: 'direct' },
  ரெண்டாயிரத்தொன்பது: { val: 2009, mode: 'direct' },
  // Hindi
  सौ: { val: 100, mode: 'multiplier' },
  हजार: { val: 1000, mode: 'multiplier' },
  हज़ार: { val: 1000, mode: 'multiplier' },
};

function isValidCalendarDate(day: number, month: number, year: number): boolean {
  const currYear = new Date().getFullYear();
  if (year < 1900 || year > currYear) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function formatDmy(day: number, month: number, year: number): string {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year)}`;
}

function parseSpokenYearTokens(tokens: string[]): number | null {
  if (tokens.length === 0) return null;

  // Single 4-digit year token anywhere in the tail
  for (const tk of tokens) {
    if (/^(?:19|20)\d{2}$/.test(tk)) {
      return Number(tk);
    }
  }

  let total = 0;
  let current = 0;
  let sawAny = false;

  for (const rawTk of tokens) {
    const tk = rawTk.toLowerCase();
    if (/^\d+$/.test(tk)) {
      const n = Number(tk);
      // Support "19 95" or "20 06" spoken pairs
      if (current === 0 && total === 0 && (n === 19 || n === 20) && tokens.length >= 2) {
        current = n * 100;
      } else {
        current += n;
      }
      sawAny = true;
      continue;
    }

    const scale = SPOKEN_SCALE_WORDS[tk];
    if (scale) {
      sawAny = true;
      if (scale.mode === 'direct') {
        total += current + scale.val;
        current = 0;
      } else {
        const mult = current > 0 ? current : 1;
        total += mult * scale.val;
        current = 0;
      }
      continue;
    }

    const word = SPOKEN_NUMBER_WORDS[tk] ?? SPOKEN_NUMBER_WORDS[rawTk];
    if (word) {
      sawAny = true;
      // Handle "nineteen ninety five" -> 19 followed by >= 10 means 1900 + 95
      if (total === 0 && current === 19 && word.val >= 10 && word.val < 100) {
        total = 1900;
        current = word.val;
      } else if (total === 0 && current === 20 && word.val >= 0 && word.val < 100) {
        total = 2000;
        current = word.val;
      } else {
        current += word.val;
      }
    }
  }

  if (!sawAny) return null;
  const result = total + current;
  return result >= 1900 && result <= new Date().getFullYear() ? result : null;
}

function parseSpokenWordsDate(cleaned: string): string {
  const stripped = cleaned
    .replace(/[.!?।,]+/g, ' ')
    .replace(/(\d+)(?:ஆம்|வது|ஆவது|st|nd|rd|th)\b/gi, '$1')
    .replace(/\b(?:of|the|on|and|ஆம்|தேதி|வது|மாதம்|மாசம்|வருடம்|வருஷம்|तारीख|महीना|साल|सन)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!stripped) return '';
  const tokens = stripped.split(' ').filter(Boolean);
  if (tokens.length < 3) return '';

  // Tokenize first into day + month, then pass remaining tokens to parseSpokenYearTokens
  let idx = 0;
  let day: number | null = null;
  let month: number | null = null;

  const readSmallNumber = (): number | null => {
    if (idx >= tokens.length) return null;
    const raw = tokens[idx];
    const low = raw.toLowerCase();
    if (/^\d{1,2}$/.test(raw)) {
      idx++;
      return Number(raw);
    }
    const word = SPOKEN_NUMBER_WORDS[low] ?? SPOKEN_NUMBER_WORDS[raw];
    if (word) {
      idx++;
      if (word.isTens && idx < tokens.length) {
        const nextRaw = tokens[idx];
        const nextWord = SPOKEN_NUMBER_WORDS[nextRaw.toLowerCase()] ?? SPOKEN_NUMBER_WORDS[nextRaw];
        if (nextWord && nextWord.val >= 1 && nextWord.val <= 9) {
          idx++;
          return word.val + nextWord.val;
        }
      }
      return word.val;
    }
    return null;
  };

  day = readSmallNumber();
  if (day === null || day < 1 || day > 31) return '';

  if (idx < tokens.length) {
    const mToken = tokens[idx];
    const mm = MONTH_NAME_TO_MM[mToken.toLowerCase()] ?? MONTH_NAME_TO_MM[mToken];
    if (mm) {
      month = Number(mm);
      idx++;
    } else {
      const mNum = readSmallNumber();
      if (mNum !== null && mNum >= 1 && mNum <= 12) {
        month = mNum;
      }
    }
  }

  if (month === null || month < 1 || month > 12) return '';

  const year = parseSpokenYearTokens(tokens.slice(idx));
  if (year !== null && isValidCalendarDate(day, month, year)) {
    return formatDmy(day, month, year);
  }

  return '';
}

/**
 * Converts any recognizable date string (DD-MM-YYYY, YYYY-MM-DD, MM/DD/YYYY when day > 12,
 * 8-digit DDMMYYYY or YYYYMMDD, "30 Aug 2006", "August 30, 2006", or spoken number words
 * like "30 எட்டு ரெண்டாயிரத்து ஆறு." / "thirty eight two thousand six")
 * into canonical DD/MM/YYYY format. Returns '' if not a complete valid date.
 */
export function normalizeDobFormat(raw: string): string {
  const cleaned = toAsciiDigits(raw)
    .replace(/(\d)(st|nd|rd|th)\b/gi, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // 1. YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  const ymd = /^((?:19|20)\d{2})[/\-.\s|]+(\d{1,2})[/\-.\s|]+(\d{1,2})$/.exec(cleaned);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (isValidCalendarDate(d, m, y)) return formatDmy(d, m, y);
  }

  // 2. DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (auto-swap MM/DD/YYYY if second part > 12 and first <= 12)
  const dmy = /(\d{1,2})[/\-.\s|]+(\d{1,2})[/\-.\s|]+((?:19|20)\d{2})/.exec(cleaned);
  if (dmy) {
    let p1 = Number(dmy[1]);
    let p2 = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (p2 > 12 && p1 >= 1 && p1 <= 12) {
      const tmp = p1;
      p1 = p2;
      p2 = tmp;
    }
    if (isValidCalendarDate(p1, p2, y)) return formatDmy(p1, p2, y);
  }

  // 3. Pure 8 digits: DDMMYYYY or YYYYMMDD
  const compact = cleaned.replace(/\D/g, '');
  if (compact.length === 8 && /^\d{8}$/.test(cleaned.replace(/\s+/g, ''))) {
    if (/^(?:19|20)\d{2}/.test(compact)) {
      const y = Number(compact.slice(0, 4));
      const m = Number(compact.slice(4, 6));
      const d = Number(compact.slice(6, 8));
      if (isValidCalendarDate(d, m, y)) return formatDmy(d, m, y);
    }
    const d = Number(compact.slice(0, 2));
    const m = Number(compact.slice(2, 4));
    const y = Number(compact.slice(4, 8));
    if (isValidCalendarDate(d, m, y)) return formatDmy(d, m, y);
    if (isValidCalendarDate(m, d, y)) return formatDmy(m, d, y);
  }

  // 4. "30 August 2006" / "30 of Aug 2006" / Tamil/Hindi month names
  const dayMonthYear = /(\d{1,2})\s+(?:of\s+)?([^\s\d]+)\s+((?:19|20)\d{2})/i.exec(cleaned);
  if (dayMonthYear) {
    const d = Number(dayMonthYear[1]);
    const key = dayMonthYear[2].toLowerCase();
    const mm = MONTH_NAME_TO_MM[key] ?? MONTH_NAME_TO_MM[dayMonthYear[2]];
    const y = Number(dayMonthYear[3]);
    if (mm && isValidCalendarDate(d, Number(mm), y)) {
      return formatDmy(d, Number(mm), y);
    }
  }

  // 5. "August 30 2006"
  const monthDayYear = /([^\s\d]+)\s+(\d{1,2})\s+((?:19|20)\d{2})/i.exec(cleaned);
  if (monthDayYear) {
    const key = monthDayYear[1].toLowerCase();
    const mm = MONTH_NAME_TO_MM[key] ?? MONTH_NAME_TO_MM[monthDayYear[1]];
    const d = Number(monthDayYear[2]);
    const y = Number(monthDayYear[3]);
    if (mm && isValidCalendarDate(d, Number(mm), y)) {
      return formatDmy(d, Number(mm), y);
    }
  }

  // 6. Spoken number words across Indian languages & English (e.g. "30 எட்டு ரெண்டாயிரத்து ஆறு.")
  const spokenFormatted = parseSpokenWordsDate(cleaned);
  if (spokenFormatted) {
    return spokenFormatted;
  }

  return '';
}

/**
 * Formats DOB smoothly during live keyboard typing or pasting:
 * - If input resolves to a full valid date (e.g. "2006-08-30", "30082006", "30 Aug 2006", "30-08-2006"),
 *   returns canonical "DD/MM/YYYY".
 * - While typing digits forward (e.g. "30", "3008", "30082006"), automatically inserts "/" cleanly.
 * - Normalizes "-" and "." separators to "/" for numeric typing.
 */
export function autoFormatDobInput(nextValue: string, previousValue = ''): string {
  const normalizedFull = normalizeDobFormat(nextValue);
  if (normalizedFull) {
    return normalizedFull;
  }

  const ascii = toAsciiDigits(nextValue);
  const isDeleting = ascii.length < previousValue.length;

  if (/^[\d/\-.\s]*$/.test(ascii)) {
    const cleanSep = ascii.replace(/[-.\s]+/g, '/');
    const digitsOnly = ascii.replace(/\D/g, '');

    const looksLikeYearFirst = /^(?:19|20)\d{2}/.test(digitsOnly);
    if (!looksLikeYearFirst && !cleanSep.includes('/') && digitsOnly.length > 0) {
      if (digitsOnly.length <= 2) {
        return digitsOnly.length === 2 && !isDeleting ? `${digitsOnly}/` : digitsOnly;
      }
      if (digitsOnly.length <= 4) {
        const base = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
        return digitsOnly.length === 4 && !isDeleting ? `${base}/` : base;
      }
      return `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
    }

    if (!isDeleting && /^\d{2}\/\d{2}$/.test(cleanSep)) {
      return `${cleanSep}/`;
    }
    if (!isDeleting && /^\d{2}$/.test(cleanSep) && !previousValue.endsWith('/')) {
      return `${cleanSep}/`;
    }

    return cleanSep;
  }

  return nextValue;
}
