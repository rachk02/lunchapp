// ═══════════════════════════════════════════════════════════════════════════
// db.js — Couche d'accès aux données (PostgreSQL ou JSON fichiers)
// ═══════════════════════════════════════════════════════════════════════════
// Si DATABASE_URL est défini → PostgreSQL/Supabase (table la_data, JSONB)
// Sinon                      → JSON fichiers locaux (développement)

const fs   = require('fs');
const path = require('path');

// ── JSON adapter (développement local sans DATABASE_URL) ──────────────────
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');

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

// ── PostgreSQL / Supabase adapter ─────────────────────────────────────────
let pgAdapter = null;

async function initPg() {
  if (!process.env.DATABASE_URL) {
    console.warn('[DB] DATABASE_URL non défini — stockage JSON local (données non persistantes sur Vercel !)');
    return;
  }

  try {
    const { Pool } = require('pg');

    // ── Parse manuel pour gérer # et @ dans le mot de passe ───────────────
    const raw      = process.env.DATABASE_URL.replace(/^postgresql?:\/\//, '');
    const atIdx    = raw.lastIndexOf('@');
    const creds    = raw.substring(0, atIdx);
    const hostPart = raw.substring(atIdx + 1);
    const colonIdx = creds.indexOf(':');
    const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
    const dbUser   = safeDecode(creds.substring(0, colonIdx));
    const dbPass   = safeDecode(creds.substring(colonIdx + 1));
    const slashIdx = hostPart.indexOf('/');
    const hostPort = hostPart.substring(0, slashIdx);
    const dbName   = hostPart.substring(slashIdx + 1).split('?')[0];
    const [dbHost, dbPortStr] = hostPort.split(':');
    const dbPort   = parseInt(dbPortStr, 10) || 5432;

    const useSSL = dbHost.includes('supabase') || process.env.DB_SSL === 'true';

    const pool = new Pool({
      host:                    dbHost,
      port:                    dbPort,
      database:                dbName,
      user:                    dbUser,
      password:                dbPass,
      ssl:                     useSSL ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 8000,   // échoue rapidement si la DB est inaccessible
      idleTimeoutMillis:       30000,
      max:                     3,      // peu de connexions simultanées (serverless)
    });

    // ── Test de connexion avant d'activer l'adapter ────────────────────────
    await pool.query('SELECT 1');
    console.log('[DB] PostgreSQL (Supabase) connecté —', dbHost);

    // ── Initialisation de la table (idempotent) ────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS la_data (
        key  TEXT PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);

    const keys = Object.keys(FILES);
    await pool.query(
      `INSERT INTO la_data (key, data)
       VALUES ${keys.map((_, i) => `($${i + 1},'[]'::jsonb)`).join(',')}
       ON CONFLICT (key) DO NOTHING`,
      keys
    );

    // ── Adapter ────────────────────────────────────────────────────────────
    pgAdapter = {
      async read(key) {
        const r = await pool.query('SELECT data FROM la_data WHERE key=$1', [key]);
        return r.rows[0]?.data ?? [];
      },
      async write(key, data) {
        await pool.query(
          `INSERT INTO la_data(key, data) VALUES($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`,
          [key, JSON.stringify(data)]
        );
      },
    };

  } catch (err) {
    console.error('[DB] Échec connexion PostgreSQL — fallback JSON local:', err.message);
    pgAdapter = null;
  }
}

// Lancer l'init (non bloquant au démarrage, mais attendu avant export)
const _ready = initPg();

// Export : proxy qui attend que l'init soit terminée avant chaque opération
module.exports = {
  async read(key)       { await _ready; return (pgAdapter || jsonAdapter).read(key); },
  async write(key, data){ await _ready; return (pgAdapter || jsonAdapter).write(key, data); },
};
