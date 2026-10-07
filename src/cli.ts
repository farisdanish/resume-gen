import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { runExtraction } from './extract';
import { ResumeSchema } from './schema';
import { renderResume } from './render';
import { generatePdf } from './pdf';

export const program = new Command();

program
  .name('resume-gen')
  .description('Headless CLI to compile portfolio data into ATS-compliant PDF resume')
  .version('1.0.0')
  .option('-s, --source <source>', 'Data source: "live", "fixture", or file path', 'live')
  .option('-p, --phone <phone>', 'Phone override string')
  .option('-o, --out <path>', 'Output PDF path', 'out/resume.pdf')
  .option('--strict-pages', 'Exit with code 2 if output exceeds 1 page', false)
  .option('--strict-warnings', 'Exit with code 3 if DOM extraction produces warnings', false);

program.action(async (options) => {
  try {
    const phoneOverride = options.phone || process.env.RESUME_PHONE;

    // 1. Data extraction
    let extraction;
    try {
      extraction = await runExtraction({
        source: options.source,
        phoneOverride,
      });
    } catch (err: any) {
      console.error(`[Error 4] Operational error during extraction: ${err.message}`);
      process.exit(4);
    }

    const { data, warnings } = extraction;

    // 2. Strict warnings check (Exit Code 3)
    if (options.strictWarnings && warnings.length > 0) {
      console.error(`[Error 3] Strict warning check failed (${warnings.length} warnings):`);
      for (const w of warnings) {
        console.error(`  - ${w}`);
      }
      process.exit(3);
    } else if (warnings.length > 0) {
      for (const w of warnings) {
        console.warn(`[Warning] ${w}`);
      }
    }

    // 3. Schema validation (Exit Code 1)
    const parseResult = ResumeSchema.safeParse(data);
    if (!parseResult.success) {
      console.error('[Error 1] Zod schema validation failed:');
      for (const issue of parseResult.error.issues) {
        console.error(`  - ${issue.path.join('.') || 'root'}: ${issue.message}`);
      }
      process.exit(1);
    }

    const validResume = parseResult.data;

    // 4. Render HTML
    let html: string;
    try {
      html = renderResume(validResume);
    } catch (err: any) {
      console.error(`[Error 4] Rendering failed: ${err.message}`);
      process.exit(4);
    }

    // 5. PDF generation
    let pdfResult;
    try {
      pdfResult = await generatePdf({ html });
    } catch (err: any) {
      console.error(`[Error 4] PDF engine failed: ${err.message}`);
      process.exit(4);
    }

    const { buffer, pageCount } = pdfResult;

    // 6. Strict page budget check (Exit Code 2)
    if (options.strictPages && pageCount > 1) {
      console.error(
        `[Error 2] Page budget exceeded: Resume generated ${pageCount} pages, but strict 1-page budget required.`
      );
      process.exit(2);
    }

    // 7. Save output
    const outPath = path.resolve(process.cwd(), options.out);
    try {
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(outPath, buffer);
    } catch (err: any) {
      console.error(`[Error 4] Failed to write output file: ${err.message}`);
      process.exit(4);
    }

    console.log(`Successfully generated resume (${pageCount} page${pageCount > 1 ? 's' : ''}): ${outPath}`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[Error 4] Unexpected error: ${err.message}`);
    process.exit(4);
  }
});

// Auto-run if executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('cli.ts') || 
  process.argv[1].endsWith('cli.js') ||
  process.argv[1].includes('cli')
);

if (isDirectRun) {
  program.parseAsync(process.argv);
}
