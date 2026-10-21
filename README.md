# resume-gen

`resume-gen` extracts resume data from a portfolio website or local HTML/JSON, provides a browser editor, and exports text-based A4 PDFs. It includes an Office 2000-style interface and a command-line tool.

## Features

- Edit contact details, summaries, experience, skills, project descriptions, technology stacks, links and references.
- Include or hide individual entries, rename section headings and change section order.
- Adjust fonts, colours, margins, alignment, spacing and section sizes; optionally include a photo.
- Choose Arial-style (Liberation Sans), Calibri-style (Carlito), or Times New Roman-style (Liberation Serif), with the selected family used throughout the resume.
- Apply an 11 pt readable preset or select 10, 11 or 12 pt body text.
- Choose ISO or month-name dates and a one- or two-page target, with overflow warnings based on the exported PDF's page count.
- Preview changes, download PDFs, and save named profiles locally or import/export profiles as JSON.
- Generate PDFs from the CLI, with optional page-limit and extraction-warning enforcement.

The HTML extractor uses selectors for the supported portfolio layout; other websites may require changes to `src/extract.ts`.

## Setup

Requires Node.js 24.x or Node.js 22.12+, and Playwright Chromium.

```bash
git clone https://github.com/farisdanish/resume-gen.git
cd resume-gen
npm install
npx playwright install chromium
```

## Browser editor

```bash
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. Select **Local Fixture** or **Live Web**, then extract the resume data.
2. Edit entries in **Content**, adjust appearance in **Design**, and organise headings in **Sections**.
3. Review the preview and page count, then export the PDF.

**Design → Apply readable preset** selects 11 pt body text, left alignment and dark headings. Larger text may require a second page; the preset does not change the page target or remove content. With an explicit text size, density changes spacing and scaled text stays at least 10 pt. **Existing density sizing** uses the original smaller font settings.

Saved profiles are stored in the current browser and do not sync between devices. Export a JSON profile to keep a portable copy.

## Command line

```bash
# Export the bundled sample
npm run generate -- --source fixture --out out/resume.pdf

# Export the configured live portfolio
npm run generate -- --source live --out out/resume.pdf

# Use a local resume JSON file and readable typography
npm run generate -- --source fixtures/resume.json --body-font-size 11 --page-target 2 --out out/readable.pdf

# Require the output to fit the selected target
npm run generate -- --source fixture --page-target 1 --strict-pages
```

| Option | Purpose | Default |
| --- | --- | --- |
| `-s, --source <source>` | `live`, `fixture`, a URL, or a local HTML/JSON path | `live` (`https://farisantoni.com`) |
| `-p, --phone <phone>` | Override the contact phone number | `RESUME_PHONE` environment variable |
| `-o, --out <path>` | Output PDF path | `out/resume.pdf` |
| `--body-font-size <points>` | Readable body text: `10`, `11` or `12` pt | Density-based sizing |
| `--date-format <format>` | `iso` or `month-name` | `iso` |
| `--page-target <pages>` | Page target: `1` or `2` | `1` |
| `--strict-pages` | Fail when the PDF exceeds the target | Off |
| `--strict-warnings` | Fail when extraction produces warnings | Off |

The page target produces a warning in the editor; CLI enforcement requires `--strict-pages`.

| Exit code | Meaning |
| --- | --- |
| `0` | PDF written successfully |
| `1` | Invalid input or options |
| `2` | Page target exceeded with `--strict-pages` |
| `3` | Extraction warnings with `--strict-warnings` |
| `4` | Extraction, rendering or file-operation failure |

## Local API

The server binds to `127.0.0.1:3000` by default.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Server status |
| `POST /api/extract` | Extract data from a source, with an optional phone override |
| `POST /api/preview` | Render resume HTML and return page-budget measurements |
| `POST /api/generate-pdf` | Export resume data or supplied HTML as a PDF |

Preview and PDF requests accept resume data, style settings, section headings, section order and a page target; see `src/schema.ts` and `src/server.ts` for request fields.

## Development

```bash
npm run typecheck
npm test
npm run test:pdf-compat
```

Tests require Playwright Chromium and Poppler's `pdftotext` command (`poppler-utils` on Debian/Ubuntu).

| Directory | Contents |
| --- | --- |
| `src/` | Extraction, validation, rendering, PDF generation, CLI and API |
| `ui/` | Browser editor |
| `templates/` | Resume template, styles and bundled fonts |
| `fixtures/` | Sample portfolio HTML and resume JSON |
| `test/` | Automated tests |

## Changelog

Replaced the three font combinations with clearly labelled Arial-style, Calibri-style and Times New Roman-style open-source font choices.

## License

MIT
