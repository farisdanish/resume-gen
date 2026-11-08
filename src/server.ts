import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runExtraction } from './extract';
import {
  ResumeSchema,
  PageTargetSchema,
  StyleConfigSchema,
  SectionHeadingsSchema,
  SectionOrderSchema,
  EducationDisplayConfigSchema,
} from './schema';
import { renderResume } from './render';
import { generatePdf } from './pdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../ui');
const PDFJS_PATH = fileURLToPath(import.meta.resolve('unpdf/pdfjs'));

export function formatPdfFilename(resume: any): string {
  const name = String(resume?.basics?.name || 'RESUME')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const role = String(resume?.basics?.title || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = [name, role].filter(Boolean).join('_') || 'RESUME';
  return `${base}.pdf`;
}

export class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (err: any) => void; timer: NodeJS.Timeout }> = [];

  constructor(
    public readonly maxConcurrent: number = 2,
    public readonly queueTimeoutMs: number = 5000
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex((item) => item.timer === timer);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
        }
        const err: any = new Error('Server busy: PDF generation queue timeout');
        err.status = 503;
        reject(err);
      }, this.queueTimeoutMs);

      this.queue.push({ resolve, reject, timer });
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      next.resolve();
    } else {
      this.active--;
    }
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}

export class SlidingWindowRateLimiter {
  private records = new Map<string, { count: number; resetAt: number }>();

  constructor(
    public readonly maxRequests: number,
    public readonly windowMs: number
  ) {}

  check(key: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    const record = this.records.get(key);
    if (!record || now > record.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    if (record.count >= this.maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      return { allowed: false, retryAfter };
    }
    record.count++;
    return { allowed: true, retryAfter: 0 };
  }

  reset(): void {
    this.records.clear();
  }
}

export const pdfConcurrencyLimiter = new ConcurrencyLimiter(
  Number(process.env.MAX_CONCURRENT_PDF_JOBS) || 2,
  Number(process.env.PDF_QUEUE_TIMEOUT_MS) || 5000
);

export const pdfRateLimiter = new SlidingWindowRateLimiter(10, 60_000);
export const previewRateLimiter = new SlidingWindowRateLimiter(60, 60_000);

export const app = new Hono();

export const recentServerLogs: Array<{
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}> = [];

export function recordServerLog(entry: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}) {
  recentServerLogs.push(entry);
  if (recentServerLogs.length > 50) recentServerLogs.shift();
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
    console.log(JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
  }
}

// 1. Defensive Browser Security Headers (injected across all responses, including early errors)
app.use('/*', async (c, next) => {
  await next();
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none';"
  );
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.req.header('x-forwarded-proto') === 'https') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

// 2. Origin-Restricted CORS with Strict 403 Rejection
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(resume|resume-gen)\.farisantoni\.com$/,
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/,
];

app.use('/*', async (c, next) => {
  const origin = c.req.header('origin');
  if (origin) {
    const isAllowed = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
    if (!isAllowed) {
      return c.text('Forbidden: Invalid CORS Origin', 403);
    }
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }
  await next();
});

// 3. Request body size limit: 1MB payload ceiling (HTTP 413)
app.use(
  '/api/*',
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => {
      return c.json({ success: false, error: 'Payload Too Large' }, 413);
    },
  })
);

const KNOWN_API_ROUTES = new Set([
  '/api/health',
  '/api/extract',
  '/api/preview',
  '/api/generate-pdf',
]);

const KNOWN_STARTER_NAMES = new Set([
  'blank',
  'fresh-graduate',
  'mid-senior-engineer',
  'student-intern',
]);

export function getSafeRouteIdentifier(path: string): string {
  if (KNOWN_API_ROUTES.has(path)) {
    return path;
  }
  if (path.startsWith('/api/starters/')) {
    const starterName = path.slice('/api/starters/'.length);
    if (KNOWN_STARTER_NAMES.has(starterName)) {
      return `/api/starters/${starterName}`;
    }
    return '/api/starters/:name';
  }
  return '/api/[unmatched]';
}

// 4. Zero-PII Structured Request Logger
app.use('/api/*', async (c, next) => {
  const start = Date.now();
  const requestId = crypto.randomUUID();
  c.header('X-Request-Id', requestId);
  await next();
  const durationMs = Date.now() - start;
  recordServerLog({
    requestId,
    method: c.req.method,
    path: getSafeRouteIdentifier(c.req.path),
    status: c.res.status,
    durationMs,
  });
});

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    server: 'resume-gen',
    bind: '127.0.0.1:3000',
    activePdfJobs: pdfConcurrencyLimiter.getActiveCount(),
    queuedPdfJobs: pdfConcurrencyLimiter.getQueueLength(),
  });
});

