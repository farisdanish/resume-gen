import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDateRange } from './date';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ExtractOptions {
  source: 'live' | 'fixture' | string;
  phoneOverride?: string;
}

export interface ExtractResult {
  data: any;
  warnings: string[];
}

export async function runExtraction(opts: ExtractOptions): Promise<ExtractResult> {
  const warnings: string[] = [];
  let html = '';

  let targetUrl = '';
  const isUrl =
    opts.source === 'live' ||
    opts.source.startsWith('http://') ||
    opts.source.startsWith('https://') ||
    opts.source.startsWith('farisantoni.com') ||
    opts.source.startsWith('www.');

  if (isUrl) {
    targetUrl =
      opts.source === 'live'
        ? 'https://farisantoni.com'
        : opts.source.startsWith('http://') || opts.source.startsWith('https://')
          ? opts.source
          : `https://${opts.source}`;

    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      html = await res.text();
    } catch (err: any) {
      throw new Error(`Failed to fetch from ${targetUrl}: ${err.message}`);
    }
  } else if (opts.source === 'fixture') {
    const fixturePath = path.resolve(__dirname, '../fixtures/site.html');
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Fixture not found at: ${fixturePath}`);
    }
    html = fs.readFileSync(fixturePath, 'utf-8');
  } else {
    const candidatePath = path.isAbsolute(opts.source)
      ? opts.source
      : path.resolve(process.cwd(), opts.source);
    if (!fs.existsSync(candidatePath)) {
      throw new Error(`Source not found at: ${opts.source}`);
    }
    if (candidatePath.endsWith('.json')) {
      const rawJson = JSON.parse(fs.readFileSync(candidatePath, 'utf-8'));
      if (opts.phoneOverride) {
        rawJson.basics = rawJson.basics || {};
        rawJson.basics.contact = rawJson.basics.contact || {};
        rawJson.basics.contact.phone = opts.phoneOverride;
      }
      return { data: rawJson, warnings: [] };
    }
    html = fs.readFileSync(candidatePath, 'utf-8');
  }

  const $ = cheerio.load(html);

  // Basics
  let name = $('#about .hero-fullname').text().trim();
  if (!name) {
    name = $('#about .hero-name').text().trim();
  }
  // Remove trailing dots from name if any
  name = name.replace(/\.+$/, '').trim();

  const title = $('#about .hero-role').text().trim();
  const summary = $('#about .hero-summary').text().trim();

  const metaText = $('#about .hero-meta').text().trim();
  let location = '';
  if (metaText) {
    const parts = metaText.split('·');
    location = parts[0].trim();
  }

  const mailtoHref = $('#contact a[href^="mailto:"]').attr('href') || $('a[href^="mailto:"]').attr('href');
  const email = mailtoHref ? mailtoHref.replace(/^mailto:/i, '').trim() : '';

  const githubHref = $('#contact a[href*="github.com"]').attr('href') || $('a[href*="github.com"]').attr('href');
  let github: string | undefined = githubHref?.trim();
  if (github && github.includes('github.com/')) {
    // Standardize to user profile if repo link
    const ghMatch = github.match(/https?:\/\/github\.com\/([a-zA-Z0-9_-]+)/);
    if (ghMatch) {
      github = `https://github.com/${ghMatch[1]}`;
    }
  }

  const linkedinHref = $('#contact a[href*="linkedin.com"]').attr('href') || $('a[href*="linkedin.com"]').attr('href');
  const linkedin = linkedinHref?.trim();

  const canonicalHref = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content');
  const website = canonicalHref?.trim() || (isUrl ? targetUrl : 'https://farisantoni.com');

  const contact: any = {
    email,
    location,
    website,
  };
  if (opts.phoneOverride) {
    contact.phone = opts.phoneOverride;
  }
  if (github) contact.github = github;
  if (linkedin) contact.linkedin = linkedin;

  // Work Experience
  const workItems: any[] = [];
  const timelineNodes = $('#experience .timeline-item');
  if (timelineNodes.length === 0) {
    warnings.push('experience: 0 nodes matched');
  } else {
    timelineNodes.each((_, el) => {
      const role = $(el).find('.job-role').text().trim();
      const company = $(el).find('.job-company').text().trim();
      const rawPeriod = $(el).find('.job-period').text().trim();
      const jobLocation = $(el).find('.job-location').text().trim();
      const highlights = $(el)
        .find('.job-highlights li')
        .map((__, li) => $(li).text().trim())
        .get()
        .filter((h) => h.length > 0);

      const parsedDates = rawPeriod ? parseDateRange(rawPeriod) : { start: '2024-01', end: null };

      workItems.push({
        role,
        company,
        location: jobLocation || undefined,
        start: parsedDates.start || '2024-01',
        end: parsedDates.end,
        highlights,
      });
    });
  }

  // Education
  const educationItems: any[] = [];
  const eduNodes = $('#education .edu-grid .edu-card, #education .edu-card');
  if (eduNodes.length === 0) {
    warnings.push('education: 0 nodes matched');
  } else {
    eduNodes.each((_, el) => {
      const degree = $(el).find('.edu-degree').text().trim();
      const institution = $(el).find('.edu-institution').text().trim();
      const rawPeriod = $(el).find('.edu-period').text().trim();
      const type = $(el).find('.edu-type').text().trim();

      const parsedDates = rawPeriod ? parseDateRange(rawPeriod) : { start: undefined, end: '2024' };

      educationItems.push({
        institution,
        degree,
        start: parsedDates.start,
        end: parsedDates.end,
        type: type || undefined,
      });
    });
  }

  // Skills
  const skillsItems: any[] = [];
  const skillNodes = $('#skills .skills-grid .skill-card, #skills .skill-card');
  if (skillNodes.length === 0) {
    warnings.push('skills: 0 nodes matched');
  } else {
    skillNodes.each((_, el) => {
      const category = $(el).find('.skill-category').text().trim();
      const items = $(el)
        .find('.skill-tags .tag, .tag')
        .map((__, t) => $(t).text().trim())
        .get()
        .filter((item) => item.length > 0);

      if (category && items.length > 0) {
        skillsItems.push({ category, items });
      }
    });
  }

  // Certifications
  const certItems: string[] = [];
  const certNodes = $('#skills .certs .certs-list li');
  if (certNodes.length === 0) {
    warnings.push('certifications: 0 nodes matched');
  } else {
    certNodes.each((_, el) => {
      const text = $(el).text().replace(/✦/g, '').trim();
      if (text) certItems.push(text);
    });
  }

  // Projects
  const projectItems: any[] = [];
  const projectNodes = $('#projects .project-card');
  if (projectNodes.length === 0) {
    warnings.push('projects: 0 nodes matched');
  } else {
    projectNodes.each((_, el) => {
      const projectTitle = $(el).find('.project-title, h3').text().trim();
      const description = $(el).find('.project-desc, p').first().text().trim();
      const stack = $(el)
        .find('.project-tags .tag, .tag')
        .map((__, t) => $(t).text().trim())
        .get();
      const link = $(el).find('a[href^="http"]').attr('href')?.trim();

      if (projectTitle && description) {
        projectItems.push({
          title: projectTitle,
          description,
          stack,
          link: link || undefined,
        });
      }
    });
  }

  const data = {
    basics: {
      name,
      title,
      summary,
      contact,
    },
    work: workItems,
    education: educationItems,
    skills: skillsItems,
    certifications: certItems,
    projects: projectItems,
  };

  return { data, warnings };
}
