# Supabase database

| File | Purpose |
|---|---|
| `schema.sql` | Tables, rules, security (RLS), booking functions, private storage bucket. **Run once, no editing.** Safe to re-run. |
| `seed.sql` | Optional demo reservations. **Development only, never on the live database.** |

## Tables (5)

The old project had 3 tables (`users`, `reservations`, `payments`). Two were added so rules are data, not code:

| Table | Replaces / why |
|---|---|
| `profiles` | Old `users`. Passwords are no longer stored by us: Supabase Auth (`auth.users`) owns them. `profiles` keeps name, phone, role. |
| `reservations` | Same columns. Added: partial unique index (no duplicate open booking by one customer for a slot), "on the hour" check. |
| `payments` | Same columns. `proof_file` -> `proof_path` (private Storage object). Added status `rejected` + `rejection_reason`. |
| `branches` (new) | Opening hours and seat capacity per branch (was hardcoded in PHP/JS). |
| `cafe_settings` (new) | 24-hour notice, max days ahead, deposit %, GCash recipient name, etc. Edit in Table Editor. |

## How the important rules are enforced (all in the database)

* **24-hour notice**: `create_reservation()` compares the slot start (Asia/Manila) with the database clock `now() + 24h`.
* **No overbooking**: `create_reservation()` takes `pg_advisory_xact_lock` for the exact branch/date/time, then counts seats. Two simultaneous requests cannot both take the last seats.
* **Prices and payment status** are computed inside the function. The browser never sends them.
* **RLS**: customers can only `select` their own rows. No one can insert/update/delete `reservations` or `payments` directly; only the functions can. Staff-only functions check `is_staff()`.
* **Roles** cannot be changed from the app (trigger `guard_profile_role` + column-level grants).

## Make someone staff

Everyone who registers is a `customer`. After the staff member has registered on the website, run in **SQL Editor**:

```sql
update public.profiles set role = 'staff' where email = 'staff@example.com';
```

To remove access: set the role back to `'customer'`.

## Changing cafe rules

Table Editor > `cafe_settings` (or `branches`). Values marked PLACEHOLDER in `schema.sql` (minimum spend, 30% deposit, 2-hour table time, 60-day window) were never confirmed by the cafe: set the real numbers before launch. The API caches settings for 60 seconds.

## Migrating the old MySQL records (only if you have real data)

1. Have each customer register again (Supabase cannot import bcrypt hashes from PHP reliably; a password-reset email is simplest).
2. Export old `reservations` and `payments` to CSV with MySQL Workbench.
3. Map `old users.id` -> new `profiles.id` by email, then in SQL Editor insert into `reservations` (ENUM text values are identical) and `payments`. Old proof files must be uploaded manually to the `payment-proofs` bucket (path `<user id>/<uuid>.png|jpg|pdf`) and `proof_path` set to match. Demo data from the school project should simply be discarded.
