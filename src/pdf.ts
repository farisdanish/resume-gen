import { chromium, type Browser } from 'playwright';
import { PDFDocument } from 'pdf-lib';

export interface PdfResult {
  buffer: Buffer;
  pageCount: number;
  isSinglePage: boolean;
  layout: {
    contentHeight: number;
    usableHeight: number;
    fullnessPercent: number;
  };
}

export async function generatePdf({ html }: { html: string }): Promise<PdfResult> {
  let browser: Browser | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error('PDF layout measurement timed out after 15 seconds'));
      void browser?.close().catch(() => {});
    }, 15_000);
  });
  const operation = (async () => {
    browser = await chromium.launch({
      headless: true,
      timeout: 15_000,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      if (expired) throw new Error('PDF layout measurement timed out');
      const page = await browser.newPage();
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });

      // Eliminate font loading races
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
      });

      // Measure the continuous layout before print pagination fragments it.
      const layout = await page.evaluate(() => {
        const container = document.querySelector('.resume-page') || document.body;
        const style = getComputedStyle(container);
        const paddingTop = parseFloat(style.paddingTop) || 0;
        const paddingBottom = parseFloat(style.paddingBottom) || 0;
        const contentHeight = Math.max(0, container.getBoundingClientRect().height - paddingTop - paddingBottom);
        const usableHeight = 297 * 96 / 25.4 - paddingTop - paddingBottom;
        return { contentHeight, usableHeight, fullnessPercent: contentHeight / usableHeight * 100 };
      });

      const pdfUint8 = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
      });

      const buffer = Buffer.from(pdfUint8);
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();

      return {
        buffer,
        pageCount,
        isSinglePage: pageCount === 1,
        layout,
      };
    } finally {
      await browser.close();
    }
  })();
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
