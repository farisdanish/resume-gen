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

  it('renders sections in a user-defined order', () => {
    const html = renderResume(resumeFixture, {
      sectionOrder: ['summary', 'skills', 'projects', 'education', 'experience', 'certifications'],
      headings: {
        SUMMARY: 'ORDER SUMMARY',
        SKILLS: 'ORDER SKILLS',
        PROJECTS: 'ORDER PROJECTS',
        EDUCATION: 'ORDER EDUCATION',
        EXPERIENCE: 'ORDER EXPERIENCE',
        CERTIFICATIONS: 'ORDER CERTIFICATIONS',
      },
    });

    const summary = html.indexOf('ORDER SUMMARY');
    const skills = html.indexOf('ORDER SKILLS');
    const projects = html.indexOf('ORDER PROJECTS');
    const education = html.indexOf('ORDER EDUCATION');
    const experience = html.indexOf('ORDER EXPERIENCE');
    const certifications = html.indexOf('ORDER CERTIFICATIONS');

    expect(summary).toBeGreaterThan(-1);
    expect(skills).toBeGreaterThan(summary);
    expect(projects).toBeGreaterThan(skills);
    expect(education).toBeGreaterThan(projects);
    expect(experience).toBeGreaterThan(education);
    expect(certifications).toBeGreaterThan(experience);
  });
});
