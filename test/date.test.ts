import { describe, it, expect } from 'vitest';
import { parseDateRange, parseSingleDate } from '../src/date';

describe('Date Parser: Table-Driven Tests', () => {
  it('Baseline Site Format: "December 2024 – Present"', () => {
    expect(parseDateRange('December 2024 – Present')).toEqual({
      start: '2024-12',
      end: null,
    });
  });

  it('Closed Date Range: "March 2024 – August 2024"', () => {
    expect(parseDateRange('March 2024 – August 2024')).toEqual({
      start: '2024-03',
      end: '2024-08',
    });
  });

  it('Bare Year Range: "2020 – 2024"', () => {
    expect(parseDateRange('2020 – 2024')).toEqual({
      start: '2020',
      end: '2024',
    });
  });

  it('Single Graduation Year: "2024"', () => {
    expect(parseDateRange('2024')).toEqual({
      start: undefined,
      end: '2024',
    });
  });

  it('Hyphen Without Spaces: "December 2024-Present"', () => {
    expect(parseDateRange('December 2024-Present')).toEqual({
      start: '2024-12',
      end: null,
    });
  });

  it('Em-Dash With Odd Spacing: "March 2024 — August 2024"', () => {
    expect(parseDateRange('March 2024 — August 2024')).toEqual({
      start: '2024-03',
      end: '2024-08',
    });
  });

  it('Abbreviated Month: "Dec 2024 – Present"', () => {
    expect(parseDateRange('Dec 2024 – Present')).toEqual({
      start: '2024-12',
      end: null,
    });
  });

  it('September Variant: "Sept 2023 – Jan 2024"', () => {
    expect(parseDateRange('Sept 2023 – Jan 2024')).toEqual({
      start: '2023-09',
      end: '2024-01',
    });
  });

  it('Case Insensitivity: "december 2024 – present"', () => {
    expect(parseDateRange('december 2024 – present')).toEqual({
      start: '2024-12',
      end: null,
    });
  });

  it('Active Keyword: Current: "2023 – Current"', () => {
    expect(parseDateRange('2023 – Current')).toEqual({
      start: '2023',
      end: null,
    });
  });

  it('Active Keyword: Now: "2024 – Now"', () => {
    expect(parseDateRange('2024 – Now')).toEqual({
      start: '2024',
      end: null,
    });
  });

  it('Whitespace Padding: " December 2024 – Present "', () => {
    expect(parseDateRange(' December 2024 – Present ')).toEqual({
      start: '2024-12',
      end: null,
    });
  });

  it('Ongoing Education: "2022 – Present"', () => {
    expect(parseDateRange('2022 – Present')).toEqual({
      start: '2022',
      end: null,
    });
  });

  it('Invalid Month Rejection: "2024-13", "Mon 2024 – Present"', () => {
    expect(() => parseSingleDate('2024-13')).toThrow();
    expect(() => parseDateRange('Mon 2024 – Present')).toThrow();
  });
});
