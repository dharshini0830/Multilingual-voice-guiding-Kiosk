import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createSessionToken, requireSession, type SessionPayload } from './server/security.ts';
import { validateAndSanitizeSubmission } from './server/validation.ts';
import { getSubmissionMetadata, saveSubmissionRecord } from './server/database.ts';
import {
  handleAiOcrExtract,
  handleServerParseVoiceForm,
  handleServerTranscribe,
  handleServerTts,
} from './server/aiRoutes.ts';

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', true);

  // Baseline security headers (preserve iframe embedding in preview)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // Health endpoint (non-sensitive status only)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      aiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
    });
  });

  // Session initialization (returns signed Bearer token kept in client JS memory)
  app.post('/api/session/init', (_req, res) => {
    const session = createSessionToken();
    res.json(session);
  });

  // Protected Form Submission endpoint
  app.post('/api/forms/submit', requireSession, (req, res) => {
    const session = (req as express.Request & { session?: SessionPayload }).session;
    if (!session) {
      res.status(401).json({ error: 'Invalid session.' });
      return;
    }

    const validation = validateAndSanitizeSubmission(req.body ?? {});
    if (!validation.ok) {
      res.status(400).json({
        error: 'Validation failed. Please correct the highlighted fields.',
        fieldErrors: validation.errors,
      });
      return;
    }

    const saved = saveSubmissionRecord(validation.data, session.sid);
    // Log only opaque reference ID, never PII
    console.info(`[FORM_SUBMITTED] ref=${saved.referenceId} lang=${saved.language}`);
    res.status(201).json(saved);
  });

  // Protected Submission Metadata lookup
  app.get('/api/forms/:referenceId', requireSession, (req, res) => {
    const session = (req as express.Request & { session?: SessionPayload }).session;
    const refId = String(req.params.referenceId || '').trim();
    if (!session || !/^JSV-\d{8}-[A-F0-9]{6}$/.test(refId)) {
      res.status(400).json({ error: 'Invalid reference identifier.' });
      return;
    }

    const record = getSubmissionMetadata(refId, session.sid);
    if (!record) {
      res.status(404).json({ error: 'Submission record not found for this session.' });
      return;
    }
    res.json(record);
  });

  // Protected AI OCR Verification, Neural TTS, Audio Transcription, and Voice Form Parsing routes
  app.post('/api/ocr/extract', requireSession, handleAiOcrExtract);
  app.post('/api/voice/tts', requireSession, handleServerTts);
  app.post('/api/voice/transcribe', requireSession, handleServerTranscribe);
  app.post('/api/voice/parse-form', requireSession, handleServerParseVoiceForm);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.info(`JanSeva Voice Kiosk server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
