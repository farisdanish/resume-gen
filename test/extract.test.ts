import { describe, it, expect } from 'vitest';
import { runExtraction } from '../src/extract';
import { ResumeSchema } from '../src/schema';

describe('DOM Extractor against Fixture', () => {
  it('extracts structured data matching schema from fixture', async () => {
    const { data, warnings } = await runExtraction({
      source: 'fixture',
      phoneOverride: '+60-12-345-6789',
    });

    expect(data.basics.name).toContain('Faris');
    expect(data.basics.contact.phone).toBe('+60-12-345-6789');
    expect(data.basics.contact.email).toContain('@');
    expect(data.work.length).toBeGreaterThanOrEqual(1);
    expect(data.work[0].company).toContain('Datanian');
    expect(data.education.length).toBeGreaterThanOrEqual(1);
    expect(data.skills.length).toBeGreaterThanOrEqual(1);

    const parseResult = ResumeSchema.safeParse(data);
    expect(parseResult.success).toBe(true);
  });

  it('handles live / URL source', async () => {
    const { data } = await runExtraction({
      source: 'https://farisantoni.com',
      phoneOverride: '+65 9123 4567',
    });

    expect(data.basics.name).toContain('Faris');
    expect(data.basics.contact.phone).toBe('+65 9123 4567');
    const parseResult = ResumeSchema.safeParse(data);
    expect(parseResult.success).toBe(true);
  }, 15000);
});
