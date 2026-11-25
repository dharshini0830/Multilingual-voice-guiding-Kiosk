import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import { verifyVerhoeffChecksum } from '@/src/modules/validation/formValidator';
import type { ExtractedFieldMeta, ExtractionResultMap, FieldConfidence, FieldKey } from '@/src/types/kiosk';

function toConfidenceLabel(score: number): FieldConfidence {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  if (score > 0) return 'low';
  return 'missing';
}

function makeMeta(
  value: string,
  score: number,
  source: 'ocr' | 'qr' = 'ocr'
): ExtractedFieldMeta {
  const clean = value.trim();
  const effectiveScore = clean ? score : 0;
  return {
    value: clean,
    score: effectiveScore,
    confidence: toConfidenceLabel(effectiveScore),
    source,
    needsReview: effectiveScore > 0 && effectiveScore < 80,
  };
}

function normalizeDigits(text: string): string {
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

const BOILERPLATE_PATTERNS = [
  /government\s+of\s+india/i,
  /govt\.?\s+of\s+india/i,
  /government\s+of\s+tamil/i,
  /unique\s+identification/i,
  /uidai/i,
  /aadhaar/i,
  /mera\s+aadhaar/i,
  /bharat\s+sarkar/i,
  /income\s+tax/i,
  /permanent\s+account/i,
  /election\s+commission/i,
  /elector'?s\s+photo/i,
  /enrolment/i,
  /download/i,
  /issued\s+on/i,
  /proof\s+of\s+identity/i,
  /valid\s+throughout/i,
  /\bvid\b\s*[:\s]/i,
  /help@/i,
  /www\./i,
  /1947/,
  /இந்திய\s+அரசு/,
  /ஆதார்/,
  /भारत\s+सरकार/,
];

function isBoilerplateLine(line: string): boolean {
  const clean = line.trim();
  if (clean.length < 3) return true;
  if (/^\d[\d\s/.-]+$/.test(clean)) return true;
  return BOILERPLATE_PATTERNS.some((rx) => rx.test(clean));
}

function hasMixedLatinAndIndic(str: string): boolean {
  const hasLatin = /[A-Za-z]/.test(str);
  const hasIndicOrUrdu = /[\u0600-\u06FF\u0900-\u0DFF]/.test(str);
  return hasLatin && hasIndicOrUrdu;
}

function cleanNameLine(raw: string): string {
  return raw
    .replace(/^[^A-Za-z\u0600-\u06FF\u0900-\u0DFF]+/, '')
    .replace(/[^A-Za-z.\s\u0600-\u06FF\u0900-\u0DFF]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReasonableName(line: string): boolean {
  const clean = cleanNameLine(line);
  if (clean.length < 3 || clean.length > 65) return false;
  if (isBoilerplateLine(clean)) return false;
  if (/\d/.test(clean)) return false;
  if (/[\[\]{}|<>~`^*_=+]/.test(line)) return false;
  // Reject mixed Latin+Indic OCR hallucinations like "ந ட் Pr"
  if (hasMixedLatinAndIndic(clean)) return false;
  if (
    /\b(male|female|transgender|dob|d0b|birth|year|address|pincode|pin|mobile|phone|father|mother|husband|guardian|street|road|nagar|chennai|tamil|nadu)\b/i.test(
      clean
    )
  ) {
    return false;
  }
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return false;
  // Require majority of tokens to be real words (>= 2 base chars) so "ந ட் Pr" fails
  const realWordTokens = tokens.filter((tk) => tk.replace(/\./g, '').length >= 2);
  if (realWordTokens.length === 0) return false;
  if (tokens.length >= 2 && realWordTokens.length / tokens.length < 0.6) return false;
  return true;
}

function normalizeDateString(raw: string): string {
  return normalizeDobFormat(raw);
}

function cleanAddressText(raw: string, excludeValues: string[]): string {
  let cleaned = raw;
  for (const val of excludeValues) {
    if (val && val.length >= 4) {
      const esc = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(esc, 'gi'), ' ');
    }
  }
  // Remove field labels and OCR bracket noise
  cleaned = cleaned
    .replace(
      /(?:Father(?:'s)?|Mother(?:'s)?|Husband(?:'s)?|Applicant|Holder)?\s*Name\s*[:\-]?\s*/gi,
      ' '
    )
    .replace(/(?:தந்தை|தாய்|தாய|முழுப்|பெயர்|இததை|முகவரி|பிறந்த தேதி|கைபேசி)\s*[:\-]?\s*/g, ' ')
    .replace(/(?:पिता का नाम|माता का नाम|नाम|पता)\s*[:\-]?\s*/g, ' ')
    .replace(/[\[\]{}|<>~`^*_=+]/g, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[,.\s-]+|[,.\s-]+$/g, '')
    .trim();

  // Filter comma segments that are pure 1-2 char Latin noise or pure single-letter tokens
  const parts = cleaned
    .split(',')
    .map((p) =>
      p
        .replace(/(?:^|\s)[a-z](?=\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((p) => p.length >= 3 && !/^[A-Za-z]{1,2}$/.test(p));

  return parts.join(', ').trim();
}

export function parseOcrTextToFields(
  rawText: string,
  tesseractConfidence = 75
): ExtractionResultMap {
  const normalized = normalizeDigits(rawText);
  const lines = normalized
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const fields: ExtractionResultMap = {};

  // 1. Extract Identity Number (12-digit Aadhaar preferred; skip 16-digit VID; PAN/EPIC fallback)
  const idCandidates: { digits: string; verhoeff: boolean }[] = [];
  for (const line of lines) {
    if (/\bVID\b/i.test(line)) continue;
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(line)) continue;

    const matches = line.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g);
    if (matches) {
      for (const m of matches) {
        const digits = m.replace(/\D/g, '');
        if (digits.length === 12) {
          idCandidates.push({
            digits,
            verhoeff: verifyVerhoeffChecksum(digits),
          });
        }
      }
    }
  }
  if (idCandidates.length > 0) {
    const best = idCandidates.find((c) => c.verhoeff) ?? idCandidates[0];
    const score = best.verhoeff ? Math.max(85, Math.round(tesseractConfidence)) : 52;
    fields.idNumber = makeMeta(best.digits, score);
  } else {
    const fullJoined = lines.join(' ');
    const panMatch = /\b([A-Z]{5}\d{4}[A-Z])\b/.exec(fullJoined);
    const epicMatch = /\b([A-Z]{2,3}\d{7})\b/.exec(fullJoined);
    if (panMatch) fields.idNumber = makeMeta(panMatch[1], 78);
    else if (epicMatch) fields.idNumber = makeMeta(epicMatch[1], 75);
  }

  // 2. Extract Date of Birth
  let dobLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dobTagged =
      /(?:d[o0]b|date\s+of\s+birth|birth|जन्म|பிறந்த|పుట్టిన|ಜನ್ಮ|ജനന|জন্ম|જન્મ|ਜਨਮ|ଜନ୍ମ|پیدائش)[^0-9]*(\d{1,2}[/\-.| ]\d{1,2}[/\-.| ](?:19|20)\d{2})/i.exec(
        line
      );
    if (dobTagged) {
      const formatted = normalizeDateString(dobTagged[1]);
      if (formatted) {
        fields.dob = makeMeta(formatted, 90);
        dobLineIndex = i;
        break;
      }
    }
  }
  if (!fields.dob) {
    for (let i = 0; i < lines.length; i++) {
      const genericDate = /\b(\d{2}[/\-.|]\d{2}[/\-.|](?:19|20)\d{2})\b/.exec(lines[i]);
      if (genericDate) {
        const formatted = normalizeDateString(genericDate[1]);
        if (formatted) {
          fields.dob = makeMeta(formatted, 74);
          dobLineIndex = i;
          break;
        }
      }
    }
  }
  if (!fields.dob) {
    for (let i = 0; i < lines.length; i++) {
      const yobMatch = /(?:year\s+of\s+birth|y[o0]b)\s*[:\-]?\s*((?:19|20)\d{2})\b/i.exec(lines[i]);
      if (yobMatch) {
        fields.dob = makeMeta(`01/01/${yobMatch[1]}`, 60);
        dobLineIndex = i;
        break;
      }
    }
  }

  // 3. Extract Gender
  const fullJoined = lines.join(' ');
  if (
    /\bFEM[AE][L1I]E\b|\bFEMALE\b|महिला|स्त्री|பெண்|స్త్రీ|మహిళ|ಮಹಿಳೆ|ಸ್ತ್ರೀ|സ്ത്രീ|മഹിള|মহিলা|নারী|ਔਰਤ|ਮਹਿਲਾ|ମହିଳା|عورت|خاتون/i.test(
      fullJoined
    )
  ) {
    fields.gender = makeMeta('Female', 90);
  } else if (
    /\bM[AE][L1I]E\b|\bMALE\b|पुरुष|पुल्लिंग|ஆண்|పురుషుడు|ಪುರುಷ|പുരുഷൻ|পুরুষ|ਮਰਦ|ਪੁਰਸ਼|ପୁରୁଷ|مرد/i.test(
      fullJoined
    )
  ) {
    fields.gender = makeMeta('Male', 90);
  } else if (/\bTRANSGENDER\b|\bOTHER\b/i.test(fullJoined)) {
    fields.gender = makeMeta('Other', 82);
  }

  // 4. Extract Phone Number (10 digits starting with 6-9, not inside 12-digit ID)
  const idDigits = fields.idNumber?.value ?? '';
  for (const line of lines) {
    if (/\bVID\b/i.test(line)) continue;
    const mobMatch =
      /(?:mob|mobile|ph|phone|tel|contact|கைபேசி|தொலைபேசி|मोबाइल)?\s*[:\-]?\s*(?:\+91[\s-]?)?([6-9]\d{9})\b/i.exec(
        line
      );
    if (mobMatch && !idDigits.includes(mobMatch[1])) {
      const hasLabel = /(?:mob|mobile|ph|phone|tel|contact|கைபேசி|मोबाइल|\+91)/i.test(line);
      fields.phoneNumber = makeMeta(mobMatch[1], hasLabel ? 88 : 68);
      break;
    }
  }

  // 5. Extract 6-digit PIN Code (prefer line with "PIN" or near the end)
  let pinLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/\bVID\b/i.test(line)) continue;
    const labeledPin = /(?:pin|pincode|pin\s*code|அஞ்சல்|पिन)\s*[:\-]?\s*\b([1-9]\d{5})\b/i.exec(line);
    if (labeledPin && !idDigits.includes(labeledPin[1])) {
      fields.pincode = makeMeta(labeledPin[1], 90);
      pinLineIndex = i;
      break;
    }
  }
  if (!fields.pincode) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (/\bVID\b/i.test(line)) continue;
      const pinMatch = /\b([1-9]\d{5})\b/.exec(line);
      if (pinMatch && !idDigits.includes(pinMatch[1])) {
        fields.pincode = makeMeta(pinMatch[1], 84);
        pinLineIndex = i;
        break;
      }
    }
  }

  // 6. Extract Father's / Mother's / Guardian's Name (English + Indic labels)
  let fatherLineIndex = -1;
  const fatherLabelRegex =
    /(?:[SDWC]\s*[/|]\s*[O0]|SIO|DIO|CIO|Father(?:'s)?\s*Name|Mother(?:'s)?\s*Name|Husband(?:'s)?\s*Name|Guardian(?:'s)?\s*Name|Care\s*Of|தந்தை\s*பெயர்|தாய்\s*பெயர்|தாய\s*பெயர்|கணவர்\s*பெயர்|पिता\s*का\s*नाम|माता\s*का\s*नाम|पति\s*का\s*नाम)\s*[:\-]?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const relLabelMatch = fatherLabelRegex.exec(line);
    if (relLabelMatch) {
      let candidate = relLabelMatch[1] ?? '';
      if (cleanNameLine(candidate).length < 3 && i + 1 < lines.length) {
        candidate = lines[i + 1];
      }
      const cleanRel = cleanNameLine(
        candidate.split(/[,;]/)[0].replace(/\s+\d+.*$/, '')
      );
      if (cleanRel.length >= 3 && !isBoilerplateLine(cleanRel) && !hasMixedLatinAndIndic(cleanRel)) {
        fields.fatherName = makeMeta(cleanRel, 82);
        fatherLineIndex = i;
        break;
      }
    }
  }

  // 7. Extract Full Name (explicit English or regional labels, then positional heuristics)
  const nameLabelRegex =
    /(?:^|\s)(?:Applicant\s*Name|Holder\s*Name|Full\s*Name|Name|முழுப்\s*பெயர்|பெயர்|पूरा\s*नाम|नाम|పూర్తి\s*పేరు|పేరు|ಪೂರ್ಣ\s*ಹೆಸರು|ಹೆಸರು|പൂർണ്ണ\s*പേര്|പേര്|পুরো\s*নাম|নাম|पूर्ण\s*नाव|नाव|પૂરું\s*નામ|નામ|ਪੂਰਾ\s*ਨਾਮ|ਨਾਮ|ସମ୍ପୂର୍ଣ୍ଣ\s*ନାମ|ନାମ|پورا\s*نام|نام)\s*[:\-]\s*(.+)$/i;

  for (let i = 0; i < lines.length; i++) {
    if (i === fatherLineIndex) continue;
    // Skip lines that are Father/Mother Name so "Name:" inside "Father Name:" doesn't steal fullName
    if (fatherLabelRegex.test(lines[i])) continue;
    const nameMatch = nameLabelRegex.exec(lines[i]);
    if (nameMatch) {
      const cleaned = cleanNameLine(nameMatch[1].split(/[,;]/)[0]);
      if (isReasonableName(cleaned)) {
        fields.fullName = makeMeta(cleaned, 86);
        break;
      }
    }
  }

  if (!fields.fullName && dobLineIndex > 0) {
    const candidates: { text: string; isLatin: boolean }[] = [];
    for (let j = dobLineIndex - 1; j >= Math.max(0, dobLineIndex - 4); j--) {
      if (j === fatherLineIndex) continue;
      const cleaned = cleanNameLine(lines[j]);
      if (isReasonableName(cleaned)) {
        candidates.push({ text: cleaned, isLatin: /^[A-Za-z.\s]+$/.test(cleaned) });
      }
    }
    const chosen = candidates.find((c) => c.isLatin) ?? candidates[0];
    if (chosen) fields.fullName = makeMeta(chosen.text, 78);
  }

  if (!fields.fullName && fatherLineIndex > 0) {
    for (let j = fatherLineIndex - 1; j >= Math.max(0, fatherLineIndex - 2); j--) {
      const cand = cleanNameLine(lines[j].split(/[,;]/)[0]);
      if (isReasonableName(cand)) {
        fields.fullName = makeMeta(cand, 76);
        break;
      }
    }
  }

  if (!fields.fullName) {
    const candidates = lines
      .filter((_, idx) => idx !== fatherLineIndex)
      .map((l) => cleanNameLine(l.split(/[,;]/)[0]))
      .filter((c) => isReasonableName(c) && c.split(' ').length >= 2 && c.split(' ').length <= 5);
    const latinBest = candidates.find((c) => /^[A-Za-z.\s]+$/.test(c)) ?? candidates[0];
    if (latinBest) {
      fields.fullName = makeMeta(latinBest, 66);
    }
  }

  // 8. Extract Address (cleaned of already-extracted non-address fields & noise)
  const excludeFromAddr = [
    fields.fullName?.value ?? '',
    fields.fatherName?.value ?? '',
    fields.idNumber?.value ?? '',
    fields.phoneNumber?.value ?? '',
  ];

  const addrStartIdx = lines.findIndex((l) =>
    /(?:^|\s)(?:Address|पता|முகவரி|చిరునామా|ವಿಳಾಸ|വിലാസം|ঠিকানা|पत्ता|સરનામું|ਪਤਾ|ଠିକଣା|پتہ)\s*[:\-]?/i.test(
      l
    )
  );
  if (addrStartIdx !== -1) {
    const endIdx =
      pinLineIndex >= addrStartIdx ? pinLineIndex : Math.min(lines.length - 1, addrStartIdx + 4);
    const addrParts: string[] = [];
    for (let k = addrStartIdx; k <= endIdx; k++) {
      const chunk = lines[k]
        .replace(
          /^.*?(?:Address|पता|முகவரி|చిరునామా|ವಿಳಾಸ|വിലാസം|ঠিকানা|पत्ता|સરનામું|ਪਤਾ|ଠିକଣା|پتہ)\s*[:\-]?\s*/i,
          ''
        )
        .trim();
      if (chunk && !isBoilerplateLine(chunk)) {
        addrParts.push(chunk);
      }
    }
    const cleanedAddr = cleanAddressText(addrParts.join(', '), excludeFromAddr);
    if (cleanedAddr.length >= 8) {
      fields.address = makeMeta(cleanedAddr, 76);
    }
  } else if (fatherLineIndex !== -1 && pinLineIndex > fatherLineIndex) {
    const addrParts: string[] = [];
    for (let k = fatherLineIndex; k <= pinLineIndex; k++) {
      if (!isBoilerplateLine(lines[k])) addrParts.push(lines[k]);
    }
    const cleanedAddr = cleanAddressText(addrParts.join(', '), excludeFromAddr);
    if (cleanedAddr.length >= 8) {
      fields.address = makeMeta(cleanedAddr, 68);
    }
  }

  return fields;
}

