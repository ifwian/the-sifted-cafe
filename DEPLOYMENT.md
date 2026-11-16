# Deployment guide (beginner friendly, cost: 0 pesos)

You need: a GitHub account, a Supabase account, a Vercel account (sign in with GitHub). Do the steps in order.

## A. Supabase

1. **Create account**: go to supabase.com > Start your project > sign in with GitHub.
2. **New project**: New project > name `thesifted` > create a strong Database Password (save it in a password manager; the app does not need it) > Region: **Southeast Asia (Singapore)** > Plan: **Free** > Create. Wait about 2 minutes.
3. **Import the schema**: left menu **SQL Editor** > New query > open `supabase/schema.sql` from this project, copy everything, paste, click **Run**. You should see "Success. No rows returned". (Safe to run again.)
4. **Authentication settings**: left menu **Authentication**
   * **Sign In / Providers > Email**: make sure Email is enabled. Set **Confirm email**: OFF for a first launch (see the email limits in README), or ON if you have configured custom SMTP.
   * **URL Configuration**: *Site URL* = your Vercel address (fill in after step B6, e.g. `https://thesifted.vercel.app`). Under *Redirect URLs* add `https://thesifted.vercel.app/reset-password.html`.
5. **Storage**: left menu **Storage**. You should already see a bucket **payment-proofs** marked *Private* (created by schema.sql). If missing: New bucket > name `payment-proofs` > Public OFF > file limit 3 MB > allowed types `image/png, image/jpeg, application/pdf`. Do NOT add any storage policies.
6. **Security policies (RLS)**: already created by schema.sql. Check: **Table Editor**, each table should show "RLS enabled". 
7. **Get the keys**: **Project Settings > API** (or "API Keys"). Copy: **Project URL**; the **anon / publishable** key; the **service_role / secret** key (click Reveal). Keep the service key private.
8. **Set the real cafe rules**: Table Editor > `cafe_settings`: set `minimum_spend_per_guest`, `downpayment_percent`, `reservation_fee`, `gcash_recipient`, etc. to the cafe's real values. Table `branches`: check hours and capacity.

## B. GitHub and Vercel

1. Install Git, then in this folder:
   ```
   git init
   git add .
   git commit -m "The Sifted production"
   ```
   Check that `.env` files are NOT listed by `git status` (they are ignored).
2. On github.com: New repository > `TheSifted` > **Private** > Create (do not add a README).
3. Push (replace YOUR-USER):
   ```
   git branch -M main
   git remote add origin https://github.com/YOUR-USER/TheSifted.git
   git push -u origin main
   ```
4. vercel.com > Add New > **Project** > Import your `TheSifted` repository.
5. On the configure screen: **Framework Preset: Other**. Leave Build Command and Install Command empty. Output Directory is read from `vercel.json` (`public`).
6. Open **Environment Variables** and add all four (copy names from `.env.example`):
   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL from A7 |
   | `SUPABASE_ANON_KEY` | anon/publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role/secret key |
   | `SITE_URL` | your Vercel address, no trailing slash (known after the first deploy: set it, then Redeploy) |
7. Click **Deploy**. When finished, open the address Vercel shows.
8. Go back to Supabase **Authentication > URL Configuration** and put that address in *Site URL* and the redirect URL (A4). In Vercel, set `SITE_URL`, then **Deployments > Redeploy**.

## C. Create the first staff account
1. On your live site: Sign up with the staff member's real email.
2. Supabase > SQL Editor: `update public.profiles set role = 'staff' where email = 'staff@example.com';`
3. Log in on the site: you are taken to the staff page.

## D. Test the production site (do all of these)
1. Open `/api/config` on your address: you should see JSON with branches and `min_advance_hours: 24`. If you see an error about configuration, an environment variable is missing or wrong (Vercel > Project > Logs).
2. Sign up as a test customer, log out, log in.
3. Reserve a table for 2+ days ahead, attach a screenshot as proof. Confirm you see the "request received" screen and the reservation under My account.
4. Try today/tomorrow-morning dates: they must be blocked with "Reservations must be made at least 24 hours in advance."
5. Log in as staff: open the reservation > Open proof of payment > Verify payment > Confirm. Log back in as customer: status should read Confirmed.
6. Test "Forgot password" (needs working email, see README).
7. Check on a phone.
8. Supabase > Table Editor: the rows are there; Storage > payment-proofs: the file is there.

## Troubleshooting
* "The server is not configured yet": one of the four variables is missing. Add it, Redeploy.
* "We could not reach the database": Supabase project is paused (Restore it) or `SUPABASE_URL` is wrong.
* Sign-up works but no account appears: you did not run `schema.sql` successfully.
* Proof upload fails: bucket `payment-proofs` missing, or `SUPABASE_SERVICE_ROLE_KEY` is the anon key by mistake.
* Password email never arrives: Supabase built-in email limit; configure SMTP.
