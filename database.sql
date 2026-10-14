-- =====================================================================
-- The Sifted Cafe - database schema
-- Target: MySQL 8.0.16 or newer (MySQL Workbench). CHECK constraints need 8.0.16+.
-- How to use: open this file in MySQL Workbench and run the whole script
-- (lightning-bolt icon). It is safe to run more than once: it only
-- creates things that do not exist yet and never deletes data.
-- No passwords or sample customers are stored here. Create the first
-- admin with:  npm run create-admin
--
-- IMPORTANT: the CREATE TABLE statements use IF NOT EXISTS, so they do
-- nothing at all when the table already exists. That means an older
-- database does NOT pick up columns added to this file later. The
-- "UPGRADES" section at the bottom fixes that: re-running this script on
-- an older database adds the missing columns and keeps the data.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS sifted_cafe_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE sifted_cafe_db;

-- ---------------------------------------------------------------------
-- reservations: one row per reservation request from the website.
-- New requests always start as 'pending'; only staff change the status.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  customer_name     VARCHAR(100)  NOT NULL,
  phone             VARCHAR(20)   NOT NULL,
  email             VARCHAR(254)  NULL,
  branch            VARCHAR(40)   NOT NULL,            -- branch id from server/config.js
  reservation_date  DATE          NOT NULL,
  reservation_time  TIME          NOT NULL,
  guests            TINYINT UNSIGNED NOT NULL,
  special_requests  VARCHAR(500)  NULL,
  status            ENUM('pending','confirmed','cancelled','completed','no_show')
                    NOT NULL DEFAULT 'pending',
  admin_notes       VARCHAR(1000) NULL,                -- internal staff notes, never shown to customers
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reservations_date_time (reservation_date, reservation_time),
  KEY idx_reservations_status (status),
  CONSTRAINT chk_reservations_guests CHECK (guests BETWEEN 1 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- admins: staff accounts. Only a bcrypt hash of the password is stored.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50)  NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at  TIMESTAMP    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- admin_sessions: one row per signed-in browser. The browser keeps a
-- random token in an HttpOnly cookie; only the SHA-256 hash of that
-- token is stored here, so a database leak does not leak live sessions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_id    INT UNSIGNED NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  expires_at  DATETIME     NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_sessions_token (token_hash),
  KEY idx_admin_sessions_expires (expires_at),
  CONSTRAINT fk_admin_sessions_admin
    FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- UPGRADES FOR OLDER DATABASES
--
-- Everything above this line only ever CREATES tables. A database created
-- from an older version of this file therefore keeps its old columns, and
-- re-running the script quietly changes nothing (because of IF NOT EXISTS).
-- That is what causes "Something went wrong on our side." on the admin
-- login: the server asks for a column the table does not have yet.
--
-- Each block below checks information_schema first and only runs the ALTER
-- when the column really is missing, so this section is safe to run as
-- often as you like and never deletes data.
-- Add a new block here whenever you add a column to a CREATE TABLE above.
-- ---------------------------------------------------------------------

-- admins.last_login_at (NULL for accounts that have never signed in).
SET @upgrade_sql = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins'
               AND COLUMN_NAME = 'last_login_at'),
    'SELECT ''upgrades: admins.last_login_at already present'' AS upgrade_note',
    'ALTER TABLE admins ADD COLUMN last_login_at TIMESTAMP NULL AFTER created_at'
  )
);
PREPARE upgrade_stmt FROM @upgrade_sql;
EXECUTE upgrade_stmt;
DEALLOCATE PREPARE upgrade_stmt;

-- reservations.phone: older databases called this column contact_number.
-- Renaming it keeps the existing numbers instead of making staff re-enter them.
SET @upgrade_sql = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
               AND COLUMN_NAME = 'phone'),
    'SELECT ''upgrades: reservations.phone already present'' AS upgrade_note',
    'ALTER TABLE reservations CHANGE COLUMN contact_number phone VARCHAR(20) NOT NULL'
  )
);
PREPARE upgrade_stmt FROM @upgrade_sql;
EXECUTE upgrade_stmt;
DEALLOCATE PREPARE upgrade_stmt;

-- reservations.branch: added after the first version of the schema. Existing
-- rows have no branch to recover, so they are set to Calamba; staff can correct
-- a booking from the admin page if that was not the right branch.
SET @upgrade_sql = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
               AND COLUMN_NAME = 'branch'),
    'SELECT ''upgrades: reservations.branch already present'' AS upgrade_note',
    'ALTER TABLE reservations ADD COLUMN branch VARCHAR(40) NOT NULL DEFAULT ''calamba'' AFTER phone'
  )
);
PREPARE upgrade_stmt FROM @upgrade_sql;
EXECUTE upgrade_stmt;
DEALLOCATE PREPARE upgrade_stmt;

-- reservations.email: widened from 150 to 254 so it matches the standard
-- maximum length for an email address.
SET @upgrade_sql = (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reservations'
               AND COLUMN_NAME = 'email' AND CHARACTER_MAXIMUM_LENGTH = 254),
    'SELECT ''upgrades: reservations.email already 254'' AS upgrade_note',
    'ALTER TABLE reservations MODIFY COLUMN email VARCHAR(254) NULL'
  )
);
PREPARE upgrade_stmt FROM @upgrade_sql;
EXECUTE upgrade_stmt;
DEALLOCATE PREPARE upgrade_stmt;

-- The branch column above carries a DEFAULT only so that older rows can be
-- added safely. New rows always send a branch, so the default is dropped to
-- make a forgotten branch fail loudly instead of silently becoming Calamba.
ALTER TABLE reservations ALTER COLUMN branch DROP DEFAULT;
