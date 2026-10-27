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
