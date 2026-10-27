# QT Report Aggregator 2.1.0

A rebuilt static web app with a desktop two-column / mobile one-column layout, Chinese/Vietnamese/English UI, client-side OCR, explicit reconciliation gates, image duplicate hashing, edit/review queue, local persistence, CSV (Excel-compatible) and PNG export, serialized batch OCR, trace-to-source highlighting, backlog warnings, aliases, and reset/undo controls.

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
- Browser-side Tesseract.js; first attempt plus contrast-enhanced retry and bottom-region total pass.
- Batch images are queued and processed sequentially through the shared OCR worker to avoid concurrent worker collisions.
- Text parsing is conservative and only accepts a row if a row number or exact Chinese label can be associated with two numeric cells. OCR parsing of perspective photos is inherently imperfect.
- The app requires all 16 rows to be parsed and validates non-negative integers plus processed <= occurrences. When printed totals are unreadable or conflict with row sums, the app records totals calculated from the 16 rows and visibly marks that the printed total was not independently read. Review row values before confirmation; this avoids blocking every image solely because the bottom total OCR failed, but does not independently verify a misread row.
- Optional fallback endpoint can be configured in Settings. It receives the full image as base64. You must deploy and secure that endpoint yourself; no paid AI provider is configured by default and no fallback costs occur unless configured.
- Identical image bytes are hashed with SHA-256; duplicates require an explicit override. A database unique constraint on image_hash is also provided.

## Persistence and cloud
Local browser storage uses localStorage for the report records/config. It survives refreshes on the same browser profile, but is not cross-device and can be cleared by browser settings. For team sync, create a Supabase project, run `supabase/schema.sql`, then enter the project URL and public anon key in Settings. Never put a service-role key in the browser. The included RLS policy is per-user, not shared-team access. To enable shared team reporting, add a team membership model and policies before production use. Cloud sync currently writes confirmed reports; initial cross-device pull/auth UI and conflict-resolution are not implemented yet, so treat cloud integration as a starter adapter, not a finished multi-user system.

## Exports
The export button creates UTF-8 CSV that opens in Excel. It is not a native `.xlsx` workbook. PNG is rendered from the monthly summary.

## Test limits
Build checks validate required source files and create `dist/`. They do not prove OCR accuracy on all images, browser compatibility, Supabase permissions, or successful Vercel deployment. Test with a known set of real reports before production use.

## Important limitation
This is a static browser app. It has not been deployed to GitHub/Vercel from this workspace. Browser OCR still requires network access to load Tesseract.js and Chinese language data on first run. The source package has passed syntax/build checks and automated structural tests, but must be verified in a real browser against the team’s image set before production use.
