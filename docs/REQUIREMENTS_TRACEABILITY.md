# Requirements Traceability

Links each requirement (`REQUIREMENTS.md`) to the code that implements it and the check that covers it.
"Run here" means the check was actually executed during development; **"Manual"** means it still has to be verified on your own computer with real MySQL (see `TESTING.md`).

| Requirement | Implemented in | Verified by |
|---|---|---|
| BR-1, BR-3 | `server/config.js`; `public/js/main.js` (hours) | Unit: `support.test.js` (config sane); browser (hours text) |
| BR-2, FR-RES-5 | `server/routes/reservations.js` (INSERT with `'pending'`); `public/js/reservation.js` | API test "saved as PENDING" (Run here against stand-in; Manual with MySQL); browser success screen |
| BR-4, BR-5, FR-RES-6 | `server/validation.js`; `public/js/api.js` (`getSlotsForBranch`) | Unit: `validation.test.js` (slots, dates, lead time) — Run here |
| BR-6 | `server/validation.js` | Unit: guests test — Run here |
| BR-7 | `server/config.js`, `database.sql` ENUM | Unit: config matches `database.sql` — Run here |
| LIM-1 | (deliberately not built) `README.md` and form text say requests are not confirmed | Review |
| CT-1…CT-5 | `public/index.html` (TBC markers) | Review |
| FR-PUB-1, FR-PUB-2 | `public/index.html`, `public/css/style.css` | Browser: desktop/tablet/mobile checks — Run here |
| FR-PUB-3 | `public/js/main.js` ← `/api/config` | Browser — Run here |
| FR-RES-1, FR-RES-2 | `public/js/reservation.js`; `server/validation.js` | Unit; browser (empty submit, field errors); API invalid-values test |
| FR-RES-4 | `server/routes/reservations.js` (201 only after INSERT); `reservation.js` shows success only on 2xx | Browser (stand-in); **Manual**: stop MySQL, submit, expect an error and no success |
| FR-RES-7 | Honeypot in `index.html`; `rateLimit.js`; route | Unit: rate limiter; API honeypot test |
| FR-ADM-1, SEC-1 | `server/routes/auth.js`, `server/middleware/auth.js`; every staff route uses `requireAdmin` | API: 401 on all staff routes without a session — Run here (stand-in); **Manual** (real) |
| FR-ADM-2 | `server/listQuery.js`; `public/js/admin.js` | Unit: `listQuery.test.js` — Run here; browser filters — Run here |
| FR-ADM-3…6 | `server/routes/reservations.js`; `public/js/admin.js` | API CRUD tests; browser: view, edit, status, delete with cancel — Run here (stand-in) |
| FR-ADM-7 | `public/js/admin.js` | Browser: empty filter state, error text — Run here |
| FR-ADM-8 | `scripts/create-admin.js` | **Manual** (needs MySQL) |
| SEC-2 | `server/session.js`, `routes/auth.js`, `database.sql` | Unit: session tests — Run here; **Manual** login |
| SEC-4 | Placeholders in all queries; `.env`, `.gitignore` | Unit: listQuery; code review; ZIP content check |
| SEC-5 | `admin.js` DOM helpers | Browser: a customer name containing `<img onerror>` stays text — Run here |
| NFR-2 | `style.css`, `admin.css` | Browser: 1440/820/390 px, no horizontal scroll — Run here |
| NFR-3 | HTML structure, `aria-*`, `<dialog>` | Browser spot checks; no automated audit run (see `TESTING.md`) |
| Browser ↔ API match | `public/js/*.js`, `server/routes/*.js` | `npm run check` — Run here |
