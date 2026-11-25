import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Request, Response } from 'express';
import { sanitizeTextInput } from './security.ts';

function getGeminiClient(apiVersion?: string): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 10) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English (Indian)',
  ta: 'Tamil',
  hi: 'Hindi',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  bn: 'Bengali',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
  or: 'Odia',
  ur: 'Urdu',
};

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);
const ALLOWED_AUDIO_MIMES = new Set([
  'audio/webm',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
]);

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      const isTransient = status === 429 || status === 500 || status === 503 || status === 504;
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export async function handleAiOcrExtract(req: Request, res: Response): Promise<void> {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: 'AI OCR verification service is not configured. Using local Tesseract OCR engine.',
      code: 'AI_UNAVAILABLE',
    });
    return;
  }

  const { imageBase64, mimeType, consentGiven } = req.body ?? {};
  if (consentGiven !== true) {
    res.status(400).json({ error: 'Explicit user consent is required before scanning a document.' });
    return;
  }

  if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string') {
    res.status(400).json({ error: 'Invalid image payload.' });
    return;
  }

  const normalizedMime = mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeType.toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.has(normalizedMime)) {
    res.status(400).json({ error: 'Only JPG, PNG, and WebP images are supported.' });
    return;
  }

  const rawBuffer = Buffer.from(imageBase64, 'base64');
  if (rawBuffer.byteLength === 0 || rawBuffer.byteLength > 10 * 1024 * 1024) {
    rawBuffer.fill(0);
    res.status(400).json({ error: 'Image must be non-empty and under 10 MB.' });
    return;
  }

  const promptText = [
    'You are an expert Indian government identity document OCR reader (Aadhaar, PAN, Voter ID, Driving Licence, Ration Card, Bank Passbook).',
    'Extract ALL visible printed citizen details accurately from this image.',
    'STRICT RULES:',
    '1. Return ONLY information clearly printed in the image. NEVER guess, invent, or fabricate missing fields.',
    '2. If a field is blurry, unreadable, or absent from the document, return an empty string "".',
    '3. Preserve personal names and addresses accurately as printed (prefer the English/Latin spelling if both bilingual English and regional script are printed; otherwise preserve the printed script).',
    '4. For idNumber: extract the 12-digit Aadhaar number (digits only, ignoring 16-digit VID), OR PAN (10 chars), OR Voter ID / Licence number if no Aadhaar is printed.',
    '5. For phoneNumber: extract the 10-digit Indian mobile number if printed (digits only).',
    '6. For dob: format strictly as DD/MM/YYYY (e.g. 15/08/1965). If only Year of Birth (YYYY) is printed, return 01/01/YYYY.',
    '7. For gender: normalize strictly to "Male", "Female", "Other", or "".',
    '8. For fatherName: extract father/husband/guardian name from S/O, D/O, W/O, C/O, or Father\'s Name if printed (strip the "S/O:" prefix).',
    '9. For pincode: extract the 6-digit Indian postal PIN code if printed.',
    '10. Include rawText with the main printed lines and realistic 0-100 confidence scores.',
  ].join('\n');

  const schema = {
    type: Type.OBJECT,
    properties: {
      fullName: { type: Type.STRING },
      idNumber: { type: Type.STRING },
      dob: { type: Type.STRING },
      gender: { type: Type.STRING },
      fatherName: { type: Type.STRING },
      phoneNumber: { type: Type.STRING },
      address: { type: Type.STRING },
      pincode: { type: Type.STRING },
      rawText: { type: Type.STRING },
      confidence: {
        type: Type.OBJECT,
        properties: {
          fullName: { type: Type.INTEGER },
          idNumber: { type: Type.INTEGER },
          dob: { type: Type.INTEGER },
          gender: { type: Type.INTEGER },
          fatherName: { type: Type.INTEGER },
          phoneNumber: { type: Type.INTEGER },
          address: { type: Type.INTEGER },
          pincode: { type: Type.INTEGER },
        },
      },
    },
  };

  try {
    let response;
    try {
      response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [
              { inlineData: { mimeType: normalizedMime, data: imageBase64 } },
              { text: promptText },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        })
      );
    } catch {
      // Fallback to gemini-3.1-flash-lite if gemini-4-hydrogen experiences high demand (503/429)
      response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: {
            parts: [
              { inlineData: { mimeType: normalizedMime, data: imageBase64 } },
              { text: promptText },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        })
      );
    }

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({ extracted: parsed });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const detail = String(e?.message ?? 'unknown').slice(0, 220);
    console.error(`[AI_OCR_ERR] status=${e?.status ?? 'unknown'} msg=${detail}`);
    res.status(502).json({
      error: 'AI OCR verification failed upstream. Falling back to local Tesseract OCR.',
      code: 'AI_UPSTREAM_ERROR',
      detail,
    });
  } finally {
    rawBuffer.fill(0);
  }
}

