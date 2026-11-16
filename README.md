# The Sifted Cafe & Bakery: online reservations

A real, deployable version of the school project: customers register, reserve a table (24 hours in advance), pay a GCash downpayment by uploading proof; staff verify payment and manage reservations.

**Stack (all free tier):** static HTML/CSS/vanilla JS on **Vercel** + **Vercel Node.js serverless function** (`api/`, no npm packages) + **Supabase** (PostgreSQL, Auth, private Storage) + GitHub.

```
public/        the website (your original design, pages and assets)
api/           Vercel function entry (api/[...path].js)
lib/           server code: routes.js (endpoints), session.js, supa.js, validate.js, time.js, http.js
supabase/      schema.sql (run once), seed.sql (optional demo data), README.md
tests/         automated tests (see TEST_REPORT.md)
vercel.json    hosting config + security headers
.env.example   variable NAMES only
```

## Why Node instead of PHP on Vercel
Vercel's PHP support is an unofficial community runtime (extra config, often stale, cold starts, no MySQL). The app also stores uploads on local disk and sessions in PHP files, neither of which exist on serverless hosting. Rewriting only the backend to Node (about 700 lines) while keeping every page, style and script kept the design intact and is easier to maintain. PHP files, XAMPP/MySQL setup, and the old owner-dashboard leftovers (`owner*.php`, `owner.css`) were not carried over.

## How it works
* The browser only talks to `/api/*` on the same site. It never sees a Supabase key.
* Login uses **Supabase Auth**; the session is kept in HttpOnly cookies.
* The API calls the database **as the logged-in user**, so Row Level Security applies. The service-role key is used only for private file storage.
* Business rules (24 h notice, capacity, price, status changes) live in database functions; the API and the form repeat the checks only to give friendly messages.

## Run the tests locally
```
bash tests/run_db_tests.sh      # schema, RLS, 24h rule, concurrency (needs local PostgreSQL)
node --test tests/*.test.js     # API end-to-end + unit tests (needs local PostgreSQL)
node tests/ui-check.js          # browser tests (needs Playwright)
node tests/pages-check.js
```
There is nothing to install for the app itself (`npm install` not needed).

## Deploy
See **DEPLOYMENT.md** (step by step). Test results: **TEST_REPORT.md**.

## Free-tier limits that matter for a real business
* **Vercel Hobby plan is for non-commercial use** (Vercel's terms). A school project is fine; an actual paying café should move to Vercel Pro (paid) or another host. Decide this before real launch.
* **Supabase Free pauses a project after 1 week of no activity**; you must click "Restore". Real daily traffic keeps it awake, a quiet café may not. Free plan has **no automatic backups**: export the database regularly.
* **Supabase built-in email is very limited** (a few emails per hour) and meant for testing. Confirmation and password-reset emails will fail under real use. Either turn "Confirm email" OFF (accepting unverified emails) or add free custom SMTP (e.g. Resend/Brevo free tier).
* Limits: 500 MB database, 1 GB file storage (proofs are max 3 MB: roughly 300+ proofs per GB), 50,000 monthly users. Vercel functions time out after 10 s on Hobby. More than enough for one café.
* No rate limiting exists beyond Supabase Auth's own. A determined bot could create junk accounts.
* GCash is manual: staff must compare the screenshot with the café's own GCash records. A screenshot can be faked.
