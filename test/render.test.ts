import { describe, it, expect } from 'vitest';
import { renderResume } from '../src/render';
import resumeFixture from '../fixtures/resume.json';

describe('Template & Render Engine', () => {
  it('keeps percentage ranges intact without interpreting description markup', () => {
    const html = renderResume({ ...resumeFixture, basics: { ...resumeFixture.basics,
      summary: 'Improved 80–90% and 80-90% <img src=x onerror=alert(1)>',
    } });
    expect(html).toContain('<span class="numeric-range">80–90%</span>');
    expect(html).toContain('<span class="numeric-range">80-90%</span>');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
  });
  it('compiles HTML with inlined fonts and template sections', () => {
    const html = renderResume(resumeFixture);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(resumeFixture.basics.name);
    expect(html).toContain('ResumeSans');
    expect(html).toContain('ResumeSerif');
    expect(html).toContain('data:font/ttf;base64,');
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

  it('renders sections in a user-defined order', () => {
    const resumeWithReferences = {
      ...resumeFixture,
      references: { mode: 'available-on-request' as const },
    };
    const html = renderResume(resumeWithReferences, {
      sectionOrder: ['summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'references'],
      headings: {
        SUMMARY: 'ORDER SUMMARY',
        SKILLS: 'ORDER SKILLS',
        PROJECTS: 'ORDER PROJECTS',
        EDUCATION: 'ORDER EDUCATION',
        EXPERIENCE: 'ORDER EXPERIENCE',
        CERTIFICATIONS: 'ORDER CERTIFICATIONS',
        REFERENCES: 'ORDER REFERENCES',
      },
    });

    const summary = html.indexOf('ORDER SUMMARY');
    const skills = html.indexOf('ORDER SKILLS');
    const projects = html.indexOf('ORDER PROJECTS');
    const education = html.indexOf('ORDER EDUCATION');
    const experience = html.indexOf('ORDER EXPERIENCE');
    const certifications = html.indexOf('ORDER CERTIFICATIONS');
    const references = html.indexOf('ORDER REFERENCES');

    expect(summary).toBeGreaterThan(-1);
    expect(skills).toBeGreaterThan(summary);
    expect(projects).toBeGreaterThan(skills);
    expect(education).toBeGreaterThan(projects);
    expect(experience).toBeGreaterThan(education);
    expect(certifications).toBeGreaterThan(experience);
    expect(references).toBeGreaterThan(certifications);
  });

  it('renders Phase 9 alignment, scales, references, and a safe headshot', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    const html = renderResume({
      ...resumeFixture,
      basics: {
        ...resumeFixture.basics,
        headshot: { dataUri, shape: 'rounded', position: 'right' },
      },
      references: {
        mode: 'entries',
        entries: [{ name: 'Jordan Lee', title: 'Engineering Director', email: 'jordan.lee@example.com' }],
      },
    }, {
      styleConfig: {
        bodyAlignment: 'left',
        headerAlignment: 'center',
        sectionScale: { experience: 0.9, references: 1.1 },
      },
    });

    expect(html).toContain('--body-align: left');
    expect(html).toContain('--header-align: center');
    expect(html).toContain('--scale-experience: 0.9');
    expect(html).toContain('--scale-references: 1.1');
    expect(html).toContain('headshot-rounded');
    expect(html).toContain('headshot-right');
    expect(html).toContain('data:image/png;base64');
    expect(html).toContain('Jordan Lee');
    expect(html).toContain('jordan.lee@example.com');
  });
});
