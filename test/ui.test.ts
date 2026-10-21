import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { startServer } from '../src/server';
import type { Server } from 'node:http';
import { PDFDocument } from 'pdf-lib';

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