export async function handleServerTts(req: Request, res: Response): Promise<void> {
  const aiBeta = getGeminiClient('v1beta');
  const aiDefault = getGeminiClient();
  if (!aiBeta && !aiDefault) {
    res.status(503).json({ error: 'Neural TTS service unavailable.', code: 'TTS_UNAVAILABLE' });
    return;
  }

  const text = sanitizeTextInput(req.body?.text, 600);
  const language = sanitizeTextInput(req.body?.language, 10) || 'en';
  const voiceGender = req.body?.voiceGender === 'male' ? 'male' : 'female';

  if (!text) {
    res.status(400).json({ error: 'Text is required for speech synthesis.' });
    return;
  }

  const langName = LANGUAGE_NAMES[language] ?? 'English';
  const voiceName = voiceGender === 'male' ? 'Charon' : 'Kore';

  try {
    let response;
    try {
      // Try v1beta with speechMetadata first
      response = await withRetry(() =>
        (aiBeta ?? aiDefault)!.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                  speechMetadata: {
                    style: `Warm, calm, patient Indian government kiosk assistant speaking clearly in ${langName}.`,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        })
      );
    } catch {
      // Fallback without speechMetadata field (for v1 endpoints that reject speechMetadata)
      response = await withRetry(() =>
        (aiDefault ?? aiBeta)!.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: `Speak clearly and warmly in ${langName}: ${text}` }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        })
      );
    }

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      res.status(502).json({ error: 'No audio returned from speech model.' });
      return;
    }

    res.json({
      audioBase64: base64Audio,
      mimeType: 'audio/wav',
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const detail = String(e?.message ?? 'unknown').slice(0, 220);
    console.error(`[AI_TTS_ERR] status=${e?.status ?? 'unknown'} msg=${detail}`);
    res.status(502).json({ error: 'Neural speech generation failed.', code: 'TTS_FAILED', detail });
  }
}

export async function handleServerTranscribe(req: Request, res: Response): Promise<void> {
  const aiBeta = getGeminiClient('v1beta');
  const aiDefault = getGeminiClient();
  if (!aiDefault && !aiBeta) {
    res.status(503).json({
      error: 'Audio transcription service unavailable.',
      code: 'STT_UNAVAILABLE',
    });
    return;
  }

  const { audioBase64, mimeType, language, fieldHint } = req.body ?? {};
  if (typeof audioBase64 !== 'string' || typeof mimeType !== 'string') {
    res.status(400).json({ error: 'Invalid audio payload.' });
    return;
  }

  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_AUDIO_MIMES.has(baseMime)) {
    res.status(400).json({ error: 'Unsupported audio MIME type.' });
    return;
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  if (audioBuffer.byteLength === 0 || audioBuffer.byteLength > 5 * 1024 * 1024) {
    audioBuffer.fill(0);
    res.status(400).json({ error: 'Audio clip must be non-empty and under 5 MB.' });
    return;
  }

  const langName = LANGUAGE_NAMES[sanitizeTextInput(language, 10)] ?? 'Indian language';
  const safeField = sanitizeTextInput(fieldHint, 60);
  const sttPrompt = `Listen to this spoken ${langName} response for the form field "${safeField}". Output ONLY the exact spoken value (name, digits, date, gender, or address) with no extra commentary or labels. If the field is a Date of Birth / Birth Date, convert the spoken date directly into DD/MM/YYYY digits (e.g. 30/08/2006). If there is only silence or no speech, output an empty string.`;

  const audioPart = {
    inlineData: {
      mimeType: baseMime,
      data: audioBase64,
    },
  };

  try {
    let response;
    try {
      // Primary: dedicated transcription model on v1beta
      response = await withRetry(() =>
        (aiBeta ?? aiDefault)!.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: { parts: [audioPart, { text: sttPrompt }] },
        })
      );
    } catch {
      try {
        // Fallback 1: gemini-4-hydrogen multimodal audio understanding
        response = await withRetry(() =>
          (aiDefault ?? aiBeta)!.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: { parts: [audioPart, { text: sttPrompt }] },
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          })
        );
      } catch {
        // Fallback 2: gemini-3.1-flash-lite multimodal audio understanding
        response = await withRetry(() =>
          (aiDefault ?? aiBeta)!.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: { parts: [audioPart, { text: sttPrompt }] },
          })
        );
      }
    }

    const transcript = sanitizeTextInput(response.text ?? '', 300);
    res.json({ transcript });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    const detail = String(e?.message ?? 'unknown').slice(0, 220);
    console.error(`[AI_STT_ERR] status=${e?.status ?? 'unknown'} msg=${detail}`);
    res.status(502).json({ error: 'Speech transcription failed.', detail });
  } finally {
    audioBuffer.fill(0);
  }
}

