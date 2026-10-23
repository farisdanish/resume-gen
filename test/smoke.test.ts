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
import compatibility from '../fixtures/pdf-compatibility.json';
import { extractText } from 'unpdf';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.resolve(ROOT_DIR, 'fixtures/site.html');
const OUT_DIR = path.resolve(ROOT_DIR, 'out');
const SCRATCH_DIR = path.resolve(ROOT_DIR, 'out/test-scratch');

describe('Smoke Test Suite', () => {
  test('SPM text results remain readable in the PDF', async () => {
    const resume = ResumeSchema.parse({ ...resumeFixture, education: [{ ...resumeFixture.education[0],
      level: 'spm', degree: 'Sijil Pelajaran Malaysia (SPM)', grade: undefined,
      spmResults: { overall: '5A2B1C1D', bahasaMelayu: 'A-' } }] });
    const result = await generatePdf({ html: renderResume(resume) });
    expect(result.pageCount).toBe(1);
    const text = (await extractText(new Uint8Array(result.buffer))).text.join(' ');
    expect(text).toContain('5A2B1C1D');
    expect(text).toContain('Bahasa Melayu: A-');
    expect(text).not.toContain('CGPA:');
  }, 60000);
  test('education detail remains readable in compact and detailed PDFs', async () => {
    const resume = ResumeSchema.parse({ ...resumeFixture, education: [{ ...resumeFixture.education[0], grade: { value: 3.8, scale: 4 }, subjects: [{ name: 'Bahasa Melayu', grade: 'A-' }], activities: ['Robotics Club'], academicProject: { title: 'Campus Scheduler' } }] });
    const compact = await generatePdf({ html: renderResume(resume, { educationConfig: { mode: 'compact' } }) });
    expect(compact.pageCount).toBe(1);
    const detailed = await generatePdf({ html: renderResume(resume, { educationConfig: { mode: 'detailed', showSubjects: true, showAcademicProject: true } }) });
    expect(detailed.pageCount).toBeLessThanOrEqual(2);
    const text = (await extractText(new Uint8Array(detailed.buffer))).text.join(' ');
    expect(text).not.toContain('Bahasa Melayu');
    expect(text).toContain('Robotics Club');
    expect(text).toContain('Campus Scheduler');
    expect(text).toContain('3.8');
  }, 60000);
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
    expect(content).toContain('Acme Systems');
    expect(content).not.toMatch(/Faris|Antoni|Datanian/i);
    const resumeContent = fs.readFileSync(path.resolve(ROOT_DIR, 'fixtures/resume.json'), 'utf-8');
    expect(resumeContent).toContain('Alex Morgan');
    expect(resumeContent).not.toMatch(/Faris|Antoni|Datanian/i);
  });

  // SMOKE 2: End-to-End Extraction & 1-Page Regression
  test('SMOKE 2: End-to-End Extraction & 1-Page Regression', async () => {
    // 1. Extract from fixture
    const extraction = await runExtraction({
      source: 'fixture',
      phoneOverride: '+65 9123 4567',
    });

    expect(extraction.data).toBeDefined();
    expect(extraction.data.basics.name).toBe('Alex Morgan');
    expect(extraction.data.basics.contact.phone).toBe('+65 9123 4567');

    // 2. Schema validation
    const parsed = ResumeSchema.safeParse(extraction.data);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // 3. Render HTML
    const html = renderResume(parsed.data);
    expect(html).toContain('Alex Morgan');
    expect(html).toContain('+65 9123 4567');
    expect(html).toContain('@font-face');

    // 4. Generate PDF & enforce strict 1-page budget
    const { buffer, pageCount, isSinglePage } = await generatePdf({ html });

    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(0);
    expect(pageCount).toBe(1);
    expect(isSinglePage).toBe(true);
  }, 30000);

  test('SMOKE 2B: Customized layout remains a strict single-page PDF', async () => {
    const phase9Fixture = {
      ...resumeFixture,
      basics: {
        ...resumeFixture.basics,
        headshot: {
          dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          shape: 'circle' as const,
          position: 'right' as const,
        },
      },
      references: { mode: 'available-on-request' as const },
    };
    const html = renderResume(phase9Fixture, {
      styleConfig: {
        fontPairing: 'modern',
        accentColor: '#1b4332',
        density: 'compact',
        margins: 'tight',
        bodyAlignment: 'left',
        headerAlignment: 'center',
        sectionScale: { experience: 0.9, skills: 0.95, references: 0.9 },
      },
      headings: { EXPERIENCE: 'PROFESSIONAL EXPERIENCE', SKILLS: 'CORE SKILLS' },
      sectionOrder: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'references'],
    });
    const { buffer, pageCount, isSinglePage } = await generatePdf({ html });

    expect(buffer.length).toBeGreaterThan(0);
    expect(pageCount).toBe(1);
    expect(isSinglePage).toBe(true);
  }, 30000);

  // SMOKE 3: Discrete CLI Exit Code Contract
  describe('SMOKE 3: CLI Exit Code Contract', () => {
    const cliScript = path.resolve(ROOT_DIR, 'src/cli.ts');

    test.each(['9', '13', 'large'])('typography-input-validation rejects CLI size %s', async (value) => {
      const result = await execa('npx', ['tsx', cliScript, '--source', 'fixture', '--body-font-size', value], { cwd: ROOT_DIR, reject: false });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--body-font-size');
    });

    test.each(['10', '11', '12'])('exports readable CLI size %s without losing content', async (value) => {
      const output = path.join(SCRATCH_DIR, `readable-${value}.pdf`);
      const result = await execa('npx', ['tsx', cliScript, '--source', 'fixture', '--body-font-size', value, '--out', output], { cwd: ROOT_DIR, reject: false });
      expect(result.exitCode).toBe(0);
      const { inspectPdf } = await import('./helpers/pdf-checks');
      const pdf = await inspectPdf(fs.readFileSync(output));
      expect(pdf.texts.unpdf).toContain('ALEX MORGAN');
      expect(pdf.textPages.flatMap((p) => p.runs).every((run) => run.height >= 9.9)).toBe(true);
    }, 30000);

    test.each([1, 2])('enforces explicit page target %i and supports month-name dates', async (target) => {
      const input = path.join(SCRATCH_DIR, `target-${target}.json`);
      const output = path.join(SCRATCH_DIR, `target-${target}.pdf`);
      fs.writeFileSync(input, JSON.stringify({ ...compatibility, work: Array.from({ length: 20 }, () => compatibility.work[0]) }));
      const result = await execa('npx', ['tsx', cliScript, '--source', input, '--out', output, '--date-format', 'month-name', '--page-target', String(target), '--strict-pages'], { cwd: ROOT_DIR, reject: false });
      expect(result.exitCode).toBe(target === 1 ? 2 : 0);
      if (target === 2) {
        const { text } = await extractText(new Uint8Array(fs.readFileSync(output)), { mergePages: true });
        expect(text).toContain('Dec 2024');
        expect(text).toContain('Project sentinel: reliable production processing.');
      }
    }, 30000);

    test.each([['--page-target', '3'], ['--date-format', 'invalid']])('rejects invalid CLI presentation option %s', async (flag, value) => {
      const result = await execa('npx', ['tsx', cliScript, '--source', 'fixture', flag, value], { cwd: ROOT_DIR, reject: false });
      expect(result.exitCode).toBe(1);
    });

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
