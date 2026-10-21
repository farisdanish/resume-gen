# resume-gen

> Portfolio extraction, resume editing, and text-based A4 PDF export with configurable page targets.

`resume-gen` compiles live web portfolios (such as [farisantoni.com](https://farisantoni.com)) or offline HTML/JSON fixtures into a customizable A4 PDF resume. The system includes a headless CLI with discrete exit codes, an ATS text/ligature verification quality gate, and a vintage Office 2000 desktop web application powered by a loopback-bound Hono server.

---

## Architecture & Data Flow

```
Live Web / Fixture (HTML/JSON)
          │
          ▼
   DOM Extractor (src/extract.ts)
   • Cheerio selector mapping
   • Warnings accumulator
   • Phone & website injection
          │
          ▼
   Date Normalizer & Zod Schema (src/date.ts, src/schema.ts)
   • YYYY / YYYY-MM normalization
   • Chronological order validation
          │
          ▼
   Template Engine (src/render.ts)
   • Handlebars layout (templates/classic.hbs)
   • Base64 inlined static TTF fonts (Liberation Sans/Serif)
          │
          ▼
   PDF Engine (src/pdf.ts)
   • Playwright Chromium
   • document.fonts.ready sync
   • pdf-lib actual page-count inspection
          │
     ┌────┴────────────────────────┐
     ▼                             ▼
Headless CLI (src/cli.ts)    Hono Server (src/server.ts) [127.0.0.1:3000]
Exit Codes: 0 to 4                 │
                             Office 2000 Web UI (ui/)
```

---

## Key Features

- **Measured Page Targets**: Choose one or two pages. Playwright and `pdf-lib` report the actual PDF page count. UI export remains available beyond the target; CLI `--strict-pages` enforces it when requested.
- **PDF Text Regression Checks**: Independent unpdf and Poppler checks cover literal phrases, dates, punctuation, reading order, page geometry, and hyperlink annotations across font/photo/alignment variants. These checks do not establish employer ATS approval.
- **Self-Contained & Deterministic**: Zero external network font dependencies at render time. Static Liberation Sans/Serif fonts are bundled with their license and inlined as Base64 TTF into the document stylesheet.
- **Discrete Exit Codes Contract**: Hardened CLI returning discrete exit codes (`0` to `4`) for CI/CD pipeline automation.
- **Loopback-Only Server Security**: Local API server strictly binds to `127.0.0.1:3000` (never `0.0.0.0`).
- **Sandboxed Live Preview**: Web UI renders the live resume strictly within an isolated `<iframe sandbox="" srcdoc="...">` to eliminate script execution and DOM leakage.
- **Vintage Office 2000 Retro UI**: Authentic Windows 2000 styling with 3D bevels, Tahoma typography, menu/toolbars, phone injection, dynamic URL extraction, and zoom controls.

---

## Installation & Setup

### Prerequisites
- Node.js 24.x or 22.x (22.12 or newer)
- Playwright Chromium binaries
- For tests: Poppler `pdftotext` (for example, `sudo apt-get install poppler-utils` on Debian/Ubuntu)

### Setup
```bash
# Clone and install dependencies
git clone https://github.com/farisantoni/resume-gen.git
cd resume-gen
npm install

# Install Playwright browser binary
npx playwright install chromium
```

---

## CLI Usage

Generate PDF resumes directly from the command line:

```bash
# Generate from local fixture
npm run generate -- --source fixture --out out/resume.pdf

# Generate from live portfolio URL
npm run generate -- --source live --out out/resume.pdf

# Generate from custom URL with phone injection
npm run generate -- --source https://farisantoni.com --phone "+65 9123 4567" --out out/resume.pdf

# Strict page budget and selector warnings mode
npm run generate -- --source fixture --strict-pages --strict-warnings
```

### CLI Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `-s, --source <source>` | Data source: `"live"`, `"fixture"`, a URL, or local file path | `"live"` |
| `-p, --phone <phone>` | Contact phone number override string | `RESUME_PHONE` env |
| `-o, --out <path>` | Output PDF destination path | `"out/resume.pdf"` |
| `--date-format` | `iso` or `month-name`; canonical input dates stay unchanged | `iso` |
| `--page-target` | Target PDF page count, `1` or `2` | `1` |
| `--strict-pages` | Exits with code `2` if output exceeds the selected target | `false` |
| `--strict-warnings` | Exits with code `3` if DOM extraction produces selector warnings | `false` |

### Discrete Exit Codes Contract

| Code | Meaning | Cause |
| :---: | :--- | :--- |
| **`0`** | **Success** | Resume compiled and written to output file within the requested page target, when strict enforcement is enabled. |
| **`1`** | **Schema Error** | Input data violated Zod schema validation (`ResumeSchema`). |
| **`2`** | **Page Overflow** | Output exceeded the selected target while `--strict-pages` was enabled. |
| **`3`** | **DOM Warning** | Missing selectors produced warnings while `--strict-warnings` was enabled. |
| **`4`** | **Operational Error** | Network fetch failure, missing file/fixture, or I/O permission error. |

---

## Web Application (Vintage Office 2000 UI)

Launch the local development server:

```bash
npm run dev
```

Open **`http://127.0.0.1:3000`** in your browser.

- **Data Sources**: Toggle between Local Fixture and Live Web with an editable URL input field.
- **Contact Injection**: Live phone override input injected into `basics.contact.phone`.
- **Live Preview**: Sandboxed preview `<iframe sandbox="" srcdoc="...">` updating on demand.
- **Export**: A4 PDF download with actual page counts and one/two-page target warnings.
- **Diagnostics**: Retro status well displaying extraction metrics, warnings, and schema status.

---

## API Endpoints

The loopback server exposes the following REST endpoints:

- `GET /api/health` — Returns server status and loopback binding information.
- `POST /api/extract` — Accepts `{ source?: string, phoneOverride?: string }`, returns parsed resume JSON and extraction warnings.
- `POST /api/preview` — Accepts `{ resume: Resume, styleConfig?, pageTarget?: 1 | 2, headings?, sectionOrder? }`, returns `{ success: true, html: string, budget: { fullnessPercent: number, pageCount: number, isSinglePage: boolean, pageTarget: 1 | 2, withinTarget: boolean, targetFullnessPercent: number } }`.
- `POST /api/generate-pdf` — Accepts `{ resume: Resume, styleConfig?, pageTarget?: 1 | 2, headings?, sectionOrder? }` or `{ html: string, pageTarget?: 1 | 2 }`, returns binary `application/pdf` with `X-Page-Count`, `X-Is-Single-Page`, `X-Page-Target`, and `X-Within-Target` headers.

---

## Testing & Quality Gate

Run the complete test suite:

```bash
# Typecheck TypeScript codebase
npm run typecheck

# Run all test suites (Vitest)
npm test

# Focused PDF compatibility gate (requires Chromium and pdftotext)
npm run test:pdf-compat

# Run individual test suites
npx vitest run test/smoke.test.ts    # Fixture sanity, 1-page regression & exit codes
npx vitest run test/ats.test.ts      # unpdf ATS ordering and ligature checks
npx vitest run test/server.test.ts   # Server endpoints & 127.0.0.1 loopback invariant
npx vitest run test/extract.test.ts  # Cheerio DOM extractor & URL fetching
npx vitest run test/date.test.ts     # Table-driven date normalization
npx vitest run test/render.test.ts   # Handlebars & Base64 font inlining
```

---

## Project Structure

```
resume-gen/
├── fixtures/
│   ├── resume.json            # Golden resume JSON fixture
│   └── site.html              # Offline portfolio DOM fixture
├── src/
│   ├── cli.ts                 # Commander CLI with discrete exit codes
│   ├── constants.ts           # ATS section headings
│   ├── date.ts                # Date range and keyword normalizer
│   ├── extract.ts             # Cheerio DOM extractor
│   ├── pdf.ts                 # Playwright & pdf-lib A4 PDF generator
│   ├── render.ts              # Handlebars renderer with Base64 font inliner
│   ├── schema.ts              # Zod validation schemas
│   └── server.ts              # Loopback Hono server (127.0.0.1:3000)
├── templates/
│   ├── classic.hbs            # Resume Handlebars template
│   ├── styles.css             # Print CSS & @page A4 rules
│   └── fonts/                 # Static TTF fonts, license, provenance, and retained legacy assets
├── test/
│   ├── ats.test.ts            # ATS text order & ligature validation
│   ├── date.test.ts           # Date parser table-driven test suite
│   ├── extract.test.ts        # DOM extraction tests
│   ├── render.test.ts         # Template compilation tests
│   ├── server.test.ts         # Server loopback security & endpoint tests
│   └── smoke.test.ts          # End-to-end regression & CLI exit code suite
├── ui/
│   ├── app.js                 # Office 2000 client logic & sandbox bridge
│   ├── index.html             # Office 2000 desktop window shell
│   └── office2000.css         # Windows 2000 3D bevels & retro styling
├── package.json
├── tsconfig.json
└── README.md
```

---

### Design and page budget

Design changes refresh the preview after a short debounce. Density scales body
text and line spacing; per-section scaling affects only its selected section.
The server waits for fonts and images, measures content against the usable A4
height, and generates a PDF to obtain the actual page count. Fullness can exceed
100%; overflow warnings use the PDF page count. The preview shows the first A4
page, so the exported PDF is the way to inspect subsequent pages.

Preview measurement runs in Chromium and can take longer than HTML compilation.
Browser work has a 15-second deadline; preview requests time out after 20 seconds.
Pending or failed previews show the budget as unavailable, and older responses
cannot replace newer edits. PDF export still permits multiple pages and reports
their actual count. Legacy profile files remain supported and the iframe keeps its existing isolation.

---

## Authoring, compatibility, and verification

- **Project evidence:** Content includes editable stacks and optional visible project URLs. Stack input is comma-separated; empty tokens are discarded. Links must be absolute HTTP(S) URLs. Unsafe schemes are rejected in profiles/API requests. Project links are rendered as text and PDF URI annotations; hidden projects contribute neither. URLs are not fetched by the server.
- **Header:** identity fields wrap on one row group; GitHub/LinkedIn/Website use a dedicated row. Photo inclusion is independent of project/reference inclusion. Long input can still increase document height.
- **Date display:** Design offers ISO or English month names. `YYYY-MM`, bare years, and null end dates remain canonical in JSON; formatting does not mutate them.
- **Page target:** Design offers 1 or 2 pages. `budget.fullnessPercent` retains its one-page geometric meaning for API compatibility; `targetFullnessPercent` divides that by the target. Overflow uses actual PDF page count, not a percentage guess. Page breaks can make geometric fullness differ from actual pagination. Export never silently deletes or shrinks content.
- **Named variants:** Source → Saved Profiles saves snapshots of your own content, visibility, styling, order, and page target. Suggested names do not generate or rewrite achievements. Names are unique case-insensitively (1–80 characters); replacing a duplicate requires Update Saved Profile. Loading asks before replacing unmatched edits, including after reload. Save Profile/Load Profile still download/upload portable JSON.
- **Local persistence:** active draft uses `resume_gen_draft_v1`; named snapshots use independent `resume_gen_profiles_v1` storage. Profiles are browser-local and do not sync. Quota/corrupt-library failures show an error and preserve existing snapshots. Keep portable JSON backups, especially with photos. Previously accepted non-HTTP(S) project links must be corrected before importing into this version.
- **Backward compatibility:** version 1 bundles and legacy raw resume JSON still load. Missing date format/page target defaults to `iso`/1. New fields are additive; no database migration is required.
- **Font change:** internal font-pairing IDs stay the same, but exports now embed static Liberation Sans/Serif TTF files. Font provenance, package version, hashes and SIL OFL license are in `templates/fonts/`. Legacy WOFF2 files are intentionally retained for rollback. Text wrapping, PDF size, and page counts can change. Short percentage ranges remain atomic text runs; their source Unicode is preserved and all prose is HTML-escaped.
- **Limits:** Data: Ready means extraction data was loaded successfully. PDF parsing regression checks, metadata, or an untagged PDF do not establish a score or guarantee in a real employer ATS. Accessibility tagging and live employer-ATS qualification remain separate work.

### Smoke tests after every phase

Every implementation phase has a smoke checkpoint before the next phase proceeds:

1. Fonts: export photo/no-photo fixtures; run both parsers and the semantic matrix; inspect rendered PDFs and existing CLI smoke behavior.
2. Project/header: edit and persist stack/link, reject unsafe URLs, toggle photo/project visibility, download PDF, and inspect URI annotations and contact layout.
3. Dates/targets: round-trip settings and old profiles; compare one/two/three-page API/PDF results; exercise strict CLI targets and invalid values.
4. Named variants: save/load independent drafts, explicit duplicate update, dirty-switch cancellation/reload, portable JSON/PDF export, and corrupt/quota-failed storage.
5. Final: full tests, typecheck, JS syntax and diff checks; extraction → editing → settings/profile changes → preview → PDF download; render every page of representative one/two/overflow-page PDFs.

### Readable typography and extraction fixes

Design → **Apply readable preset** selects 11 pt body text, modern Liberation Sans, dark headings, left-aligned prose, standard density/margins and unscaled sections. It keeps your content, photo, reference visibility and page target unchanged. This follows the 10–12 pt body-text range, restrained font choices and strong contrast discussed in [Jobstreet's font guide](https://my.jobstreet.com/career-advice/article/guide-to-choosing-best-fonts-for-resume). It is not an employer ATS certification.

Choose **Body text size → 10 / 11 / 12 pt** to enable readable typography independently. Density then changes spacing rather than font size. Section scaling cannot reduce body/contact/metadata text below 10 pt or section headings below 12 pt. Larger text can need two pages: shorten content, hide an optional section such as references, or choose the existing two-page target. Exports do not silently shrink or delete content to fit.

**Existing density sizing** restores the original density/scaling behavior. Older profiles keep that behavior until you choose an explicit text size. The optional numeric `styleConfig.bodyFontSize` is saved with autosave, named profiles and portable JSON; it accepts only 10, 11 or 12. No profile version migration is required. CLI usage:

```bash
npm run generate -- --source fixture --body-font-size 11 --page-target 2 --out out/readable.pdf
```

Omit `--body-font-size` to retain legacy sizing. Unsupported sizes exit with code 1. `--strict-pages` still exits with code 2 if the actual PDF exceeds the selected target.

Readable exports repeat the chosen margins on every printed page. Legacy exports retain their previous pagination, including continuation text that can start near the page edge. Geometric budget fullness is measured at the readable print width and usable height; actual PDF page count remains authoritative.

Automatic prose hyphenation is disabled. Short authored alphabetic hyphenated compounds (up to 32 characters) and percentage ranges remain whole PDF text runs, with escaped source text and unchanged punctuation. Longer tokens and URLs remain wrappable. Contacts use two ordinary text rows with literal separators to preserve extraction order, including missing fields and photo layouts.

Smoke checkpoints for these changes:

1. Word preservation: `npm test -- test/render.test.ts test/ats.test.ts`; export photo/no-photo PDFs, check extracted words with Poppler/unpdf and pypdf/pdfplumber, then inspect every rendered page.
2. Contact order: `npm test -- test/ats.test.ts -t contact-order`; inspect long/missing contacts with left/right photos, verify reading order and link annotations.
3. Readable layout: `npm test -- test/schema.test.ts test/layout.test.ts test/server.test.ts test/ui.test.ts test/smoke.test.ts -t 'typography-|readable'`; round-trip settings, reject invalid imports, compare actual page count with budget, inspect every page and font/margin bounds of one/two/overflow exports.
4. Final: `npm test`, `npm run typecheck`, `node --check ui/app.js`, `git diff --check`; complete extraction → editing → readable preset → preview → PDF download. Recheck text, links, page count, margins and normal-size readability. Independent PDF parsers are evidence about extraction, not proof of employer ATS acceptance or PDF accessibility tagging.

The known loopback test currently uses a substring match that can confuse port 3000 with unrelated ports such as 30007. Report that baseline failure separately; do not skip or weaken the assertion to make this release green.


## License

MIT
