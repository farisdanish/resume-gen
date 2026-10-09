import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { Resume, StyleConfig } from './schema';
import { SECTION_HEADINGS } from './constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../templates/fonts');
const TEMPLATE_PATH = path.resolve(__dirname, '../templates/classic.hbs');
const STYLES_PATH = path.resolve(__dirname, '../templates/styles.css');

function loadBase64Font(filename: string): string {
  return fs.readFileSync(path.join(FONTS_DIR, filename)).toString('base64');
}

export interface RenderOptions {
  styleConfig?: StyleConfig;
  headings?: Record<string, string>;
}

export function renderResume(resume: Resume, options: RenderOptions = {}): string {
  const fontCss = `
    @font-face {
      font-family: 'ResumeSans';
      src: url('data:font/woff2;base64,${loadBase64Font('Inter-Regular.woff2')}') format('woff2');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSans';
      src: url('data:font/woff2;base64,${loadBase64Font('Inter-Bold.woff2')}') format('woff2');
      font-weight: 700;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSerif';
      src: url('data:font/woff2;base64,${loadBase64Font('SourceSerif4-Regular.woff2')}') format('woff2');
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: 'ResumeSerif';
      src: url('data:font/woff2;base64,${loadBase64Font('SourceSerif4-Bold.woff2')}') format('woff2');
      font-weight: 700;
      font-style: normal;
    }
  `;

  const { styleConfig, headings = {} } = options;

  let dynamicOverrides = '';
  if (styleConfig) {
    const accent = styleConfig.accentColor || '#2b6cb0';

    let fontHeading = "'ResumeSerif', Georgia, serif";
    let fontBody = "'ResumeSans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

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
      }
    `;
  }

  const userStyles = fs.readFileSync(STYLES_PATH, 'utf-8');
  const templateSource = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const template = Handlebars.compile(templateSource);

  const resolvedHeadings = {
    ...SECTION_HEADINGS,
    ...headings,
  };

  return template({
    ...resume,
    headings: resolvedHeadings,
    inlinedStyles: `<style>${fontCss}\n${userStyles}\n${dynamicOverrides}</style>`,
  });
}
