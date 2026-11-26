import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/src/firebase';
import { SUPPORTED_LANGUAGES } from '@/src/modules/language/languages';
import type {
  CitizenFormData,
  GenderOption,
  LanguageCode,
  ServiceType,
  SubmissionRecord,
} from '@/src/types/kiosk';

const VALID_SERVICE_TYPES: ServiceType[] = [
  'citizen_certificate',
  'pension_welfare',
  'ration_card',
  'bank_kyc',
];

const VALID_GENDERS: GenderOption[] = ['', 'Male', 'Female', 'Other'];

function sanitizeLanguage(lang: string | undefined): LanguageCode {
  if (lang && SUPPORTED_LANGUAGES.some((l) => l.code === lang)) {
    return lang as LanguageCode;
  }
  return 'en';
}

function sanitizeServiceType(svc: string | undefined): ServiceType {
  if (svc && VALID_SERVICE_TYPES.includes(svc as ServiceType)) {
    return svc as ServiceType;
  }
  return 'citizen_certificate';
}

function sanitizeGender(gender: string | undefined): GenderOption {
  if (gender && VALID_GENDERS.includes(gender as GenderOption)) {
    return gender as GenderOption;
  }
  return '';
}

function sanitizeDraftFields(
  formData: CitizenFormData,
  language: LanguageCode,
  consentGiven: boolean
) {
  return {
    language: sanitizeLanguage(language),
    serviceType: sanitizeServiceType(formData.serviceType),
    fullName: (formData.fullName ?? '').trim().slice(0, 100),
    idNumber: (formData.idNumber ?? '').replace(/\D/g, '').slice(0, 12),
    dob: (formData.dob ?? '').trim().slice(0, 24),
    gender: sanitizeGender(formData.gender),
    fatherName: (formData.fatherName ?? '').trim().slice(0, 100),
    phoneNumber: (formData.phoneNumber ?? '').replace(/\D/g, '').slice(0, 10),
    address: (formData.address ?? '').trim().slice(0, 240),
    pincode: (formData.pincode ?? '').replace(/\D/g, '').slice(0, 6),
    consentGiven: Boolean(consentGiven),
  };
}

