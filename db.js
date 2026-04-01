// ═══════════════════════════════════════════════════════════════════════════
// db.js — Couche d'accès aux données (PostgreSQL ou JSON fichiers)
// ═══════════════════════════════════════════════════════════════════════════
// Si DATABASE_URL est défini → PostgreSQL (table la_data avec colonnes key/data JSONB)
// Sinon → JSON plats fichiers (comportement d'origine)
// Les fonctions read(key) et write(key, data) ont la même signature dans les deux cas.

const fs   = require('fs');
const path = require('path');

// ── JSON adapter (défaut) ─────────────────────────────────────────────────────
const DB_DIR = process.env.DB_DIR
  || (process.env.VERCEL ? '/tmp/data' : path.join(__dirname, 'data'));

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const FILES = {
  enterprises:      'enterprises.json',
  employees:        'employees.json',
  restaurants:      'restauratrices.json',
  menus:            'menus.json',
  dailyMenus:       'dailyMenus.json',
  affiliations:     'affiliations.json',
  offers:           'offers.json',
  choices:          'choices.json',
  orders:           'orders.json',
  subscriptions:    'subscriptions.json',
  notifications:    'notifications.json',
  ratings:          'ratings.json',
  deletionRequests: 'deletionRequests.json',
  messages:         'messages.json',
  passwordResets:   'passwordResets.json',
  invoices:         'invoices.json',
};

const jsonAdapter = {
  read(key) {
    const f = path.join(DB_DIR, FILES[key]);
    if (!fs.existsSync(f)) return [];
    try { return JSON.parse(fs.readFileSync(f, 'utf8')) || []; } catch { return []; }
  },
  write(key, data) {
    fs.writeFileSync(path.join(DB_DIR, FILES[key]), JSON.stringify(data, null, 2));
  },
};

// ── PostgreSQL adapter ────────────────────────────────────────────────────────
let pgAdapter = null;

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    // Initialiser le schéma si nécessaire
    pool.query(`
      CREATE TABLE IF NOT EXISTS la_data (
        key  TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `).catch(() => {});

    // Seed les clés si absentes
    const keys = Object.keys(FILES);
    pool.query(
      `INSERT INTO la_data (key) VALUES ${keys.map((_,i) => `($${i+1})`).join(',')}
       ON CONFLICT DO NOTHING`,
      keys
    ).catch(() => {});

    pgAdapter = {
      async read(key) {
        const r = await pool.query('SELECT data FROM la_data WHERE key=$1', [key]);
        return r.rows[0]?.data || [];
      },
      async write(key, data) {
        await pool.query(
          `INSERT INTO la_data(key,data) VALUES($1,$2)
           ON CONFLICT (key) DO UPDATE SET data=$2`,
          [key, JSON.stringify(data)]
        );
      },
    };
  } catch (_err) {
    pgAdapter = null;
  }
}

module.exports = pgAdapter || jsonAdapter;