export async function handleServerParseVoiceForm(req: Request, res: Response): Promise<void> {
  const aiBeta = getGeminiClient('v1beta');
  const aiDefault = getGeminiClient();
  if (!aiDefault && !aiBeta) {
    res.status(503).json({ error: 'Voice form parsing service unavailable.' });
    return;
  }

  const { transcript, audioBase64, mimeType, language } = req.body ?? {};
  const cleanTranscript = sanitizeTextInput(transcript, 1500);
  const langName = LANGUAGE_NAMES[sanitizeTextInput(language, 10)] ?? 'Indian language';

  let audioBuffer: Buffer | null = null;
  let baseMime = '';

  if (typeof audioBase64 === 'string' && typeof mimeType === 'string' && audioBase64.length > 0) {
    baseMime = mimeType.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_AUDIO_MIMES.has(baseMime)) {
      res.status(400).json({ error: 'Unsupported audio MIME type.' });
      return;
    }
    audioBuffer = Buffer.from(audioBase64, 'base64');
    if (audioBuffer.byteLength === 0 || audioBuffer.byteLength > 6 * 1024 * 1024) {
      audioBuffer.fill(0);
      res.status(400).json({ error: 'Audio clip must be under 6 MB.' });
      return;
    }
  } else if (!cleanTranscript) {
    res.status(400).json({ error: 'Transcript or audio is required.' });
    return;
  }

  const promptText = [
    `The citizen spoke in ${langName} to fill an Indian government citizen service form.`,
    cleanTranscript ? `Spoken transcript: "${cleanTranscript}"` : 'Listen carefully to the attached audio.',
    'Extract ONLY the form fields explicitly stated by the citizen. NEVER invent, guess, or assume missing values.',
    'Rules:',
    '- transcript: the verbatim words spoken (in the spoken language/script).',
    '- serviceType: one of "citizen_certificate", "pension_welfare", "ration_card", "bank_kyc", or "" if not mentioned.',
    '- fullName: citizen full name if stated, else "".',
    '- idNumber: 12-digit Aadhaar/ID (digits only), else "".',
    '- dob: DD/MM/YYYY format if stated, else "".',
    '- gender: strictly "Male", "Female", "Other", or "" if not stated.',
    '- fatherName: father/mother/husband/guardian name if stated, else "".',
    '- phoneNumber: 10-digit Indian mobile number (digits only) if stated, else "".',
    '- address: residential address if stated, else "".',
    '- pincode: 6-digit postal PIN code if stated, else "".',
  ].join('\n');

  const schema = {
    type: Type.OBJECT,
    properties: {
      transcript: { type: Type.STRING },
      serviceType: { type: Type.STRING },
      fullName: { type: Type.STRING },
      idNumber: { type: Type.STRING },
      dob: { type: Type.STRING },
      gender: { type: Type.STRING },
      fatherName: { type: Type.STRING },
      phoneNumber: { type: Type.STRING },
      address: { type: Type.STRING },
      pincode: { type: Type.STRING },
    },
  };

  const parts = audioBuffer
    ? [{ inlineData: { mimeType: baseMime, data: audioBase64 } }, { text: promptText }]
    : [{ text: promptText }];

  try {
    let response;
    try {
      response = await withRetry(() =>
        (aiDefault ?? aiBeta)!.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        })
      );
    } catch {
      response = await withRetry(() =>
        (aiDefault ?? aiBeta)!.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: { parts },
          config: {
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        })
      );
    }

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      transcript: sanitizeTextInput(parsed.transcript ?? cleanTranscript, 1500),
      fields: parsed,
    });
  } catch (err: unknown) {
    // If audio was provided and structured JSON model had transient 503, try gemini-3.5-transcribe so client parser can still fill fields
    if (audioBuffer && aiBeta) {
      try {
        const sttRes = await withRetry(() =>
          aiBeta.models.generateContent({
            model: 'gemini-3.5-transcribe',
            contents: {
              parts: [
                { inlineData: { mimeType: baseMime, data: audioBase64 } },
                { text: `Transcribe this spoken ${langName} audio verbatim.` },
              ],
            },
          })
        );
        const fallbackText = sanitizeTextInput(sttRes.text ?? '', 1500);
        res.json({ transcript: fallbackText, fields: {} });
        return;
      } catch {
        // fall through
      }
    }
    if (cleanTranscript) {
      res.json({ transcript: cleanTranscript, fields: {}, fallbackUsed: true });
      return;
    }
    const e = err as { status?: number; message?: string };
    const detail = String(e?.message ?? 'unknown').slice(0, 220);
    console.error(`[AI_VOICE_PARSE_ERR] status=${e?.status ?? 'unknown'} msg=${detail}`);
    res.status(502).json({ error: 'Voice form parsing failed upstream.', detail });
  } finally {
    if (audioBuffer) audioBuffer.fill(0);
  }
}

