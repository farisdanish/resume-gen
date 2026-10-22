import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { renderResume } from '../src/render';
import { generatePdf } from '../src/pdf';
import resume from '../fixtures/resume.json';
import { createServer } from 'node:http';
import compatibility from '../fixtures/pdf-compatibility.json';
import { inspectPdf } from './helpers/pdf-checks';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

describe('Design application and measured budget', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
  afterAll(async () => { await browser?.close(); });

  // Catches a short entry splitting between its heading and final content.
  it.each(['projects', 'experience'] as const)('section-continuation keeps a short %s entry intact at a page boundary', async (section) => {
    const data = structuredClone(compatibility);
    data.projects = [{ title: 'SHORT PROJECT', description: 'A short project delivers useful production results. '.repeat(3) + ' SHORT-PROJECT-END', stack: ['TypeScript'], link: 'https://example.com/short' }];
    data.work = [{ ...data.work[0], company: 'SHORT EMPLOYER', highlights: ['First evidence of production work.', 'Second evidence of useful delivery.', 'SHORT-WORK-END'] }];
    let html = renderResume(data, { sectionOrder: [section], styleConfig: { bodyFontSize: 11 } });
    html = html.replace(`<section class="section section-${section}">`, `<div style="height:220mm"></div><section class="section section-${section}">`);
    const { buffer } = await generatePdf({ html });
    const result = await inspectPdf(buffer);
    const title = section === 'projects' ? 'SHORT PROJECT' : 'SHORT EMPLOYER';
    const end = section === 'projects' ? 'SHORT-PROJECT-END' : 'SHORT-WORK-END';
    const pages = result.textPages.map((page) => page.runs.map((run) => run.text).join(' '));
    const index = pages.findIndex((text) => text.includes(title));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(pages[index]).toContain(end);
    expect(pages[index]).toContain(section === 'projects' ? 'PROJECTS' : 'WORK EXPERIENCE');
    for (const raw of Object.values(result.texts)) expect(raw.split(end).length - 1).toBe(1);
  }, 30000);

  // Catches legacy-sized continuation pages losing top/bottom margins.
  it.each([undefined, 11] as const)('section-continuation repeats print margins at body size %s', async (bodyFontSize) => {
    const data = { ...compatibility, work: Array.from({ length: 30 }, () => compatibility.work[0]) };
    const { buffer } = await generatePdf({ html: renderResume(data, { styleConfig: { bodyFontSize } }) });
    const result = await inspectPdf(buffer);
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.textPages) for (const run of page.runs) {
      expect(run.y).toBeGreaterThanOrEqual(12 * 72 / 25.4 - 2);
      expect(run.y + run.height).toBeLessThanOrEqual(page.height - 12 * 72 / 25.4 + 2);
    }
  }, 30000);

  it('section-continuation splits oversized work and projects without losing or duplicating sentinels', async () => {
    const data = structuredClone(compatibility);
    data.work = [{ ...data.work[0], highlights: Array.from({ length: 75 }, (_, i) => `WorkSentinel${i}: delivered reliable production processing with CPU-intensive queue-driven work.`) }];
    data.projects[0].description = Array.from({ length: 100 }, (_, i) => `ProjectSentinel${i}: delivered useful production processing and remote collaboration.`).join(' ');
    const { buffer, pageCount } = await generatePdf({ html: renderResume(data, { styleConfig: { bodyFontSize: 11 } }) });
    expect(pageCount).toBeGreaterThan(2);
    const result = await inspectPdf(buffer);
    expect(result.textPages[0].runs.map((run) => run.text).join(' ')).toContain('WorkSentinel0:');
    for (const raw of Object.values(result.texts)) {
      let previous = -1;
      for (const [prefix, count] of [['WorkSentinel', 75], ['ProjectSentinel', 100]] as const) for (let index = 0; index < count; index++) {
        const token = `${prefix}${index}:`;
        expect(raw.split(token).length - 1).toBe(1);
        const position = raw.indexOf(token);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
      expect(raw).not.toMatch(/[\uE000-\uF8FF\uFFFD]/);
    }
  }, 30000);

  it('section-continuation starts an oversized individual bullet below its job header', async () => {
    const data = structuredClone(compatibility);
    data.work = [{ ...data.work[0], highlights: ['BULLET-FIRST ' + 'Delivered useful production processing and reliable remote collaboration. '.repeat(160) + ' BULLET-LAST'] }];
    const { buffer, pageCount } = await generatePdf({ html: renderResume(data, { styleConfig: { bodyFontSize: 11 } }) });
    expect(pageCount).toBeGreaterThan(1);
    const result = await inspectPdf(buffer);
    expect(result.textPages[0].runs.map((run) => run.text).join(' ')).toContain('BULLET-FIRST');
    for (const raw of Object.values(result.texts)) {
      expect(raw.split('BULLET-FIRST').length - 1).toBe(1);
      expect(raw.split('BULLET-LAST').length - 1).toBe(1);
    }
  }, 30000);

  it('section rules are visible without overpowering headings', async () => {
    const page = await browser.newPage({ deviceScaleFactor: 3 });
    try {
      await page.setContent(renderResume(compatibility));
      const rule = await page.locator('.section-heading').first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: parseFloat(style.borderBottomWidth), color: style.borderBottomColor };
      });
      expect(rule.width).toBeGreaterThanOrEqual(1);
      expect(rule.color).toBe('rgb(184, 194, 204)');
    } finally { await page.close(); }
  });

  // Catches a font choice rendering as a mixture or silently exporting a different family.
  it.each([
    ['modern', 'ResumeSans', 'LiberationSans'],
    ['editorial', 'ResumeCalibri', 'Carlito'],
    ['serif', 'ResumeSerif', 'LiberationSerif'],
  ] as const)('traditional font exports use one family for %s', async (fontPairing, family, pdfFamily) => {
    const page = await browser.newPage();
    try {
      const html = renderResume(compatibility, { styleConfig: { fontPairing, bodyFontSize: 11 } });
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      for (const selector of ['.candidate-name', '.section-heading', '.summary-text', '.highlight-list li']) {
        expect(await page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '').trim())).toBe(family);
      }
      const { buffer } = await generatePdf({ html });
      const pdf = await PDFDocument.load(buffer);
      const names: string[] = [];
      for (const sheet of pdf.getPages()) {
        const fonts = sheet.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
        for (const [, ref] of fonts?.entries() || []) {
          const font = pdf.context.lookup(ref, PDFDict);
          names.push(font.lookup(PDFName.of('BaseFont'), PDFName).decodeText());
        }
      }
      expect(names.length).toBeGreaterThanOrEqual(2);
      expect(names.every((name) => name.includes(pdfFamily))).toBe(true);
      const result = await inspectPdf(buffer);
      for (const raw of Object.values(result.texts)) {
        const text = raw.replace(/\s+/g, ' ');
        for (const phrase of ['Backend Software Engineer', '2024-12', '80–90%', 'Kota Kinabalu']) expect(text).toContain(phrase);
        expect(text).not.toMatch(/[\uE000-\uF8FF\uFFFD]/);
      }
    } finally { await page.close(); }
  }, 30000);

  // Catches small bullets/metadata and section zoom bypassing the 10 pt floor.
  it.each([10, 11, 12] as const)('readable-effective-font-sizes respects size %i and section-scale floors', async (bodyFontSize) => {
    const page = await browser.newPage();
    try {
      const html = renderResume(compatibility, { styleConfig: {
        bodyFontSize, sectionScale: { summary: 0.85, experience: 0.85, projects: 0.85 },
      } });
      await page.setContent(html);
      const sizes = await page.evaluate(() => {
        const pt = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize) * 72 / 96;
        return { summary: pt('.summary-text'), bullet: pt('.highlight-list li'), heading: pt('.section-experience h2'),
          contact: pt('.contact-bar'), meta: pt('.item-meta'), link: pt('.project-link'), skills: pt('.skill-category-row'),
          zoom: Number(getComputedStyle(document.querySelector('.section-experience')!).zoom) };
      });
      for (const key of ['summary', 'bullet', 'contact', 'meta', 'link', 'skills'] as const) expect(sizes[key], key).toBeGreaterThanOrEqual(9.99);
      expect(sizes.summary).toBeCloseTo(Math.max(10, bodyFontSize * 0.85), 1);
      expect(sizes.skills).toBeCloseTo(bodyFontSize, 1);
      expect(sizes.heading).toBeGreaterThanOrEqual(12);
      expect(sizes.zoom).toBe(1);
    } finally { await page.close(); }
  });

  // Catches continuation pages losing their print margins or final content.
  it.each(['tight', 'standard', 'spacious'] as const)('readable-print-margins preserves every page at %s margins', async (margins) => {
    const resume = { ...compatibility, work: Array.from({ length: 30 }, (_, i) => ({ ...compatibility.work[0], company: `Employer ${i + 1}` })) };
    const { buffer, pageCount } = await generatePdf({ html: renderResume(resume, { styleConfig: { bodyFontSize: 11, margins } }) });
    expect(pageCount).toBeGreaterThan(1);
    const result = await inspectPdf(buffer);
    for (const text of Object.values(result.texts)) expect(text).toContain('Project sentinel: reliable production processing.');
    const marginY = ({ tight: 10, standard: 12, spacious: 14 }[margins]) * 72 / 25.4;
    const marginX = ({ tight: 12, standard: 14, spacious: 16 }[margins]) * 72 / 25.4;
    for (const page of result.textPages) {
      expect(page.runs.length).toBeGreaterThan(0);
      for (const run of page.runs) {
        expect(run.x).toBeGreaterThanOrEqual(marginX - 2);
        expect(run.x + run.width).toBeLessThanOrEqual(page.width - marginX + 2);
        expect(run.y).toBeGreaterThanOrEqual(marginY - 2);
        expect(run.y + run.height).toBeLessThanOrEqual(page.height - marginY + 2);
      }
    }
  }, 30000);

  // Catches a job heading stranded at the page bottom before its first bullet.
  it('keeps readable job headings with their first evidence line', async () => {
    const data = { ...compatibility, work: Array.from({ length: 32 }, (_, i) => ({ ...compatibility.work[0], company: `Employer ${i + 1}` })) };
    data.basics = { ...data.basics, summary: data.basics.summary + ' Seeking remote work on CPU-intensive queue-driven systems.' };
    const { buffer } = await generatePdf({ html: renderResume(data, { styleConfig: { bodyFontSize: 11, fontPairing: 'modern', bodyAlignment: 'left' } }) });
    const result = await inspectPdf(buffer);
    for (const page of result.textPages) {
      const lastRun = page.runs.at(-1)!.text;
      expect(lastRun).not.toMatch(/Present$/);
      expect(lastRun).not.toMatch(/Employer \d+$/);
    }
  }, 30000);

  it('justifies the summary while preserving the hyphen guard and other body alignment', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(renderResume(compatibility, { styleConfig: { bodyAlignment: 'left', bodyFontSize: 11 } }));
      const styles = await page.locator('.summary-text').evaluate((el) => ({
        alignment: getComputedStyle(el).textAlign,
        hyphens: getComputedStyle(el).hyphens,
      }));
      expect(styles.alignment).toBe('justify');
      expect(styles.hyphens).toBe('none');
      expect(await page.locator('.highlight-list li').first().evaluate((el) => getComputedStyle(el).textAlign)).toBe('left');
    } finally { await page.close(); }
  });

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
        body: getComputedStyle(document.querySelector('.highlight-list li')!).textAlign,
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

  it.each(['left', 'right'] as const)('keeps photo profile links together at %s with all projects present', async (position) => {
    const page = await browser.newPage();
    try {
      await page.setContent(renderResume({ ...resume, basics: { ...resume.basics,
        contact: { ...resume.basics.contact, location: 'A long location in Kota Kinabalu, Sabah, Malaysia' },
        headshot: { dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', shape: position === 'left' ? 'circle' : 'rounded', position },
      } }));
      await page.evaluate(() => document.fonts.ready);
      expect(await page.locator('.contact-links a').count()).toBe(3);
      const tops = await page.locator('.contact-links a').evaluateAll((links) => links.map((el) => el.getBoundingClientRect().top));
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
      expect(await page.locator('.project-item').count()).toBe(resume.projects.length);
      expect(await page.locator('.header-copy').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    } finally { await page.close(); }
  });
});
