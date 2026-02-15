# UNI_p to Lenex converter

This is a UNI_p to [Lenex](https://wiki.swimrankings.net/index.php/swimrankings:Lenex)
converter running in your web browser. You can upload a Lenex file and a
UNI_p file with registrations for an event, and you will get a Lenex file
back with the entries included.

The tool does basic checks of the contents of the UNI_p file. Please be aware
that there might still be cases that are not handled correctly.

Use at your own risk, and please manually verify the contents of the resulting
Lenex file.

The tool is deployed to [Github pages](https://hakostra.github.io/unip-to-lenex/)
and can be used from there.


## UNI_p file description

The UNI_p file is a plain text file with comma-separated data. The encoding
cannot be determined automatically, but we assume ISO-8859-1 by default.

The first line of the UNI_p file is the name of the club.

After that come comma-separated columns of entries, one entry per line.
The columns are as follows:

  1. Event number. Mandatory.
  2. Distance of the event, in meters. Mandatory.
  3. Stroke. Mandatory.
  4. Last name. Mandatory.
  5. First name. Mandatory for individual entries, optional for relays.
  6. Unknown content, usually empty.
  7. Gender + agegroup/class. Mandatory.
  8. Year of birth or class. Optional.
  9. Qualification time, in format `mm:ss.00` (`mm`: minutes, `ss.00`: seconds). Optional.
  10. Unknown content, usually empty.
  11. Date of qualification time. Optional.
  12. Place of qualification time. Optional.
  13. Length of pool for qualification time. Optional.
  14. Unknown content, usually empty.
  15. Unknown content, usually empty.

### Field 2: Distance
This is either the distance of the event in meters, or on the form 4*50, where
4 is the relay count and 50 is the length of each relay leg (maps to relay
count and distance in the Lenex file).

### Field 3: Stroke
The UNI_p definition of stroke maps to the Lenex notation as:

  * `FR`: `FREE`
  * `BR`: `BREAST`
  * `RY`: `BACK`
  * `BU`: `FLY`
  * `IM`: `MEDLEY` (individual medley)
  * `LM`: `MEDLEY` (relay medley)

### Field 4 and 5: last and first name
This is the name of the swimmer. For relay events, the last name field is
usually the name of the relay team and the first name (field 5) is empty.

### Field 7:
Three characters. The first is a letter (`M`, `K`, `X`), which can be
decoded/translated as:

  * `M`: Men / `M`
  * `K`: Female / `F`
  * `X`: Mixed / `X`

The last two characters are interpreted as follows:

  * 2 digits: last two digits of the birth year
  * `JR`: Junior
  * `SR`: Senior
  * `MA`: Masters A
  * `MB`: Masters B

and so on for master classes from MA to MO.

### Field 8:
Complete 4-digit year of birth *or* class.

  * 4 digits: birth year
  * `JUNIOR`: Junior
  * `SENIOR`: Senior
  * `MASTERS`: Masters entry
  * `MASTERSA`: Masters A class and so on for B, C, D etc.
  * `S1`-`S15`, `SB1`-`SB15`, `SM1`-`SM15`: Para/handicap classes

### Field 13: Qual. time pool length
The length of the pool where the qualification time was set. Can be decoded
to Lenex as follows:

  * `K`: `SCM` (25 meter short course)
  * `L`: `LCM` (50 meter long course)


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
