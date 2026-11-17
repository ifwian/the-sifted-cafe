# Test report

Run on 16 Nov 2026 in a sandbox **without internet access to Supabase or Vercel and without your credentials**. So: database logic was tested on a real local PostgreSQL 16 with the real `schema.sql`; the Node API was tested against a **mock** of the Supabase HTTP services (the mock runs the real schema); the pages were tested in headless Chromium with a mocked API. **No test touched a real Supabase project or a deployed Vercel site.**

## 1. Tested and passing
| Area | How | Result |
|---|---|---|
| Schema imports on a fresh DB, and re-runs cleanly | `tests/run_db_tests.sh` | PASS |
| Profile created on sign-up, role always `customer` (even if sign-up sends `staff`) | DB test | PASS |
| 24-hour rule: <24h, 12h, past date rejected; first slot after now+24h accepted; `slot_availability` marks same-day slots not bookable | DB test (DB clock, Asia/Manila) | PASS |
| Opening hours, non-hourly time, min/max guests, unknown branch, >60 days, bad payment option | DB test | PASS |
| Capacity (20 at Calamba): partial fill, exact last seats, over-capacity refused, cancel releases seats | DB test | PASS |
| **Concurrency**: 10 simultaneous bookings of 4 guests into a 20-seat slot: exactly 5 succeed, 20 guests booked | `run_db_tests.sh` | PASS |
| Duplicate open booking by same customer | DB + API test | PASS |
| RLS/privileges: anon cannot read/book; customer cannot insert/update reservations or payments, change role, call staff functions, read proof paths; customer sees only own rows; staff sees all | DB test + API test | PASS |
| Staff workflow: verify needs a proof; confirm needs verified payment; reject payment + customer re-submits proof; complete; archive; restore; delete (cascades, proof file removed) | DB + API test | PASS |
| API: register validation, duplicate email, login, wrong password, logout, HttpOnly/SameSite cookies, CSRF (missing header, foreign origin) | `tests/api.test.js` (19 checks) | PASS |
| API: signed-out access refused on every protected route; customers get 403 on all staff routes; new accounts are not staff | API test | PASS |
| API: 24h rule via direct API call (yesterday/today/12h ahead), bad time/guests/option/date, bot trap, missing proof | API test | PASS |
| API: browser-sent `total_amount`/`payment_status` are ignored (DB computes 800 / 240 / proof_submitted) | API test | PASS |
| Upload safety: wrong type/oversize refused; HTML renamed `.png` is rejected by content sniffing and deleted; orphan uploads cleaned after failed booking | API test | PASS |
| Unit tests: the four requirement examples, 9:59:59/10:00:01 boundary, UTC server vs Manila, file sniffing, amounts | `tests/validate.test.js` (6) | PASS |
| Reservation form in Chromium (desktop 1280px + mobile 390px): terms gate, prefilled contact, date picker min = earliest allowed date, slots blocked/allowed correctly, all fields fillable, 24h message, same-day rejected without sending, double-click sends one request, no price fields sent, success screen, no horizontal scroll, no JS errors | `tests/ui-check.js` (26) | PASS |
| All 10 pages load with no JS errors, no missing local files or dead links; staff page renders rows, hides Confirm until verified, opens details with proof link, sends the verify action, mobile layout | `tests/pages-check.js` | PASS |
| `vercel.json` valid JSON; no `localhost`/XAMPP/MySQL/PHP references remain in `public/` or server code | grep | PASS |

Bugs found and fixed by these tests: ambiguous `generate_series` on `smallint` in the schema; NULL `detail` in error helper; staff page helper rendering arrays as text.

## 2. Implemented but NOT tested (needs your real accounts)
* Real Supabase Auth behaviour (sign-up, login, refresh, "Confirm email" ON, password-reset email and the `#access_token` link).
* Real Supabase Storage: the signed-upload `PUT` (multipart format copied from supabase-js; the mock accepts it, the real service not yet verified), signed read link for staff.
* Real PostgREST query syntax (the mock translates the same filters; `or=(...ilike...)` search in particular).
* Vercel deployment itself: `vercel.json` (`outputDirectory: public`, headers), single API function `api/router.js` (plus the public `api/config.js`), environment variables, and the Content-Security-Policy (checked only for syntax, not against the live site; if the map or fonts break, loosen `vercel.json` headers).
* The "production API connectivity" test: **not possible here**.
* Real mobile devices (only emulated viewport).
* Staff page `?view=archive`, filters and notes were exercised in API/DB tests but not clicked through in the browser.

## 3. Requires manual configuration by you
Everything in DEPLOYMENT.md: Supabase project, running `schema.sql`, Auth URL settings, 4 environment variables, GitHub push, Vercel import, creating the first staff account, setting real prices in `cafe_settings`, SMTP for emails.

## 4. Known limitations
* No rate limiting beyond Supabase Auth's.
* Capacity is counted per exact hourly slot (as in the original), not across the 2-hour table time of overlapping slots.
* Customer/staff page protection in the browser is a redirect only; the real protection is the API + database (verified above).
* The "original reservation form problem" could not be reproduced without your PHP/MySQL environment. Likely causes found and removed: availability and rules hardcoded separately in JS and PHP (guest range text said 2-10 while code allowed 30), date limit based on the visitor's own clock, and a form that depended on the PHP session page. The form now loads rules from the server and passes the browser tests above; if you still see a specific problem, tell me the exact field/behaviour.
