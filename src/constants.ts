export const SECTION_HEADINGS = {
  SUMMARY: 'Professional Summary',
  EXPERIENCE: 'Work Experience',
  EDUCATION: 'Education',
  SKILLS: 'Technical Skills',
  PROJECTS: 'Projects',
  CERTIFICATIONS: 'Certifications',
  REFERENCES: 'References',
} as const;

export const SECTION_KEYS = [
  'summary',
  'experience',
  'education',
  'skills',
  'certifications',
  'projects',
  'references',
] as const;

export const DEFAULT_SECTION_ORDER = [...SECTION_KEYS];
