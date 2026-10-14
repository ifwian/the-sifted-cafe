-- =====================================================================
-- The Sifted Cafe - database schema
-- Target: MySQL 8.0.16 or newer (MySQL Workbench). CHECK constraints need 8.0.16+.
-- How to use: open this file in MySQL Workbench and run the whole script
-- (lightning-bolt icon). It is safe to run more than once: it only
-- creates things that do not exist yet and never deletes data.
-- No passwords or sample customers are stored here. Create the first
-- admin with:  npm run create-admin
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
