import { describe, expect, test } from 'vitest';
import { SectionOrderSchema } from '../src/schema';
import { DEFAULT_SECTION_ORDER } from '../src/constants';

describe('SectionOrderSchema', () => {
  test('accepts the canonical and reordered complete section sets', () => {
    expect(SectionOrderSchema.safeParse(DEFAULT_SECTION_ORDER).success).toBe(true);
    expect(SectionOrderSchema.safeParse([
      'summary', 'skills', 'projects', 'education', 'experience', 'certifications',
    ]).success).toBe(true);
  });

  test.each([
    ['missing section', ['summary', 'experience']],
    ['duplicate section', ['summary', 'summary', 'education', 'skills', 'certifications', 'projects']],
    ['unknown section', ['summary', 'experience', 'education', 'skills', 'certifications', 'references']],
  ])('rejects %s', (_label, order) => {
    expect(SectionOrderSchema.safeParse(order).success).toBe(false);
  });
});
