import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import { PDFDocument } from 'pdf-lib';
import { extractText } from 'unpdf';
import resumeFixture from '../fixtures/resume.json';

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
