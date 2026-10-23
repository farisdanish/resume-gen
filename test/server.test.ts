import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import resumeFixture from '../fixtures/resume.json';
import { PDFDocument } from 'pdf-lib';
import compatibility from '../fixtures/pdf-compatibility.json';

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

  // Catches the browser tab silently falling back to a generic icon.
  test('serves the configured resume favicon', async () => {
    const page = await fetch(BASE_URL);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');

    const favicon = await fetch(`${BASE_URL}/favicon.svg`);
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get('content-type')).toContain('image/svg+xml');
    expect(await favicon.text()).toContain('<title>Resume document</title>');
  });

  test('preview-pdf-parity returns the measured PDF bytes and a fixed local renderer asset', async () => {
    const response = await fetch(`${BASE_URL}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: compatibility, styleConfig: { bodyFontSize: 11 } }) });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(typeof result.pdfBase64).toBe('string');
    const bytes = Buffer.from(result.pdfBase64, 'base64');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(result.budget.pageCount);
    expect(result.html).toContain('Alex Morgan');
    const asset = await fetch(`${BASE_URL}/vendor/pdfjs.mjs`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect((await asset.text()).includes('getDocument')).toBe(true);
    expect((await fetch(`${BASE_URL}/vendor/package.json`)).status).toBe(404);
  }, 30000);

  // Catches API silently discarding or accepting an invalid readable font size.
  test.each([9, 13, '11', 'large'])('typography-input-validation rejects API size %j', async (bodyFontSize) => {
    for (const endpoint of ['preview', 'generate-pdf']) {
      const response = await fetch(`${BASE_URL}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: compatibility, styleConfig: { bodyFontSize } }) });
      expect(response.status).toBe(400);
    }
  });

  test.each([2, 12, 32])('readable-overflow-budget retains content with %i work entries', async (count) => {
    const resume = { ...compatibility, work: Array.from({ length: count }, () => compatibility.work[0]) };
    const body = { resume, pageTarget: 2, styleConfig: { bodyFontSize: 11 } };
    const response = await fetch(`${BASE_URL}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    const { budget } = await response.json();
    expect(budget.withinTarget).toBe(budget.pageCount <= 2);
    expect(budget.pageCount).toBe(count === 2 ? 1 : count === 12 ? 2 : 3);
    const download = await fetch(`${BASE_URL}/api/generate-pdf`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(download.status).toBe(200);
    const buffer = new Uint8Array(await download.arrayBuffer());
    expect((await PDFDocument.load(buffer)).getPageCount()).toBe(budget.pageCount);
    const { text } = await import('unpdf').then(({ extractText }) => extractText(buffer, { mergePages: true }));
    expect(text).toContain('Project sentinel: reliable production processing.');
  }, 30000);

  test.each([1, 2])('uses actual pages for target %i without changing one-page fullness metadata', async (pageTarget) => {
    const resume = { ...compatibility, work: Array.from({ length: 20 }, () => compatibility.work[0]) };
    const response = await fetch(`${BASE_URL}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume, pageTarget }) });
    expect(response.status).toBe(200);
    const { budget } = await response.json();
    expect(budget.pageCount).toBe(2);
    expect(budget.pageTarget).toBe(pageTarget);
    expect(budget.withinTarget).toBe(pageTarget === 2);
    expect(budget.targetFullnessPercent).toBeCloseTo(budget.fullnessPercent / pageTarget);
  }, 30000);

  test.each([0, 3, '2'])('rejects invalid page target %j in preview and PDF endpoints', async (pageTarget) => {
    for (const endpoint of ['preview', 'generate-pdf']) {
      const response = await fetch(`${BASE_URL}/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: compatibility, pageTarget }) });
      expect(response.status).toBe(400);
    }
  });

  test('reports three pages as over both supported targets', async () => {
    const resume = { ...compatibility, work: Array.from({ length: 60 }, () => compatibility.work[0]) };
    for (const pageTarget of [1, 2]) {
      const response = await fetch(`${BASE_URL}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume, pageTarget }) });
      const { budget } = await response.json();
      expect(budget.pageCount).toBeGreaterThan(2);
      expect(budget.withinTarget).toBe(false);
    }
  }, 30000);

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

  test('GET /: Serves Office 2000 retro web UI with a PDF page stack', async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Microsoft Resume 2000');
    // Resume HTML no longer runs inside the UI: the preview accepts PDF bytes only.
    expect(html).toContain('id="preview-pages"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('type="module" src="/app.js"');
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
    expect(jsRes.headers.get('content-type')).toContain('javascript');
    const renderer = await fetch(`${BASE_URL}/pdf-preview.js`);
    expect(renderer.status).toBe(200);
    expect(renderer.headers.get('content-type')).toContain('javascript');
  });

});
