-- ═══════════════════════════════════════════════════════════════════════════
-- schema.sql — LunchApp PostgreSQL Schema (normalisé)
-- Usage : psql -U <user> -d <db> -f schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- pour gen_random_uuid() si besoin

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENTREPRISES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enterprises (
  id           TEXT        PRIMARY KEY,
  company_name TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  password     TEXT        NOT NULL,              -- bcrypt hash
  phone        TEXT        NOT NULL DEFAULT '',
  location     TEXT        NOT NULL DEFAULT '',   -- URL Google Maps ou adresse
  role         TEXT        NOT NULL DEFAULT 'enterprise',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprises_email ON enterprises (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESTAURANTS (restauratrices)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id              TEXT        PRIMARY KEY,
  restaurant_name TEXT        NOT NULL,
  full_name       TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  password        TEXT        NOT NULL,           -- bcrypt hash
  phone           TEXT        NOT NULL DEFAULT '',
  specialty       TEXT[]      NOT NULL DEFAULT '{}',  -- ex: ['Cuisine africaine']
  address         TEXT        NOT NULL DEFAULT '',
  description     TEXT        NOT NULL DEFAULT '',
  photo           TEXT        NOT NULL DEFAULT '',   -- URL ou base64
  payment_info    JSONB       NOT NULL DEFAULT '[]', -- [{type, number}]
  role            TEXT        NOT NULL DEFAULT 'restauratrice',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_restaurants_email ON restaurants (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EMPLOYÉS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id              TEXT        PRIMARY KEY,
  full_name       TEXT        NOT NULL,
  gender          TEXT        NOT NULL CHECK (gender IN ('male', 'female', 'other')),
  password        TEXT        NOT NULL,           -- bcrypt hash
  role            TEXT        NOT NULL DEFAULT 'employee',
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,           -- dénormalisé pour affichage rapide
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_enterprise ON employees (enterprise_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MENUS (catalogue complet d'un restaurant)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            TEXT        PRIMARY KEY,
  restaurant_id TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  category      TEXT        NOT NULL CHECK (category IN ('food', 'drink')),
  price         INTEGER     NOT NULL CHECK (price >= 0),  -- en FCFA
  description   TEXT        NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MENUS JOURNALIERS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_menus (
  id              SERIAL      PRIMARY KEY,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  date            DATE        NOT NULL,
  -- liste des IDs d'articles disponibles ce jour-là
  available_items TEXT[]      NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ,
  UNIQUE (restaurant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_menus_restaurant_date ON daily_menus (restaurant_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. AFFILIATIONS (entreprise ↔ restaurant)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliations (
  id              TEXT        PRIMARY KEY,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enterprise_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliations_enterprise  ON affiliations (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_restaurant  ON affiliations (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OFFRES (restaurant propose ses services à une entreprise)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id              TEXT        PRIMARY KEY,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_offers_restaurant   ON offers (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_offers_enterprise   ON offers (enterprise_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CHOIX DU DÉJEUNER (par employé, par jour)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS choices (
  id              TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  user_name       TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  -- snapshot de l'article au moment du choix : {id, name, price}
  food_item       JSONB,
  drink_item      JSONB,
  date            DATE        NOT NULL,
  rating          SMALLINT    CHECK (rating BETWEEN 1 AND 5),
  order_launched  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_choices_user        ON choices (user_id);
CREATE INDEX IF NOT EXISTS idx_choices_enterprise  ON choices (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_choices_restaurant  ON choices (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_choices_date        ON choices (date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. COMMANDES (groupées par entreprise + restaurant + date)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT        PRIMARY KEY,
  enterprise_id       TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name     TEXT        NOT NULL,
  restaurant_id       TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name     TEXT        NOT NULL,
  date                DATE        NOT NULL,
  -- tableau de lignes : [{employeeId, employeeName, foodItem, drinkItem, amount}]
  items               JSONB       NOT NULL DEFAULT '[]',
  total_amount        INTEGER     NOT NULL CHECK (total_amount >= 0),
  payment_mode        TEXT        NOT NULL DEFAULT 'delivery'
                        CHECK (payment_mode IN ('delivery', 'deposit', 'subscription')),
  deposit_screenshot  TEXT,       -- base64 ou URL
  deposit_type        TEXT,       -- 'OM', 'MOOV', etc.
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'delivered', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_enterprise   ON orders (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant   ON orders (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_date         ON orders (date);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. ABONNEMENTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT        PRIMARY KEY,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  frequency       TEXT        NOT NULL
                    CHECK (frequency IN ('daily','weekly','monthly','quarterly','semi-annual','annual')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  UNIQUE (enterprise_id, restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_enterprise ON subscriptions (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant ON subscriptions (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL,   -- enterprise, restaurant ou employee
  user_role   TEXT        NOT NULL,
  type        TEXT        NOT NULL,   -- 'new_order', 'new_affiliation', 'menu_updated', etc.
  title       TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (user_id, is_read);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ÉVALUATIONS (notes laissées par les employés sur les plats)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id              TEXT        PRIMARY KEY,
  employee_id     TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  employee_name   TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  item_id         TEXT        NOT NULL,   -- ID de l'article noté (menu_items.id)
  item_name       TEXT        NOT NULL,
  stars           SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  date            DATE        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, item_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ratings_employee    ON ratings (employee_id);
CREATE INDEX IF NOT EXISTS idx_ratings_restaurant  ON ratings (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_ratings_item        ON ratings (item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. DEMANDES DE SUPPRESSION DE COMPTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deletion_requests (
  id             TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL,
  user_type      TEXT        NOT NULL CHECK (user_type IN ('enterprise', 'restaurant')),
  user_name      TEXT        NOT NULL,
  reason         TEXT        NOT NULL DEFAULT '',
  feedback       TEXT        NOT NULL DEFAULT '',
  bad_experience TEXT        NOT NULL DEFAULT '',
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_deleted_at ON deletion_requests (deleted_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. MESSAGERIE (entre entreprises et restaurants)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT        PRIMARY KEY,
  sender_id       TEXT        NOT NULL,
  sender_name     TEXT        NOT NULL,
  sender_role     TEXT        NOT NULL,
  recipient_id    TEXT        NOT NULL,
  recipient_name  TEXT        NOT NULL,
  recipient_role  TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'audio')),
  content         TEXT,                          -- pour type = 'text'
  audio_data      TEXT,                          -- base64, pour type = 'audio'
  audio_duration  NUMERIC,                       -- secondes
  read_by         TEXT[]      NOT NULL DEFAULT '{}',  -- liste d'IDs
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. RÉINITIALISATIONS DE MOT DE PASSE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('enterprise', 'restaurant')),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets (email);

-- Nettoyage automatique des tokens expirés (si pg_cron est disponible)
-- SELECT cron.schedule('clean-password-resets', '0 * * * *',
--   'DELETE FROM password_resets WHERE expires_at < NOW()');

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. FACTURES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT        PRIMARY KEY,
  number          TEXT        NOT NULL UNIQUE,   -- ex: 'FACT-20260330-MNCWVJ'
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  restaurant_name TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE RESTRICT,
  enterprise_name TEXT        NOT NULL,
  order_id        TEXT        REFERENCES orders (id) ON DELETE SET NULL,
  date            DATE        NOT NULL,
  -- lignes de facture : [{name, qty, unitPrice, total}]
  items           JSONB       NOT NULL DEFAULT '[]',
  total_amount    INTEGER     NOT NULL CHECK (total_amount >= 0),
  frequency       TEXT        CHECK (frequency IN ('daily','weekly','monthly','quarterly','semi-annual','annual')),
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled')),
  pdf_base64      TEXT,                          -- PDF généré côté serveur
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoices_restaurant  ON invoices (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_enterprise  ON invoices (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order       ON invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date        ON invoices (date DESC);

