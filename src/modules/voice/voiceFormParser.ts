import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { requestServerParseVoiceForm } from '@/src/services/apiClient';
import type { CitizenFormData, ExtractionResultMap, GenderOption, LanguageCode, ServiceType } from '@/src/types/kiosk';
import { normalizeSpokenAnswer } from './sttEngine';

function normalizeIndicDigits(text: string): string {
  const ranges = [
    0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x06f0, 0x0660,
  ];
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    let rep = ch;
    for (const base of ranges) {
      if (code >= base && code <= base + 9) {
        rep = String(code - base);
        break;
      }
    }
    out += rep;
  }
  return out;
}

const MONTH_WORDS: Record<string, string> = {
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08', ஆகஸ்ட்: '08', अगस्त: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12',
  ஜனவரி: '01', பிப்ரவரி: '02', மார்ச்: '03', ஏப்ரல்: '04', மே: '05', ஜூன்: '06',
  ஜூலை: '07', செப்டம்பர்: '09', அக்டோபர்: '10', നവംബർ: '11', நவம்பர்: '11', டிசம்பர்: '12',
  जनवरी: '01', फरवरी: '02', मार्च: '03', अप्रैल: '04', मई: '05', जून: '06',
  जुलाई: '07', सितंबर: '09', अक्टूबर: '10', नवंबर: '11', दिसंबर: '12',
};

const STOP_CLAUSE_PATTERN =
  /(?=(?:,|\band\b|\bmy\b|\bfather|\bmother|\bhusband|\bguardian|\bdate\s+of\s+birth|\bdob\b|\bborn\b|\bgender\b|\bsex\b|\bmale\b|\bfemale\b|\bphone\b|\bmobile\b|\bcontact\b|\baadhaar\b|\bid\s*number|\baddress\b|\blive\s+at|\blive\s+in|\bpin\b|\bpincode|\bpin\s*code|என்\s*பெயர்|தந்தை|அப்பா|தாய்|அம்மா|பிறந்த|பாலினம்|ஆண்|பெண்|கைபேசி|ஆதார்|முகவரி|அஞ்சல்|मेरा\s*नाम|पिता|माता|जन्म|लिंग|पुरुष|महिला|मोबाइल|आधार|पता|पिन))/i;

