import { z } from 'zod';
import { SECTION_KEYS } from './constants';

export const SectionKeySchema = z.enum(SECTION_KEYS);
export const PageTargetSchema = z.union([z.literal(1), z.literal(2)]).default(1);

// Tightly scoped: "YYYY" or "YYYY-MM" with valid calendar months 01-12
export const DatePointSchema = z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, {
  message: 'Date must be YYYY or YYYY-MM with a valid calendar month (01-12)',
});

// Converts "YYYY" or "YYYY-MM" into a month-index for numerical comparison
export function toMonthIndex(d: string, fill: '01' | '12'): number {
  const [yearStr, monthStr = fill] = d.split('-');
  return Number.parseInt(yearStr, 10) * 12 + Number.parseInt(monthStr, 10);
}

export const ContactInfoSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(), // Injected via CLI flag, RESUME_PHONE env, or UI input
  location: z.string().min(1),
  github: z.string().url().optional(),
  linkedin: z.string().url().optional(),
  website: z.string().url().optional(),
});

export const WorkExperienceSchema = z
  .object({
    role: z.string().min(1),
    company: z.string().min(1),
    location: z.string().optional(),
    start: DatePointSchema,          // Required for work experience
    end: DatePointSchema.nullable(), // null = "Present"
    highlights: z.array(z.string().min(1)).min(1),
  })
  .refine((data) => !data.end || toMonthIndex(data.start, '01') <= toMonthIndex(data.end, '12'), {
    message: 'Start date must be before or equal to end date',
    path: ['end'],
  });

export const EducationDisplayConfigSchema = z.object({
  mode: z.enum(['compact', 'balanced', 'detailed']).default('balanced'),
  showGrade: z.boolean().default(true),
  showSpecialization: z.boolean().default(true),
  showAcademicProject: z.boolean().default(false),
  showAchievements: z.boolean().default(true),
  showSubjects: z.boolean().default(false),
  showDates: z.boolean().default(true),
}).default({ mode: 'balanced', showGrade: true, showSpecialization: true, showAcademicProject: false, showAchievements: true, showSubjects: false, showDates: true });
export type EducationDisplayConfig = z.infer<typeof EducationDisplayConfigSchema>;

export const EducationSchema = z
  .object({
    id: z.string().min(1),
    institution: z.string().min(1),
    degree: z.string().min(1),
    start: DatePointSchema.optional(), // Optional: allows lone graduation dates ("2024")
    end: DatePointSchema.nullable(),   // null = "Present" (ongoing studies)
    type: z.string().optional(),
    level: z.enum(['phd', 'masters', 'bachelor', 'diploma', 'certificate', 'spm', 'other']).optional(),
    specialization: z.string().min(1).optional(),
    grade: z.object({ value: z.number().min(0), scale: z.number().positive(), label: z.string().min(1).optional() })
      .refine((grade) => grade.value <= grade.scale, { message: 'Grade cannot exceed scale', path: ['value'] }).optional(),
    achievements: z.array(z.string().min(1)).default([]),
    academicProject: z.object({ title: z.string().min(1), description: z.string().min(1).optional() }).optional(),
    subjects: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), grade: z.string().min(1).optional() }))
      .refine((subjects) => new Set(subjects.map((subject) => subject.id)).size === subjects.length, 'Subject IDs must be unique').default([]),
  })
  .refine(
    (data) => !data.start || !data.end || toMonthIndex(data.start, '01') <= toMonthIndex(data.end, '12'),
    {
      message: 'Start date must be before or equal to end date',
      path: ['end'],
    }
  );

export const SkillCategorySchema = z.object({
  category: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
});

export const ProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  stack: z.array(z.string()).default([]),
  link: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Use an absolute HTTP or HTTPS URL').optional(),
});

export const ReferenceSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    organization: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(3).optional(),
  })
  .refine((reference) => Boolean(
    reference.title || reference.organization || reference.email || reference.phone
  ), {
    message: 'Reference must include at least one detail beyond the name',
  });

export const ReferencesConfigSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('available-on-request') }),
  z.object({ mode: z.literal('entries'), entries: z.array(ReferenceSchema).min(1) }),
]);

