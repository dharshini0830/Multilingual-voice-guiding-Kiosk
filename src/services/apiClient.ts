import type { CitizenFormData, LanguageCode, SubmissionRecord, VoiceGender } from '@/src/types/kiosk';

// Session token held strictly in JS memory (never in localStorage or sessionStorage)
let memoryToken: string | null = null;
let tokenExpiresAt = 0;

export async function ensureSessionToken(): Promise<string> {
  if (memoryToken && Date.now() < tokenExpiresAt - 30_000) {
    return memoryToken;
  }
  const res = await fetch('/api/session/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error('Failed to initialize secure kiosk session.');
  }
  const data = (await res.json()) as { token: string; expiresAt: number };
  memoryToken = data.token;
  tokenExpiresAt = data.expiresAt;
  return memoryToken;
}

export function clearSessionToken(): void {
  memoryToken = null;
  tokenExpiresAt = 0;
}

async function authorizedPost<T>(url: string, body: unknown, timeoutMs?: number): Promise<T> {
  const token = await ensureSessionToken();
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    if (res.status === 401) {
      // Refresh token once and retry
      clearSessionToken();
      const freshToken = await ensureSessionToken();
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      const retryData = await retryRes.json();
      if (!retryRes.ok) {
        throw Object.assign(new Error(retryData?.error || 'Request failed'), {
          status: retryRes.status,
          data: retryData,
        });
      }
      return retryData as T;
    }

    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data?.error || 'Request failed'), {
        status: res.status,
        data,
      });
    }
    return data as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function submitFormToServer(
  formData: CitizenFormData,
  language: LanguageCode,
  consentGiven: boolean
): Promise<SubmissionRecord> {
  return authorizedPost<SubmissionRecord>('/api/forms/submit', {
    ...formData,
    language,
    consentGiven,
  });
}

export interface ServerAiOcrResponse {
  extracted: {
    fullName?: string;
    idNumber?: string;
    dob?: string;
    gender?: string;
    fatherName?: string;
    phoneNumber?: string;
    address?: string;
    pincode?: string;
    rawText?: string;
    confidence?: Record<string, number>;
  };
}

export async function requestAiOcrExtraction(params: {
  imageBase64?: string;
  mimeType?: string;
  images?: Array<{ imageBase64: string; mimeType: string }>;
  language: LanguageCode;
  consentGiven: boolean;
}): Promise<ServerAiOcrResponse> {
  return authorizedPost<ServerAiOcrResponse>('/api/ocr/extract', params, 45_000);
}

export async function requestServerTts(params: {
  text: string;
  language: LanguageCode;
  voiceGender: VoiceGender;
}): Promise<{ audioBase64: string; mimeType: string }> {
  return authorizedPost<{ audioBase64: string; mimeType: string }>('/api/voice/tts', params);
}

export async function requestServerTranscribe(params: {
  audioBase64: string;
  mimeType: string;
  language: LanguageCode;
  fieldHint: string;
}): Promise<{ transcript: string }> {
  return authorizedPost<{ transcript: string }>('/api/voice/transcribe', params);
}

export async function requestServerParseVoiceForm(params: {
  transcript?: string;
  audioBase64?: string;
  mimeType?: string;
  language: LanguageCode;
}): Promise<{
  transcript: string;
  fields: Record<string, string>;
}> {
  return authorizedPost<{ transcript: string; fields: Record<string, string> }>(
    '/api/voice/parse-form',
    params
  );
}

