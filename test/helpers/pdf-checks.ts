import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractText } from 'unpdf';
import { PDFDocument, PDFName, PDFDict, PDFString, PDFHexString } from 'pdf-lib';

export async function inspectPdf(buffer: Buffer) {
  const dir = await mkdtemp(path.join(tmpdir(), 'resume-pdf-'));
  try {
    const file = path.join(dir, 'resume.pdf');
    await writeFile(file, buffer);
    let poppler: string;
    try {
      const result = await promisify(execFile)('pdftotext', ['-enc', 'UTF-8', file, '-'], {
        timeout: 10_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
      });
      poppler = result.stdout;
    } catch (error) {
      throw new Error('Independent PDF extraction failed. Install Poppler (pdftotext) and retry.', { cause: error });
    }
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const pdf = await PDFDocument.load(buffer);
    const urls: string[] = [];
    for (const page of pdf.getPages()) {
      for (const ref of page.node.Annots()?.asArray() || []) {
        const annotation = pdf.context.lookup(ref, PDFDict);
        const action = annotation.lookupMaybe(PDFName.of('A'), PDFDict);
        const uri = action?.get(PDFName.of('URI'));
        if (uri instanceof PDFString || uri instanceof PDFHexString) urls.push(uri.decodeText());
      }
    }
    return { texts: { unpdf: text, poppler }, urls, pages: pdf.getPages().map((page) => page.getSize()) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
