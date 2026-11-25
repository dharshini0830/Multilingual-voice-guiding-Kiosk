import { normalizeDobFormat } from '@/src/modules/form/dobFormatter';
import type { CitizenFormData, ExtractionResultMap, FieldKey } from '@/src/types/kiosk';

export interface FormFieldDescriptor {
  key: FieldKey;
  inputType: 'text' | 'tel' | 'select' | 'textarea';
  maxLength: number;
  required: boolean;
}

export const FORM_FIELDS_ORDER: readonly FormFieldDescriptor[] = [
  { key: 'fullName', inputType: 'text', maxLength: 120, required: true },
  { key: 'idNumber', inputType: 'tel', maxLength: 16, required: true },
  { key: 'dob', inputType: 'text', maxLength: 24, required: true },
  { key: 'gender', inputType: 'select', maxLength: 12, required: true },
  { key: 'fatherName', inputType: 'text', maxLength: 120, required: true },
  { key: 'phoneNumber', inputType: 'tel', maxLength: 14, required: true },
  { key: 'address', inputType: 'textarea', maxLength: 300, required: true },
  { key: 'pincode', inputType: 'tel', maxLength: 6, required: true },
] as const;

export function createEmptyFormData(): CitizenFormData {
  return {
    serviceType: 'citizen_certificate',
    fullName: '',
    idNumber: '',
    dob: '',
    gender: '',
    fatherName: '',
    phoneNumber: '',
    address: '',
    pincode: '',
  };
}

export function countCompletedFields(data: CitizenFormData): { filled: number; total: number } {
  const keys: FieldKey[] = FORM_FIELDS_ORDER.map((f) => f.key);
  let filled = 0;
  for (const key of keys) {
    if (String(data[key] ?? '').trim().length > 0) {
      filled++;
    }
  }
  return { filled, total: keys.length };
}

export function mergeExtractedFieldsIntoForm(
  current: CitizenFormData,
  extracted: ExtractionResultMap
): CitizenFormData {
  const next = { ...current };

  const assignIfPresent = (key: Exclude<FieldKey, 'serviceType' | 'gender'>) => {
    const meta = extracted[key];
    if (meta && meta.value.trim().length > 0) {
      next[key] = meta.value.trim();
    }
  };

  assignIfPresent('fullName');
  assignIfPresent('idNumber');
  assignIfPresent('dob');
  if (next.dob) {
    next.dob = normalizeDobFormat(next.dob) || next.dob;
  }
  assignIfPresent('fatherName');
  assignIfPresent('phoneNumber');
  assignIfPresent('address');
  assignIfPresent('pincode');

  const g = extracted.gender?.value;
  if (g === 'Male' || g === 'Female' || g === 'Other') {
    next.gender = g;
  }

  const st = extracted.serviceType?.value;
  if (
    st === 'citizen_certificate' ||
    st === 'pension_welfare' ||
    st === 'ration_card' ||
    st === 'bank_kyc'
  ) {
    next.serviceType = st;
  }

  return next;
}
