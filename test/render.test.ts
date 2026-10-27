import { describe, it, expect } from 'vitest';
import { renderResume } from '../src/render';
import resumeFixture from '../fixtures/resume.json';

describe('Template & Render Engine', () => {
  it('renders blank sections safely and structured certificate details', () => {
    const blank = renderResume({ ...resumeFixture, work: [], education: [], skills: [], projects: [], certifications: [] });
    expect(blank).not.toContain('class="section section-experience"');
    expect(blank).not.toContain('class="section section-education"');
    const html = renderResume({ ...resumeFixture, certifications: [{ name: 'Cloud Associate', issuer: 'Example Institute', date: '2025-06' }] },
      { styleConfig: { dateFormat: 'month-name' } });
    expect(html).toContain('Cloud Associate — Example Institute (Jun 2025)');
  });
  it('renders SPM text results without a numeric CGPA or invented values', () => {
    const spm = { ...resumeFixture.education[0], degree: 'Sijil Pelajaran Malaysia (SPM)', level: 'spm',
      grade: { value: 3.5, scale: 4 }, spmResults: { overall: '5A2B1C1D', bahasaMelayu: 'A-' } };
    const resume = { ...resumeFixture, education: [spm] };
    const html = renderResume(resume);
    expect(html).toContain('SPM Results: 5A2B1C1D');
    expect(html).toContain('Bahasa Melayu: A-');
    expect(html).not.toContain('CGPA:');
    const compact = renderResume(resume, { educationConfig: { mode: 'compact' } });
    expect(compact).not.toContain('5A2B1C1D');
    expect(compact).not.toContain('Bahasa Melayu: A-');
    expect(spm.spmResults.overall).toBe('5A2B1C1D');
  });
  it('keeps legacy subjects stored but omits them from every resume mode', () => {
    const resume = { ...resumeFixture, education: [{ ...resumeFixture.education[0], grade: { value: 3.8, scale: 4 }, subjects: [{ name: 'Bahasa Melayu', grade: 'A-' }] }] };
    const detailed = renderResume(resume, { educationConfig: { mode: 'detailed', showSubjects: true } });
    expect(detailed).toContain('CGPA: 3.8 / 4');
    expect(detailed).not.toContain('Bahasa Melayu: A-');
    const compact = renderResume(resume, { educationConfig: { mode: 'compact', showSubjects: true } });
    expect(compact).not.toContain('CGPA:');
    expect(compact).not.toContain('Bahasa Melayu');
    expect(resume.education[0].grade.value).toBe(3.8);
    expect(resume.education[0].subjects[0].grade).toBe('A-');
  });
  it('renders activities and limits academic projects to detailed mode', () => {
    const resume = { ...resumeFixture, education: [{ ...resumeFixture.education[0], activities: ['Robotics Club', 'Peer mentor'], academicProject: { title: 'Campus Scheduler' } }] };
    const balanced = renderResume(resume, { educationConfig: { showAcademicProject: true } });
    expect(balanced).toContain('Activities: Robotics Club; Peer mentor');
    expect(balanced).not.toContain('Campus Scheduler');
    const detailed = renderResume(resume, { educationConfig: { mode: 'detailed', showAcademicProject: true } });
    expect(detailed).toContain('Campus Scheduler');
    expect(detailed).toContain('Activities: Robotics Club; Peer mentor');
  });
  it('escapes academic details and omits missing values', () => {
    const resume = { ...resumeFixture, education: [{ ...resumeFixture.education[0], achievements: ['<script>alert(1)</script>'] }] };
    const html = renderResume(resume);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('CGPA:');
    expect(html).not.toContain('Academic Project:');
  });
  it('protects short compounds while escaping markup and leaving long tokens wrappable', () => {
    const long = 'this-is-an-intentionally-extremely-long-hyphenated-token';
    const html = renderResume({ ...resumeFixture, basics: { ...resumeFixture.basics,
      summary: `CPU-intensive queue-driven ${long} <img src=x onerror=alert(1)> 80–90%`,
    } });
    expect(html).toContain('<span class="text-compound">CPU-intensive</span>');
    expect(html).toContain('<span class="text-compound">queue-driven</span>');
    expect(html).not.toContain(`<span class="text-compound">${long}</span>`);
    expect(html).toContain(` ${long} &lt;img`);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<span class="numeric-range">80–90%</span>');
  });
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
