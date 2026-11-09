import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { startServer, getSafeRouteIdentifier, recentServerLogs } from '../src/server';
import { runExtraction } from '../src/extract';
import { ResumeSchema } from '../src/schema';
import { renderResume } from '../src/render';
import { generatePdf, isChromiumSandboxEnabled, getChromiumLaunchArgs } from '../src/pdf';
import resumeFixture from '../fixtures/resume.json';

describe('Security & Input Regression Test Suite', () => {
  let serverInstance: any;
  let BASE_URL: string;

  beforeAll(async () => {
    // Bind to an ephemeral loopback port to avoid colliding with other test suites running in parallel
    serverInstance = startServer(0, '127.0.0.1');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const addr = serverInstance.address();
    const port = typeof addr === 'object' && addr !== null ? addr.port : 3002;
    BASE_URL = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (serverInstance && typeof serverInstance.close === 'function') {
      await new Promise<void>((resolve) => serverInstance.close(() => resolve()));
    }
  });

  // 1. Arbitrary HTML Bypass Rejection
  test('rejection of arbitrary raw HTML payloads on /api/generate-pdf', async () => {
    const rawHtmlRes = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<h1>Unauthorized Injected HTML</h1>' }),
    });
    expect(rawHtmlRes.status).toBe(400);
    const body = await rawHtmlRes.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Resume JSON payload required');

    const emptyRes = await fetch(`${BASE_URL}/api/generate-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(emptyRes.status).toBe(400);
  });

  // 2. Extractor SSRF Hardening
  test('extractor blocks requests to private subnets, loopback, and cloud metadata IPs', async () => {
    const maliciousSources = [
      'http://169.254.169.254/latest/meta-data',
      'http://127.0.0.1:3000/api/health',
      'http://localhost:8080',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://172.16.0.1',
    ];

    for (const source of maliciousSources) {
      await expect(runExtraction({ source })).rejects.toThrow();
    }
  });

  // 3. Contact & Project URL Scheme Restrictions
  test('schema rejects dangerous URL schemes (javascript:, file:, data:, relative paths)', () => {
    const dangerousSchemes = [
      'javascript:alert("pwned")',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'ftp://ftp.example.com',
      '/relative/path/to/script',
    ];

    for (const badUrl of dangerousSchemes) {
      // Test contact info
      const badContact = {
        ...resumeFixture,
        basics: {
          ...resumeFixture.basics,
          contact: {
            ...resumeFixture.basics.contact,
            website: badUrl,
          },
        },
      };
      expect(ResumeSchema.safeParse(badContact).success).toBe(false);

      // Test project link
      const badProject = {
        ...resumeFixture,
        projects: [
          {
            ...resumeFixture.projects[0],
            link: badUrl,
          },
        ],
      };
      expect(ResumeSchema.safeParse(badProject).success).toBe(false);
    }

    // Valid http/https schemes must parse cleanly
    const validContact = {
      ...resumeFixture,
      basics: {
        ...resumeFixture.basics,
        contact: {
          ...resumeFixture.basics.contact,
          website: 'https://example.com',
          github: 'https://github.com/example',
          linkedin: 'https://linkedin.com/in/example',
        },
      },
      projects: [
        {
          ...resumeFixture.projects[0],
          link: 'https://project.example.com',
        },
      ],
    };
    expect(ResumeSchema.safeParse(validContact).success).toBe(true);
  });

  // 4. Origin-Restricted CORS
  test('strictly rejects unauthorized cross-origin requests with HTTP 403', async () => {
    const unauthorizedOrigins = [
      'https://malicious-site.com',
      'https://phishing-attacker.org',
      'http://evil.local',
    ];

    for (const origin of unauthorizedOrigins) {
      const postRes = await fetch(`${BASE_URL}/api/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({ resume: resumeFixture }),
      });
      expect(postRes.status).toBe(403);
      expect(await postRes.text()).toContain('Forbidden: Invalid CORS Origin');

      const preflightRes = await fetch(`${BASE_URL}/api/generate-pdf`, {
        method: 'OPTIONS',
        headers: { Origin: origin },
      });
      expect(preflightRes.status).toBe(403);
    }
  });

  // 5. Request Body Limit (1MB Ceiling)
  test('rejects incoming JSON payloads exceeding 1MB with HTTP 413 and security headers', async () => {
    const hugePayload = {
      resume: {
        ...resumeFixture,
        basics: {
          ...resumeFixture.basics,
          summary: 'B'.repeat(1024 * 1024 + 1024),
        },
      },
    };

    const res = await fetch(`${BASE_URL}/api/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
      },
      body: JSON.stringify(hugePayload),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Payload Too Large');

    // Security headers must still be present on 413 responses
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    await new Promise((r) => setTimeout(r, 100));
  });

  // 6. XSS / HTML Tag Injection Fuzzing & Rendering Escaping
  test('encodes HTML and script tags harmlessly without script execution or layout crash', async () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror="alert(1)">',
      '<svg/onload=alert(1)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '"><script>alert(document.cookie)</script>',
      '\' onmouseover=\'alert(1)',
    ];

    for (const injection of xssPayloads) {
      const injectedResume = {
        ...resumeFixture,
        basics: {
          ...resumeFixture.basics,
          name: `Candidate ${injection}`,
          title: `Engineer ${injection}`,
          summary: `Summary with ${injection} injection.`,
        },
        work: [
          {
            ...resumeFixture.work[0],
            company: `Acme ${injection}`,
            position: `Dev ${injection}`,
            highlights: [`Delivered project with ${injection} safely`],
          },
        ],
        skills: [
          {
            category: `Languages ${injection}`,
            items: [`TypeScript ${injection}`],
          },
        ],
      };

      const html = renderResume(injectedResume as any);

      // Verify that raw executable script / event handlers are not emitted unescaped
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onerror=');
      expect(html).not.toContain('onload=');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('onmouseover=');

      // Verify that rendered text survives properly escaped
      if (injection.includes('<')) {
        expect(html).toContain('&lt;');
      }
      if (injection.includes("'")) {
        expect(html).toContain('&#x27;');
      }
    }
  });

  // 7. Renderer Network Isolation (SSRF Route Interception)
  test('renderer aborts outbound network requests embedded in HTML', async () => {
    let canaryHits = 0;
    const canaryServer = http.createServer((_req, res) => {
      canaryHits++;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('leak-captured');
    });

    await new Promise<void>((resolve) => canaryServer.listen(0, '127.0.0.1', () => resolve()));
    const canaryPort = (canaryServer.address() as any).port;
    const canaryUrl = `http://127.0.0.1:${canaryPort}`;

    const maliciousHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>SSRF Test</title>
          <link rel="stylesheet" href="${canaryUrl}/leak.css">
          <script src="${canaryUrl}/leak.js"></script>
        </head>
        <body>
          <h1>Security Test</h1>
          <img src="${canaryUrl}/leak.png" alt="probe">
          <img src="http://169.254.169.254/latest/meta-data" alt="aws">
          <img src="http://127.0.0.1:9999/internal-leak" alt="internal">
          <iframe src="${canaryUrl}/frame"></iframe>
        </body>
      </html>
    `;

    try {
      // generatePdf must complete cleanly without hanging on outbound network requests
      const result = await generatePdf({ html: maliciousHtml });
      expect(result.buffer).toBeDefined();
      expect(result.pageCount).toBeGreaterThanOrEqual(1);
      // Playwright network route interception must strictly abort outbound egress
      expect(canaryHits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => canaryServer.close(() => resolve()));
    }
  }, 20000);

  // 8. Zero-PII Safe Route Logging
  test('masks arbitrary paths and sensitive tokens to /api/[unmatched] in logs', async () => {
    const sensitivePaths = [
      '/api/candidate-ssn-12345',
      '/api/user-faris@example.com',
      '/api/passwords/reset',
    ];

    for (const p of sensitivePaths) {
      expect(getSafeRouteIdentifier(p)).toBe('/api/[unmatched]');
      const res = await fetch(`${BASE_URL}${p}`);
      expect(res.status).toBe(404);
    }

    const leaked = recentServerLogs.find(
      (log) => log.path.includes('ssn') || log.path.includes('faris@example.com')
    );
    expect(leaked).toBeUndefined();
  });

  // 9. OS Chromium Sandboxing Configuration & Execution Modes
  test('OS sandbox configuration flags and execution modes', async () => {
    const origEnv = process.env.DISABLE_CHROMIUM_SANDBOX;

    try {
      // Default production mode: Sandboxing enabled
      delete process.env.DISABLE_CHROMIUM_SANDBOX;
      expect(isChromiumSandboxEnabled()).toBe(true);
      const defaultArgs = getChromiumLaunchArgs();
      expect(defaultArgs).toContain('--disable-dev-shm-usage');
      expect(defaultArgs).not.toContain('--no-sandbox');
      expect(defaultArgs).not.toContain('--disable-setuid-sandbox');

      // Opt-out mode: Sandboxing disabled (e.g. unprivileged container)
      process.env.DISABLE_CHROMIUM_SANDBOX = 'true';
      expect(isChromiumSandboxEnabled()).toBe(false);
      const optOutArgs = getChromiumLaunchArgs();
      expect(optOutArgs).toContain('--disable-dev-shm-usage');
      expect(optOutArgs).toContain('--no-sandbox');
      expect(optOutArgs).toContain('--disable-setuid-sandbox');

      // Verify PDF generation execution in opt-out mode
      const optOutPdf = await generatePdf({ html: '<h1>Opt-Out Mode</h1>' });
      expect(optOutPdf.pageCount).toBe(1);

      // Verify PDF generation execution in sandboxed mode
      delete process.env.DISABLE_CHROMIUM_SANDBOX;
      const sandboxedPdf = await generatePdf({ html: '<h1>Sandboxed Mode</h1>' });
      expect(sandboxedPdf.pageCount).toBe(1);
    } finally {
      if (origEnv !== undefined) {
        process.env.DISABLE_CHROMIUM_SANDBOX = origEnv;
      } else {
        delete process.env.DISABLE_CHROMIUM_SANDBOX;
      }
    }
  }, 30000);
});