function extractClauseAfter(text: string, labelPattern: RegExp): string {
  const m = labelPattern.exec(text);
  if (!m) return '';
  const tail = text.slice(m.index + m[0].length).trim();
  const stopMatch = STOP_CLAUSE_PATTERN.exec(tail);
  const slice = stopMatch && stopMatch.index > 0 ? tail.slice(0, stopMatch.index) : tail;
  return slice
    .replace(/^[:\-,\s]+/, '')
    .replace(/[,.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTranscriptToMultipleFields(rawTranscript: string): Partial<CitizenFormData> {
  const text = normalizeIndicDigits(rawTranscript).trim();
  if (!text) return {};

  const out: Partial<CitizenFormData> = {};

  // 1. 12-digit Aadhaar / ID Number
  const idMatch = /(?:aadhaar|aadhar|id\s*(?:number|no)?|uid|ஆதார்|आधार)?\s*(?:is|number|:|-)?\s*\b(\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/i.exec(
    text
  );
  if (idMatch) {
    const digits = idMatch[1].replace(/\D/g, '');
    if (digits.length === 12) out.idNumber = digits;
  }

  // 2. 10-digit Indian mobile number (not overlapping Aadhaar)
  const phoneMatch = /(?:phone|mobile|cell|number|contact|கைபேசி|தொலைபேசி|मोबाइल|फोन)?\s*(?:is|no|:|-)?\s*(?:\+91[\s-]?)?\b([6-9]\d{4}[\s-]?\d{5}|[6-9]\d{9})\b/i.exec(
    text
  );
  if (phoneMatch) {
    const digits = phoneMatch[1].replace(/\D/g, '');
    if (digits.length === 10 && (!out.idNumber || !out.idNumber.includes(digits))) {
      out.phoneNumber = digits;
    }
  }

  // 3. 6-digit PIN code
  const pinMatch = /(?:pin\s*code|pincode|pin|postal|அஞ்சல்\s*குறியீடு|पिन\s*कोड|पिन)?\s*(?:is|:|-)?\s*\b([1-9]\d{5})\b/i.exec(
    text
  );
  if (pinMatch) {
    const pin = pinMatch[1];
    if (
      (!out.idNumber || !out.idNumber.includes(pin)) &&
      (!out.phoneNumber || !out.phoneNumber.includes(pin))
    ) {
      out.pincode = pin;
    }
  }

  // 4. Date of Birth (numeric, ISO YYYY-MM-DD, 8-digit, month words, or spoken number words)
  const dobPattern =
    /(?:19|20)\d{2}[/\-.]\d{1,2}[/\-.]\d{1,2}|\d{1,2}[\s/\-.]+\d{1,2}[\s/\-.]+(?:19|20)\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[^\s\d,]+\s+(?:19|20)\d{2}|[^\s\d,]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}/i;
  const dobSub = dobPattern.exec(text);
  if (dobSub) {
    const formatted = normalizeDobFormat(dobSub[0]);
    if (formatted) {
      out.dob = formatted;
    }
  }
  if (!out.dob) {
    const spokenDobClause = extractClauseAfter(
      text,
      /(?:date\s+of\s+birth|dob|born\s+on|பிறந்த\s*தேதி|जन्म\s*(?:तिथि|तारीख))\s*(?:is|:|-)?\s*/i
    );
    if (spokenDobClause) {
      const formatted = normalizeDobFormat(spokenDobClause);
      if (formatted) {
        out.dob = formatted;
      }
    }
  }

  // 5. Gender
  const normGender = normalizeSpokenAnswer(text, 'gender');
  if (normGender === 'Male' || normGender === 'Female' || normGender === 'Other') {
    out.gender = normGender;
  }

  // 6. Service Type
  if (/pension|welfare|ஓய்வூதியம்|पेंशन/i.test(text)) out.serviceType = 'pension_welfare';
  else if (/ration|food|ரேஷன்|राशन/i.test(text)) out.serviceType = 'ration_card';
  else if (/bank|kyc|subsidy|வங்கி|बैंक/i.test(text)) out.serviceType = 'bank_kyc';
  else if (/citizen|residence|certificate|குடிமகன்|निवास/i.test(text)) {
    out.serviceType = 'citizen_certificate';
  }

  // 7. Father / Guardian / Mother Name
  const fatherVal = extractClauseAfter(
    text,
    /(?:my\s+)?(?:father(?:'s)?|mother(?:'s)?|husband(?:'s)?|guardian(?:'s)?)\s*(?:name)?\s*(?:is\b|:|-)?\s+|(?:son|daughter|wife)\s+of\s+|(?:தந்தை|அப்பா|தாய்|அம்மா|கணவர்)\s*பெயர்\s*[:\-]?\s*|(?:पिता|माता|पति)\s*(?:का|की)?\s*नाम\s*[:\-]?\s*/i
  );
  if (fatherVal.length >= 2) {
    out.fatherName = fatherVal.replace(/\b\d+\b/g, '').trim();
  }

  // 8. Full Name (ensure we match "my name is" / "name is" / "I am", not "father name")
  const nameTextMasked = text.replace(
    /(?:father(?:'s)?|mother(?:'s)?|husband(?:'s)?|guardian(?:'s)?)\s*(?:name)?/gi,
    'guardian_ref'
  );
  const nameVal = extractClauseAfter(
    nameTextMasked,
    /(?:my\s+full\s+name\s*(?:is\b|:|-)?|my\s+name\s*(?:is\b|:|-)?|full\s+name\s*(?:is\b|:|-)?|name\s*(?:is\b|:|-)?|i\s+am|என்\s*பெயர்|பெயர்\s*[:\-]?|मेरा\s*नाम|नाम\s*[:\-]?)\s+/i
  );
  if (nameVal.length >= 2) {
    out.fullName = nameVal.replace(/\b(?:is|है)\b$/i, '').replace(/\b\d+\b/g, '').trim();
  }

  // 9. Address
  const addrVal = extractClauseAfter(
    text,
    /(?:my\s+)?(?:residential\s+)?address\s*(?:is\b|:|-)?\s+|i\s+live\s+(?:at|in)\s+|(?:என்\s*)?முகவரி\s*[:\-]?\s*|(?:मेरा\s*)?पता\s*[:\-]?\s*/i
  );
  if (addrVal.length >= 4) {
    out.address = addrVal;
  }

  return out;
}

function sanitizeServiceType(val: unknown): ServiceType | undefined {
  if (
    val === 'citizen_certificate' ||
    val === 'pension_welfare' ||
    val === 'ration_card' ||
    val === 'bank_kyc'
  ) {
    return val;
  }
  return undefined;
}

function sanitizeGender(val: unknown): GenderOption | undefined {
  if (typeof val !== 'string') return undefined;
  const g = val.trim().toLowerCase();
  if (g === 'female' || g === 'f') return 'Female';
  if (g === 'male' || g === 'm') return 'Male';
  if (g === 'other' || g === 'transgender') return 'Other';
  return undefined;
}

export async function parseSpokenDetailsToForm(params: {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
  language: LanguageCode;
}): Promise<{ transcript: string; extractedFields: ExtractionResultMap }> {
  let finalTranscript = params.transcript?.trim() ?? '';
  let serverFields: Record<string, string> = {};

  try {
    const res = await requestServerParseVoiceForm(params);
    if (res.transcript) finalTranscript = res.transcript;
    serverFields = res.fields ?? {};
  } catch {
    // Fall back gracefully to local deterministic multilingual parser
  }

  const localParsed = finalTranscript ? parseTranscriptToMultipleFields(finalTranscript) : {};
  const merged: ExtractionResultMap = {};

  const assignField = (
    key: keyof CitizenFormData,
    serverRaw: unknown,
    localRaw: string | undefined
  ) => {
    let val = '';
    if (typeof serverRaw === 'string' && serverRaw.trim()) {
      val = serverRaw.trim();
    } else if (localRaw && localRaw.trim()) {
      val = localRaw.trim();
    }
    if (!val) return;

    if (key === 'idNumber') val = val.replace(/\D/g, '').slice(0, 12);
    if (key === 'phoneNumber') val = val.replace(/\D/g, '').slice(-10);
    if (key === 'pincode') val = val.replace(/\D/g, '').slice(0, 6);
    if (key === 'dob') val = normalizeDobFormat(val) || val;
    if (key === 'gender') {
      const g = sanitizeGender(val);
      if (!g) return;
      val = g;
    }
    if (key === 'serviceType') {
      const s = sanitizeServiceType(val);
      if (!s) return;
      val = s;
    }

    if (val) {
      merged[key] = {
        value: val,
        confidence: 'high',
        score: 90,
        source: 'voice',
        needsReview: false,
      };
    }
  };

  assignField('serviceType', serverFields.serviceType, localParsed.serviceType);
  assignField('fullName', serverFields.fullName, localParsed.fullName);
  assignField('idNumber', serverFields.idNumber, localParsed.idNumber);
  assignField('dob', serverFields.dob, localParsed.dob);
  assignField('gender', serverFields.gender, localParsed.gender);
  assignField('fatherName', serverFields.fatherName, localParsed.fatherName);
  assignField('phoneNumber', serverFields.phoneNumber, localParsed.phoneNumber);
  assignField('address', serverFields.address, localParsed.address);
  assignField('pincode', serverFields.pincode, localParsed.pincode);

  return {
    transcript: finalTranscript,
    extractedFields: merged,
  };
}
