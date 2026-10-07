import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { runExtraction } from '../src/extract';
import { ResumeSchema } from '../src/schema';
import { renderResume } from '../src/render';
import { generatePdf } from '../src/pdf';
import resumeFixture from '../fixtures/resume.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.resolve(ROOT_DIR, 'fixtures/site.html');
const OUT_DIR = path.resolve(ROOT_DIR, 'out');
const SCRATCH_DIR = path.resolve(ROOT_DIR, 'out/test-scratch');

describe('Smoke Test Suite', () => {
  beforeAll(() => {
    if (!fs.existsSync(OUT_DIR)) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(SCRATCH_DIR)) {
      fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
    }
  });

  // SMOKE 1: Fixture Sanity Check
  test('SMOKE 1: Fixture Sanity Check', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);

    const stats = fs.statSync(FIXTURE_PATH);
    expect(stats.size).toBeGreaterThan(1000);

    const content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    expect(content).toContain('Datanian');
  });

  // SMOKE 2: End-to-End Extraction & 1-Page Regression
  test('SMOKE 2: End-to-End Extraction & 1-Page Regression', async () => {
    // 1. Extract from fixture
    const extraction = await runExtraction({
      source: 'fixture',
      phoneOverride: '+65 9123 4567',
    });

    expect(extraction.data).toBeDefined();
    expect(extraction.data.basics.name).toBe('Muhd Faris Danish bin Antoni');
    expect(extraction.data.basics.contact.phone).toBe('+65 9123 4567');

    // 2. Schema validation
    const parsed = ResumeSchema.safeParse(extraction.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // 3. Render HTML
    const html = renderResume(parsed.data);
    expect(html).toContain('Muhd Faris Danish bin Antoni');
    expect(html).toContain('+65 9123 4567');
    expect(html).toContain('@font-face');

    // 4. Generate PDF & enforce strict 1-page budget
    const { buffer, pageCount, isSinglePage } = await generatePdf({ html });

    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
    expect(pageCount).toBe(1);
    expect(isSinglePage).toBe(true);
  }, 30000);

  // SMOKE 3: Discrete CLI Exit Code Contract
  describe('SMOKE 3: CLI Exit Code Contract', () => {
    const cliScript = path.resolve(ROOT_DIR, 'src/cli.ts');

    test('Exit Code 0: Successful generation within 1-page budget', async () => {
      const outPath = path.resolve(SCRATCH_DIR, 'smoke-exit-0.pdf');
      const result = await execa(
        'npx',
        ['tsx', cliScript, '--source', 'fixture', '--out', outPath],
        { cwd: ROOT_DIR, reject: false }
      );

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(outPath)).toBe(true);
      expect(fs.statSync(outPath).size).toBeGreaterThan(0);
    }, 30000);

    test('Exit Code 1: Schema validation error on malformed input', async () => {
      const invalidJsonPath = path.resolve(SCRATCH_DIR, 'invalid-resume.json');
      fs.writeFileSync(
        invalidJsonPath,
        JSON.stringify({
          basics: { name: '' }, // violates min(1) and missing required properties
          work: [],             // violates min(1)
        })
      );

      const result = await execa(
        'npx',
        ['tsx', cliScript, '--source', invalidJsonPath],
        { cwd: ROOT_DIR, reject: false }
      );

      expect(result.exitCode).toBe(1);
    }, 15000);

    test('Exit Code 2: Page budget exceeded under --strict-pages', async () => {
      // Create multi-page resume fixture by cloning and duplicating work experience
      const multiPageFixture = JSON.parse(JSON.stringify(resumeFixture));
      const baseWork = multiPageFixture.work[0];
      multiPageFixture.work = [];
      for (let i = 0; i < 15; i++) {
        multiPageFixture.work.push({
          ...baseWork,
          role: `Senior Staff Software Engineer #${i + 1}`,
          company: `Enterprise Tech Corp #${i + 1}`,
          highlights: [
            'Architected distributed microservices handling millions of events per second with high availability.',
            'Scaled infrastructure across multi-region Kubernetes clusters with zero downtime deployment strategies.',
            'Mentored junior engineers and instituted rigorous continuous integration and delivery quality gates.',
            'Led cross-functional initiatives driving significant developer productivity and reducing latency.',
          ],
        });
      }

      const multiPagePath = path.resolve(SCRATCH_DIR, 'multipage-resume.json');
      fs.writeFileSync(multiPagePath, JSON.stringify(multiPageFixture, null, 2));

      const outPath = path.resolve(SCRATCH_DIR, 'overflow.pdf');
      const result = await execa(
        'npx',
        ['tsx', cliScript, '--source', multiPagePath, '--strict-pages', '--out', outPath],
        { cwd: ROOT_DIR, reject: false }
      );

      expect(result.exitCode).toBe(2);
    }, 30000);

    test('Exit Code 3: Unmatched selector warnings under --strict-warnings', async () => {
      const emptyHtmlPath = path.resolve(SCRATCH_DIR, 'empty.html');
      fs.writeFileSync(emptyHtmlPath, '<!DOCTYPE html><html><body><h1>Empty Page</h1></body></html>');

      const result = await execa(
        'npx',
        ['tsx', cliScript, '--source', emptyHtmlPath, '--strict-warnings'],
        { cwd: ROOT_DIR, reject: false }
      );

      expect(result.exitCode).toBe(3);
    }, 15000);

    test('Exit Code 4: Operational error on non-existent source', async () => {
      const result = await execa(
        'npx',
        ['tsx', cliScript, '--source', 'non-existent-source-file.html'],
        { cwd: ROOT_DIR, reject: false }
      );

      expect(result.exitCode).toBe(4);
    }, 15000);
  });
});
