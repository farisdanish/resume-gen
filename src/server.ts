import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { runExtraction } from './extract';
import { ResumeSchema } from './schema';
import { renderResume } from './render';
import { generatePdf } from './pdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../ui');

export const app = new Hono();

// Enable CORS for local development & loopback web requests
app.use('/*', cors());

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    server: 'resume-gen',
    bind: '127.0.0.1:3000',
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
  try {
    const body = await c.req.json();
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

    const html = renderResume(validation.data);
    return c.json({
      success: true,
      html,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PDF Generation endpoint
app.post('/api/generate-pdf', async (c) => {
  try {
    const body = await c.req.json();
    let html = body.html;

    if (!html) {
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
      html = renderResume(validation.data);
    }

    const { buffer, pageCount, isSinglePage } = await generatePdf({ html });

    return c.body(new Uint8Array(buffer), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="resume.pdf"',
      'X-Page-Count': String(pageCount),
      'X-Is-Single-Page': String(isSinglePage),
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

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

export function startServer(port = 3000, hostname = '127.0.0.1') {
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
