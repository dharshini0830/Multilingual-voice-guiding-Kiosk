import { sanitizeTextInput } from './security.ts';

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidVerhoeff(numStr: string): boolean {
  if (!/^\d{12}$/.test(numStr)) return false;
  let c = 0;
  const digits = numStr.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  }
  return c === 0;
}

const VALID_SERVICES = new Set([
  'citizen_certificate',
  'pension_welfare',
  'ration_card',
  'bank_kyc',
]);

const VALID_GENDERS = new Set(['Male', 'Female', 'Other']);

const VALID_LANGUAGES = new Set([
  'en',
  'ta',
  'hi',
  'te',
  'kn',
  'ml',
  'bn',
  'mr',
  'gu',
  'pa',
  'or',
  'ur',
]);

export interface ValidatedSubmissionInput {
  serviceType: string;
  fullName: string;
  idNumber: string;
  dob: string;
  gender: string;
  fatherName: string;
  phoneNumber: string;
  address: string;
  pincode: string;
  language: string;
  consentGiven: boolean;
}

export function validateAndSanitizeSubmission(
  raw: Record<string, unknown>
): { ok: true; data: ValidatedSubmissionInput } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const serviceType = sanitizeTextInput(raw.serviceType, 40);
  if (!VALID_SERVICES.has(serviceType)) {
    errors.serviceType = 'Invalid service type.';
  }

  const fullName = sanitizeTextInput(raw.fullName, 120);
  if (fullName.length < 2) {
    errors.fullName = 'Full name must be at least 2 characters.';
  }

  const idNumber = sanitizeTextInput(raw.idNumber, 24).replace(/\D/g, '');
  if (!/^\d{12}$/.test(idNumber)) {
    errors.idNumber = 'Identity number must be exactly 12 digits.';
  }

  const dob = sanitizeTextInput(raw.dob, 20);
  const dobMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob);
  if (!dobMatch) {
    errors.dob = 'Date of birth must be in DD/MM/YYYY format.';
  } else {
    const day = Number(dobMatch[1]);
    const month = Number(dobMatch[2]);
    const year = Number(dobMatch[3]);
    const dt = new Date(year, month - 1, day);
    const currentYear = new Date().getFullYear();
    if (
      year < 1900 ||
      year > currentYear ||
      dt.getFullYear() !== year ||
      dt.getMonth() !== month - 1 ||
      dt.getDate() !== day
    ) {
      errors.dob = 'Date of birth is not a valid calendar date.';
    }
  }

  const gender = sanitizeTextInput(raw.gender, 20);
  if (!VALID_GENDERS.has(gender)) {
    errors.gender = 'Gender must be Male, Female, or Other.';
  }

  const fatherName = sanitizeTextInput(raw.fatherName, 120);
  if (fatherName.length < 2) {
    errors.fatherName = "Father's or guardian's name must be at least 2 characters.";
  }

  const phoneNumber = sanitizeTextInput(raw.phoneNumber, 20).replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phoneNumber)) {
    errors.phoneNumber = 'Phone number must be a valid 10-digit Indian mobile number.';
  }

  const address = sanitizeTextInput(raw.address, 300);
  if (address.length < 8) {
    errors.address = 'Address must be at least 8 characters.';
  }

  const pincode = sanitizeTextInput(raw.pincode, 10).replace(/\D/g, '');
  if (!/^[1-9]\d{5}$/.test(pincode)) {
    errors.pincode = 'PIN code must be a valid 6-digit number.';
  }

  const language = sanitizeTextInput(raw.language, 10);
  if (!VALID_LANGUAGES.has(language)) {
    errors.language = 'Unsupported language selection.';
  }

  const consentGiven = raw.consentGiven === true;
  if (!consentGiven) {
    errors.consentGiven = 'Explicit user consent is required before submission.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    data: {
      serviceType,
      fullName,
      idNumber,
      dob,
      gender,
      fatherName,
      phoneNumber,
      address,
      pincode,
      language,
      consentGiven,
    },
  };
}
