import { describe, test, expect } from 'vitest';
import { extractText } from 'unpdf';
import { SECTION_HEADINGS } from '../src/constants';
import { renderResume } from '../src/render';
import { generatePdf } from '../src/pdf';
import resumeFixture from '../fixtures/resume.json';
import compatibility from '../fixtures/pdf-compatibility.json';
import { inspectPdf } from './helpers/pdf-checks';

const compatibilityCases = (['modern', 'editorial', 'serif'] as const).flatMap((fontPairing) =>
  [false, true].flatMap((photo) => (['left', 'justify'] as const).map((bodyAlignment) => ({ fontPairing, photo, bodyAlignment })))
);

describe('ATS Validation Test', () => {
  // Catches contact rows becoming interleaved in default Poppler extraction.
  test.each([undefined, 'left', 'right'] as const)('contact-order-extraction preserves identity before links, photo=%s', async (position) => {
    const resume = structuredClone(compatibility);
    if (position) Object.assign(resume.basics, { headshot: {
      dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', shape: 'circle', position,
    } });
    const { buffer } = await generatePdf({ html: renderResume(resume, { styleConfig: { headerAlignment: 'center' } }) });
    const result = await inspectPdf(buffer);
    for (const raw of Object.values(result.texts)) {
      const header = raw.slice(0, raw.indexOf('SUMMARY')).replace(/\s+/g, ' ');
      const tokens = ['alex.morgan@example.com', '+60 10 1234567', 'Seattle, WA', 'GitHub', 'LinkedIn', 'Website'];
      const positions = tokens.map((token) => header.indexOf(token));
      expect(positions.every((value) => value >= 0)).toBe(true);
      positions.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(positions[index]));
    }
  }, 30000);
  // Catches inserted word hyphens and lost source hyphens at PDF line boundaries.
  test('word-boundary-extraction preserves authored words in narrow prose', async () => {
    const resume = structuredClone(compatibility);
    const prose = 'Backend remote CPU-intensive queue-driven processing. '.repeat(6);
    resume.basics.summary = prose;
    resume.work[0].highlights = [prose];
    resume.projects[0].description = prose;
    const html = renderResume(resume).replace('</head>', '<style>.summary-text,.highlight-list li,.project-desc{width:115px}</style></head>');
    const { buffer } = await generatePdf({ html });
    const result = await inspectPdf(buffer);
    for (const raw of Object.values(result.texts)) {
      for (const [start, end] of [['SUMMARY', 'EXPERIENCE'], ['EXPERIENCE', 'EDUCATION'], ['PROJECTS', 'sentinel-never-present']]) {
        const section = raw.slice(raw.indexOf(start), end === 'sentinel-never-present' ? undefined : raw.indexOf(end));
        for (const word of ['remote', 'CPU-intensive', 'queue-driven']) expect(section.split(word).length - 1, word).toBe(6);
        expect(section).not.toContain('re‐');
      }
    }
  }, 30000);
  test.each([0.85, 1.15])('retains scaled text on every page at section scale %s', async (scale) => {
    const resume = structuredClone(compatibility);
    resume.work = Array.from({ length: 32 }, (_, i) => ({ ...compatibility.work[0], company: `Employer ${i + 1}` }));
    const { buffer, pageCount } = await generatePdf({ html: renderResume(resume, {
      styleConfig: { density: scale < 1 ? 'compact' : 'spacious', sectionScale: { summary: scale, experience: scale } },
    }) });
    expect(pageCount).toBeGreaterThan(1);
    const result = await inspectPdf(buffer);
    for (const text of Object.values(result.texts)) {
      expect(text).not.toMatch(/[\uE000-\uF8FF\uFFFD]/);
      expect(text).toContain('Employer 32');
      expect(text).toContain('Project sentinel: reliable production processing.');
      expect(text).toContain('2024-12');
    }
  }, 30000);
  test.each(compatibilityCases)('preserves semantic text: $fontPairing photo=$photo $bodyAlignment', async ({ fontPairing, photo, bodyAlignment }) => {
    const resume = structuredClone(compatibility);
    if (photo) Object.assign(resume.basics, { headshot: {
      dataUri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', shape: 'circle', position: 'right',
    } });
    const { buffer } = await generatePdf({ html: renderResume(resume, { styleConfig: { fontPairing, bodyAlignment } }) });
    const result = await inspectPdf(buffer);
    for (const raw of Object.values(result.texts)) {
      const text = raw.replace(/\r\n/g, '\n').replace(/\n/g, ' ');
      expect(text).not.toMatch(/[\uE000-\uF8FF\uFFFD]/);
      expect(text.slice(0, text.indexOf('SUMMARY'))).toContain('Software Engineer');
      const summary = text.slice(text.indexOf('SUMMARY'), text.indexOf('EXPERIENCE'));
      for (const phrase of ['Backend Software Engineer', 'production Laravel', 'MongoDB', 'PostgreSQL', 'Kota Kinabalu', '80–90%', '80-90%', 'PHP↔Python (interop)']) expect(summary).toContain(phrase);
      expect(text).toContain('+60 10 1234567');
      const alpha = text.indexOf('Alpha Systems');
      const beta = text.indexOf('Beta Labs');
      expect(alpha).toBeGreaterThan(0);
      expect(text.indexOf('Platform Engineer')).toBeGreaterThan(alpha);
      expect(text.slice(alpha, beta)).toContain('2024-12');
      expect(text.slice(beta, text.indexOf('EDUCATION'))).toContain('2023-03');
      expect(text).toContain('Project sentinel: reliable production processing.');
    }
    for (const page of result.pages) {
      expect(page.width).toBeCloseTo(595, 0);
      expect(page.height).toBeCloseTo(842, 0);
    }
    expect(result.urls).toContain('https://github.com/alexmorgan-example');
  }, 30000);
  test('ATS: Verifies text stream order and ligature retention', async () => {
    const html = renderResume(resumeFixture as any);
    const { buffer, pageCount } = await generatePdf({ html });

    expect(pageCount).toBe(1);

    // unpdf returns string when mergePages: true
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const normalized = text.trim();

    // 1. Candidate name check (case-insensitive)
    expect(normalized.toUpperCase().startsWith(resumeFixture.basics.name.toUpperCase())).toBe(true);

    // 2. Sequential headings check (case-insensitive due to CSS text-transform: uppercase)
    const upperText = normalized.toUpperCase();
    const pSum = upperText.indexOf(SECTION_HEADINGS.SUMMARY.toUpperCase());
    const pExp = upperText.indexOf(SECTION_HEADINGS.EXPERIENCE.toUpperCase());
    const pEdu = upperText.indexOf(SECTION_HEADINGS.EDUCATION.toUpperCase());
    const pSki = upperText.indexOf(SECTION_HEADINGS.SKILLS.toUpperCase());

    expect(pSum).toBeGreaterThan(-1);
    expect(pExp).toBeGreaterThan(pSum);
    expect(pEdu).toBeGreaterThan(pExp);
    expect(pSki).toBeGreaterThan(pEdu);

    // 3. Dynamically derived ligature checks from fixture
    const ligatureWords = resumeFixture.work
      .flatMap((w: any) => w.highlights)
      .flatMap((h: string) => h.split(/\s+/))
      .filter((word: string) => /\w*(fi|fl|ff)\w*/i.test(word))
      .map((word: string) => word.replace(/[^\w]/g, ''))
      .filter((word: string) => word.length > 0);

    for (const word of ligatureWords) {
      expect(normalized).toContain(word);
    }
  }, 30000);

  test('ATS: Preserves custom headings and requested section order', async () => {
    const headings = {
      SUMMARY: 'CAREER PROFILE',
      SKILLS: 'CORE COMPETENCIES',
      PROJECTS: 'SELECTED PROJECTS',
      EDUCATION: 'ACADEMIC BACKGROUND',
      EXPERIENCE: 'PROFESSIONAL EXPERIENCE',
      CERTIFICATIONS: 'CREDENTIALS',
      REFERENCES: 'REFERENCES',
    };
    const order = ['summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'references'] as const;
    const resumeWithReferences = {
      ...resumeFixture,
      references: {
        mode: 'entries' as const,
        entries: [{
          name: 'Jordan Lee',
          title: 'Engineering Director',
          organization: 'Example Industries',
          email: 'jordan.lee@example.com',
          phone: '+1-555-0101',
        }],
      },
    };
    const html = renderResume(resumeWithReferences, { headings, sectionOrder: [...order] });
    const { buffer, pageCount } = await generatePdf({ html });
    expect(pageCount).toBe(1);

    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    const upperText = text.toUpperCase();
    const positions = order.map((key) => upperText.indexOf({
      summary: headings.SUMMARY,
      skills: headings.SKILLS,
      projects: headings.PROJECTS,
      education: headings.EDUCATION,
      experience: headings.EXPERIENCE,
      certifications: headings.CERTIFICATIONS,
      references: headings.REFERENCES,
    }[key]));

    positions.forEach((position) => expect(position).toBeGreaterThan(-1));
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(positions[index - 1]);
    }
    expect(text.replace(/\s+/g, '')).toContain('JordanLee');
    expect(text).toContain('jordan.lee@example.com');
  }, 30000);
});
