import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import resumeFixture from '../fixtures/resume.json';
import { PDFDocument } from 'pdf-lib';

describe('Server & Loopback Security Test', () => {
  let serverInstance: any;
  const PORT = 3000;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    try {
      const check = await fetch(`${BASE_URL}/api/health`);
      if (check.ok) {
        // Server already running (e.g. active dev server)
        return;
      }
    } catch {
      // Server not running yet
    }
    serverInstance = startServer(PORT, '127.0.0.1');
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
    }
  });

  test('Security Invariant: Strictly bound to 127.0.0.1 loopback', () => {
    const ssOutput = execSync('ss -ltn').toString();
    expect(ssOutput).toContain(`127.0.0.1:${PORT}`);
    expect(ssOutput).not.toContain(`0.0.0.0:${PORT}`);
    expect(ssOutput).not.toContain(`*:${PORT}`);
  });

  test('GET /api/health: Returns 200 with loopback bind details', async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.bind).toBe('127.0.0.1:3000');
  });

  test('POST /api/extract: Extracts and validates resume data from fixture', async () => {
    const res = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture', phoneOverride: '+65 9123 4567' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.basics.name).toBe('Alex Morgan');
    expect(body.data.basics.contact.phone).toBe('+65 9123 4567');
  });

  test('POST /api/preview: Returns rendered HTML', async () => {
    // Extract first
    const extractRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture' }),
    });
    const { data } = await extractRes.json();

    const previewRes = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: data }),
    });

    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.success).toBe(true);
    expect(previewBody.html).toContain('Alex Morgan');
    expect(previewBody.html).toContain('@font-face');
  });

  test('POST /api/preview: Respects custom styleConfig and headings', async () => {
    const extractRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture' }),
    });
    const { data } = await extractRes.json();

    const previewRes = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: data,
        styleConfig: {
          accentColor: '#1b4332',
          fontPairing: 'modern',
          density: 'compact',
        },
        headings: {
          EXPERIENCE: 'WORK HISTORY',
        },
        sectionOrder: ['summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'references'],
      }),
    });

    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.success).toBe(true);
    expect(previewBody.html).toContain('--primary-accent: #1b4332');
    expect(previewBody.html).toContain('WORK HISTORY');
    expect(previewBody.html.indexOf('Technical Skills')).toBeLessThan(previewBody.html.indexOf('WORK HISTORY'));
  });

  test.each([1, 20])('Preview and export agree on actual pagination with %i work items', async (count) => {
    const payload = {
      resume: { ...resumeFixture, work: Array.from({ length: count }, () => resumeFixture.work[0]) },
      styleConfig: { margins: 'spacious', fontPairing: 'serif', sectionScale: { experience: 1.15 } },
    };
    const preview = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(preview.status).toBe(200);
    const { budget } = await preview.json();
    expect(budget.fullnessPercent).toBeGreaterThan(0);
    const exported = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    expect(exported.status).toBe(200);
    const pdf = await PDFDocument.load(await exported.arrayBuffer());
    expect(budget.pageCount).toBe(pdf.getPageCount());
    expect(budget.isSinglePage).toBe(count === 1);
    expect(Number(exported.headers.get('X-Page-Count'))).toBe(budget.pageCount);
    if (count === 20) expect(budget.fullnessPercent).toBeGreaterThan(100);
  }, 30000);

  test('POST /api/preview: Rejects duplicate or incomplete section order', async () => {
    const extractRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture' }),
    });
    const { data } = await extractRes.json();
    const previewRes = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: data,
        sectionOrder: ['summary', 'summary', 'education'],
      }),
    });

    expect(previewRes.status).toBe(400);
    const body = await previewRes.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid section order');
  });

  test('POST /api/preview: Rejects invalid Phase 9 style values', async () => {
    const extractRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture' }),
    });
    const { data } = await extractRes.json();
    const previewRes = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: data,
        styleConfig: { bodyAlignment: 'center', sectionScale: { summary: 2 } },
      }),
    });

    expect(previewRes.status).toBe(400);
    const body = await previewRes.json();
    expect(body.error).toBe('Invalid style configuration');
  });

  test('POST /api/generate-pdf: Returns binary PDF with single page budget header', async () => {
    const extractRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'fixture' }),
    });
    const { data } = await extractRes.json();

    const pdfRes = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: data }),
    });

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
    expect(pdfRes.headers.get('x-page-count')).toBe('1');
    expect(pdfRes.headers.get('x-is-single-page')).toBe('true');

    const buffer = await pdfRes.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  }, 20000);

  test('GET /: Serves Office 2000 retro web UI with sandboxed iframe', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Microsoft Resume 2000');
    // Enforce sandboxed iframe invariant
    expect(html).toContain('<iframe id="preview-frame" sandbox=""');
    expect(html).toContain('id="select-body-alignment"');
    expect(html).toContain('id="section-scale-controls"');
    expect(html).toContain('id="select-references-mode"');
    expect(html).toContain('id="input-headshot"');
  });

  test('GET /office2000.css & /app.js: Serves static assets', async () => {
    const cssRes = await fetch(`${BASE_URL}/office2000.css`);
    expect(cssRes.status).toBe(200);
    const cssText = await cssRes.text();
    expect(cssText).toContain('--win-gray');

    const jsRes = await fetch(`${BASE_URL}/app.js`);
    expect(jsRes.status).toBe(200);
    const jsText = await jsRes.text();
    expect(jsText).toContain('previewFrame');
  });

});
