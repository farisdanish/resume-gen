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
        let printMargins = 0;
        {
          // Resolve repeated @page margins in physical units through the layout engine.
          const rules = Array.from(document.styleSheets).flatMap((sheet) => Array.from(sheet.cssRules));
          const pageRule = rules.filter((rule): rule is CSSPageRule => rule instanceof CSSPageRule).at(-1);
          const measure = document.createElement('div');
          measure.style.position = 'absolute';
          measure.style.height = pageRule?.style.marginTop || '0px';
          document.body.append(measure);
          const top = measure.getBoundingClientRect().height;
          measure.style.height = pageRule?.style.marginBottom || '0px';
          printMargins = top + measure.getBoundingClientRect().height;
          measure.remove();
        }
        const usableHeight = 297 * 96 / 25.4 - paddingTop - paddingBottom - printMargins;
        // Avoid moving an entry taller than a page onto an otherwise empty next page.
        // Short entries remain intact; oversized entries may use the remaining space.
        for (const item of document.querySelectorAll('.experience-item, .project-item, .education-item, .highlight-list li')) {
          item.classList.toggle('allow-page-split', item.getBoundingClientRect().height > usableHeight);
        }
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
