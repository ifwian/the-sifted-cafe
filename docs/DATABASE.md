# Database

Name: `sifted_cafe_db` (MySQL 8.0.16 or newer). Created by `database.sql`, which is safe to run more than once (it only creates what is missing and never deletes data).

## Tables

### `reservations` — one row per request
| Column | Type | Notes |
|---|---|---|
| `id` | INT UNSIGNED, auto-increment, PK | The customer reference is `SC-` + id padded to 5 digits (id 12 → `SC-00012`). |
| `customer_name` | VARCHAR(100) NOT NULL | |
| `phone` | VARCHAR(20) NOT NULL | |
| `email` | VARCHAR(254) NULL | Optional. |
| `branch` | VARCHAR(40) NOT NULL | Branch id from `server/config.js` (`calamba`, `cabuyao`). Stored as text so a branch can be added without changing the table. |
| `reservation_date` | DATE NOT NULL | |
| `reservation_time` | TIME NOT NULL | |
| `guests` | TINYINT UNSIGNED NOT NULL | `CHECK (guests BETWEEN 1 AND 100)`; the form limit (default 20) is in config. |
| `special_requests` | VARCHAR(500) NULL | |
| `status` | ENUM(`pending`,`confirmed`,`cancelled`,`completed`,`no_show`) NOT NULL DEFAULT `pending` | Must match `statuses` in `server/config.js` (a unit test checks this). |
| `admin_notes` | VARCHAR(1000) NULL | Private staff notes, never returned to customers. |
| `created_at`, `updated_at` | TIMESTAMP | `updated_at` changes automatically. |

Indexes: `(reservation_date, reservation_time)` and `(status)` for the staff list.

### `admins` — staff accounts
`id`, `username` (unique), `password_hash` (bcrypt), `created_at`, `last_login_at`.

### `admin_sessions` — signed-in browsers
`id`, `admin_id` (FK → `admins`, deleted with the admin), `token_hash` (unique, SHA-256 of the cookie value), `expires_at`, `created_at`. Only the hash is stored, so a copy of the database does not expose live sessions.

Why only three tables: customers are not stored separately because the owner has not asked for customer accounts, and a separate `customers` table would add complexity without a requirement.

## Create the database (MySQL Workbench)
1. Open MySQL Workbench and connect to your local server.
2. **File → Open SQL Script…** and choose `database.sql` from the project folder.
3. Click the lightning-bolt button (**Execute**) to run the whole script.
4. Verify: run
   ```sql
   USE sifted_cafe_db;
   SHOW TABLES;                 -- admins, admin_sessions, reservations
   DESCRIBE reservations;
   SELECT COUNT(*) FROM reservations;
   ```

## Connection
Set in `.env` (never committed): `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. `server/database.js` creates one connection pool (10 connections); queries borrow and return connections automatically. Dates and times are returned as plain strings so time zones cannot shift them.

## Changing a status or adding a branch
- New branch: add it to `branches` in `server/config.js`. No SQL change.
- New status: add it to `statuses` in `server/config.js` **and** run `ALTER TABLE reservations MODIFY status ENUM(...) NOT NULL DEFAULT 'pending';` with the full new list.
