# Lenex Tools

This project contains browser-based conversion tools for
[Lenex](https://wiki.swimrankings.net/index.php/swimrankings:Lenex).

Current tools:

- UNI_p to Lenex converter
- CSV to Lenex records converter

Use at your own risk, and manually verify generated Lenex files.

The tool is deployed to
[GitHub Pages](https://hakostra.github.io/unip-to-lenex/).


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
8. Birth year or class. Optional.
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

Rows with parsing/validation issues are shown in the table and excluded from
export.


### Record type guessing and overrides

By default, the tool guesses record list type from parsed rows:

- If any para class exists: `Norwegian senior records`
- Otherwise: `Norwegian junior records`

Default age limits:

- Senior: 9 to -1
- Junior: 11 to 18

These values can be overridden in the UI before download:

- record list name
- minimum age
- maximum age


### Record list structure and para grouping

For each pool file (SCM/LCM), the exporter creates:

- one non-para list per gender (`F`, `M`, `X`) when rows exist
- para lists grouped by gender and handicap number

Para list names always include all three class tags for a handicap number,
for example:

- `Norwegian senior records S9/SB9/SM9`

even if only one or two subclasses have records.


### CSV export output

Two files are produced independently:

- 25m records (`SCM`)
- 50m records (`LCM`)

File names include record type, pool, and production date,
for example `norwegian-senior-records-scm-2026-04-26.lef`.

All generated Lenex files (both converters) use constructor name
`lenex-tools`.


## Build and Deployment

This project is a client-only web app (React + TypeScript + Vite) and is
compatible with GitHub Pages.

### Prerequisites

- Node.js 20+ (recommended)
- npm 10+ (recommended)

### Local development

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite (usually `http://localhost:5173`).

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
4. Add a workflow file at `.github/workflows/deploy-pages.yml` that builds
   with `npm ci` and `npm run build`, then uploads `dist/` and deploys.

#### Option B: Manual upload

1. Run `npm run build`.
2. Publish the contents of `dist/` to your Pages branch/source.

### Notes

- The app uses Vite config `base: './'` so it can be served from GitHub Pages subpaths.
- No server-side code is required or used; all parsing runs in the browser.
