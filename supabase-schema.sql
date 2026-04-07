-- ═══════════════════════════════════════════════════════════════════════════
-- LunchApp — Supabase PostgreSQL Schema
-- Usage : SQL Editor dans Supabase → Run
-- Mis à jour : 2026-04-06
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENTREPRISES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enterprises (
  id           TEXT        PRIMARY KEY,
  company_name TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  password     TEXT        NOT NULL,
  phone        TEXT        NOT NULL DEFAULT '',
  location     TEXT        NOT NULL DEFAULT '',
  role         TEXT        NOT NULL DEFAULT 'enterprise',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_enterprises_email ON enterprises (email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESTAURANTS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurants (
  id              TEXT        PRIMARY KEY,
  restaurant_name TEXT        NOT NULL,
  full_name       TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  password        TEXT        NOT NULL,
  phone           TEXT        NOT NULL DEFAULT '',
  specialty       TEXT[]      NOT NULL DEFAULT '{}',
  address         TEXT        NOT NULL DEFAULT '',
  description     TEXT        NOT NULL DEFAULT '',
  photo           TEXT        NOT NULL DEFAULT '',
  payment_info    JSONB       NOT NULL DEFAULT '[]',
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
  employee_id     TEXT        NOT NULL UNIQUE,
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  full_name       TEXT        NOT NULL,
  gender          TEXT        NOT NULL CHECK (gender IN ('male', 'female')),
  whatsapp        TEXT        NOT NULL DEFAULT '',
  email           TEXT        NOT NULL DEFAULT '',
  password        TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'employee',
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_employees_enterprise  ON employees (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees (employee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MENUS (un par restaurant, items stockés en JSONB)
-- items : [{id, name, category, price, description, available}]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menus (
  restaurant_id TEXT        PRIMARY KEY REFERENCES restaurants (id) ON DELETE CASCADE,
  items         JSONB       NOT NULL DEFAULT '[]',
  updated_at    TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. MENU JOURNALIER (items disponibles par date)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_menus (
  id              TEXT        PRIMARY KEY,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  date            DATE        NOT NULL,
  available_items TEXT[]      NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  UNIQUE (restaurant_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_menus_restaurant ON daily_menus (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_daily_menus_date       ON daily_menus (date);

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
CREATE INDEX IF NOT EXISTS idx_affiliations_enterprise ON affiliations (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_restaurant ON affiliations (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. OFFRES (restaurant → entreprise)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id              TEXT        PRIMARY KEY,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, enterprise_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_restaurant ON offers (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_offers_enterprise ON offers (enterprise_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. CHOIX (employé → restaurant, 1 par jour)
-- food_item / drink_item : JSONB snapshot {id, name, price}
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS choices (
  id              TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  user_name       TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
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
-- 9. ABONNEMENTS (avant orders car orders référence subscriptions)
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
                    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  UNIQUE (enterprise_id, restaurant_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enterprise ON subscriptions (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_restaurant ON subscriptions (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. COMMANDES (orders)
-- items : JSONB [{employeeId, employeeName, foodItem, drinkItem, amount}]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT        PRIMARY KEY,
  enterprise_id       TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name     TEXT        NOT NULL,
  restaurant_id       TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name     TEXT        NOT NULL,
  date                DATE        NOT NULL,
  items               JSONB       NOT NULL DEFAULT '[]',
  total_amount        INTEGER     NOT NULL CHECK (total_amount >= 0),
  payment_mode        TEXT        NOT NULL DEFAULT 'delivery'
                        CHECK (payment_mode IN ('delivery', 'deposit', 'subscription')),
  deposit_screenshot  TEXT,
  deposit_type        TEXT,
  subscription_id     TEXT        REFERENCES subscriptions (id) ON DELETE SET NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'preparing', 'delivered', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_enterprise ON orders (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_date       ON orders (date);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. FACTURES
-- items : JSONB [{name, qty, unitPrice, total}]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT        PRIMARY KEY,
  number          TEXT        NOT NULL UNIQUE,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  restaurant_name TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE RESTRICT,
  enterprise_name TEXT        NOT NULL,
  order_id        TEXT        REFERENCES orders (id) ON DELETE SET NULL,
  subscription_id TEXT        REFERENCES subscriptions (id) ON DELETE SET NULL,
  date            DATE        NOT NULL,
  items           JSONB       NOT NULL DEFAULT '[]',
  total_amount    INTEGER     NOT NULL CHECK (total_amount >= 0),
  frequency       TEXT        CHECK (frequency IN ('daily','weekly','monthly','quarterly','semi-annual','annual')),
  status          TEXT        NOT NULL DEFAULT 'sent'
                    CHECK (status IN ('sent', 'confirmed', 'paid', 'cancelled')),
  pdf_base64      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invoices_restaurant   ON invoices (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_enterprise   ON invoices (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order        ON invoices (order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices (subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date         ON invoices (date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. NOTIFICATIONS
-- data : JSONB libre
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL,
  user_role   TEXT        NOT NULL CHECK (user_role IN ('enterprise', 'restauratrice', 'employee')),
  type        TEXT        NOT NULL,
  title       TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user   ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, is_read) WHERE is_read = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. MESSAGERIE
-- read_by : TEXT[] (array of userIds)
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
  content         TEXT,
  audio_data      TEXT,
  audio_duration  NUMERIC,
  read_by         TEXT[]      NOT NULL DEFAULT '{}',
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. ÉVALUATIONS (ratings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id              TEXT        PRIMARY KEY,
  employee_id     TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  employee_name   TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  item_id         TEXT        NOT NULL,
  item_name       TEXT        NOT NULL,
  stars           SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  date            DATE        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, item_id, date)
);
CREATE INDEX IF NOT EXISTS idx_ratings_employee   ON ratings (employee_id);
CREATE INDEX IF NOT EXISTS idx_ratings_restaurant ON ratings (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_ratings_item       ON ratings (item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. RÉINITIALISATIONS DE MOT DE PASSE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('enterprise', 'restauratrice')),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_email      ON password_resets (email);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets (expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. DEMANDES DE SUPPRESSION DE COMPTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deletion_requests (
  id             TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL,
  user_type      TEXT        NOT NULL CHECK (user_type IN ('enterprise', 'restauratrice')),
  user_name      TEXT        NOT NULL,
  email          TEXT        NOT NULL DEFAULT '',
  reason         TEXT        NOT NULL DEFAULT '',
  feedback       TEXT        NOT NULL DEFAULT '',
  bad_experience TEXT        NOT NULL DEFAULT '',
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_deleted_at ON deletion_requests (deleted_at DESC);