export function mergeOcrFieldMaps(
  primary: ExtractionResultMap,
  secondary: ExtractionResultMap
): ExtractionResultMap {
  const keys: Array<Exclude<FieldKey, 'serviceType'>> = [
    'fullName',
    'idNumber',
    'dob',
    'gender',
    'fatherName',
    'phoneNumber',
    'address',
    'pincode',
  ];

  const merged: ExtractionResultMap = {};
  for (const key of keys) {
    const a = primary[key];
    const b = secondary[key];
    if (a?.value && !b?.value) {
      merged[key] = a;
    } else if (!a?.value && b?.value) {
      merged[key] = b;
    } else if (a?.value && b?.value) {
      // For names/fatherName, prefer clean Latin script if both exist and scores are close
      if ((key === 'fullName' || key === 'fatherName') && /^[A-Za-z.\s]+$/.test(a.value) && !hasMixedLatinAndIndic(a.value)) {
        merged[key] = a.score >= b.score - 12 ? a : b;
      } else if (
        key === 'address' &&
        !hasMixedLatinAndIndic(a.value) &&
        hasMixedLatinAndIndic(b.value)
      ) {
        merged[key] = a.score >= b.score - 16 ? a : b;
      } else {
        merged[key] = b.score > a.score ? b : a;
      }
    }
  }
  return merged;
}

