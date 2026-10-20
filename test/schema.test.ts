import { describe, expect, test } from 'vitest';
import {
  HeadshotSchema,
  ReferencesConfigSchema,
  SectionOrderSchema,
  StyleConfigSchema,
} from '../src/schema';
import { DEFAULT_SECTION_ORDER } from '../src/constants';

describe('SectionOrderSchema', () => {
  test('accepts the canonical and reordered complete section sets', () => {
    expect(SectionOrderSchema.safeParse(DEFAULT_SECTION_ORDER).success).toBe(true);
    expect(SectionOrderSchema.safeParse([
      'summary', 'skills', 'projects', 'education', 'experience', 'certifications', 'references',
    ]).success).toBe(true);
  });

  test.each([
    ['missing section', ['summary', 'experience']],
    ['duplicate section', ['summary', 'summary', 'education', 'skills', 'certifications', 'projects', 'references']],
    ['unknown section', ['summary', 'experience', 'education', 'skills', 'certifications', 'references', 'portfolio']],
  ])('rejects %s', (_label, order) => {
    expect(SectionOrderSchema.safeParse(order).success).toBe(false);
  });
});

describe('Phase 9 schemas', () => {
  test('accepts bounded typography and alignment settings', () => {
    const result = StyleConfigSchema.safeParse({
      bodyAlignment: 'left',
      headerAlignment: 'center',
      sectionScale: { summary: 0.85, references: 1.15 },
    });
    expect(result.success).toBe(true);
  });

  test.each([0.8, 0.87, 1.2])('rejects invalid section scale %s', (scale) => {
    expect(StyleConfigSchema.safeParse({ sectionScale: { experience: scale } }).success).toBe(false);
  });

  test('validates both reference modes and useful referee details', () => {
    expect(ReferencesConfigSchema.safeParse({ mode: 'available-on-request' }).success).toBe(true);
    expect(ReferencesConfigSchema.safeParse({
      mode: 'entries',
      entries: [{ name: 'Jordan Lee', email: 'jordan.lee@example.com' }],
    }).success).toBe(true);
    expect(ReferencesConfigSchema.safeParse({
      mode: 'entries', entries: [{ name: 'Jordan Lee' }],
    }).success).toBe(false);
  });

  test('allows raster data URIs and rejects SVG or remote headshots', () => {
    const raster = {
      dataUri: 'data:image/png;base64,iVBORw0KGgo=',
      shape: 'circle',
      position: 'left',
    };
    expect(HeadshotSchema.safeParse(raster).success).toBe(true);
    expect(HeadshotSchema.safeParse({ ...raster, dataUri: 'https://example.com/photo.png' }).success).toBe(false);
    expect(HeadshotSchema.safeParse({ ...raster, dataUri: 'data:image/svg+xml;base64,PHN2Zz4=' }).success).toBe(false);
    expect(HeadshotSchema.safeParse({ ...raster, dataUri: 'data:image/png;base64,abc' }).success).toBe(false);
  });
});
