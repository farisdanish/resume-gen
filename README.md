# resume-gen

> Automated portfolio extraction and single-page ATS-compliant A4 PDF resume generator.

`resume-gen` compiles live web portfolios (such as [farisantoni.com](https://farisantoni.com)) or offline HTML/JSON fixtures into a standardized, single-page A4 PDF resume. The system includes a headless CLI with discrete exit codes, an ATS text/ligature verification quality gate, and a vintage Office 2000 desktop web application powered by a loopback-bound Hono server.

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
   • Base64 inlined WOFF2 fonts (Inter, Source Serif 4)
          │
          ▼
   PDF Engine (src/pdf.ts)
   • Playwright Chromium
   • document.fonts.ready sync
   • pdf-lib strict 1-page budget guard
          │
     ┌────┴────────────────────────┐
     ▼                             ▼
Headless CLI (src/cli.ts)    Hono Server (src/server.ts) [127.0.0.1:3000]
Exit Codes: 0 to 4                 │
                             Office 2000 Web UI (ui/)
```

---

## Key Features

- **Strict 1-Page A4 Budget**: Uses Playwright Chromium and `pdf-lib` to inspect the compiled page count. Exiting or alerting if content exceeds the single-page limit.
- **ATS Quality Gate**: Uses `unpdf` to verify continuous linear text stream extraction, correct section hierarchy (`SUMMARY` → `EXPERIENCE` → `EDUCATION` → `SKILLS`), and preservation of typographical ligatures (`fi`, `fl`, `ff`).
- **Self-Contained & Deterministic**: Zero external network font dependencies at render time. All fonts (`Inter`, `Source Serif 4`) are inlined as Base64 WOFF2 into the document stylesheet.
- **Discrete Exit Codes Contract**: Hardened CLI returning discrete exit codes (`0` to `4`) for CI/CD pipeline automation.
- **Loopback-Only Server Security**: Local API server strictly binds to `127.0.0.1:3000` (never `0.0.0.0`).
- **Sandboxed Live Preview**: Web UI renders the live resume strictly within an isolated `<iframe sandbox="" srcdoc="...">` to eliminate script execution and DOM leakage.
- **Vintage Office 2000 Retro UI**: Authentic Windows 2000 styling with 3D bevels, Tahoma typography, menu/toolbars, phone injection, dynamic URL extraction, and zoom controls.

---

## Installation & Setup

### Prerequisites
- Node.js 20+
- Playwright Chromium binaries

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
| `--strict-pages` | Exits with code `2` if output exceeds 1 A4 page | `false` |
| `--strict-warnings` | Exits with code `3` if DOM extraction produces selector warnings | `false` |

### Discrete Exit Codes Contract

| Code | Meaning | Cause |
| :---: | :--- | :--- |
| **`0`** | **Success** | Resume compiled and written to output file within page budget. |
| **`1`** | **Schema Error** | Input data violated Zod schema validation (`ResumeSchema`). |
| **`2`** | **Page Overflow** | Output exceeded 1 page while `--strict-pages` was enabled. |
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
- **Export**: One-click 1-page A4 PDF download.
- **Diagnostics**: Retro status well displaying extraction metrics, warnings, and schema status.

---

## API Endpoints

The loopback server exposes the following REST endpoints:

- `GET /api/health` — Returns server status and loopback binding information.
- `POST /api/extract` — Accepts `{ source?: string, phoneOverride?: string }`, returns parsed resume JSON and extraction warnings.
- `POST /api/preview` — Accepts `{ resume: Resume }`, returns `{ success: true, html: string }`.
- `POST /api/generate-pdf` — Accepts `{ resume: Resume }` or `{ html: string }`, returns binary `application/pdf` with `X-Page-Count` headers.

---

## Testing & Quality Gate

Run the complete test suite:

```bash
# Typecheck TypeScript codebase
npm run typecheck

# Run all test suites (Vitest)
npm test

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
│   ├── pdf.ts                 # Playwright & pdf-lib single-page PDF generator
│   ├── render.ts              # Handlebars renderer with Base64 font inliner
│   ├── schema.ts              # Zod validation schemas
│   └── server.ts              # Loopback Hono server (127.0.0.1:3000)
├── templates/
│   ├── classic.hbs            # Resume Handlebars template
│   ├── styles.css             # Print CSS & @page A4 rules
│   └── fonts/                 # WOFF2 fonts (Inter, Source Serif 4)
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

## License

MIT
