import { describe, test, expect } from 'vitest';
import { extractText } from 'unpdf';
import { SECTION_HEADINGS } from '../src/constants';
import { renderResume } from '../src/render';
import { generatePdf } from '../src/pdf';
import resumeFixture from '../fixtures/resume.json';

describe('ATS Validation Test', () => {
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
});