// Extraction endpoint
app.post('/api/extract', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const source = body.source || 'fixture';
    const phoneOverride = body.phoneOverride || process.env.RESUME_PHONE;

    const extraction = await runExtraction({ source, phoneOverride });
    const validation = ResumeSchema.safeParse(extraction.data);

    return c.json({
      success: validation.success,
      data: validation.success ? validation.data : extraction.data,
      warnings: extraction.warnings,
      issues: validation.success ? [] : validation.error.issues,
    });
  } catch (err: any) {
    return c.json(
      {
        success: false,
        error: err.message,
        warnings: [],
      },
      400
    );
  }
});

// HTML Preview endpoint
app.post('/api/preview', async (c) => {
  const clientIp = c.req.header('x-forwarded-for') || '127.0.0.1';
  if (process.env.VITEST !== 'true') {
    const rateCheck = previewRateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      return c.json(
        { success: false, error: 'Too Many Requests', retryAfter: rateCheck.retryAfter },
        429,
        { 'Retry-After': String(rateCheck.retryAfter) }
      );
    }
  }

  try {
    const body = await c.req.json();
    const targetValidation = PageTargetSchema.safeParse(body.pageTarget);
    if (!targetValidation.success) return c.json({ success: false, error: 'Invalid page target', issues: targetValidation.error.issues }, 400);
    const pageTarget = targetValidation.data;
    const resumeData = body.resume || body;
    const validation = ResumeSchema.safeParse(resumeData);

    if (!validation.success) {
      return c.json(
        {
          success: false,
          error: 'Zod validation failed',
          issues: validation.error.issues,
        },
        400
      );
    }

    const styleValidation = StyleConfigSchema.safeParse(body.styleConfig);
    if (body.styleConfig !== undefined && !styleValidation.success) {
      return c.json(
        { success: false, error: 'Invalid style configuration', issues: styleValidation.error.issues },
        400
      );
    }
    const styleConfig = styleValidation.success ? styleValidation.data : undefined;
    const headingsValidation = SectionHeadingsSchema.safeParse(body.headings);
    if (body.headings !== undefined && !headingsValidation.success) {
      return c.json(
        { success: false, error: 'Invalid section headings', issues: headingsValidation.error.issues },
        400
      );
    }
    const headings = headingsValidation.success ? headingsValidation.data : undefined;
    const orderValidation = SectionOrderSchema.safeParse(body.sectionOrder);
    if (body.sectionOrder !== undefined && !orderValidation.success) {
      return c.json(
        { success: false, error: 'Invalid section order', issues: orderValidation.error.issues },
        400
      );
    }
    const sectionOrder = orderValidation.success ? orderValidation.data : undefined;

    const educationConfigResult = EducationDisplayConfigSchema.safeParse(body.educationConfig);
    if (!educationConfigResult.success) return c.json({ success: false, error: 'Invalid education display configuration', issues: educationConfigResult.error.issues }, 400);
    const html = renderResume(validation.data, { styleConfig, headings, sectionOrder, educationConfig: educationConfigResult.data });
    const { buffer, layout, pageCount, isSinglePage } = await pdfConcurrencyLimiter.run(() => generatePdf({ html }));
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return c.json({
      success: true,
      html,
      pdfBase64: buffer.toString('base64'),
      budget: { fullnessPercent: layout.fullnessPercent, pageCount, isSinglePage, pageTarget, withinTarget: pageCount <= pageTarget, targetFullnessPercent: layout.fullnessPercent / pageTarget },
    });
  } catch (err: any) {
    const status = err.status || 500;
    if (status === 503 || status === 429) {
      return c.json(
        { success: false, error: err.message || 'Server busy: PDF generation queue at capacity', retryAfter: 5 },
        status,
        { 'Retry-After': '5' }
      );
    }
    return c.json({ success: false, error: err.message }, status);
  }
});

