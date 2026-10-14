# Security notes

What is implemented, and what is **not**.

## Implemented
| Area | Measure | File |
|---|---|---|
| Passwords | bcrypt (cost 12), minimum 12 characters when creating an admin, never logged or stored in plain text | `scripts/create-admin.js`, `routes/auth.js` |
| Login timing | A dummy hash is compared when the username does not exist, so wrong-user and wrong-password answers look and take alike | `routes/auth.js` |
| Sessions | 32 random bytes in an **HttpOnly, SameSite=Strict** cookie (`Secure` when `NODE_ENV=production`); only the SHA-256 hash is stored; expires after `SESSION_HOURS` (default 8); logout deletes it | `session.js`, `middleware/auth.js` |
| Route protection | Every staff route runs `requireAdmin` on the server | `routes/reservations.js` |
| CSRF | SameSite cookie plus a required `X-Requested-With: fetch` header on all non-GET staff requests | `middleware/security.js` |
| SQL injection | Only parameter placeholders (`?`); sort order comes from a fixed list; LIKE wildcards escaped; LIMIT/OFFSET are validated integers | all `server/` queries, `listQuery.js` |
| XSS | Customer text is inserted with `textContent`/DOM methods, never `innerHTML`; Content-Security-Policy allows only own scripts and Google Fonts styles | `admin.js`, `security.js` |
| Headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP; `X-Powered-By` removed | `security.js` |
| Input | Server re-validates everything; body limited to 20 KB; control characters stripped | `validation.js`, `server.js` |
| Abuse | Honeypot field; 10 saved requests / 15 min and 10 logins / 15 min per device (in memory, resets on restart) | `rateLimit.js` |
| Secrets | `.env` is git-ignored and excluded from the ZIP; `.env.example` has placeholders only; the browser never receives DB credentials | `.gitignore` |
| Errors | Visitors see friendly text; technical details go only to the terminal | `dbErrors.js` |

## Not implemented (limitations to mention in your report)
- **No HTTPS.** Local development uses plain HTTP. If deployed, put the site behind HTTPS and set `NODE_ENV=production` so cookies get `Secure`.
- The rate limiter is per-process memory and trusts `req.ip`; behind a proxy you must configure Express `trust proxy`.
- One admin role; no password-reset page (rerun `npm run create-admin` and choose the same username), no two-factor login, no audit log of who changed what.
- No automatic data-retention or privacy notice (waiting for the owner, see `PRIV-1`).
- Dependencies were not audited with `npm audit` in the build environment (the npm registry was unreachable there). Run `npm audit` on your computer.
- The Google Fonts stylesheet is loaded from Google; the page still works with fallback fonts if it is blocked.

## Good habits
Never commit `.env`. Use a strong, unique admin password. Give the MySQL user only the permissions it needs if you deploy (the school project may use `root` locally).
