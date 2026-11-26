export type LanguageCode =
  | 'en'
  | 'ta'
  | 'hi'
  | 'te'
  | 'kn'
  | 'ml'
  | 'bn'
  | 'mr'
  | 'gu'
  | 'pa'
  | 'or'
  | 'ur';

export type WorkflowStage =
  | 'welcome'
  | 'language'
  | 'dashboard'
  | 'document-scan'
  | 'ocr-review'
  | 'voice-form'
  | 'review'
  | 'completion';

export type ServiceType =
  | 'citizen_certificate'
  | 'pension_welfare'
  | 'ration_card'
  | 'bank_kyc';

export type GenderOption = '' | 'Male' | 'Female' | 'Other';

export type FieldKey =
  | 'serviceType'
  | 'fullName'
  | 'idNumber'
  | 'dob'
  | 'gender'
  | 'fatherName'
  | 'phoneNumber'
  | 'address'
  | 'pincode';

export interface CitizenFormData {
  serviceType: ServiceType;
  fullName: string;
  idNumber: string;
  dob: string;
  gender: GenderOption;
  fatherName: string;
  phoneNumber: string;
  address: string;
  pincode: string;
}

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export interface ExtractedFieldMeta {
  value: string;
  confidence: FieldConfidence;
  score: number; // 0-100
  source: 'ocr' | 'voice' | 'manual';
  needsReview: boolean;
}

export type ExtractionResultMap = Partial<Record<FieldKey, ExtractedFieldMeta>>;

export interface OcrScanResult {
  rawText: string;
  fields: ExtractionResultMap;
  overallConfidence: number;
  engine: 'tesseract-local' | 'gemini-enhanced';
  preprocessedDataUrl: string;
  warnings: string[];
}

export interface SubmissionRecord {
  referenceId: string;
  submittedAt: string;
  language: LanguageCode;
  maskedIdNumber: string;
  status: 'submitted';
  consentTimestamp: string;
  formSummary: {
    serviceType: ServiceType;
    fullName: string;
    dob: string;
    gender: GenderOption;
    fatherName: string;
    phoneNumber: string;
    address: string;
    pincode: string;
  };
}

export type VoiceGender = 'female' | 'male';

export interface VoiceState {
  isSpeaking: boolean;
  isPaused: boolean;
  isMuted: boolean;
  rate: number;
  voiceGender: VoiceGender;
  currentText: string;
  previousText: string;
  provider: 'browser' | 'server-neural' | 'text-only';
  voiceUnavailableNotice: string | null;
}