// PDF Generation endpoint (Validated Resume JSON only — Arbitrary HTML is rejected)
app.post('/api/generate-pdf', async (c) => {
  const clientIp = c.req.header('x-forwarded-for') || '127.0.0.1';
  if (process.env.VITEST !== 'true') {
    const rateCheck = pdfRateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      return c.json(
        { success: false, error: 'Too Many Requests', retryAfter: rateCheck.retryAfter },
        429,
        { 'Retry-After': String(rateCheck.retryAfter) }
      );
    }
  }

  try {
    const body = await c.req.json();
    const targetValidation = PageTargetSchema.safeParse(body.pageTarget);
    if (!targetValidation.success) return c.json({ success: false, error: 'Invalid page target', issues: targetValidation.error.issues }, 400);
    const pageTarget = targetValidation.data;

    // Eliminate arbitrary HTML support: require structured resume data
    const resumeData = body.resume || (body.basics ? body : null);
    if (!resumeData) {
      return c.json(
        {
          success: false,
          error: 'Resume JSON payload required. Raw HTML PDF compilation is disabled on this public endpoint.',
        },
        400
      );
    }

    const validation = ResumeSchema.safeParse(resumeData);
    if (!validation.success) {
      return c.json(
        {
          success: false,
          error: 'Zod validation failed',
          issues: validation.error.issues,
        },
        400
      );
    }

    const styleValidation = StyleConfigSchema.safeParse(body.styleConfig);
    if (body.styleConfig !== undefined && !styleValidation.success) {
      return c.json(
        { success: false, error: 'Invalid style configuration', issues: styleValidation.error.issues },
        400
      );
    }
    const styleConfig = styleValidation.success ? styleValidation.data : undefined;
    const headingsValidation = SectionHeadingsSchema.safeParse(body.headings);
    if (body.headings !== undefined && !headingsValidation.success) {
      return c.json(
        { success: false, error: 'Invalid section headings', issues: headingsValidation.error.issues },
        400
      );
    }
    const headings = headingsValidation.success ? headingsValidation.data : undefined;
    const orderValidation = SectionOrderSchema.safeParse(body.sectionOrder);
    if (body.sectionOrder !== undefined && !orderValidation.success) {
      return c.json(
        { success: false, error: 'Invalid section order', issues: orderValidation.error.issues },
        400
      );
    }
    const sectionOrder = orderValidation.success ? orderValidation.data : undefined;

    const educationConfigResult = EducationDisplayConfigSchema.safeParse(body.educationConfig);
    if (!educationConfigResult.success) return c.json({ success: false, error: 'Invalid education display configuration', issues: educationConfigResult.error.issues }, 400);
    const html = renderResume(validation.data, { styleConfig, headings, sectionOrder, educationConfig: educationConfigResult.data });

    const filename = formatPdfFilename(validation.data);
    const { buffer, pageCount, isSinglePage } = await pdfConcurrencyLimiter.run(() => generatePdf({ html }));

    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Page-Count': String(pageCount),
      'X-Is-Single-Page': String(isSinglePage),
      'X-Page-Target': String(pageTarget),
      'X-Within-Target': String(pageCount <= pageTarget),
    });
  } catch (err: any) {
    const status = err.status || 500;
    if (status === 503 || status === 429) {
      return c.json(
        { success: false, error: err.message || 'Server busy: PDF generation queue at capacity', retryAfter: 5 },
        status,
        { 'Retry-After': '5' }
      );
    }
    return c.json({ success: false, error: err.message }, status);
  }
});

// Starter templates endpoint
app.get('/api/starters/:name', (c) => {
  const name = c.req.param('name');
  if (name === 'sample') {
    const filePath = path.resolve(__dirname, '../fixtures/resume.json');
    if (!fs.existsSync(filePath)) {
      return c.json({ success: false, error: 'Sample fixture missing' }, 404);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return c.json({ success: true, data });
  }
  const allowed = ['blank', 'fresh-graduate', 'mid-senior-engineer', 'student-intern'];
  if (!allowed.includes(name)) {
    return c.json({ success: false, error: 'Starter template not found' }, 404);
  }
  const filePath = path.resolve(__dirname, `../fixtures/templates/${name}.json`);
  if (!fs.existsSync(filePath)) {
    return c.json({ success: false, error: 'Starter fixture missing' }, 404);
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return c.json({ success: true, data });
});

// Expose only the installed renderer bundle, never the dependency directory.
app.get('/vendor/pdfjs.mjs', (c) => c.body(fs.readFileSync(PDFJS_PATH, 'utf8'), 200, {
  'Content-Type': 'text/javascript; charset=utf-8',
  'Cache-Control': 'no-cache',
}));

// Serve static UI assets
const relativeUiRoot = path.relative(process.cwd(), UI_DIR) || './ui';
app.use('/*', serveStatic({ root: relativeUiRoot }));

// Fallback for root index.html
app.get('/', (c) => {
  const indexPath = path.join(UI_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'));
  }
  return c.text('Office 2000 UI index not found', 404);
});

export function startServer(
  port = Number(process.env.PORT) || 3000,
  hostname = process.env.HOST || '127.0.0.1'
) {
  return serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      console.log(`Resume-gen server running strictly on http://${info.address}:${info.port}`);
    }
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js') ||
    process.argv[1].includes('server'));

if (isDirectRun) {
  startServer();
}
