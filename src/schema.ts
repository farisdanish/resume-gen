import { z } from 'zod';

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

export const EducationSchema = z
  .object({
    institution: z.string().min(1),
    degree: z.string().min(1),
    start: DatePointSchema.optional(), // Optional: allows lone graduation dates ("2024")
    end: DatePointSchema.nullable(),   // null = "Present" (ongoing studies)
    type: z.string().optional(),
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
  link: z.string().url().optional(),
});

export const ResumeSchema = z.object({
  basics: z.object({
    name: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    contact: ContactInfoSchema,
  }),
  work: z.array(WorkExperienceSchema).min(1),
  education: z.array(EducationSchema).min(1),
  skills: z.array(SkillCategorySchema).min(1),
  certifications: z.array(z.string()).default([]),
  projects: z.array(ProjectSchema).default([]),
});

export type Resume = z.infer<typeof ResumeSchema>;
