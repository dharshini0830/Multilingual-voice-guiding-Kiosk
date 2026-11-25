import type { TranslationDictionary } from '@/src/modules/i18n/types';
import type { CitizenFormData, FieldKey } from '@/src/types/kiosk';

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

export function verifyVerhoeffChecksum(digitsOnly: string): boolean {
  if (!/^\d{12}$/.test(digitsOnly)) return false;
  let c = 0;
  const arr = digitsOnly.split('').reverse().map(Number);
  for (let i = 0; i < arr.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][arr[i]]];
  }
  return c === 0;
}

export interface FieldValidationResult {
  valid: boolean;
  error: string | null;
  warning: string | null;
}

export function validateField(
  field: FieldKey,
  value: string,
  t: TranslationDictionary
): FieldValidationResult {
  const trimmed = (value ?? '').trim();

  switch (field) {
    case 'serviceType': {
      return trimmed
        ? { valid: true, error: null, warning: null }
        : { valid: false, error: t.validation.required, warning: null };
    }
    case 'fullName': {
      if (!trimmed) return { valid: false, error: t.validation.required, warning: null };
      if (trimmed.length < 2) return { valid: false, error: t.validation.nameTooShort, warning: null };
      return { valid: true, error: null, warning: null };
    }
    case 'idNumber': {
      const digits = trimmed.replace(/\D/g, '');
      if (!digits) return { valid: false, error: t.validation.required, warning: null };
      if (!/^\d{12}$/.test(digits)) {
        return { valid: false, error: t.validation.idInvalid, warning: null };
      }
      const checksumOk = verifyVerhoeffChecksum(digits);
      return {
        valid: true,
        error: null,
        warning: checksumOk ? null : t.validation.idChecksumWarn,
      };
    }
    case 'dob': {
      if (!trimmed) return { valid: false, error: t.validation.required, warning: null };
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
      if (!m) return { valid: false, error: t.validation.dobInvalid, warning: null };
      const d = Number(m[1]);
      const mo = Number(m[2]);
      const y = Number(m[3]);
      const dt = new Date(y, mo - 1, d);
      const currY = new Date().getFullYear();
      if (
        y < 1900 ||
        y > currY ||
        dt.getFullYear() !== y ||
        dt.getMonth() !== mo - 1 ||
        dt.getDate() !== d
      ) {
        return { valid: false, error: t.validation.dobInvalid, warning: null };
      }
      return { valid: true, error: null, warning: null };
    }
    case 'gender': {
      if (trimmed !== 'Male' && trimmed !== 'Female' && trimmed !== 'Other') {
        return { valid: false, error: t.validation.genderRequired, warning: null };
      }
      return { valid: true, error: null, warning: null };
    }
    case 'fatherName': {
      if (!trimmed) return { valid: false, error: t.validation.required, warning: null };
      if (trimmed.length < 2) return { valid: false, error: t.validation.nameTooShort, warning: null };
      return { valid: true, error: null, warning: null };
    }
    case 'phoneNumber': {
      const digits = trimmed.replace(/\D/g, '').slice(-10);
      if (!digits) return { valid: false, error: t.validation.required, warning: null };
      if (!/^[6-9]\d{9}$/.test(digits)) {
        return { valid: false, error: t.validation.phoneInvalid, warning: null };
      }
      return { valid: true, error: null, warning: null };
    }
    case 'address': {
      if (!trimmed) return { valid: false, error: t.validation.required, warning: null };
      if (trimmed.length < 8) {
        return { valid: false, error: t.validation.addressTooShort, warning: null };
      }
      return { valid: true, error: null, warning: null };
    }
    case 'pincode': {
      const digits = trimmed.replace(/\D/g, '');
      if (!digits) return { valid: false, error: t.validation.required, warning: null };
      if (!/^[1-9]\d{5}$/.test(digits)) {
        return { valid: false, error: t.validation.pincodeInvalid, warning: null };
      }
      return { valid: true, error: null, warning: null };
    }
  }
}

export function validateEntireForm(
  data: CitizenFormData,
  t: TranslationDictionary
): {
  isValid: boolean;
  errors: Partial<Record<FieldKey, string>>;
  warnings: Partial<Record<FieldKey, string>>;
  invalidFields: FieldKey[];
} {
  const orderedKeys: FieldKey[] = [
    'serviceType',
    'fullName',
    'idNumber',
    'dob',
    'gender',
    'fatherName',
    'phoneNumber',
    'address',
    'pincode',
  ];

  const errors: Partial<Record<FieldKey, string>> = {};
  const warnings: Partial<Record<FieldKey, string>> = {};
  const invalidFields: FieldKey[] = [];

  for (const key of orderedKeys) {
    const res = validateField(key, data[key] ?? '', t);
    if (!res.valid && res.error) {
      errors[key] = res.error;
      invalidFields.push(key);
    }
    if (res.warning) {
      warnings[key] = res.warning;
    }
  }

  return {
    isValid: invalidFields.length === 0,
    errors,
    warnings,
    invalidFields,
  };
}

export function maskIdForDisplay(idNumber: string, revealFull: boolean): string {
  const digits = (idNumber ?? '').replace(/\D/g, '');
  if (!digits) return '—';
  if (revealFull) {
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  }
  if (digits.length <= 4) return 'XXXX';
  return `XXXX XXXX ${digits.slice(-4)}`;
}
