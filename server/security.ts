import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

// Ephemeral or configured signing secret (never hardcoded)
const SESSION_SIGNING_KEY: Buffer = process.env.SESSION_SECRET
  ? crypto.createHash('sha256').update(process.env.SESSION_SECRET).digest()
  : crypto.randomBytes(32);

// AES-256-GCM encryption key derived via scrypt when configured, else ephemeral CSPRNG
const ENCRYPTION_SALT = 'janseva-voice-kiosk-pii-salt-v1';
const PII_ENCRYPTION_KEY: Buffer = process.env.ENCRYPTION_MASTER_KEY
  ? crypto.scryptSync(process.env.ENCRYPTION_MASTER_KEY, ENCRYPTION_SALT, 32)
  : crypto.randomBytes(32);

export interface SessionPayload {
  sid: string;
  iat: number;
  exp: number;
}

export interface EncryptedBlob {
  iv: string;
  tag: string;
  data: string;
}

export function createSessionToken(): { token: string; sessionId: string; expiresAt: number } {
  const sessionId = crypto.randomUUID();
  const iat = Date.now();
  const exp = iat + 4 * 60 * 60 * 1000; // 4-hour kiosk session
  const payload: SessionPayload = { sid: sessionId, iat, exp };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(encoded).digest('base64url');
  return {
    token: `${encoded}.${sig}`,
    sessionId,
    expiresAt: exp,
  };
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');

  const sigBufA = Buffer.from(providedSig, 'utf8');
  const sigBufB = Buffer.from(expectedSig, 'utf8');
  if (sigBufA.length !== sigBufB.length) return null;
  if (!crypto.timingSafeEqual(sigBufA, sigBufB)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.sid || typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please initialize a kiosk session.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please refresh your session.' });
    return;
  }
  (req as Request & { session?: SessionPayload }).session = payload;
  next();
}

export function encryptSensitiveData(plaintext: string): EncryptedBlob {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', PII_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

export function decryptSensitiveData(blob: EncryptedBlob): string | null {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      PII_ENCRYPTION_KEY,
      Buffer.from(blob.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(blob.data, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function maskIdNumber(id: string): string {
  const digits = id.replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX-XXXX-XXXX';
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

export function sanitizeTextInput(input: unknown, maxLength = 300): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
