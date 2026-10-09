import { describe, it, expect } from 'vitest';
import { renderResume } from '../src/render';
import resumeFixture from '../fixtures/resume.json';

describe('Template & Render Engine', () => {
  it('compiles HTML with inlined fonts and template sections', () => {
    const html = renderResume(resumeFixture);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(resumeFixture.basics.name);
    expect(html).toContain('ResumeSans');
    expect(html).toContain('ResumeSerif');
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain(resumeFixture.work[0].company);
    expect(html).toContain(resumeFixture.education[0].institution);
  });

  it('applies custom styleConfig overrides for accent colors, fonts, and density', () => {
    const html = renderResume(resumeFixture, {
      styleConfig: {
        fontPairing: 'modern',
        accentColor: '#1b4332',
        density: 'compact',
        margins: 'tight',
      },
    });

    expect(html).toContain('--primary-accent: #1b4332');
    expect(html).toContain("--font-heading: 'ResumeSans'");
    expect(html).toContain('--font-base-size: 8.0pt');
    expect(html).toContain('--page-padding-y: 10mm');
  });

  it('renders custom section headings when provided in options', () => {
    const html = renderResume(resumeFixture, {
      headings: {
        EXPERIENCE: 'PROFESSIONAL EXPERIENCE',
        SKILLS: 'CORE COMPETENCIES',
      },
    });

    expect(html).toContain('PROFESSIONAL EXPERIENCE');
    expect(html).toContain('CORE COMPETENCIES');
  });
});
