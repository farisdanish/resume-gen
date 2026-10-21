import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { renderResume } from '../src/render';
import { generatePdf } from '../src/pdf';
import resume from '../fixtures/resume.json';
import { createServer } from 'node:http';

describe('Design application and measured budget', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  it('applies Design controls to computed styles rather than merely emitting CSS', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(renderResume(resume, { styleConfig: {
        accentColor: '#111111', fontPairing: 'modern', margins: 'spacious',
        bodyAlignment: 'left', headerAlignment: 'center', sectionScale: { skills: 0.9 },
      } }));
      const styles = await page.evaluate(() => ({
        accent: getComputedStyle(document.querySelector('.section-heading')!).color,
        font: getComputedStyle(document.querySelector('h1')!).fontFamily,
        header: getComputedStyle(document.querySelector('header')!).textAlign,
        body: getComputedStyle(document.querySelector('.summary-text')!).textAlign,
        padding: getComputedStyle(document.querySelector('.resume-page')!).paddingTop,
        skills: getComputedStyle(document.querySelector('.section-skills')!).zoom,
        experience: getComputedStyle(document.querySelector('.section-experience')!).zoom,
      }));
      expect(styles.accent).toBe('rgb(17, 17, 17)');
      expect(styles.font).toContain('ResumeSans');
      expect(styles.header).toBe('center');
      expect(styles.body).toBe('left');
      expect(parseFloat(styles.padding)).toBeCloseTo(14 * 96 / 25.4, 1);
      expect(Number(styles.skills)).toBeCloseTo(0.9);
      expect(Number(styles.experience)).toBe(1);
    } finally { await page.close(); }
  });

  it('makes body typography and content height increase with density', async () => {
    const page = await browser.newPage();
    try {
      const measurements = [];
      for (const density of ['compact', 'standard', 'spacious'] as const) {
        await page.setContent(renderResume(resume, { styleConfig: { density } }));
        await page.evaluate(() => document.fonts.ready);
        measurements.push(await page.evaluate(() => ({
          size: parseFloat(getComputedStyle(document.querySelector('.highlight-list li')!).fontSize),
          line: parseFloat(getComputedStyle(document.querySelector('.highlight-list li')!).lineHeight),
          height: document.querySelector('.resume-page')!.getBoundingClientRect().height,
        })));
      }
      expect(measurements[0].size).toBeLessThan(measurements[1].size);
      expect(measurements[1].size).toBeLessThan(measurements[2].size);
      expect(measurements[0].line).toBeLessThan(measurements[1].line);
      expect(measurements[1].line).toBeLessThan(measurements[2].line);
      expect(measurements[0].height).toBeLessThan(measurements[1].height);
      expect(measurements[1].height).toBeLessThan(measurements[2].height);
      expect(measurements[1].size).toBeCloseTo(8.2 * 96 / 72, 1);
    } finally { await page.close(); }
  });

  it('measures a known half-page and reports actual overflowing PDF pages', async () => {
    const half = await generatePdf({ html: '<style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0}.resume-page{padding:10mm}.content{height:138.5mm}</style><div class="resume-page"><div class="content"></div></div>' });
    expect(half).toHaveProperty('layout.fullnessPercent');
    expect(half.layout.fullnessPercent).toBeCloseTo(50, 0);
    expect(half.pageCount).toBe(1);
    const overflow = await generatePdf({ html: renderResume({ ...resume,
      work: Array.from({ length: 20 }, () => resume.work[0]),
    }) });
    expect(overflow.pageCount).toBeGreaterThan(1);
    expect(overflow.isSinglePage).toBe(false);
    expect(overflow.layout.fullnessPercent).toBeGreaterThan(100);
  }, 30000);

  it('accounts for long certification text', async () => {
    const original = await generatePdf({ html: renderResume(resume) });
    const expanded = await generatePdf({ html: renderResume({ ...resume,
      certifications: Array(30).fill('A long certification describing a substantial professional qualification'),
    }) });
    expect(expanded).toHaveProperty('layout.fullnessPercent');
    expect(expanded.layout.fullnessPercent).toBeGreaterThan(original.layout.fullnessPercent);
  }, 30000);

  it('bounds browser work when an image never finishes loading', async () => {
    const imageServer = createServer(() => { /* Deliberately keep the image response open. */ });
    await new Promise<void>((resolve) => imageServer.listen(0, '127.0.0.1', resolve));
    const port = (imageServer.address() as { port: number }).port;
    try {
      await expect(generatePdf({ html: `<img src="http://127.0.0.1:${port}/stalled.png">` }))
        .rejects.toThrow('timed out');
    } finally {
      imageServer.closeAllConnections();
      await new Promise<void>((resolve) => imageServer.close(() => resolve()));
    }
  }, 20000);
});
