export interface ParsedDateRange {
  start?: string;
  end: string | null;
}

const MONTH_MAP: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sept: '09',
  sep: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
};

export function parseSingleDate(token: string): string {
  const trimmed = token.trim();
  // Bare year: "2024"
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  // ISO: "2024-12"
  const isoMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed);
  if (isoMatch) return trimmed;

  // Month Year: "December 2024", "Dec 2024", "Sept 2023"
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2) {
    const month = MONTH_MAP[parts[0].toLowerCase()];
    const year = parts[1];
    if (month && /^\d{4}$/.test(year)) {
      return `${year}-${month}`;
    }
  }
  throw new Error(`Unparseable date token: "${token}"`);
}

export function parseDateRange(raw: string): ParsedDateRange {
  const cleaned = raw.trim();
  // Replace en-dash (\u2013) and em-dash (\u2014) with hyphen
  // Split only on hyphens surrounded by spaces or separating word boundaries
  const normalized = cleaned
    .replace(/[\u2013\u2014]/g, ' - ')
    .replace(/([a-zA-Z\d])\s*-\s*([a-zA-Z\d])/g, '$1 - $2');

  const parts = normalized.split(/\s+-\s+/).map((s) => s.trim());

  if (parts.length === 1) {
    return { end: parseSingleDate(parts[0]) };
  }

  const start = parseSingleDate(parts[0]);
  const endToken = parts[1].toLowerCase();
  const end = ['present', 'current', 'now'].includes(endToken) ? null : parseSingleDate(parts[1]);

  return { start, end };
}
