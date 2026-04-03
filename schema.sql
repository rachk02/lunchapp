-- ═══════════════════════════════════════════════════════════════════════════
-- schema.sql — LunchApp PostgreSQL Schema
-- Usage : psql -U <user> -d <db> -f schema.sql
-- Mis à jour : 2026-04-02
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ENTREPRISES
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enterprises (
  id           TEXT        PRIMARY KEY,
  company_name TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  password     TEXT        NOT NULL,              -- bcrypt hash
  phone        TEXT        NOT NULL DEFAULT '',
  location     TEXT        NOT NULL DEFAULT '',   -- adresse ou URL Google Maps
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
  full_name       TEXT        NOT NULL,           -- nom du gérant
  email           TEXT        NOT NULL UNIQUE,
  password        TEXT        NOT NULL,           -- bcrypt hash
  phone           TEXT        NOT NULL DEFAULT '',
  specialty       TEXT[]      NOT NULL DEFAULT '{}',
  address         TEXT        NOT NULL DEFAULT '',
  description     TEXT        NOT NULL DEFAULT '',
  photo           TEXT        NOT NULL DEFAULT '',  -- URL ou base64
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
  -- Identifiant auto-généré : entreprise_BF_ANNEE_XX (ex: el_immeka_BF_2026_01)
  employee_id     TEXT        NOT NULL UNIQUE,
  first_name      TEXT        NOT NULL,
  last_name       TEXT        NOT NULL,
  full_name       TEXT        NOT NULL,           -- first_name || ' ' || last_name
  gender          TEXT        NOT NULL CHECK (gender IN ('male', 'female')),
  -- Numéro WhatsApp (12–14 chiffres, sans le +) pour envoi automatique des identifiants
  whatsapp        TEXT        NOT NULL DEFAULT '',
  password        TEXT        NOT NULL,           -- bcrypt hash (défaut : Temp1234)
  role            TEXT        NOT NULL DEFAULT 'employee',
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employees_enterprise  ON employees (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees (employee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ARTICLES DU MENU
-- available remplace l'ancien système daily_menus :
--   TRUE  → article visible et commandable (défaut)
--   FALSE → article masqué par le restaurant
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_items (
  id            TEXT        PRIMARY KEY,
  restaurant_id TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  category      TEXT        NOT NULL CHECK (category IN ('food', 'drink')),
  price         INTEGER     NOT NULL CHECK (price >= 0),  -- en FCFA
  description   TEXT        NOT NULL DEFAULT '',
  available     BOOLEAN     NOT NULL DEFAULT TRUE,        -- toggle de disponibilité
  updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant  ON menu_items (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available   ON menu_items (restaurant_id, available);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. AFFILIATIONS (entreprise ↔ restaurant)
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
-- 6. OFFRES (restaurant propose ses services à une entreprise)
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
-- 7. CHOIX DU DÉJEUNER (par employé, par jour — 1 seul par jour)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS choices (
  id              TEXT        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  user_name       TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  food_item       JSONB,      -- snapshot : {id, name, price}
  drink_item      JSONB,      -- snapshot : {id, name, price}
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
-- 8. COMMANDES (groupées par entreprise + restaurant + date)
-- Cycle de statut : pending → confirmed → preparing → delivered
--                                        └──────────→ cancelled
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  TEXT        PRIMARY KEY,
  enterprise_id       TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name     TEXT        NOT NULL,
  restaurant_id       TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name     TEXT        NOT NULL,
  date                DATE        NOT NULL,
  -- [{employeeId, employeeName, foodItem, drinkItem, amount}]
  items               JSONB       NOT NULL DEFAULT '[]',
  total_amount        INTEGER     NOT NULL CHECK (total_amount >= 0),  -- en FCFA
  payment_mode        TEXT        NOT NULL DEFAULT 'delivery'
                        CHECK (payment_mode IN ('delivery', 'deposit', 'subscription')),
  deposit_screenshot  TEXT,       -- base64 ou URL
  deposit_type        TEXT,       -- 'OM', 'MOOV', etc.
  subscription_id     TEXT        REFERENCES subscriptions (id) ON DELETE SET NULL,
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'preparing', 'delivered', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_enterprise   ON orders (enterprise_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant   ON orders (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_date         ON orders (date);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. ABONNEMENTS
-- Cycle de statut : pending → accepted | declined
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
-- 10. FACTURES
-- Cycle de statut : sent → confirmed → paid | cancelled
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT        PRIMARY KEY,
  number          TEXT        NOT NULL UNIQUE,   -- ex: FACT-20260402-ABCXYZ
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  restaurant_name TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE RESTRICT,
  enterprise_name TEXT        NOT NULL,
  order_id        TEXT        REFERENCES orders (id) ON DELETE SET NULL,
  subscription_id TEXT        REFERENCES subscriptions (id) ON DELETE SET NULL,
  date            DATE        NOT NULL,
  -- [{name, qty, unitPrice, total}]
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
-- 11. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL,  -- id d'une enterprise, restaurant ou employee
  user_role   TEXT        NOT NULL   CHECK (user_role IN ('enterprise', 'restauratrice', 'employee')),
  type        TEXT        NOT NULL,  -- 'new_order', 'new_affiliation', 'menu_updated', 'order_status', ...
  title       TEXT        NOT NULL,
  message     TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}',
  is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON notifications (user_id, is_read) WHERE is_read = FALSE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. MESSAGERIE
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
  content         TEXT,                            -- pour type = 'text'
  audio_data      TEXT,                            -- base64, pour type = 'audio'
  audio_duration  NUMERIC,                         -- durée en secondes
  read_by         TEXT[]      NOT NULL DEFAULT '{}',
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. ÉVALUATIONS (notes laissées par les employés sur les plats)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ratings (
  id              TEXT        PRIMARY KEY,
  employee_id     TEXT        NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  employee_name   TEXT        NOT NULL,
  enterprise_id   TEXT        NOT NULL REFERENCES enterprises (id) ON DELETE CASCADE,
  enterprise_name TEXT        NOT NULL,
  restaurant_id   TEXT        NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  restaurant_name TEXT        NOT NULL,
  item_id         TEXT        NOT NULL,  -- menu_items.id (snapshot, pas de FK pour conservation historique)
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
-- 14. RÉINITIALISATIONS DE MOT DE PASSE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT        PRIMARY KEY,
  email       TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('enterprise', 'restauratrice')),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_email      ON password_resets (email);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets (expires_at);

-- Nettoyage automatique des tokens expirés (nécessite pg_cron)
-- SELECT cron.schedule('clean-password-resets', '0 * * * *',
--   'DELETE FROM password_resets WHERE expires_at < NOW()');

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. DEMANDES DE SUPPRESSION DE COMPTE
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deletion_requests (
  id             TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL,
  user_type      TEXT        NOT NULL CHECK (user_type IN ('enterprise', 'restauratrice')),
  user_name      TEXT        NOT NULL,
  reason         TEXT        NOT NULL DEFAULT '',
  feedback       TEXT        NOT NULL DEFAULT '',
  bad_experience TEXT        NOT NULL DEFAULT '',
  deleted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_deleted_at ON deletion_requests (deleted_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- RÉCAPITULATIF DES CHANGEMENTS vs version précédente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- TABLE employees :
--   + employee_id  TEXT UNIQUE  (auto-généré : entreprise_BF_ANNEE_XX)
--   + first_name / last_name    (remplacent le champ unique full_name)
--   + whatsapp TEXT             (pour envoi automatique des identifiants)
--   + updated_at TIMESTAMPTZ
--   ~ gender CHECK : suppression de 'other'
--
-- TABLE menu_items :
--   + available BOOLEAN DEFAULT TRUE  (toggle persistant de disponibilité)
--   (remplace la table daily_menus qui gérait la dispo par date)
--
-- TABLE daily_menus : SUPPRIMÉE
--   (la disponibilité est désormais portée par menu_items.available)
--
-- TABLE orders :
--   + statut 'preparing' dans le CHECK
--   + subscription_id FK → subscriptions
--
-- TABLE subscriptions :
--   ~ statut 'rejected' → 'declined'  (aligné avec le code serveur)
--   + accepted_at TIMESTAMPTZ
--
-- TABLE invoices :
--   ~ statut par défaut 'pending' → 'sent'  (aligné avec le code serveur)
--   ~ CHECK : remplace 'pending' par 'sent'
--   + subscription_id FK → subscriptions
--
-- TABLE affiliations :
--   - enterprise_name supprimé (redondant, jointure suffisante)
--
-- TABLE notifications :
--   + CHECK sur user_role
--   ~ index is_read → index partiel WHERE is_read = FALSE (plus efficace)
-- ═══════════════════════════════════════════════════════════════════════════
