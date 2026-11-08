export const SECTION_HEADINGS = {
  SUMMARY: 'Professional Summary',
  EXPERIENCE: 'Work Experience',
  EDUCATION: 'Education',
  SKILLS: 'Technical Skills',
  PROJECTS: 'Projects',
  CERTIFICATIONS: 'Certifications',
  REFERENCES: 'References',
} as const;

export const SECTION_HEADINGS_MS = {
  SUMMARY: 'Ringkasan Profesional',
  EXPERIENCE: 'Pengalaman Kerja',
  EDUCATION: 'Pendidikan',
  SKILLS: 'Kemahiran Teknikal',
  PROJECTS: 'Projek',
  CERTIFICATIONS: 'Persijilan',
  REFERENCES: 'Rujukan',
} as const;

export const TEMPLATE_LABELS = {
  en: {
    present: 'Present',
    activities: 'Activities:',
    academicProject: 'Academic Project:',
    cgpa: 'CGPA:',
    spmResults: 'SPM Results:',
    bahasaMelayu: 'Bahasa Melayu:',
    referencesAvailable: 'References available upon request.',
  },
  ms: {
    present: 'Kini',
    activities: 'Aktiviti:',
    academicProject: 'Projek Akademik:',
    cgpa: 'PNGK:',
    spmResults: 'Keputusan SPM:',
    bahasaMelayu: 'Bahasa Melayu:',
    referencesAvailable: 'Rujukan disediakan atas permintaan.',
  },
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
