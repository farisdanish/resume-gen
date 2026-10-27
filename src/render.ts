import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Handlebars from 'handlebars';
import { EducationDisplayConfigSchema, ResumeSchema, type EducationDisplayConfig, type SectionOrder, type StyleConfigInput } from './schema';
import { DEFAULT_SECTION_ORDER, SECTION_HEADINGS } from './constants';
import { formatDisplayDate } from './date';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../templates/fonts');
const TEMPLATE_PATH = path.resolve(__dirname, '../templates/classic.hbs');
const STYLES_PATH = path.resolve(__dirname, '../templates/styles.css');

function loadBase64Font(filename: string): string {
  return fs.readFileSync(path.join(FONTS_DIR, filename)).toString('base64');
}

// Keep short semantic tokens as one text run; escape all user-authored content.
function resumeText(value: unknown): Handlebars.SafeString {
  const text = String(value ?? '');
  const range = /\b\d{1,6}(?:\.\d{1,3})?[-–]\d{1,6}(?:\.\d{1,3})?%|\b[A-Za-z]+(?:-[A-Za-z]+)+\b/g;
  let html = '';
  let offset = 0;
  for (const match of text.matchAll(range)) {
    html += Handlebars.escapeExpression(text.slice(offset, match.index));
    const escaped = Handlebars.escapeExpression(match[0]);
    const isRange = match[0].endsWith('%');
    html += isRange || match[0].length <= 32
      ? `<span class="${isRange ? 'numeric-range' : 'text-compound'}">${escaped}</span>`
      : escaped;
    offset = match.index! + match[0].length;
  }
  return new Handlebars.SafeString(html + Handlebars.escapeExpression(text.slice(offset)));
}

export interface RenderOptions {
  styleConfig?: StyleConfigInput;
  headings?: Record<string, string>;
  sectionOrder?: SectionOrder;
  educationConfig?: Partial<EducationDisplayConfig>;
}

