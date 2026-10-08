# Lenex Tools

This project contains browser-based conversion tools for
[Lenex](https://wiki.swimrankings.net/index.php/swimrankings:Lenex).

Current tools:

- UNI_p to Lenex converter
- CSV to Lenex records converter
- Lenex entry fee calculator
- Lenex to Victoria meetsetup.xml converter

Use at your own risk, and manually verify generated files before importing them.

The tool is deployed to
[GitHub Pages](https://hakostra.github.io/lenex-tools/).


## UNI_p to Lenex converter

This tool lets you upload:

- a Lenex meet file (.lef/.xml)
- a UNI_p registration file

and download a Lenex file with entries added.

The app performs structural checks and highlights invalid rows before export.


### UNI_p file description

The UNI_p file is plain text with comma-separated data.
Encoding cannot be auto-detected, so ISO-8859-1 is used by default
(UTF-8 can be selected manually in the UI).

The first line is the club name.

Each following line is one entry with these columns:

1. Event number. Mandatory.
2. Distance of event, in meters. Mandatory.
3. Stroke. Mandatory.
4. Last name. Mandatory.
5. First name. Mandatory for individuals, optional for relays.
6. Unknown content, usually empty.
7. Gender + agegroup/class. Mandatory.
8. Birth year or class. Mandatory for individuals; ignored for relays.
9. Qualification time in format `mm:ss.00`. Optional.
10. Unknown content, usually empty.
11. Qualification date. Optional.
12. Qualification place. Optional.
13. Pool length for qualification time. Optional.
14. Unknown content, usually empty.
15. Unknown content, usually empty.

#### Field 2: Distance

Either a normal distance (for example 100), or relay notation
`4*50` where 4 is relay count and 50 is leg distance.

#### Field 3: Stroke mapping

- `FR` -> `FREE`
- `BR` -> `BREAST`
- `RY` -> `BACK`
- `BU` -> `FLY`
- `IM` -> `MEDLEY` (individual medley)
- `LM` -> `MEDLEY` (relay medley)

#### Field 4 and 5: Name

For relays, field 4 is usually team name and field 5 is often empty.

#### Field 7: Gender + age group/class

First character:

- `M` -> men (`M`)
- `K` -> women (`F`)
- `X` -> mixed (`X`)

Last two characters can be:

- two digits: last two digits of birth year
- `JR`, `SR`
- `MA`, `MB`, ... `MO` (masters classes)

#### Field 8: Birth year or class

- 4 digits: birth year
- `JUNIOR`, `SENIOR`
- `MASTERS`, `MASTERSA`, `MASTERSB`, ...
- `S1`-`S15`, `SB1`-`SB15`, `SM1`-`SM15` (para classes)

#### Field 13: Qualification pool length

- `K` -> `SCM` (25m)
- `L` -> `LCM` (50m)


### Relay handling in UNI_p export

In generated Lenex entries, relay age attributes are always:

- `agemin="-1"`
- `agemax="-1"`
- `agetotalmin="-1"`
- `agetotalmax="-1"`

This matches current practical import behavior in Swimify where relay class is
resolved from registered swimmers.


## CSV to Lenex records converter

This tool converts Medley record CSV exports into Lenex record list files.

Workflow:

1. Open one of the Medley source links in the UI.
2. Download records as CSV.
3. Upload CSV to the converter.
4. Review parsed rows and issues.
5. Review/override record-list settings.
6. Download separate Lenex files for 25m and 50m.


### CSV format and parsing

The parser expects semicolon-separated CSV and supports ISO-8859-1 or UTF-8.

Expected columns used by the parser:

- Event descriptor (from first column; fallback to second column)
- Time
- Swimmer name
- Club
- Date
- Place
- Gender
- Pool length
- Para class (optional)

Supported values include:

- Relay notation like `4*50m Fri` and `4*50m Lag medley`
- Strokes: free, breast, back, fly, medley (Norwegian/English variants)
- Gender: `herrer`, `damer`, `mixed`
- Pool: `25m`, `50m`
- Para class: `S1`-`S14`, `SB1`-`SB14`, `SM1`-`SM14`
- Date: `dd.mm.yyyy` and `00.00.yyyy` (mapped to `yyyy-01-01`)

Rows with blocking parsing/validation issues are shown in the table and excluded
from export. Unknown cities are warnings only: the record remains eligible, but
its meet nation is omitted.


### Record type guessing and overrides

By default, the tool guesses record list type from parsed rows:

- If any para class exists: `Norwegian record`
- Otherwise: `Norwegian junior record`

Default age limits:

- Senior: 11 to -1
- Junior: 11 to 18

These values can be overridden in the UI before download:

- record list name
- minimum age
- maximum age


### Record list structure and para grouping

For each pool file (SCM/LCM), the exporter creates:

- one non-para list per gender (`F`, `M`, `X`) when rows exist
- para lists grouped by gender and handicap number


### CSV export output

Two files are produced independently:

- 25m records (`SCM`)
- 50m records (`LCM`)

File names include record type, pool, and production date,
for example `norwegian-senior-records-scm-2026-04-26.lef`.

All generated Lenex files (both converters) use constructor name
`lenex-tools`.


## Lenex entry fee calculator

This tool calculates payment totals from a Lenex entries file.

Workflow:

1. Upload a Lenex entries file (`.lef`/`.xml`) containing event definitions and club entries.
2. Set special-rule values:
   - `X`: swimmers X years and younger
   - `Y`: flat amount those swimmers should pay
3. Review payment summary per club and swimmer.
4. Download the generated payment report as text or CSV.

Rules and calculation details:

- Event fee is read from `EVENT > FEE value` and interpreted as 1/100 currency.
- Entry-based amounts are converted to whole currency by rounding.
- If swimmer age is `<= X`, amount is overridden to `Y` regardless of entry count.
- Report is grouped by club and shows swimmer name, birth year, amount, and club total.


## Lenex to Victoria meetsetup.xml

Upload a Lenex meet definition (`.lef`/`.xml`), enter the NSF meet ID, select
the competition type, review registration settings and events, and download
`meetsetup.xml`. The export uses actual ISO-8859-1 bytes, matching the Victoria
examples. NSF meet IDs are preserved as text, including all leading zeroes.

- Preliminary and timed-final events are included. Finals, semifinals,
   quarterfinals, and swim-offs remain visible in the summary but are skipped.
   All sessions are retained with their original IDs, including final-only sessions.
- Each event's minimum age becomes its youngest allowed birth year. Merged age
   groups are replaced by individual birth-year classes and senior eligibility.
   "Oldest age junior" defaults to 18 and controls the junior/senior boundary.
- Relay events use only the senior class and omit `Youngest` and `Oldest`.
- Ordinary individual and relay fees are inferred from Lenex when uniform,
   converting minor currency units to kr. Missing prices default to 100 kr for
   individuals and 200 kr for relays; differing fees require manual input.
   Late fees default to twice the ordinary fee (200/400 kr with the defaults)
   and can be overridden.
- The flat fee defaults to 100 kr for ages up to 10. Only eligible birth-year
   classes are written to `OnePriceAllClasses`; it is empty for an 11+ meet.
- The editable deadline defaults to Wednesday in the calendar week before the
   earliest session, in `YYYY-MM-DD` format. Victoria's `FinalEntryDate` and
   `LastEntryDate` fields use `YYYYMMDD`, as in the supplied examples.
   `FirstEntryDate` is one calendar year before the deadline plus one day.
   February 29 is clamped to February 28 in the previous year before adding a day.
- Competition type IDs are 4 (national), 15 (regional), and 6 (unapproved).
- Organizer, dated sessions, pool length, and available session times are
   retained. Optional information such as websites, organization number, and
   meet information is omitted. Missing start times are omitted.
- The meet date range is written in Norwegian (for example, `22.-24. januar 2027`).
   Lane numbering starts at 1, and the editable lane count defaults to 8.
   `GeneralHC` is always `TRUE`.
- Downloads are named `Meetsetup_<input basename>.xml`; for example,
   `Events.lef` produces `Meetsetup_Events.xml`.

The converter supports one meet, 25m/50m pools, and calendar-year ages.
Unknown rounds, unsupported strokes, duplicate registration event numbers,
missing minimum ages, and characters outside ISO-8859-1 prevent export rather
than silently generating an ambiguous setup. Verify the file in the intended
registration system before publishing the meet.

Run the regression tests with `npm test`.


## Build and Deployment

This project is a client-only web app (React + TypeScript + Vite) and is
compatible with GitHub Pages.

### Prerequisites

- Node.js 24+ (LTS recommended)
- npm 11+ (recommended)

### Local development

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite (usually `http://localhost:5173`).

### Shared code and checks

- [src/FileUpload.tsx](src/FileUpload.tsx) provides the common file picker and
   drag-and-drop upload control used by every tool.
- [src/fileUtils.ts](src/fileUtils.ts) centralizes decoding, file-name sanitizing,
   and downloads, including temporary URL cleanup.
- [src/styles.css](src/styles.css) defines shared controls and responsive layouts;
   wide tables scroll within their containers.
- `npm test` checks conversion behavior and shared file interactions.
- `npm run build` checks types and unused code before producing the static site.

### Production build

```bash
npm run build
```

The generated static site is placed in `dist/`.

### Deploy to GitHub Pages

#### Option A: GitHub Actions (recommended)

1. Push this repository to GitHub.
2. In GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Source: GitHub Actions**.
4. The included [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
   workflow installs with `npm ci`, runs `npm test` and `npm run build`, then
   uploads `dist/` and deploys.

#### Option B: Manual upload

1. Run `npm run build`.
2. Publish the contents of `dist/` to your Pages branch/source.

### Notes

- The app uses Vite config `base: './'` so it can be served from GitHub Pages subpaths.
- No server-side code is required or used; all parsing runs in the browser.
