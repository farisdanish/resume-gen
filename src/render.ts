import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { Resume } from './schema';
import { SECTION_HEADINGS } from './constants';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '../templates/fonts');
const TEMPLATE_PATH = path.resolve(__dirname, '../templates/classic.hbs');
const STYLES_PATH = path.resolve(__dirname, '../templates/styles.css');

function loadBase64Font(filename: string): string {
  return fs.readFileSync(path.join(FONTS_DIR, filename)).toString('base64');
}

export function renderResume(resume: Resume): string {
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

  const userStyles = fs.readFileSync(STYLES_PATH, 'utf-8');
  const templateSource = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  const template = Handlebars.compile(templateSource);

  return template({
    ...resume,
    headings: SECTION_HEADINGS,
    inlinedStyles: `<style>${fontCss}\n${userStyles}</style>`,
  });
}
