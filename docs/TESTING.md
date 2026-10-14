# Testing

Honest summary: the checks below were run in the build environment on **2026-10-13/14**. That environment had **no MySQL server** and its network policy **blocked the npm registry**, so `npm install` could not run and the real Express + MySQL stack was **never started there**. Everything that needs them is listed under *Not run here* and must be verified on your computer (steps at the end).

## What was run, and the actual result

| # | Check | How | Result |
|---|---|---|---|
| 1 | JavaScript syntax of every file in `server/`, `scripts/`, `public/js/`, `tests/` | `node --check` | **Pass** (no errors) |
| 2 | Unit tests: validation, search/filter SQL builder, sessions, rate limiter, DB error messages, config ↔ `database.sql` consistency | `npm test` | **37 of 37 pass** |
| 3 | Browser calls match real server routes | `npm run check` | **Pass**: 13 browser calls, 12 server routes, none missing |
| 4 | Live API test suite (20 tests) against a **stand-in server** (same API contract, in-memory data, real `validation.js`/`listQuery.js`/`session.js`) | `npm run test:api` pointed at the stand-in | **19 pass, 1 fail.** The failure is "security headers are sent": the stand-in does not send the Content-Security-Policy header that the real server sends. It says nothing about the real server. |
| 5 | Browser end-to-end test (Chromium via Playwright) against the same stand-in: 25 checks | script (not shipped) | **25 of 25 pass** |
| 6 | Visual inspection of screenshots at 1440, 820 and 390 px (landing page and admin) | manual | Layout as intended; no horizontal scrolling |

### The 25 browser checks
Desktop: reservation panel right of the hero · branches load · empty submit shows errors · times appear after choosing branch and date · valid submit shows reference, "Pending" and "NOT confirmed". Phone/tablet: no horizontal scroll · form stacks under the hero text · menu button opens the nav. Gallery photo viewer opens and closes with Escape. Admin: wrong password shows an error · sign-in · list shows all rows · a name containing `<img onerror=...>` is shown as text · status filter · "no match" empty state · status change from the detail view · server-side error on invalid edit (guests = 0) · successful edit refreshes the list · **cancel keeps the record** · **confirmed delete removes it** · admin page has no horizontal scroll on a phone · sign-out · no JavaScript errors.

### Test cases covered by the API suite (`tests/api/api.test.js`)
Public: config, headers, pages served, empty body → 400 with field errors, nine invalid-value cases → 400, malformed JSON → 400, honeypot → 400, valid request → 201 **pending** even if the sender asks for `confirmed`.
Protection: all seven staff routes → 401 without a session, fake cookie → 401, bad logins → 400/401, login without security header → 403.
CRUD (needs an admin): login cookie flags · create + read + list search · filters/sort/paging and bad queries (including an injection-style search string) · full edit and 400 on bad edit · status-only update · DELETE without header → 403 · delete → then 404 · logout → 401.

## Not run here (manual verification still required)
- `npm install` and starting the real server with `npm start`.
- Executing `database.sql` and every real SQL statement; real `mysql2` pool behaviour.
- Real bcrypt login, `npm run create-admin`, session expiry in MySQL.
- **Database error handling**: stop MySQL and confirm the form shows an error and **no** success message, and `/api/health` returns 503. (The error-to-message mapping itself is unit-tested.)
- The real server's headers (test 4 will check them on your machine).
- Accessibility audit tools (axe/Lighthouse), screen-reader testing, Firefox/Safari/Edge, real phones.
- The Google Fonts and Google Maps links (no internet to Google in the build environment; fallback fonts were used in the screenshots).

## How to run everything on your computer
```
npm install
npm test                 # unit tests, no database needed
npm run check            # browser ↔ server route check
npm start                # in one terminal (after database + .env + create-admin)
```
Then, in a **second** terminal (PowerShell):
```
$env:TEST_ADMIN_USER="your-admin-username"
$env:TEST_ADMIN_PASSWORD="your-admin-password"
npm run test:api
```
Expected: all tests pass. Created test records are named "Test Automated" and are deleted automatically. Without the two variables the admin tests are skipped and the output says so.

## Manual checklist (about 10 minutes)
1. Open `http://localhost:3000`: hero, reservation panel, all sections, TBC markers visible.
2. Submit an empty form → field errors. Submit a valid request → success box with `SC-xxxxx`, status Pending.
3. In MySQL Workbench: `SELECT * FROM sifted_cafe_db.reservations;` shows the row.
4. `http://localhost:3000/admin`: wrong password rejected; correct password opens the list.
5. View, edit, change status, delete (cancel first, then confirm). Check the database after each.
6. Stop MySQL, submit the public form → error message, **no** success. Start MySQL again.
7. Resize the browser to phone width; check both pages.
8. Open `http://localhost:3000/api/reservations` while signed out → `{"error":"Please sign in."}`.
