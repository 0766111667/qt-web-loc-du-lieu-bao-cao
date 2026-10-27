# QT Report Aggregator

A local-first web app for consolidating the structured Chinese QT software issue-statistics screenshots.

## Stack
- React + Vite
- Tesseract.js OCR (browser-side, no Gemini API dependency)
- IndexedDB for durable local browser storage
- SheetJS for `.xlsx` export
- Canvas for PNG report export
- Vercel static deployment

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Deploy
1. Push this directory to a GitHub repository.
2. Import that repository into Vercel.
3. Framework preset: Vite; Build command: `npm run build`; Output directory: `dist`.
4. No environment variables are required for this local-first version.

## OCR notes
OCR is run in the browser using Tesseract.js and the Chinese Simplified + English language packs. The first run needs network access to download the OCR worker/language data; browser caching may speed later runs. Extracted values are marked for review before inclusion in totals. This is deliberate: low-confidence OCR must not silently corrupt a monthly report.

## Persistence / scope
- Reports, category names and language choice are stored in IndexedDB and survive refreshes on the same browser profile/device.
- This is not cloud synchronization. If several staff need a shared, central dataset, add a database and authentication before using it as a team-wide source of truth.
- The image's row structure may vary. Always inspect each OCR result and correct values before confirming.

## Security
Images are processed client-side. Do not upload sensitive screenshots to third-party OCR APIs. The Vercel deployment serves static assets only and does not store uploaded images centrally.

## v1.0.1 OCR safety patch
- Removed the page-level drop handler; the drop-zone handler stops propagation to prevent the same drag/drop from processing twice.
- OCR now upscales and mildly normalizes contrast before Tesseract recognition.
- Removed fuzzy character-overlap category matching, which could attach a row to the wrong issue type.
- Rows with insufficient numeric structure remain flagged for review rather than being silently treated as reliable zeros.
- If the printed grand total can be read, confirmation is blocked when the sum of row occurrences does not match it. If OCR confidence/row parsing is uncertain, an explicit review warning appears.

Important: this is a safer failure mode, not a guarantee of 100% OCR accuracy. Photographed, skewed, moiré-heavy or blurry tables still require row-by-row verification. Do not treat unverified OCR output as final accounting data.

## v1.2 validation and usability update
- Page-level Tesseract confidence is now diagnostic only; it does not independently block a report when every row is parsed, row values are valid, and the printed occurrence/resolved totals match.
- Added independent reconciliation for both `发生次数` and `已处理` totals when both are legible in the footer.
- Confirmation still remains blocked for missing rows, invalid row values, missing printed occurrence total, or total mismatch.
- Increased touch targets, numeric input sizes, review card spacing, table row padding and mobile layouts to reduce accidental taps/drags.
- Removed a duplicated IndexedDB save effect.

Build status note: dependency installation could not be completed in this environment due to timeout, so run `npm install` and `npm run build` before deploying this archive.