export async function ensureUserAccountDocs(
  user: User,
  preferredLanguage: LanguageCode
): Promise<{ preferredLanguage: LanguageCode }> {
  const uid = user.uid;
  const userPath = `users/${uid}`;
  const privatePath = `users/${uid}/private/account`;
  const userRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'account');

  const safeDisplayName = (user.displayName || 'Citizen User').trim().slice(0, 120);
  const safeEmail = (user.email || '').trim().slice(0, 254);

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  if (!existingSnap.exists()) {
    try {
      const batch = writeBatch(db);
      batch.set(userRef, {
        uid,
        displayName: safeDisplayName,
        preferredLanguage: sanitizeLanguage(preferredLanguage),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(privateRef, {
        uid,
        email: safeEmail,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      return { preferredLanguage: sanitizeLanguage(preferredLanguage) };
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }
  }

  const data = existingSnap.data();
  const savedLang = sanitizeLanguage(
    typeof data?.preferredLanguage === 'string' ? data.preferredLanguage : preferredLanguage
  );

  try {
    if (safeDisplayName && data?.displayName !== safeDisplayName) {
      await updateDoc(userRef, {
        displayName: safeDisplayName,
        preferredLanguage: savedLang,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }

  try {
    const privSnap = await getDoc(privateRef);
    if (!privSnap.exists()) {
      await setDoc(privateRef, {
        uid,
        email: safeEmail,
        updatedAt: serverTimestamp(),
      });
    } else if (privSnap.data()?.email !== safeEmail) {
      await updateDoc(privateRef, {
        email: safeEmail,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, privatePath);
  }

  return { preferredLanguage: savedLang };
}

export async function saveUserPreferredLanguage(
  uid: string,
  preferredLanguage: LanguageCode,
  displayName: string
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: (displayName || 'Citizen User').trim().slice(0, 120),
      preferredLanguage: sanitizeLanguage(preferredLanguage),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export interface LoadedCloudDraft {
  formData: CitizenFormData;
  language: LanguageCode;
  consentGiven: boolean;
}

export async function loadActiveDraft(uid: string): Promise<LoadedCloudDraft | null> {
  const path = `users/${uid}/drafts/current`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'drafts', 'current'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      language: sanitizeLanguage(typeof d.language === 'string' ? d.language : 'en'),
      consentGiven: Boolean(d.consentGiven),
      formData: {
        serviceType: sanitizeServiceType(typeof d.serviceType === 'string' ? d.serviceType : undefined),
        fullName: typeof d.fullName === 'string' ? d.fullName : '',
        idNumber: typeof d.idNumber === 'string' ? d.idNumber : '',
        dob: typeof d.dob === 'string' ? d.dob : '',
        gender: sanitizeGender(typeof d.gender === 'string' ? d.gender : ''),
        fatherName: typeof d.fatherName === 'string' ? d.fatherName : '',
        phoneNumber: typeof d.phoneNumber === 'string' ? d.phoneNumber : '',
        address: typeof d.address === 'string' ? d.address : '',
        pincode: typeof d.pincode === 'string' ? d.pincode : '',
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveActiveDraft(
  uid: string,
  formData: CitizenFormData,
  language: LanguageCode,
  consentGiven: boolean
): Promise<void> {
  const path = `users/${uid}/drafts/current`;
  const draftRef = doc(db, 'users', uid, 'drafts', 'current');
  const fields = sanitizeDraftFields(formData, language, consentGiven);

  let exists = false;
  try {
    const snap = await getDoc(draftRef);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  try {
    if (exists) {
      await updateDoc(draftRef, {
        ...fields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(draftRef, {
        ownerId: uid,
        ...fields,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function clearActiveDraft(uid: string): Promise<void> {
  const path = `users/${uid}/drafts/current`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'drafts', 'current'));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveSubmissionToFirestore(
  uid: string,
  record: SubmissionRecord
): Promise<void> {
  const docId = record.referenceId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'submission';
  const path = `users/${uid}/submissions/${docId}`;
  const subRef = doc(db, 'users', uid, 'submissions', docId);

  const summary = record.formSummary;
  const payload = {
    ownerId: uid,
    referenceId: record.referenceId.replace(/[^A-Z0-9-]/g, '').slice(0, 40),
    submittedAt: record.submittedAt.slice(0, 40),
    language: sanitizeLanguage(record.language),
    maskedIdNumber: record.maskedIdNumber.slice(0, 24),
    status: 'submitted' as const,
    consentTimestamp: record.consentTimestamp.slice(0, 40),
    serviceType: sanitizeServiceType(summary.serviceType),
    fullName: summary.fullName.trim().slice(0, 100),
    dob: summary.dob.trim().slice(0, 24),
    gender: (summary.gender === 'Female' || summary.gender === 'Other' ? summary.gender : 'Male') as 'Male' | 'Female' | 'Other',
    fatherName: summary.fatherName.trim().slice(0, 100),
    phoneNumber: summary.phoneNumber.replace(/\D/g, '').slice(0, 10),
    address: summary.address.trim().slice(0, 240),
    pincode: summary.pincode.replace(/\D/g, '').slice(0, 6),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(subRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeToSubmissions(
  uid: string,
  onData: (records: SubmissionRecord[]) => void,
  onError: (err: unknown) => void
): Unsubscribe {
  const path = `users/${uid}/submissions`;
  const q = query(collection(db, 'users', uid, 'submissions'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SubmissionRecord[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          referenceId: String(data.referenceId ?? d.id),
          submittedAt: String(data.submittedAt ?? new Date().toISOString()),
          language: sanitizeLanguage(typeof data.language === 'string' ? data.language : 'en'),
          maskedIdNumber: String(data.maskedIdNumber ?? 'XXXX XXXX XXXX'),
          status: 'submitted',
          consentTimestamp: String(data.consentTimestamp ?? data.submittedAt ?? ''),
          formSummary: {
            serviceType: sanitizeServiceType(typeof data.serviceType === 'string' ? data.serviceType : undefined),
            fullName: String(data.fullName ?? ''),
            dob: String(data.dob ?? ''),
            gender: sanitizeGender(typeof data.gender === 'string' ? data.gender : 'Male'),
            fatherName: String(data.fatherName ?? ''),
            phoneNumber: String(data.phoneNumber ?? ''),
            address: String(data.address ?? ''),
            pincode: String(data.pincode ?? ''),
          },
        };
      });
      items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped);
      }
    }
  );
}
