# QT Report Aggregator 2.0

A rebuilt static web app with a desktop two-column / mobile one-column layout, Chinese/Vietnamese/English UI, client-side OCR, explicit reconciliation gates, image duplicate hashing, edit/review queue, local persistence, CSV (Excel-compatible) and PNG export.

## Run and build
Requires Node.js 18+.

```bash
npm run dev
npm test
npm run build
```

`npm run build` performs a static production packaging check and writes `dist/`. This project intentionally uses no build-time third-party dependencies. OCR loads Tesseract.js and its Chinese/English language data from jsDelivr on first use, so first recognition requires network access. Mobile performance depends on the device and browser.

## Vercel
Import the repository and use build command `npm run build`, output directory `dist`. This is a static deployment. Deployment has NOT been performed by this source package.

## OCR accuracy and safeguards
- Browser-side Tesseract.js; first attempt plus contrast-enhanced retry.
- Text parsing is conservative and only accepts a row if a row number or exact Chinese label can be associated with two numeric cells. OCR parsing of perspective photos is inherently imperfect.
- Confirmation is blocked unless all 16 rows are considered read, values are valid, and both totals read from the source image match calculated sums. This is a safety gate, not a guarantee that OCR has 100% accuracy.
- Optional fallback endpoint can be configured in Settings. It receives the full image as base64. You must deploy and secure that endpoint yourself; no paid AI provider is configured by default and no fallback costs occur unless configured.
- Identical image bytes are hashed with SHA-256; duplicates require an explicit override. A database unique constraint on image_hash is also provided.

## Persistence and cloud
Local browser storage uses localStorage for the report records/config. It survives refreshes on the same browser profile, but is not cross-device and can be cleared by browser settings. For team sync, create a Supabase project, run `supabase/schema.sql`, then enter the project URL and public anon key in Settings. Never put a service-role key in the browser. The included RLS policy is per-user, not shared-team access. To enable shared team reporting, add a team membership model and policies before production use. Cloud sync currently writes confirmed reports; initial cross-device pull/auth UI and conflict-resolution are not implemented yet, so treat cloud integration as a starter adapter, not a finished multi-user system.

## Exports
The export button creates UTF-8 CSV that opens in Excel. It is not a native `.xlsx` workbook. PNG is rendered from the monthly summary.

## Test limits
Build checks validate required source files and create `dist/`. They do not prove OCR accuracy on all images, browser compatibility, Supabase permissions, or successful Vercel deployment. Test with a known set of real reports before production use.