export const HeadshotSchema = z.object({
  dataUri: z
    .string()
    .max(700_000, 'Headshot must be smaller than 700 KB when encoded')
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, {
      message: 'Headshot must be a Base64 PNG, JPEG, or WebP data URI',
    })
    .refine((dataUri) => dataUri.slice(dataUri.indexOf(',') + 1).length % 4 === 0, {
      message: 'Headshot contains malformed Base64 data',
    }),
  shape: z.enum(['circle', 'rounded']),
  position: z.enum(['left', 'right']),
});

export function normalizeEducationInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).education)) return input;
  const resume = input as any;
  const used = new Set<string>();
  return { ...resume, education: resume.education.map((entry: any, index: number) => {
    if (!entry || typeof entry !== 'object') return entry;
    const seed = `${entry.institution || ''}|${entry.degree || ''}|${entry.start || ''}|${entry.end || ''}|${index}`;
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const base = entry.id ?? `edu-${(hash >>> 0).toString(36)}`;
    let id = base;
    if (entry.id === undefined) for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
    used.add(id);
    return { ...entry, id, subjects: Array.isArray(entry.subjects) ? entry.subjects.map((subject: any, subjectIndex: number) =>
      subject && typeof subject === 'object' ? { ...subject, id: subject.id ?? `${id}-subject-${subjectIndex + 1}` } : subject) : entry.subjects };
  }) };
}

export const ResumeSchema = z.preprocess(normalizeEducationInput, z.object({
  basics: z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    contact: ContactInfoSchema,
    headshot: HeadshotSchema.optional(),
  }),
  work: z.array(WorkExperienceSchema).min(1),
  education: z.array(EducationSchema).min(1).refine((items) => new Set(items.map((item) => item.id)).size === items.length, 'Education IDs must be unique'),
  skills: z.array(SkillCategorySchema).min(1),
  certifications: z.array(z.string()).default([]),
  projects: z.array(ProjectSchema).default([]),
  references: ReferencesConfigSchema.optional(),
}));

export type Resume = z.infer<typeof ResumeSchema>;

export const StyleConfigSchema = z
  .object({
    fontPairing: z.enum(['modern', 'editorial', 'serif']).default('editorial'),
    bodyFontSize: z.union([z.literal(10), z.literal(11), z.literal(12)]).optional(),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2b6cb0'),
    density: z.enum(['compact', 'standard', 'spacious']).default('standard'),
    margins: z.enum(['tight', 'standard', 'spacious']).default('standard'),
    bodyAlignment: z.enum(['left', 'justify']).default('justify'),
    headerAlignment: z.enum(['left', 'center']).default('left'),
    dateFormat: z.enum(['iso', 'month-name']).default('iso'),
    sectionScale: z
      .partialRecord(SectionKeySchema, z.number().min(0.85).max(1.15).multipleOf(0.05))
      .default({}),
  })
  .default({
    fontPairing: 'editorial',
    accentColor: '#2b6cb0',
    density: 'standard',
    margins: 'standard',
    bodyAlignment: 'justify',
    headerAlignment: 'left',
    dateFormat: 'iso',
    sectionScale: {},
  });

export type StyleConfig = z.infer<typeof StyleConfigSchema>;
export type StyleConfigInput = z.input<typeof StyleConfigSchema>;

export const SectionHeadingsSchema = z
  .object({
    SUMMARY: z.string().default('SUMMARY'),
    EXPERIENCE: z.string().default('EXPERIENCE'),
    EDUCATION: z.string().default('EDUCATION'),
    SKILLS: z.string().default('SKILLS'),
    CERTIFICATIONS: z.string().default('CERTIFICATIONS'),
    PROJECTS: z.string().default('PROJECTS'),
    REFERENCES: z.string().default('REFERENCES'),
  })
  .partial()
  .default({});

export type SectionHeadings = z.infer<typeof SectionHeadingsSchema>;

export const SectionOrderSchema = z
  .array(SectionKeySchema)
  .length(SECTION_KEYS.length, `Section order must contain exactly ${SECTION_KEYS.length} sections`)
  .refine((order) => new Set(order).size === SECTION_KEYS.length, {
    message: 'Section order must contain each section exactly once',
  });

export type SectionKey = z.infer<typeof SectionKeySchema>;
export type SectionOrder = z.infer<typeof SectionOrderSchema>;
