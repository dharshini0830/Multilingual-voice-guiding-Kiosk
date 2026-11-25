import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  encryptSensitiveData,
  maskIdNumber,
  type EncryptedBlob,
} from './security.ts';
import type { ValidatedSubmissionInput } from './validation.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'submissions.enc.json');

export interface StoredSubmissionRecord {
  referenceId: string;
  sessionId: string;
  submittedAt: string;
  consentTimestamp: string;
  language: string;
  serviceType: string;
  maskedIdNumber: string;
  status: 'submitted';
  encryptedPayload: EncryptedBlob;
}

interface StoreFileShape {
  records: StoredSubmissionRecord[];
}

function ensureStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ records: [] }, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}

function readStore(): StoreFileShape {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreFileShape;
    return Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch {
    return { records: [] };
  }
}

function writeStoreAtomic(store: StoreFileShape): void {
  ensureStore();
  const tempPath = `${STORE_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tempPath, STORE_PATH);
}

function generateReferenceId(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `JSV-${datePart}-${randomPart}`;
}

export function saveSubmissionRecord(
  input: ValidatedSubmissionInput,
  sessionId: string
): {
  referenceId: string;
  submittedAt: string;
  consentTimestamp: string;
  language: string;
  maskedIdNumber: string;
  status: 'submitted';
  formSummary: {
    serviceType: string;
    fullName: string;
    dob: string;
    gender: string;
    fatherName: string;
    phoneNumber: string;
    address: string;
    pincode: string;
  };
} {
  const now = new Date().toISOString();
  const referenceId = generateReferenceId();
  const maskedId = maskIdNumber(input.idNumber);

  const piiPayload = JSON.stringify({
    fullName: input.fullName,
    idNumber: input.idNumber,
    dob: input.dob,
    gender: input.gender,
    fatherName: input.fatherName,
    phoneNumber: input.phoneNumber,
    address: input.address,
    pincode: input.pincode,
  });

  const record: StoredSubmissionRecord = {
    referenceId,
    sessionId,
    submittedAt: now,
    consentTimestamp: now,
    language: input.language,
    serviceType: input.serviceType,
    maskedIdNumber: maskedId,
    status: 'submitted',
    encryptedPayload: encryptSensitiveData(piiPayload),
  };

  const store = readStore();
  store.records.push(record);
  writeStoreAtomic(store);

  return {
    referenceId,
    submittedAt: now,
    consentTimestamp: now,
    language: input.language,
    maskedIdNumber: maskedId,
    status: 'submitted',
    formSummary: {
      serviceType: input.serviceType,
      fullName: input.fullName,
      dob: input.dob,
      gender: input.gender,
      fatherName: input.fatherName,
      phoneNumber: input.phoneNumber,
      address: input.address,
      pincode: input.pincode,
    },
  };
}

export function getSubmissionMetadata(referenceId: string, sessionId: string) {
  const store = readStore();
  const match = store.records.find(
    (r) => r.referenceId === referenceId && r.sessionId === sessionId
  );
  if (!match) return null;
  return {
    referenceId: match.referenceId,
    submittedAt: match.submittedAt,
    consentTimestamp: match.consentTimestamp,
    language: match.language,
    serviceType: match.serviceType,
    maskedIdNumber: match.maskedIdNumber,
    status: match.status,
  };
}
