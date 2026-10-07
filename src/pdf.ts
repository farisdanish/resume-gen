import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

export interface PdfResult {
  buffer: Buffer;
  pageCount: number;
  isSinglePage: boolean;
}

export async function generatePdf({ html }: { html: string }): Promise<PdfResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    // Eliminate font loading races
    await page.evaluate(() => document.fonts.ready);

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
    };
  } finally {
    await browser.close();
  }
}