export function renderResume(input: unknown, options: RenderOptions = {}): string {
  const resume = ResumeSchema.parse(input);
  const fontCss = `
    @font-face {
      font-family: 'ResumeSans';
      src: url('data:font/ttf;base64,${loadBase64Font('LiberationSans-Regular.ttf')}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSans';
      src: url('data:font/ttf;base64,${loadBase64Font('LiberationSans-Bold.ttf')}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSerif';
      src: url('data:font/ttf;base64,${loadBase64Font('LiberationSerif-Regular.ttf')}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSerif';
      src: url('data:font/ttf;base64,${loadBase64Font('LiberationSerif-Bold.ttf')}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeCalibri';
      src: url('data:font/ttf;base64,${loadBase64Font('Carlito-Regular.ttf')}') format('truetype');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeCalibri';
      src: url('data:font/ttf;base64,${loadBase64Font('Carlito-Bold.ttf')}') format('truetype');
      font-weight: 700;
      font-style: normal;
    }
  `;

  const { styleConfig, headings = {}, sectionOrder = DEFAULT_SECTION_ORDER } = options;
  const educationConfig = EducationDisplayConfigSchema.parse(options.educationConfig);
  const detail = educationConfig.mode;
  const displayResume = {
    ...resume,
    work: resume.work.map((item) => ({ ...item, start: formatDisplayDate(item.start, styleConfig?.dateFormat), end: formatDisplayDate(item.end, styleConfig?.dateFormat) })),
    certifications: resume.certifications.map((item) => ({ ...item, date: formatDisplayDate(item.date, styleConfig?.dateFormat) })),
    education: resume.education.map((item) => ({
      ...item,
      start: educationConfig.showDates ? formatDisplayDate(item.start, styleConfig?.dateFormat) : undefined,
      end: educationConfig.showDates ? formatDisplayDate(item.end, styleConfig?.dateFormat) : undefined,
      showDates: educationConfig.showDates && Boolean(item.start || item.end),
      specialization: detail !== 'compact' && educationConfig.showSpecialization ? item.specialization : undefined,
      grade: item.level !== 'spm' && detail !== 'compact' && educationConfig.showGrade ? item.grade : undefined,
      spmResults: item.level === 'spm' && detail !== 'compact' && educationConfig.showGrade ? item.spmResults : undefined,
      achievements: detail !== 'compact' && educationConfig.showAchievements ? item.achievements : [],
      activities: detail !== 'compact' && educationConfig.showActivities ? item.activities : [],
      academicProject: detail === 'detailed' && educationConfig.showAcademicProject ? item.academicProject : undefined,
      subjects: [], // Retained in profiles for compatibility, not shown on resumes.
    })),
  };

  let dynamicOverrides = '';
  let readableOverrides = '';
  if (styleConfig) {
    const accent = styleConfig.accentColor || '#2b6cb0';

    // Retain persisted IDs; each choice now uses one family throughout the resume.
    let fontHeading = "'ResumeCalibri', sans-serif";
    let fontBody = "'ResumeCalibri', sans-serif";

    if (styleConfig.fontPairing === 'modern') {
      fontHeading = "'ResumeSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      fontBody = "'ResumeSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    } else if (styleConfig.fontPairing === 'serif') {
      fontHeading = "'ResumeSerif', Georgia, serif";
      fontBody = "'ResumeSerif', Georgia, serif";
    }

    let baseSize = '8.5pt';
    let lineHeight = '1.35';
    let headingSize = '10.5pt';
    let nameSize = '20pt';

    if (styleConfig.density === 'compact') {
      baseSize = '8.0pt';
      lineHeight = '1.25';
      headingSize = '10pt';
      nameSize = '18pt';
    } else if (styleConfig.density === 'spacious') {
      baseSize = '9.0pt';
      lineHeight = '1.45';
      headingSize = '11pt';
      nameSize = '22pt';
    }

    let paddingY = '12mm';
    let paddingX = '14mm';

    if (styleConfig.margins === 'tight') {
      paddingY = '10mm';
      paddingX = '12mm';
    } else if (styleConfig.margins === 'spacious') {
      paddingY = '14mm';
      paddingX = '16mm';
    }

    dynamicOverrides = `
      :root {
        --primary-accent: ${accent};
        --font-heading: ${fontHeading};
        --font-body: ${fontBody};
        --font-base-size: ${baseSize};
        --line-height-base: ${lineHeight};
        --font-heading-size: ${headingSize};
        --font-name-size: ${nameSize};
        --page-padding-y: ${paddingY};
        --page-padding-x: ${paddingX};
        --body-align: ${styleConfig.bodyAlignment ?? 'justify'};
        --header-align: ${styleConfig.headerAlignment ?? 'left'};
        --scale-summary: ${styleConfig.sectionScale?.summary ?? 1};
        --scale-experience: ${styleConfig.sectionScale?.experience ?? 1};
        --scale-education: ${styleConfig.sectionScale?.education ?? 1};
        --scale-skills: ${styleConfig.sectionScale?.skills ?? 1};
        --scale-certifications: ${styleConfig.sectionScale?.certifications ?? 1};
        --scale-projects: ${styleConfig.sectionScale?.projects ?? 1};
        --scale-references: ${styleConfig.sectionScale?.references ?? 1};
      }
      @page { margin: ${paddingY} ${paddingX}; }
    `;
    if (styleConfig.bodyFontSize !== undefined) {
      const size = styleConfig.bodyFontSize;
      const sectionGap = styleConfig.density === 'compact' ? 6 : styleConfig.density === 'spacious' ? 10 : 8;
      readableOverrides = `
        :root {
          --font-base-size: ${size}pt;
          --font-aux-size: 10pt;
          --font-heading-size: 13pt;
          --font-name-size: 22pt;
          --section-gap: ${sectionGap}pt;
        }
        ${sectionOrder.map((key) => {
          const scale = styleConfig.sectionScale?.[key] ?? 1;
          return `.readable-layout .section-${key} {
            zoom: 1;
            --font-base-size: ${Math.max(10, size * scale)}pt;
            --font-aux-size: ${Math.max(10, 10 * scale)}pt;
            --font-heading-size: ${Math.max(12, 13 * scale)}pt;
          }`;
        }).join('\n')}
      `;
    }
  }

  const userStyles = fs.readFileSync(STYLES_PATH, 'utf-8');
  const templateSource = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const template = Handlebars.compile(templateSource);

  const resolvedHeadings = {
    ...SECTION_HEADINGS,
    ...headings,
  };

  const orderedSections = sectionOrder.map((key) => ({
    key,
    resume: displayResume,
    headings: resolvedHeadings,
    isSummary: key === 'summary',
    isExperience: key === 'experience',
    isEducation: key === 'education',
    isSkills: key === 'skills',
    isCertifications: key === 'certifications',
    isProjects: key === 'projects',
    isReferences: key === 'references',
  }));

  return template({
    ...displayResume,
    readableTypography: styleConfig?.bodyFontSize !== undefined,
    contactIdentity: [
      { text: resume.basics.contact.email, href: resume.basics.contact.email ? `mailto:${resume.basics.contact.email}` : undefined },
      { text: resume.basics.contact.phone },
      { text: resume.basics.contact.location },
    ].filter((item) => item.text),
    contactLinks: [
      { text: 'GitHub', href: resume.basics.contact.github },
      { text: 'LinkedIn', href: resume.basics.contact.linkedin },
      { text: 'Website', href: resume.basics.contact.website },
    ].filter((item) => item.href),
    headings: resolvedHeadings,
    orderedSections,
    inlinedStyles: `<style>${fontCss}\n${userStyles}\n${dynamicOverrides}\n${readableOverrides}</style>`,
  }, { helpers: { resumeText } });
}
