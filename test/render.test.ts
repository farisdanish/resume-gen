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
});
