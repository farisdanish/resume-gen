import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import { extractText } from 'unpdf';
import resumeFixture from '../fixtures/resume.json';
import { inspectPdf } from './helpers/pdf-checks';
import compatibility from '../fixtures/pdf-compatibility.json';

describe('Editor preview and budget flow', () => {
  let server: Server;
  let browser: Browser;
  let baseUrl: string;
  beforeAll(async () => {
    server = startServer(0, '127.0.0.1') as Server;
    if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server?.close((err) => err ? reject(err) : resolve()));
  });

  async function previewText(page: Page) {
    return (await page.locator('#preview-pages .pdf-text-layer span').allTextContents()).join(' ').replace(/\s+/g, ' ').trim();
  }

  async function openEditor(page: Page) {
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
  }

  async function openProjectEditor(page: Page) {
    await openEditor(page);
    await page.locator('#input-import-json').setInputFiles({
      name: 'projects.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...resumeFixture, projects: [
        resumeFixture.projects[0],
        { title: 'Second Project', description: 'Keep this description unchanged.', stack: [] },
      ] })),
    });
    await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Imported legacy resume JSON'));
    await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
    await page.locator('[data-tab="tab-content"]').click();
    expect(await page.locator('.input-project-description').count()).toBe(2);
  }

  async function downloadedBytes(page: Page, button: string) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  it('collapses education cards and explains detailed-only academic projects', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.locator('[data-tab="tab-content"]').click();
      const card = page.locator('.education-editor-card').first();
      expect(await card.locator('.editor-card-body').isVisible()).toBe(false);
      expect(await card.locator('.edu-toggle').getAttribute('aria-expanded')).toBe('false');
      expect(await page.locator('#education-display-controls').textContent()).toContain('Academic projects appear only in Detailed mode.');
      await card.locator('.edu-toggle').click();
      expect(await card.locator('.editor-card-body').isVisible()).toBe(true);
      expect(await card.locator('[data-list="activities"]').count()).toBe(1);
      expect(await card.locator('[data-list="subjects"]').count()).toBe(0);
      await card.locator('.edu-toggle').click();
      expect(await card.locator('.editor-card-body').isVisible()).toBe(false);
    } finally { await page.close(); }
  }, 30000);

  it('adds an SPM entry with independent overall and Bahasa Melayu results', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('#btn-add-spm').click();
      const spm = page.locator('.education-editor-card').last();
      expect(await spm.locator('[data-field="degree"]').inputValue()).toBe('Sijil Pelajaran Malaysia (SPM)');
      expect(await spm.locator('[data-grade]').count()).toBe(0);
      await spm.locator('[data-field="institution"]').fill('Maktab Rendah Sains MARA Kota Kinabalu');
      await spm.locator('[data-field="end"]').fill('2017');
      await spm.locator('[data-spm="overall"]').fill('5A2B1C1D');
      await spm.locator('[data-spm="bahasaMelayu"]').fill('A-');
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      const text = await previewText(page);
      expect(text).toContain('5A2B1C1D');
      expect(text).toContain('Bahasa Melayu: A-');
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(draft.draftResume.education.at(-1).spmResults).toEqual({ overall: '5A2B1C1D', bahasaMelayu: 'A-' });
    } finally { await page.close(); }
  }, 30000);

  it('lets a migrated SPM copy remove its inherited CGPA', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const copied = { ...resumeFixture.education[0], degree: 'Sijil Pelajaran Malaysia (SPM)', level: 'spm',
        grade: { value: 3.5, scale: 4 }, spmResults: { overall: '5A2B1C1D' } };
      await page.locator('#input-import-json').setInputFiles({ name: 'spm-copy.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ ...resumeFixture, education: [...resumeFixture.education, copied] })) });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Imported legacy resume JSON'));
      await page.locator('[data-tab="tab-content"]').click();
      const spm = page.locator('.education-editor-card').last();
      await spm.locator('.edu-toggle').click();
      await spm.locator('[data-action="clear-grade"]').click();
      const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(draft.draftResume.education.at(-1).grade).toBeUndefined();
      expect(draft.draftResume.education.at(-1).spmResults.overall).toBe('5A2B1C1D');
    } finally { await page.close(); }
  }, 30000);

  it('keeps education visibility with its qualification after reorder and draft save', async () => {
    const page = await browser.newPage({ acceptDownloads: true });
    try {
      await openEditor(page);
      await page.locator('[data-tab="tab-content"]').click();
      const cards = page.locator('.education-editor-card');
      await page.locator('#btn-add-education').click();
      expect(await cards.count()).toBeGreaterThanOrEqual(2);
      const movedIndex = await cards.count() - 2;
      await cards.last().locator('[data-field="institution"]').fill('Second College');
      await cards.last().locator('[data-field="degree"]').fill('Diploma');
      await cards.last().locator('.edu-include').uncheck();
      await cards.last().locator('[data-action="up"]').click();
      expect(await cards.nth(movedIndex).locator('[data-field="degree"]').inputValue()).toBe('Diploma');
      expect(await cards.nth(movedIndex).locator('.edu-include').isChecked()).toBe(false);
      const beforeDuplicate = await cards.count();
      await cards.nth(movedIndex).locator('[data-action="duplicate"]').click();
      expect(await cards.count()).toBe(beforeDuplicate + 1);
      page.once('dialog', (dialog) => dialog.accept());
      await cards.nth(movedIndex + 1).locator('[data-action="remove"]').click();
      expect(await cards.count()).toBe(beforeDuplicate);
      await cards.nth(movedIndex).locator('[data-grade="value"]').fill('3.8');
      await cards.nth(movedIndex).locator('[data-grade="scale"]').fill('4');
      await cards.nth(movedIndex).locator('[data-list="activities"]').fill('Robotics Club');
      const profile = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(profile.version).toBe(2);
      expect(profile.visibility.education[profile.draftResume.education[movedIndex].id]).toBe(false);
      expect(profile.draftResume.education[movedIndex].grade.value).toBe(3.8);
      expect(profile.draftResume.education[movedIndex].activities).toEqual(['Robotics Club']);
      const validation = await page.evaluate(async () => (await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: JSON.parse(localStorage.getItem('resume_gen_draft_v1')!).draftResume }) })).json());
      expect(validation.success).toBe(true);
      await page.locator('[data-tab="tab-source"]').click();
      await page.locator('#profile-name').fill('Academic profile');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => /Saved Academic profile|Could not save profile/.test(document.getElementById('profile-library-message')?.textContent || ''));
      expect(await page.locator('#profile-library-message').textContent()).toBe('Saved Academic profile.');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!).profiles[0].bundle);
      expect(saved.draftResume.education[movedIndex].activities).toEqual(['Robotics Club']);
      expect(saved.visibility.education[saved.draftResume.education[movedIndex].id]).toBe(false);
      const exported = JSON.parse((await downloadedBytes(page, '#btn-export-json')).toString());
      expect(exported.draftResume.education[movedIndex].grade.value).toBe(3.8);
    } finally { await page.close(); }
  }, 60000);

  it('migrates v1 education visibility without losing academic records', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const legacy = { version: 1, draftResume: resumeFixture, visibility: { education: { 0: false } },
        styleConfig: {}, sectionHeadings: {}, sectionOrder: ['summary', 'experience', 'education', 'skills', 'certifications', 'projects', 'references'], pageTarget: 1 };
      await page.locator('#input-import-json').setInputFiles({ name: 'legacy-education.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(migrated.version).toBe(2);
      expect(migrated.draftResume.education[0].degree).toBe(legacy.draftResume.education[0].degree);
      expect(migrated.visibility.education[migrated.draftResume.education[0].id]).toBe(false);
    } finally { await page.close(); }
  }, 60000);

  // Catches a clipped first-page-only preview and zoom layouts that hide the last page.
  it.each([[2, 1], [12, 2], [32, 3]])('multipage-preview-reachability shows %i work entries on %i pages', async (count, expectedPages) => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      expect(await page.locator('.pdf-page').count()).toBeGreaterThan(0);
      const profile = JSON.parse((await downloadedBytes(page, '#btn-export-json')).toString());
      Object.assign(profile, { draftResume: { ...compatibility, work: Array.from({ length: count }, (_, i) => ({ ...compatibility.work[0], company: `Employer ${i + 1}` })) }, styleConfig: { bodyFontSize: 11 }, pageTarget: 2 });
      await page.locator('#input-import-json').setInputFiles({ name: 'pages.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      await page.waitForFunction(() => document.querySelectorAll('.pdf-page').length > 0 && document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('.pdf-page').count()).toBe(expectedPages);
      expect(await page.locator('.pdf-text-layer').allTextContents().then((texts) => texts.join(' '))).toContain('Project sentinel: reliable production processing.');
      expect(await page.locator('.pdf-page canvas').count()).toBe(expectedPages);
      for (const zoom of ['0.5', '1.0', '1.5', 'fit']) {
        await page.locator('#zoom-select').selectOption(zoom);
        await page.locator('#canvas-area').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const bounds = await page.locator('.pdf-page').last().boundingBox();
        const canvas = await page.locator('#canvas-area').boundingBox();
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 2);
        const lastText = page.locator('.pdf-text-layer span').filter({ hasText: 'Project sentinel:' }).last();
        await lastText.scrollIntoViewIfNeeded();
        const textBounds = await lastText.boundingBox();
        expect(textBounds!.y).toBeGreaterThanOrEqual(canvas!.y - 2);
        expect(textBounds!.y + textBounds!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height + 2);
      }
      const previewCount = await page.locator('.pdf-page').count();
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.pages.length).toBe(previewCount);
      for (let index = 0; index < pdf.textPages.length; index++) {
        const shown = await page.locator('.pdf-text-layer').nth(index).textContent();
        for (const run of pdf.textPages[index].runs) expect(shown).toContain(run.text);
      }
    } finally { await page.close(); }
  }, 60000);

  it('preview-revision-and-failure retains the previous complete PDF on invalid renderer data', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const before = await page.locator('#preview-pages').textContent();
      expect(await page.locator('.pdf-page').count()).toBeGreaterThan(0);
      await page.route('**/api/preview', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, json: { ...(await response.json()), pdfBase64: 'not-a-pdf' } });
      });
      await page.locator('#btn-render-preview').click();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Preview failed');
      expect(await page.locator('#preview-pages').textContent()).toBe(before);
      expect(await page.locator('#budget-percent').textContent()).toBe('—');
      expect(await page.locator('#budget-state').textContent()).toContain('unavailable');
    } finally { await page.close(); }
  }, 30000);

  // Catches misleading font labels and losing a selected family in saved profiles.
  it('traditional font selector names substitutes and persists the three choices', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      expect(await page.locator('#select-font-pairing option').allTextContents()).toEqual([
        'Arial-style (Liberation Sans)', 'Calibri-style (Carlito)', 'Times New Roman-style (Liberation Serif)',
      ]);
      await page.locator('[data-tab="tab-design"]').click();
      for (const [value, family] of [['modern', 'LiberationSans'], ['editorial', 'Carlito'], ['serif', 'LiberationSerif']]) {
        const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
        await page.locator('#select-font-pairing').selectOption(value);
        const result = await (await response).json();
        await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
        const pdf = await PDFDocument.load(Buffer.from(result.pdfBase64, 'base64'));
        const names = pdf.getPages().flatMap((sheet) => {
          const fonts = sheet.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
          return (fonts?.entries() || []).map(([, ref]) => pdf.context.lookup(ref, PDFDict).lookup(PDFName.of('BaseFont'), PDFName).decodeText());
        });
        expect(names.length).toBeGreaterThan(0);
        expect(names.every((name) => name.includes(family))).toBe(true);
      }
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#select-font-pairing').inputValue()).toBe('serif');
      const portable = await downloadedBytes(page, '#btn-export-json');
      expect(JSON.parse(portable.toString()).styleConfig.fontPairing).toBe('serif');
      await page.locator('#profile-name').fill('Traditional font');
      await page.locator('#btn-save-named-profile').click();
      await page.locator('[data-tab="tab-design"]').click();
      await page.locator('#select-font-pairing').selectOption('modern');
      await page.locator('[data-tab="tab-source"]').click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btn-load-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Loaded Traditional font.');
      expect(await page.locator('#select-font-pairing').inputValue()).toBe('serif');
      await page.locator('#input-import-json').setInputFiles({ name: 'font.json', mimeType: 'application/json', buffer: portable });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      expect(await page.locator('#select-font-pairing').inputValue()).toBe('serif');
    } finally { await page.close(); }
  }, 60000);

  // Catches stale shrink-text advice when switching between two overflowing layouts.
  it('refreshes readable overflow advice even when the budget state stays overflow', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const resume = { ...resumeFixture, work: Array.from({ length: 24 }, () => resumeFixture.work[0]) };
      await page.locator('#input-import-json').setInputFiles({ name: 'overflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(resume)) });
      await page.waitForFunction(() => document.getElementById('budget-state')?.textContent?.startsWith('Overflow'));
      expect(await page.locator('#assistant-tip').textContent()).toContain('Switch to Compact');
      await page.locator('[data-tab="tab-design"]').click();
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('#btn-readable-preset').click();
      await response;
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#assistant-tip').textContent()).toContain('Shorten a bullet');
      expect(await page.locator('#assistant-tip').textContent()).not.toContain('Switch to Compact');
    } finally { await page.close(); }
  }, 30000);

  // Catches losing explicit typography on reload/import/profile switches, or a preset deleting content.
  it('typography-profile-roundtrip preserves explicit readable settings without rewriting legacy profiles', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      expect(await page.locator('#select-body-font-size').count()).toBe(1);
      const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(legacy.styleConfig.bodyFontSize).toBeUndefined();
      await page.locator('[data-tab="tab-design"]').click();
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('#btn-readable-preset').click();
      const result = await (await response).json();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#select-body-font-size').inputValue()).toBe('11');
      expect(await page.locator('#select-density').textContent()).not.toContain('8.5pt');
      const readable = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_draft_v1')!));
      expect(readable.draftResume).toEqual(legacy.draftResume);
      expect(readable.visibility).toEqual(legacy.visibility);
      expect(readable.pageTarget).toBe(legacy.pageTarget);
      expect(readable.styleConfig).toMatchObject({ bodyFontSize: 11, bodyAlignment: 'left', fontPairing: 'modern', sectionScale: {}, accentColor: '#1a202c' });
      const rendered = await inspectPdf(Buffer.from(result.pdfBase64, 'base64'));
      expect(rendered.textPages.flatMap((sheet) => sheet.runs).find((run) => run.text.includes('Architected scalable'))?.height).toBeCloseTo(11, 1);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#select-body-font-size').inputValue()).toBe('11');
      const portable = await downloadedBytes(page, '#btn-export-json');
      await page.locator('#profile-name').fill('Readable');
      await page.locator('#btn-save-named-profile').click();
      await page.locator('[data-tab="tab-design"]').click();
      await page.locator('#select-body-font-size').selectOption('12');
      await page.locator('[data-tab="tab-source"]').click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btn-load-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Loaded Readable.');
      expect(await page.locator('#select-body-font-size').inputValue()).toBe('11');
      await page.locator('#input-import-json').setInputFiles({ name: 'readable.json', mimeType: 'application/json', buffer: portable });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      expect(await page.locator('#select-body-font-size').inputValue()).toBe('11');
      const before = await page.evaluate(() => ({ draft: localStorage.getItem('resume_gen_draft_v1'), library: localStorage.getItem('resume_gen_profiles_v1') }));
      const bad = JSON.parse(portable.toString());
      bad.styleConfig.bodyFontSize = 9;
      bad.draftResume.basics.name = 'Invalid replacement';
      await page.locator('#input-import-json').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Failed to import JSON'));
      expect(await page.evaluate(() => ({ draft: localStorage.getItem('resume_gen_draft_v1'), library: localStorage.getItem('resume_gen_profiles_v1') }))).toEqual(before);
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.texts.unpdf).toContain('Second Project');
      expect(pdf.textPages.flatMap((p) => p.runs).every((run) => run.height >= 9.9)).toBe(true);
    } finally { await page.close(); }
  }, 60000);

  it('protects the saved draft when settings change before extraction finishes', async () => {
    const page = await browser.newPage();
    let release!: () => void;
    try {
      await openProjectEditor(page);
      const stored = await page.evaluate(() => localStorage.getItem('resume_gen_draft_v1'));
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/api/extract', async (route) => {
        const response = await route.fetch();
        await gate;
        await route.fulfill({ response }).catch(() => {});
      });
      await page.reload();
      await page.locator('[data-tab="tab-design"]').click();
      await page.locator('#select-date-format').selectOption('month-name');
      expect(await page.evaluate(() => localStorage.getItem('resume_gen_draft_v1'))).toBe(stored);
    } finally {
      release?.();
      await page.unrouteAll({ behavior: 'wait' });
      await page.close();
    }
  }, 30000);

  it('reports data readiness without claiming ATS approval and explains the new controls in Help', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      expect(await page.locator('#status-ats-badge').textContent()).toBe('Data: Ready');
      await page.locator('#menu-help').click();
      await page.getByRole('menuitem', { name: 'Help Topics…' }).click();
      const topics = await page.getByRole('dialog', { name: 'Help Topics' }).textContent();
      for (const phrase of ['Saved Profiles', 'date display', 'page target', 'project links']) expect(topics).toContain(phrase);
    } finally { await page.close(); }
  }, 30000);

  it('isolates named profiles, confirms dirty switches, and restores a saved PDF after reload', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      expect(await page.locator('#profile-name').count()).toBe(1);
      await page.locator('#profile-name').fill('Backend Engineer');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Saved Backend Engineer.');
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('#edit-title').fill('Full-Stack Developer');
      await page.locator('[data-tab="tab-source"]').click();
      await page.locator('#profile-name').fill('Full-Stack Developer');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Saved Full-Stack Developer.');
      const library = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!));
      expect(library.profiles.length).toBe(2);
      const backend = library.profiles.find((entry: any) => entry.name === 'Backend Engineer');
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('#edit-title').fill('Unsaved draft');
      await page.locator('[data-tab="tab-source"]').click();
      await page.locator('#saved-profile-list').selectOption(backend.id);
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.locator('#btn-load-named-profile').click();
      expect(await page.locator('#edit-title').inputValue()).toBe('Unsaved draft');
      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#btn-load-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Loaded Backend Engineer.');
      expect(await page.locator('#edit-title').inputValue()).not.toBe('Unsaved draft');
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#saved-profile-list option').count()).toBe(3);
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.texts.unpdf).not.toContain('Unsaved draft');
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!));
      expect(after.profiles.find((entry: any) => entry.name === 'Full-Stack Developer').bundle.draftResume.basics.title).toBe('Full-Stack Developer');
    } finally { await page.close(); }
  }, 30000);

  it('requires explicit update for duplicate profile names and preserves data on storage failure', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      expect(await page.locator('#profile-name').count()).toBe(1);
      await page.locator('#profile-name').fill('Backend Engineer');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Saved Backend Engineer.');
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('#edit-title').fill('Updated backend title');
      await page.locator('[data-tab="tab-source"]').click();
      await page.locator('#profile-name').fill('backend engineer');
      await page.locator('#btn-save-named-profile').click();
      expect(await page.locator('#profile-library-message').textContent()).toContain('Update Saved Profile');
      const savedTitle = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!).profiles[0].bundle.draftResume.basics.title);
      expect(savedTitle).not.toBe('Updated backend title');
      await page.locator('#btn-update-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent?.startsWith('Updated '));
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!).profiles[0].bundle.draftResume.basics.title)).toBe('Updated backend title');
      const before = await page.evaluate(() => localStorage.getItem('resume_gen_profiles_v1'));
      await page.evaluate(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key === 'resume_gen_profiles_v1') throw new DOMException('Full', 'QuotaExceededError');
          return setItem.call(this, key, value);
        };
      });
      await page.locator('#profile-name').fill('Another profile');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent?.includes('Could not save'));
      expect(await page.evaluate(() => localStorage.getItem('resume_gen_profiles_v1'))).toBe(before);
      expect(await page.locator('#edit-title').inputValue()).toBe('Updated backend title');
    } finally { await page.close(); }
  }, 30000);

  it('leaves the active draft intact when the named-profile library is corrupt', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.evaluate(() => localStorage.setItem('resume_gen_profiles_v1', '{broken'));
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#profile-library-message').count()).toBe(1);
      expect(await page.locator('#profile-library-message').textContent()).toContain('unavailable');
      expect(await page.locator('#btn-save-named-profile').isDisabled()).toBe(true);
      expect(await page.locator('#edit-name').inputValue()).not.toBe('');
    } finally { await page.close(); }
  }, 30000);

  it('still confirms unsaved named-profile changes after reloading the browser', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.locator('#profile-name').fill('Backend Engineer');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Saved Backend Engineer.');
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('#edit-title').fill('Unsaved after reload');
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      const id = await page.evaluate(() => JSON.parse(localStorage.getItem('resume_gen_profiles_v1')!).profiles[0].id);
      await page.locator('#saved-profile-list').selectOption(id);
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.locator('#btn-load-named-profile').click();
      await page.waitForFunction(() => !(document.getElementById('btn-load-named-profile') as HTMLButtonElement)?.disabled);
      expect(await page.locator('#edit-title').inputValue()).toBe('Unsaved after reload');
    } finally { await page.close(); }
  }, 30000);

  it('round-trips named-profile settings and visibility through a portable profile without rewriting the library', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      await page.locator('.chk-proj-include').first().uncheck();
      await page.locator('#select-references-mode').selectOption('none');
      await page.locator('#input-headshot').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      await page.locator('#headshot-preview').waitFor({ state: 'visible' });
      await page.locator('[data-tab="tab-design"]').click();
      await page.locator('#select-date-format').selectOption('month-name');
      await page.locator('#select-page-target').selectOption('2');
      await page.locator('[data-tab="tab-source"]').click();
      await page.locator('#profile-name').fill('Sabah Software Engineer');
      await page.locator('#btn-save-named-profile').click();
      await page.waitForFunction(() => document.getElementById('profile-library-message')?.textContent === 'Saved Sabah Software Engineer.');
      const before = await page.evaluate(() => localStorage.getItem('resume_gen_profiles_v1'));
      const portable = await downloadedBytes(page, '#btn-export-json');
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('.chk-proj-include').first().check();
      await page.locator('#chk-headshot-include').uncheck();
      await page.locator('#edit-title').fill('Temporary title');
      await page.locator('#input-import-json').setInputFiles({ name: 'saved.json', mimeType: 'application/json', buffer: portable });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      expect(await page.locator('#chk-headshot-include').isChecked()).toBe(true);
      expect(await page.locator('.chk-proj-include').first().isChecked()).toBe(false);
      expect(await page.locator('#select-date-format').inputValue()).toBe('month-name');
      expect(await page.locator('#select-page-target').inputValue()).toBe('2');
      expect(await page.locator('#select-references-mode').inputValue()).toBe('none');
      expect(await page.evaluate(() => localStorage.getItem('resume_gen_profiles_v1'))).toBe(before);
      await page.locator('[data-tab="tab-source"]').click();
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.texts.unpdf).toContain('Second Project');
      expect(pdf.texts.unpdf).not.toContain('Temporary title');
      expect(pdf.urls).not.toContain(resumeFixture.projects[0].link);
    } finally { await page.close(); }
  }, 30000);

  it('round-trips date display and page targets while preserving canonical dates', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      expect(await page.locator('#select-date-format').count()).toBe(1);
      expect(await page.locator('#select-page-target').inputValue()).toBe('1');
      await page.locator('[data-tab="tab-design"]').click();
      await page.locator('#select-date-format').selectOption('month-name');
      await page.locator('#select-page-target').selectOption('2');
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('#select-date-format').inputValue()).toBe('month-name');
      expect(await page.locator('#select-page-target').inputValue()).toBe('2');
      expect(await previewText(page)).toContain('Mar 2024');
      const profile = JSON.parse((await downloadedBytes(page, '#btn-export-json')).toString());
      expect(profile.pageTarget).toBe(2);
      expect(profile.styleConfig.dateFormat).toBe('month-name');
      expect(profile.draftResume.work[0].start).toBe('2024-03');
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.texts.unpdf).toContain('Mar 2024');
    } finally { await page.close(); }
  }, 30000);

  it.each([{ pageTarget: 3 }, { styleConfig: { dateFormat: 'invalid' } }])('rejects malformed profile settings without replacing the draft: %j', async (patch) => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      await page.locator('[data-tab="tab-source"]').click();
      const profile = JSON.parse((await downloadedBytes(page, '#btn-export-json')).toString());
      profile.draftResume.basics.name = 'Must not replace the active draft';
      Object.assign(profile, patch);
      await page.locator('#input-import-json').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Failed to import JSON'));
      expect(await page.locator('#edit-name').inputValue()).toBe(resumeFixture.basics.name);
      expect(await page.locator('#select-page-target').inputValue()).toBe('1');
    } finally { await page.close(); }
  }, 30000);

  it('edits and restores project evidence, rejecting unsafe links before PDF export', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      expect(await page.locator('.input-project-link').count()).toBe(2);
      await page.locator('.input-project-stack').first().fill('PHP, Laravel, , PostgreSQL');
      await page.locator('.input-project-link').first().fill('javascript:alert(1)');
      await page.waitForFunction(() => document.querySelector('.input-project-link')?.getAttribute('aria-invalid') === 'true');
      expect(await page.locator('#budget-percent').textContent()).toBe('—');
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('.input-project-link').first().fill('https://example.com/project');
      await response;
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('.input-project-link').first().inputValue()).toBe('https://example.com/project');
      expect(await previewText(page)).toContain('PHP, Laravel, PostgreSQL');
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.urls).toContain('https://example.com/project');
      expect(pdf.texts.unpdf).toContain('https://example.com/project');
      await page.locator('[data-tab="tab-content"]').click();
      const clearing = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('.input-project-link').first().fill('');
      await clearing;
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await previewText(page)).not.toContain('https://example.com/project');
      await page.locator('[data-tab="tab-source"]').click();
      const cleared = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(cleared.urls).not.toContain('https://example.com/project');
    } finally { await page.close(); }
  }, 30000);

  it('opens the Help menu by mouse and dismisses it outside or with Escape', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const help = page.locator('#menu-help');
      await help.click();
      expect(await help.getAttribute('aria-expanded')).toBe('true');
      expect(await page.getByRole('menu', { name: 'Help' }).isVisible()).toBe(true);
      await page.locator('.win-title-text').click();
      expect(await help.getAttribute('aria-expanded')).toBe('false');
      await help.click();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('menu', { name: 'Help' }).isVisible()).toBe(false);
      expect(await help.evaluate((el) => document.activeElement === el)).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it('navigates Help by keyboard and restores focus after Help and About dialogs', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      const help = page.locator('#menu-help');
      await help.focus();
      await page.keyboard.press('Enter');
      expect(await page.getByRole('menuitem', { name: 'Help Topics…' }).evaluate((el) => document.activeElement === el)).toBe(true);
      await page.keyboard.press('ArrowUp');
      expect(await page.getByRole('menuitem', { name: 'About Resume Generator…' }).evaluate((el) => document.activeElement === el)).toBe(true);
      await page.keyboard.press('Enter');
      const about = page.getByRole('dialog', { name: 'About Resume Generator' });
      expect(await about.isVisible()).toBe(true);
      expect(await about.textContent()).toContain('1.0.0');
      await page.keyboard.press('Escape');
      expect(await about.isVisible()).toBe(false);
      expect(await help.evaluate((el) => document.activeElement === el)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      expect(await page.getByRole('menuitem', { name: 'Report an Issue…' }).evaluate((el) => document.activeElement === el)).toBe(true);
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      const topics = page.getByRole('dialog', { name: 'Help Topics' });
      expect(await topics.isVisible()).toBe(true);
      for (const topic of ['Extract', 'Content', 'Design', 'budget', 'Save Profile', 'PDF']) {
        expect(await topics.textContent()).toContain(topic);
      }
      await topics.getByRole('button', { name: 'OK', exact: true }).click();
      expect(await help.evaluate((el) => document.activeElement === el)).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it('opens the issue composer in a separate tab without including resume data', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.context().route('https://github.com/**', (route) => route.fulfill({ status: 200, body: 'GitHub issue composer' }));
      await page.locator('#menu-help').click();
      const issue = page.getByRole('menuitem', { name: 'Report an Issue…' });
      expect(await issue.getAttribute('rel')).toContain('noopener');
      expect(await issue.getAttribute('rel')).toContain('noreferrer');
      const opening = page.waitForEvent('popup');
      await issue.click();
      const popup = await opening;
      await popup.waitForLoadState();
      expect(popup.url()).toBe('https://github.com/farisdanish/resume-gen/issues/new');
      expect(await page.locator('#menu-help').getAttribute('aria-expanded')).toBe('false');
      await popup.close();
    } finally { await page.close(); }
  }, 30000);

  it('edits only the selected project, renders plain text, and exports the updated PDF and budget', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      const oldFill = Number((await page.locator('#budget-percent').textContent())!.replace('%', ''));
      const description = 'Edited project description. ' + 'Delivered a useful feature for customers. '.repeat(12)
        + '<img src=x onerror=alert(1)> & <script>alert(1)</script>';
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('.input-project-description').first().fill(description);
      const { budget } = await (await response).json();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      const shown = await previewText(page);
      expect(shown).toContain(description.trim());
      expect(shown).toContain('Keep this description unchanged.');
      expect(await page.locator('#preview-pages img, #preview-pages script').count()).toBe(0);
      expect(Math.round(budget.fullnessPercent)).toBeGreaterThan(oldFill);
      expect(await page.locator('#budget-percent').textContent()).toBe(`${Math.round(budget.fullnessPercent)}%`);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await page.locator('.input-project-description').first().inputValue()).toBe(description);
      expect(await page.locator('#proj-items-container img, #proj-items-container script').count()).toBe(0);
      await page.locator('[data-tab="tab-source"]').click();
      const bytes = await downloadedBytes(page, '#btn-download-pdf');
      const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
      expect(text).toContain('Edited project description.');
      expect(text).toContain('Keep this description unchanged.');
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(budget.pageCount);
    } finally { await page.close(); }
  }, 30000);

  it('preserves project edits through reload, profile export/import, and inclusion toggles', async () => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      await page.locator('.chk-proj-include').first().uncheck();
      const description = 'Edited while excluded, then restored.';
      await page.locator('.input-project-description').first().fill(description);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      await page.locator('[data-tab="tab-content"]').click();
      expect(await page.locator('.input-project-description').first().inputValue()).toBe(description);
      expect(await page.locator('.chk-proj-include').first().isChecked()).toBe(false);
      expect(await previewText(page)).toContain('Second Project');
      expect(await previewText(page)).not.toContain(resumeFixture.projects[0].title);
      await page.locator('[data-tab="tab-source"]').click();
      const profile = await downloadedBytes(page, '#btn-export-json');
      expect(JSON.parse(profile.toString()).draftResume.projects[0].description).toBe(description);
      await page.locator('[data-tab="tab-content"]').click();
      await page.locator('.input-project-description').first().fill('Temporary change');
      await page.locator('#input-import-json').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: profile });
      await page.waitForFunction(() => document.getElementById('diagnostics-log')?.textContent?.includes('Restored complete tailored profile'));
      expect(await page.locator('.input-project-description').first().inputValue()).toBe(description);
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('.chk-proj-include').first().check();
      await response;
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await previewText(page)).toContain(description);
    } finally { await page.close(); }
  }, 30000);

  it.each(['', '   '])('rejects a blank project description (%j) and recovers after correction', async (blank) => {
    const page = await browser.newPage();
    try {
      await openProjectEditor(page);
      const input = page.locator('.input-project-description').first();
      await input.fill(blank);
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Project description required');
      expect(await input.getAttribute('aria-invalid')).toBe('true');
      expect(await page.locator('#project-description-error-0').isVisible()).toBe(true);
      expect(await page.locator('#budget-percent').textContent()).toBe('—');
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await input.fill('Corrected description.');
      await response;
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      expect(await input.getAttribute('aria-invalid')).toBe('false');
      expect(await page.locator('#project-description-error-0').isVisible()).toBe(false);
      expect(await previewText(page)).toContain('Corrected description.');
    } finally { await page.close(); }
  }, 30000);

  it('applies a Design edit end to end and displays the measured budget', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.locator('[data-tab="tab-design"]').click();
      const response = page.waitForResponse((res) => res.url().endsWith('/api/preview') && res.request().method() === 'POST');
      await page.locator('#select-header-alignment').selectOption('center');
      const body = await (await response).json();
      expect(body).toHaveProperty('budget.pageCount', 1);
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      const preview = await inspectPdf(Buffer.from(body.pdfBase64, 'base64'));
      const name = preview.textPages[0].runs.find((run) => run.text === 'ALEX MORGAN')!;
      expect(Math.abs(name.x + name.width / 2 - preview.pages[0].width / 2)).toBeLessThan(1);
      expect(await page.locator('#budget-percent').textContent()).toBe(`${Math.round(body.budget.fullnessPercent)}%`);
      expect(await page.locator('#status-page-count').textContent()).toBe('Page 1/1');
      await page.locator('[data-tab="tab-source"]').click();
      const downloading = page.waitForEvent('download');
      await page.locator('#btn-download-pdf').click();
      const download = await downloading;
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const pdf = await PDFDocument.load(Buffer.concat(chunks));
      expect(pdf.getPageCount()).toBe(body.budget.pageCount);
    } finally { await page.close(); }
  }, 30000);

  it('keeps the latest preview when an earlier network response arrives late', async () => {
    const page = await browser.newPage();
    let release!: () => void;
    try {
      await openEditor(page);
      let entered!: () => void;
      const held = new Promise<void>((resolve) => { entered = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      let first = true;
      await page.route('**/api/preview', async (route) => {
        const response = await route.fetch();
        if (first) {
          first = false;
          entered();
          await gate;
        }
        await route.fulfill({ response }).catch(() => {});
      });
      await page.locator('[data-tab="tab-sections"]').click();
      await page.locator('#heading-summary').fill('EARLIER SUMMARY');
      await held;
      await page.locator('#heading-summary').fill('LATEST SUMMARY');
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document preview ready');
      release();
      await page.unrouteAll({ behavior: 'wait' });
      expect(await previewText(page)).toContain('LATEST SUMMARY');
      expect(await previewText(page)).not.toContain('EARLIER SUMMARY');
    } finally { release?.(); await page.close(); }
  }, 30000);

  it('marks the budget unavailable when preview measurement fails', async () => {
    const page = await browser.newPage();
    try {
      await openEditor(page);
      await page.route('**/api/preview', (route) => route.fulfill({ status: 500, json: { success: false, error: 'Measurement failed' } }));
      await page.locator('#btn-render-preview').click();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Render error');
      expect(await page.locator('#budget-percent').textContent()).toBe('—');
      expect(await page.locator('#budget-state').textContent()).toContain('unavailable');
    } finally { await page.close(); }
  }, 30000);

  it('clears the budget when a preview request times out', async () => {
    const page = await browser.newPage();
    let release!: () => void;
    try {
      await openEditor(page);
      await page.clock.install();
      const gate = new Promise<void>((resolve) => { release = resolve; });
      await page.route('**/api/preview', async (route) => {
        await gate;
        await route.abort().catch(() => {});
      });
      await page.locator('#btn-render-preview').click();
      await page.clock.fastForward(20_001);
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Preview failed');
      expect(await page.locator('#budget-percent').textContent()).toBe('—');
      expect(await page.locator('#budget-state').textContent()).toContain('unavailable');
    } finally {
      release?.();
      await page.unrouteAll({ behavior: 'wait' });
      await page.close();
    }
  }, 30000);
});
