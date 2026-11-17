# Project handover

The Sifted Cafe & Bakery reservation site is live, verified, and in maintenance
mode. This page is the short version for whoever comes back to it later.

## Where things live

| What | Where |
|---|---|
| Live site | https://thesiftedcafe.vercel.app |
| Repository | https://github.com/ifwian/the-sifted-cafe (branch `main`) |
| Hosting | Vercel project `thesiftedcafe` (team `ianneolaivar-4585s-projects`) |
| Database, auth, files | Supabase project referenced by the Vercel environment variables |

## Accounts and roles

The app has exactly two roles:

- **`customer`** - can reserve, upload proof, view and cancel their own bookings.
- **`staff`** - full access to the staff console: verify payments, confirm,
  cancel, and complete reservations.

There is no separate "owner" role. An owner account is simply a `staff` account.
Two staff accounts already exist in Supabase Auth (one owner login and one shared
staff login). Their passwords were handed over privately and are **not** stored
in this repository.

Staff sign in at:

```text
https://thesiftedcafe.vercel.app/login.html?next=staff.html
```

To add or promote a staff member:

1. Supabase Dashboard > **Authentication > Users > Add user** (set a password and
   confirm the email).
2. Supabase Dashboard > **SQL Editor**:

   ```sql
   update public.profiles set role = 'staff' where email = 'person@example.com';
   ```

3. The person signs in with the staff link above. To demote, run the same query
   with `'customer'`.

The role can only be changed from SQL (the database blocks role changes made from
the app), so staff cannot promote themselves.

## Daily commands

```bash
npm run dev      # local site + API on http://localhost:3000
npm test         # unit tests + API tests (API tests need a local PostgreSQL)
```

No `npm install` is required: the project has no runtime dependencies.

## Deploying

Push to `main`; Vercel deploys automatically. There is no build step.

```bash
git push origin main
```

Environment variables live in Vercel > Project > Settings > Environment
Variables (names are listed in `.env.example`). `SITE_URL` must match the live
address with no trailing slash.

## API rule that matters

Vercel only routes **one path segment** to a function in this project. Every
nested endpoint therefore goes through one function:

```text
/api/customer/me  ->  /api/router?__path=customer%2Fme
```

`public/js/shared.js` rewrites API URLs automatically, so page code can keep
using normal `/api/...` paths. `api/router.js` rebuilds the original path and
hands it to the route table in `lib/routes.js`.

- To add or change an endpoint, edit the table in `lib/routes.js`. Do **not**
  create `api/foo/bar.js` - it will 404 on Vercel.
- `api/config.js` is kept as a direct health endpoint (`/api/config`).
- `api/router.js` and `api/config.js` are the only files that should live in
  `api/`.

## Verified state

- Live endpoints return JSON (not Vercel's plain-text 404): config, customer
  session, availability, reservations, payments, and staff routes.
- Owner and staff logins were tested against production: both sign in, both see
  the staff reservation list.
- `npm test`: 6 pass, 1 skipped (the PostgreSQL suite is skipped when no local
  database is available).
- New reservations must be at least 24 hours ahead; the rule is enforced in the
  database, not just the browser.

## Known limits

- GCash payment is a manual proof upload; staff compare the screenshot by hand.
- Password-reset email depends on Supabase SMTP. The built-in sender is heavily
  rate-limited, so configure custom SMTP before relying on it.
- Supabase Free pauses after a week of inactivity and has no automatic backups.
- Vercel Hobby is for non-commercial use; move to Pro before running a real
  paying business on it.

See `README.md` for the full feature list and `DEPLOYMENT.md` for first-time
setup.
