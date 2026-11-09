import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import {
  startServer,
  getSafeRouteIdentifier,
  recentServerLogs,
  pdfConcurrencyLimiter,
  ConcurrencyLimiter,
  isShuttingDown,
  setShuttingDown,
  gracefulShutdown,
  getInFlightRequests,
} from '../src/server';
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

  test('POST /api/generate-pdf: Rejects arbitrary HTML bypass (Finding A)', async () => {
    const res = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<h1>Malicious injected raw HTML</h1>' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Resume JSON payload required');
  });

  test('POST /api/generate-pdf: Enforces 1MB request body limit (Finding C)', async () => {
    const hugePayload = {
      resume: {
        ...resumeFixture,
        basics: {
          ...resumeFixture.basics,
          summary: 'A'.repeat(1024 * 1024 + 500),
        },
      },
    };
    const res = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hugePayload),
    });
    expect(res.status).toBe(413);
  });

  test('POST /api/generate-pdf: Sets Content-Disposition with formatPdfFilename (M2-2)', async () => {
    const res = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: resumeFixture }),
    });
    expect(res.status).toBe(200);
    const disposition = res.headers.get('content-disposition');
    expect(disposition).toContain('ALEX_MORGAN_SENIOR_FULL_STACK_ENGINEER.pdf');
  });

  test('GET /api/starters/:name: Serves starter templates and rejects invalid names (M2-3)', async () => {
    for (const starter of ['blank', 'fresh-graduate', 'mid-senior-engineer', 'student-intern', 'sample']) {
      const res = await fetch(`${BASE_URL}/api/starters/${starter}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.basics).toBeDefined();
    }

    const invalid = await fetch(`${BASE_URL}/api/starters/nonexistent-archetype`);
    expect(invalid.status).toBe(404);
  });

  // --- Milestone 4 & 5 Security, Privacy & Localization Server Tests ---

  test('CORS: Rejects unauthorized origins with HTTP 403 (M4-AC4)', async () => {
    const postRes = await fetch(`${BASE_URL}/api/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil-hacker.com',
      },
      body: JSON.stringify({ source: 'fixture' }),
    });
    expect(postRes.status).toBe(403);
    expect(await postRes.text()).toContain('Forbidden: Invalid CORS Origin');

    const optionsRes = await fetch(`${BASE_URL}/api/preview`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://unauthorized-domain.com' },
    });
    expect(optionsRes.status).toBe(403);
  });

  test('CORS: Accepts configured production and loopback origins (M4-AC4)', async () => {
    for (const origin of [
      'https://resume-gen.farisantoni.com',
      'https://resume.farisantoni.com',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
    ]) {
      const res = await fetch(`${BASE_URL}/api/health`, {
        headers: { Origin: origin },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('vary')).toContain('Origin');
    }
  });

  test('Defensive security headers: Injected across all responses including early 413 (M4-AC5)', async () => {
    const health = await fetch(`${BASE_URL}/api/health`);
    expect(health.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-frame-options')).toBe('DENY');
    expect(health.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');

    // Early 413 error response must still carry security headers
    const huge = { resume: { ...resumeFixture, basics: { ...resumeFixture.basics, summary: 'X'.repeat(1024 * 1024 + 100) } } };
    const err413 = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(huge),
    });
    expect(err413.status).toBe(413);
    expect(err413.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(err413.headers.get('x-content-type-options')).toBe('nosniff');
    expect(err413.headers.get('x-frame-options')).toBe('DENY');
  });

  test('Sensitive Cache-Control: Previews and PDFs emit no-store headers (M4-AC5)', async () => {
    const preview = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: resumeFixture }),
    });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toContain('no-store');

    const pdf = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: resumeFixture }),
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('cache-control')).toContain('no-store');
  });

  test('Privacy Isolation: Two consecutive renders verify zero cross-contamination (M4-AC6)', async () => {
    const userA = { ...resumeFixture, basics: { ...resumeFixture.basics, name: 'Alice Unique Alpha' } };
    const userB = { ...resumeFixture, basics: { ...resumeFixture.basics, name: 'Bob Unique Beta' } };

    const resA = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: userA }),
    });
    const bytesA = new Uint8Array(await resA.arrayBuffer());
    const { extractText } = await import('unpdf');
    const textA = (await extractText(bytesA, { mergePages: true })).text.toUpperCase();
    expect(textA).toContain('ALICE UNIQUE ALPHA');

    const resB = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: userB }),
    });
    const bytesB = new Uint8Array(await resB.arrayBuffer());
    const textB = (await extractText(bytesB, { mergePages: true })).text.toUpperCase();
    expect(textB).toContain('BOB UNIQUE BETA');
    expect(textB).not.toContain('ALICE UNIQUE ALPHA');
  });

  test('Language validation: Rejects invalid languages with HTTP 400 (M5-AC11)', async () => {
    for (const endpoint of ['preview', 'generate-pdf']) {
      const res = await fetch(`${BASE_URL}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: resumeFixture, styleConfig: { language: 'fr' } }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Invalid style configuration');
    }
  });

  test('BM Localization via API: Renders Bahasa Melayu headings in PDF download (M5-AC10)', async () => {
    const res = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resume: resumeFixture,
        styleConfig: { language: 'ms', dateFormat: 'month-name' },
      }),
    });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { extractText } = await import('unpdf');
    const text = (await extractText(bytes, { mergePages: true })).text.toUpperCase();
    expect(text).toContain('RINGKASAN PROFESIONAL');
    expect(text).toContain('PENGALAMAN KERJA');
    expect(text).toContain('PENDIDIKAN');
  });

  test('Zero-PII Safe Route Logging: Arbitrary paths with PII map to constant fallback', async () => {
    expect(getSafeRouteIdentifier('/api/health')).toBe('/api/health');
    expect(getSafeRouteIdentifier('/api/preview')).toBe('/api/preview');
    expect(getSafeRouteIdentifier('/api/generate-pdf')).toBe('/api/generate-pdf');
    expect(getSafeRouteIdentifier('/api/extract')).toBe('/api/extract');
    expect(getSafeRouteIdentifier('/api/starters/blank')).toBe('/api/starters/blank');
    expect(getSafeRouteIdentifier('/api/private-candidate@example.com')).toBe('/api/[unmatched]');
    expect(getSafeRouteIdentifier('/api/users/john.doe/secret-resume')).toBe('/api/[unmatched]');

    const res = await fetch(`${BASE_URL}/api/private-candidate@example.com`);
    expect(res.status).toBe(404);

    const matchingLog = recentServerLogs.find((l) => l.path === '/api/[unmatched]');
    expect(matchingLog).toBeDefined();

    const leakedLog = recentServerLogs.find((l) => l.path.includes('private-candidate@example.com'));
    expect(leakedLog).toBeUndefined();
  });

  // --- Milestone 6: Concurrency Load & Graceful Draining Tests ---

  test('Multi-user parallel burst load respects concurrency ceiling (max 2 active jobs)', async () => {
    let peakActive = 0;
    const interval = setInterval(() => {
      const active = pdfConcurrencyLimiter.getActiveCount();
      if (active > peakActive) {
        peakActive = active;
      }
    }, 10);

    try {
      const requests = Array.from({ length: 6 }, (_, i) =>
        fetch(`${BASE_URL}/api/generate-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resume: {
              ...resumeFixture,
              basics: { ...resumeFixture.basics, name: `User Load ${i}` },
            },
          }),
        })
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
      }

      // Assert that active workers never exceeded max concurrency ceiling (2)
      expect(peakActive).toBeLessThanOrEqual(2);
      expect(pdfConcurrencyLimiter.getActiveCount()).toBe(0);
      expect(pdfConcurrencyLimiter.getQueueLength()).toBe(0);
    } finally {
      clearInterval(interval);
    }
  }, 45000);

  test('ConcurrencyLimiter: Throws 503 error when queue timeout threshold is exceeded', async () => {
    const limiter = new ConcurrencyLimiter(1, 150); // max 1 job, 150ms timeout
    let job1Finished = false;

    // Job 1: Takes 300ms
    const job1 = limiter.run(async () => {
      await new Promise((r) => setTimeout(r, 300));
      job1Finished = true;
      return 'job1-done';
    });

    // Job 2: Queued behind Job 1, timeout is 150ms so it should reject with status 503
    const job2 = limiter.run(async () => {
      return 'job2-done';
    });

    await expect(job2).rejects.toMatchObject({
      message: expect.stringContaining('Server busy: PDF generation queue timeout'),
      status: 503,
    });

    expect(await job1).toBe('job1-done');
    expect(job1Finished).toBe(true);
    expect(limiter.getActiveCount()).toBe(0);
  });

  test('ConcurrencyLimiter HTTP Backpressure: returns 503 and Retry-After header on queue timeout', async () => {
    const originalTimeout = pdfConcurrencyLimiter.queueTimeoutMs;
    // Set a tight queue timeout for backpressure testing
    pdfConcurrencyLimiter.queueTimeoutMs = 120;

    let releaseSlot1: () => void;
    let releaseSlot2: () => void;
    const slot1Promise = new Promise<void>((resolve) => {
      releaseSlot1 = resolve;
    });
    const slot2Promise = new Promise<void>((resolve) => {
      releaseSlot2 = resolve;
    });

    // Saturate the concurrency limiter (max 2 jobs)
    const worker1 = pdfConcurrencyLimiter.run(async () => {
      await slot1Promise;
      return 'done1';
    });
    const worker2 = pdfConcurrencyLimiter.run(async () => {
      await slot2Promise;
      return 'done2';
    });

    try {
      // Third request is queued behind the two active jobs and exceeds the 120ms timeout
      const res = await fetch(`${BASE_URL}/api/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: resumeFixture }),
      });

      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('PDF generation queue timeout');
      expect(body.retryAfter).toBe(5);
    } finally {
      // Release workers and restore default timeout
      releaseSlot1!();
      releaseSlot2!();
      await Promise.all([worker1, worker2]);
      pdfConcurrencyLimiter.queueTimeoutMs = originalTimeout;
    }
  });

  test('Graceful Process Draining: in-flight accepted PDF generation request completes with HTTP 200 during shutdown', async () => {
    // Start an isolated server on an ephemeral port
    const drainServer = startServer(0, '127.0.0.1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const drainPort = (drainServer.address() as any).port;
    const drainUrl = `http://127.0.0.1:${drainPort}`;

    try {
      // Dispatch an accepted PDF generation request
      const inFlightPromise = fetch(`${drainUrl}/api/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: resumeFixture }),
      });

      // Allow request to be received, parsed, and enter processing
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Trigger graceful shutdown while the request is in flight
      const shutdownPromise = gracefulShutdown(drainServer, 'SIGTERM', 15000);

      // Verify that new incoming requests arriving after shutdown begins are rejected with 503
      const healthRes = await fetch(`${BASE_URL}/api/health`);
      expect(healthRes.status).toBe(503);

      const inFlightRes = await inFlightPromise;
      expect(inFlightRes.status).toBe(200);
      expect(inFlightRes.headers.get('content-type')).toBe('application/pdf');
      const pdfBytes = await inFlightRes.arrayBuffer();
      expect(pdfBytes.byteLength).toBeGreaterThan(1000);

      await shutdownPromise;
      expect(getInFlightRequests()).toBe(0);
      expect(pdfConcurrencyLimiter.getActiveCount()).toBe(0);
    } finally {
      setShuttingDown(false);
      if (typeof drainServer.close === 'function') {
        await new Promise<void>((resolve) => drainServer.close(() => resolve()));
      }
    }
  }, 30000);

  test.each(['SIGTERM', 'SIGINT'] as const)(
    'Graceful Process Draining: Child server completes in-flight PDF request when receiving %s',
    async (signal) => {
      const child = spawn('npx', ['tsx', 'src/server.ts'], {
        env: { ...process.env, PORT: '0', NODE_ENV: 'production' },
      });

      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Child server startup timed out')), 10000);
          child.stdout.on('data', (data) => {
            const line = data.toString();
            const match = line.match(/http:\/\/127\.0\.0\.1:(\d+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(Number(match[1]));
            }
          });
          child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        // Dispatch a real PDF generation request
        const reqPromise = fetch(`http://127.0.0.1:${port}/api/generate-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: resumeFixture }),
        });

        // Wait 250ms so Chromium is actively launched and rendering
        await new Promise((r) => setTimeout(r, 250));

        // Send signal to the child server process
        child.kill(signal);

        const res = await reqPromise;
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/pdf');
        const pdfBytes = await res.arrayBuffer();
        expect(pdfBytes.byteLength).toBeGreaterThan(1000);

        // Await child process exit code 0
        const exitCode = await new Promise<number | null>((resolve) => {
          child.on('exit', (code) => resolve(code));
        });
        expect(exitCode).toBe(0);
      } finally {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }
    },
    30000
  );

  test('Graceful Process Draining: Rejects incoming API calls with 503 when shutting down and drains cleanly', async () => {
    expect(isShuttingDown).toBe(false);

    try {
      // Initiate shutdown state
      setShuttingDown(true);

      const healthRes = await fetch(`${BASE_URL}/api/health`);
      expect(healthRes.status).toBe(503);
      const json = await healthRes.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Server is shutting down');
      expect(healthRes.headers.get('retry-after')).toBe('10');

      const previewRes = await fetch(`${BASE_URL}/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume: resumeFixture }),
      });
      expect(previewRes.status).toBe(503);

      // Verify gracefulShutdown function drains properly without error
      let closed = false;
      const mockServer = {
        close: () => {
          closed = true;
        },
      };

      await gracefulShutdown(mockServer, 'SIGTERM', 2000);
      expect(closed).toBe(true);
      expect(pdfConcurrencyLimiter.getActiveCount()).toBe(0);
    } finally {
      // Restore clean running state
      setShuttingDown(false);
    }

    // Verify recovery after restoring state
    const recoveryRes = await fetch(`${BASE_URL}/api/health`);
    expect(recoveryRes.status).toBe(200);
  });
});