export function normalizeServerAiFields(
  aiData: Record<string, unknown>
): ExtractionResultMap {
  const confObj = (aiData.confidence ?? {}) as Record<string, unknown>;
  const fields: ExtractionResultMap = {};

  const mapKey = (
    key: 'fullName' | 'idNumber' | 'dob' | 'gender' | 'fatherName' | 'phoneNumber' | 'address' | 'pincode'
  ) => {
    const rawVal = typeof aiData[key] === 'string' ? aiData[key].trim() : '';
    if (!rawVal) return;
    let score = typeof confObj[key] === 'number' ? Math.round(confObj[key]) : 88;

    let cleanVal = rawVal;
    if (key === 'idNumber') {
      const digitsOnly = rawVal.replace(/\D/g, '');
      if (digitsOnly.length === 12) {
        cleanVal = digitsOnly;
        if (!verifyVerhoeffChecksum(cleanVal)) {
          score = Math.min(score, 62);
        }
      } else {
        cleanVal = rawVal.replace(/\s+/g, '').toUpperCase();
      }
    } else if (key === 'dob') {
      cleanVal = normalizeDateString(rawVal) || rawVal;
    } else if (key === 'gender') {
      const g = rawVal.toLowerCase();
      if (g === 'f' || g.includes('female')) cleanVal = 'Female';
      else if (g === 'm' || g.includes('male')) cleanVal = 'Male';
      else if (g.includes('other') || g.includes('trans')) cleanVal = 'Other';
      else return;
    } else if (key === 'phoneNumber') {
      cleanVal = rawVal.replace(/\D/g, '').slice(-10);
    } else if (key === 'pincode') {
      cleanVal = rawVal.replace(/\D/g, '').slice(0, 6);
    }

    fields[key] = makeMeta(cleanVal, score, 'ocr');
  };

  mapKey('fullName');
  mapKey('idNumber');
  mapKey('dob');
  mapKey('gender');
  mapKey('fatherName');
  mapKey('phoneNumber');
  mapKey('address');
  mapKey('pincode');

  return fields;
}
