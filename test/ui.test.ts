import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import resumeFixture from '../fixtures/resume.json';
import { inspectPdf } from './helpers/pdf-checks';

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

  async function openEditor(page: Page) {
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
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
    await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
    await page.locator('[data-tab="tab-content"]').click();
    expect(await page.locator('.input-project-description').count()).toBe(2);
  }

  async function downloadedBytes(page: Page, button: string) {
    const downloading = page.waitForEvent('download');
    await page.locator(button).click();
    const stream = await (await downloading).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      expect(await page.locator('#select-date-format').inputValue()).toBe('month-name');
      expect(await page.locator('#select-page-target').inputValue()).toBe('2');
      expect(await page.frameLocator('#preview-frame').locator('.item-meta').first().textContent()).toContain('Mar 2024');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      expect(await page.locator('.input-project-link').first().inputValue()).toBe('https://example.com/project');
      expect(await page.frameLocator('#preview-frame').locator('.project-item').first().textContent()).toContain('PHP, Laravel, PostgreSQL');
      const pdf = await inspectPdf(await downloadedBytes(page, '#btn-download-pdf'));
      expect(pdf.urls).toContain('https://example.com/project');
      expect(pdf.texts.unpdf).toContain('https://example.com/project');
      await page.locator('[data-tab="tab-content"]').click();
      const clearing = page.waitForResponse((res) => res.url().endsWith('/api/preview'));
      await page.locator('.input-project-link').first().fill('');
      await clearing;
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      expect(await page.frameLocator('#preview-frame').locator('.project-link').count()).toBe(0);
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      const frame = page.frameLocator('#preview-frame');
      expect(await frame.locator('.project-desc').first().textContent()).toBe(description);
      expect(await frame.locator('.project-desc').nth(1).textContent()).toBe('Keep this description unchanged.');
      expect(await frame.locator('.project-desc img, .project-desc script').count()).toBe(0);
      expect(Math.round(budget.fullnessPercent)).toBeGreaterThan(oldFill);
      expect(await page.locator('#budget-percent').textContent()).toBe(`${Math.round(budget.fullnessPercent)}%`);
      await page.reload();
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      await page.locator('[data-tab="tab-content"]').click();
      expect(await page.locator('.input-project-description').first().inputValue()).toBe(description);
      expect(await page.locator('.chk-proj-include').first().isChecked()).toBe(false);
      expect(await page.frameLocator('#preview-frame').locator('.project-item').count()).toBe(1);
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      expect(await page.frameLocator('#preview-frame').locator('.project-desc').first().textContent()).toBe(description);
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      expect(await input.getAttribute('aria-invalid')).toBe('false');
      expect(await page.locator('#project-description-error-0').isVisible()).toBe(false);
      expect(await page.frameLocator('#preview-frame').locator('.project-desc').first().textContent()).toBe('Corrected description.');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      const frame = page.frameLocator('#preview-frame');
      expect(await frame.locator('header').evaluate((el) => getComputedStyle(el).textAlign)).toBe('center');
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
      await page.waitForFunction(() => document.getElementById('status-bar-text')?.textContent === 'Document rendered in sandbox');
      release();
      await page.unrouteAll({ behavior: 'wait' });
      expect(await page.frameLocator('#preview-frame').locator('.section-summary h2').textContent()).toBe('LATEST SUMMARY');
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
