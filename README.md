# The Sifted Cafe — Website with Reservations and Admin Page

A school project: a responsive café landing page with a reservation form, and a staff page to
manage reservations (create, read, update, delete) stored in MySQL.

**Stack:** HTML5, CSS3, vanilla JavaScript · Node.js + Express · MySQL (set up with MySQL
Workbench) · VS Code.

> **Draft status.** The café owner has not been interviewed yet. Business rules (hours, time slots,
> limits) are provisional defaults and items marked **TBC** on the site wait for the owner.
> Reservations are **requests** that start as *Pending*; the system never promises a table and does
> **not** check availability. See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md).

## Contents

1. [Prerequisites (Windows)](#1-prerequisites-windows)
2. [Extract and open](#2-extract-and-open)
3. [Install dependencies](#3-install-dependencies)
4. [Create the database](#4-create-the-database)
5. [Configure `.env`](#5-configure-env)
6. [Create the first admin account](#6-create-the-first-admin-account)
7. [Start the server](#7-start-the-server)
8. [Try it](#8-try-it)
9. [Automated tests](#9-automated-tests)
10. [Troubleshooting](#10-troubleshooting)
11. [Project structure](#11-project-structure)
12. [After the owner interview](#12-after-the-owner-interview)
13. [Deploying to Vercel (optional)](#13-deploying-to-vercel-optional)

---

## 1. Prerequisites (Windows)

1. **Node.js** 18.18 or newer (LTS) from nodejs.org. Check in a terminal: `node -v`.
2. **MySQL Server 8.0.16 or newer** and **MySQL Workbench** (MySQL Installer for Windows installs
   both). Remember the `root` password you choose.
3. **Visual Studio Code**.

## 2. Extract and open

Extract `TheSiftedCafe_SchoolProject.zip` (right-click → *Extract All*). In VS Code:
**File → Open Folder…** and choose the extracted `TheSiftedCafe` folder. Open the terminal with
**Terminal → New Terminal**.

## 3. Install dependencies

```bash
npm install
```

This downloads Express, mysql2, bcryptjs and dotenv into `node_modules`.

## 4. Create the database

1. Open **MySQL Workbench** and connect to *Local instance MySQL*.
2. **File → Open SQL Script…** → select `database.sql` in the project folder.
3. Click the **lightning bolt** (Execute). You should see green check marks in the output.
4. Verify by running:

   ```sql
   USE sifted_cafe_db;
   SHOW TABLES;
   ```

   Expected tables: `admin_sessions`, `admins`, `reservations`.

## 5. Configure `.env`

In the VS Code terminal:

```bash
copy .env.example .env
```

Open `.env` and set `DB_PASSWORD` to your MySQL password (and `DB_USER` if you do not use `root`).
Leave the rest as is. **Never share `.env`.**

## 6. Create the first admin account

```bash
npm run create-admin
```

Type a username, then a password of at least 12 characters (each character appears as a `•` dot
while typing) and repeat it. There is no default password. Run the same command again with the same
username to reset a forgotten password.

## 7. Start the server

```bash
npm start
```

You should see:

```text
The Sifted Cafe is running:
  Website: http://localhost:3000/
  Admin:   http://localhost:3000/admin
  Database: connected
```

- Public website: **http://localhost:3000/**
- Admin page: **http://localhost:3000/admin**
- Health check: http://localhost:3000/api/health

Stop the server with `Ctrl + C`. Do not open the HTML files by double-clicking them; the pages need
the server.

## 8. Try it

- **Create** — on the website, fill in the reservation form and send it. You should see a box with a
  reference such as `SC-00001` and the status *Pending*. Check it in Workbench:
  `SELECT * FROM sifted_cafe_db.reservations;`
- **Read / search** — sign in at `/admin`; the new request appears. Try the status cards, search box,
  branch/date filters and sorting.
- **Update** — *View* → choose **Confirm** (or another status); *Edit* → change details or add a
  private note → *Save changes*.
- **Delete** — *Delete* → a confirmation appears → *Yes, delete*. *Keep it* leaves the record
  untouched.

A fuller checklist is in [`docs/TESTING.md`](docs/TESTING.md).

## 9. Automated tests

| Command | What it does | Needs database? |
| :-- | :-- | :-- |
| `npm test` | 37 unit tests (validation, search builder, sessions, limits, config) | No |
| `npm run check` | Confirms every browser request matches a real server route | No |
| `npm run test:api` | 20 API tests against the running server (start `npm start` first). To include the admin tests set `TEST_ADMIN_USER` and `TEST_ADMIN_PASSWORD` first (see [`docs/TESTING.md`](docs/TESTING.md)) | Yes |

## 10. Troubleshooting

| Message / symptom | Fix |
| :-- | :-- |
| `'npm' is not recognized` | Install Node.js, then close and reopen VS Code. |
| `DATABASE PROBLEM: Cannot reach MySQL` | Start MySQL (Windows *Services* → MySQL80 → Start). Check `DB_HOST`/`DB_PORT` in `.env`. |
| `MySQL refused the login` | Wrong `DB_USER`/`DB_PASSWORD` in `.env`. Test the same login in Workbench. |
| `The database does not exist` / `A table is missing` | Run `database.sql` again in Workbench (step 4). |
| `ER_NOT_SUPPORTED_AUTH_MODE` or "client does not support authentication protocol" | Update `mysql2` with `npm install mysql2@latest`, or use a MySQL 8 user with the default authentication. |
| `EADDRINUSE: address already in use :::3000` | Another program uses port 3000. Close it or set `PORT=3001` in `.env` (then use that port in the URLs). |
| Reservation form says it "could not load" | You opened the file directly or the server is not running. Use `http://localhost:3000`. |
| Cannot sign in to `/admin` | Create or reset the account with `npm run create-admin`. After 10 wrong attempts wait 15 minutes. |
| "No admin account yet" printed at startup | Run `npm run create-admin`. |
| Fonts look different | The Google Fonts link needs internet; the site falls back to system fonts. |

## 11. Project structure

```text
TheSiftedCafe/
  public/            index.html, admin.html, css/ (base, style, admin), js/ (api, main, reservation, admin), images/
  server/            server.js, config.js (business rules), database.js, validation.js, listQuery.js,
                     session.js, dbErrors.js, routes/ (reservations, auth), middleware/
  api/               index.js and [...path].js — Vercel entry points (section 13)
  scripts/           create-admin.js, check-endpoints.js, run-tests.js
  tests/             unit/, api/
  docs/              INTERVIEW_QUESTIONNAIRE, REQUIREMENTS, REQUIREMENTS_TRACEABILITY, DATABASE, API,
                     SECURITY, TESTING, DEVELOPMENT_NOTES
  database.sql  .env.example  package.json  vercel.json  README.md
```

## 12. After the owner interview

Use [`docs/INTERVIEW_QUESTIONNAIRE.md`](docs/INTERVIEW_QUESTIONNAIRE.md). Then update
[`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md), the values in `server/config.js` (branches, hours,
slot length, limits), and the **TBC** text in `public/index.html`.

## 13. Deploying to Vercel (optional)

Puts the site online at an address like `https://the-sifted-cafe.vercel.app`. Everything above still
works the same way on your own computer; nothing here is needed for the local version.

### What the two new files do

| File | Why it exists |
| :-- | :-- |
| `api/index.js` | Vercel turns every file in `api/` into a serverless function. This one answers `/api`. |
| `api/[...path].js` | Same app, but for `/api/...` (`/api/health`, `/api/reservations`, …). The file name is a "catch-all": Vercel sends every remaining path segment to it. |
| `vercel.json` | `cleanUrls` (so `/admin` opens `admin.html`) plus the security headers. On Vercel the HTML and CSS are served straight from the CDN and never pass through Express, so the headers have to be repeated here. |

Both entry points export the **same** Express app from `server/server.js`, which is why there is only
one copy of the code. Nothing was duplicated.

### Before you start

1. The database must be reachable from the internet. MySQL on your own computer works for local use
   but **not** from Vercel — use a hosted MySQL (Aiven, PlanetScale, Amazon RDS, Railway, …).
2. Load `database.sql` into that hosted database and create the admin account with
   `npm run create-admin` (run it on your computer, pointing at the hosted server).

### Steps

1. Push the project to GitHub (it already is a Git repository).
2. On Vercel choose **Add New → Project** and import the repository.
3. Set **Framework Preset** to **Other** and leave the build command empty.
4. Before the first deploy, add these under **Settings → Environment Variables** (mark them for
   *Production*; also tick *Preview* if you want preview deployments to work):

   | Variable | Value |
   | :-- | :-- |
   | `DB_HOST` | host name of the hosted database |
   | `DB_PORT` | usually `3306` |
   | `DB_USER` | database user |
   | `DB_PASSWORD` | database password |
   | `DB_NAME` | `sifted_cafe_db` |
   | `DB_SSL` | `true` — cloud databases need an encrypted connection |
   | `SESSION_HOURS` | `8` |

5. Deploy, then open **https://your-app.vercel.app/api/health**. It must answer
   `{"status":"ok","database":"connected"}`. Open **Logs** in Vercel if it says `"error"`.
6. Check the website and **/admin**, and sign in to the admin page once — that proves the session
   cookie is being set correctly over HTTPS.

`.env` is never uploaded (it is in `.gitignore`), which is why the values above are typed into the
Vercel dashboard instead of edited in a file.

### Deploying again after a change

Push to GitHub; Vercel redeploys automatically. Preview deployments get their own address for pull
requests, so you can check a change without touching the live site.

### Good to know (worth telling the marker)

- **Rate limits.** The login and reservation limits are counted in the memory of one running copy of
  the app. Vercel runs several copies at once, so a counter restarts more often than on one local
  server. The limits still work, they are just less exact.
- **Database pool.** `server/database.js` uses a pool of 2 connections on Vercel and 10 locally, so
  the many parallel copies do not flood the database.
- **Free plan.** Vercel's free plan is for personal, non-commercial use only.

### If something goes wrong

| Symptom | Fix |
| :-- | :-- |
| `/api/health` says `"database":"unavailable"` | Check the environment variables and that the hosted database allows connections from anywhere. The exact reason is in **Logs**. |
| `ER_ACCESS_DENIED_ERROR` / login refused | Wrong `DB_USER` or `DB_PASSWORD` in the Vercel settings. |
| `CERT_HAS_EXPIRED` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | The provider uses its own certificate authority. Add its CA certificate as `ca` in the `ssl` option in `server/database.js`. Do **not** set `rejectUnauthorized: false` — that switches the certificate check off. |
| The website 404s but the API works | Vercel is not serving `public/`. Check the build settings for the project. |
| Cannot sign in on the deployed site, but it works locally | The login cookie is only marked `Secure` in production, and Vercel sets `NODE_ENV=production` for you. Check that `SESSION_HOURS` is set. |
