// ═══════════════════════════════════════════════════════════════════════════
// db.js — Couche d'accès aux données (PostgreSQL/Supabase ou JSON fichiers)
// ═══════════════════════════════════════════════════════════════════════════
// Si DATABASE_URL est défini → PostgreSQL (Supabase) avec pool de connexions
// Sinon                      → JSON fichiers locaux (développement local)
//
// API : db.<entity>.find(), .create(), .update(), .delete(), .upsert()
//       + legacy read(key) / write(key) pour compatibilité
// ═══════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ── Mapping entity → table / file ──────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// JSON Adapter (développement local)
// ═══════════════════════════════════════════════════════════════════════════
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

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

// ═══════════════════════════════════════════════════════════════════════════
// PostgreSQL Adapter (Supabase)
// ═══════════════════════════════════════════════════════════════════════════
let pgPool = null;

const TABLE_MAP = {
  enterprises:      'enterprises',
  employees:        'employees',
  restaurants:      'restaurants',
  menus:            'menus',
  dailyMenus:       'daily_menus',
  affiliations:     'affiliations',
  offers:           'offers',
  choices:          'choices',
  orders:           'orders',
  subscriptions:    'subscriptions',
  invoices:         'invoices',
  notifications:    'notifications',
  messages:         'messages',
  ratings:          'ratings',
  passwordResets:   'password_resets',
  deletionRequests: 'deletion_requests',
};

function snakeCase(obj) {
  if (!obj) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const snake = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    out[snake] = (typeof v === 'object' && v !== null && !Array.isArray(v))
      ? JSON.stringify(v) : v;
  }
  return out;
}

function camelCase(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    // Parse JSONB columns
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[camel] = JSON.parse(v); continue; } catch {}
    }
    out[camel] = v;
  }
  return out;
}

async function initPg() {
  if (!process.env.DATABASE_URL) return null;

  try {
    const { Pool } = require('pg');

    // Parse DATABASE_URL manually to handle special chars in password
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
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis:       30000,
      max:                     3,
    });

    await pool.query('SELECT 1');
    console.log('[DB] PostgreSQL (Supabase) connecté —', dbHost);

    pgPool = pool;
    return pool;
  } catch (err) {
    console.error('[DB] Échec connexion PostgreSQL — fallback JSON local:', err.message);
    return null;
  }
}

const _ready = initPg();

// ── Generic entity CRUD for PostgreSQL ─────────────────────────────────────
function createEntity(entityName) {
  return {
    async find(where = {}) {
      if (pgPool) {
        const table = TABLE_MAP[entityName];
        if (!table) throw new Error(`Unknown entity: ${entityName}`);
        const keys = Object.keys(where);
        let sql = `SELECT * FROM ${table}`;
        const values = [];
        if (keys.length) {
          const clauses = keys.map((k, i) => {
            const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
            const val = where[k];
            if (val === null || val === undefined) return `${col} IS NULL`;
            values.push(val);
            return `${col} = $${values.length}`;
          });
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
        sql += ` ORDER BY created_at DESC`;
        const { rows } = await pgPool.query(sql, values);
        return rows.map(camelCase);
      }
      // Fallback: use legacy read
      return jsonAdapter.read(entityName).filter(item =>
        Object.entries(where).every(([k, v]) => item[k] === v)
      );
    },

    async findOne(where = {}) {
      const results = await this.find(where);
      return results[0] || null;
    },

    async create(data) {
      if (pgPool) {
        const table = TABLE_MAP[entityName];
        const cols = Object.keys(data);
        const snake = snakeCase(data);
        const values = Object.values(snake);
        const colNames = cols.map(c => c.replace(/([A-Z])/g, '_$1').toLowerCase());
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

        const sql = `INSERT INTO ${table} (${colNames.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const { rows } = await pgPool.query(sql, values);
        return camelCase(rows[0]);
      }
      const list = jsonAdapter.read(entityName);
      list.push(data);
      jsonAdapter.write(entityName, list);
      return data;
    },

    async update(where, data) {
      if (pgPool) {
        const table = TABLE_MAP[entityName];
        const whereKeys = Object.keys(where);
        const dataKeys = Object.keys(data);
        const snakeData = snakeCase(data);

        const setClauses = dataKeys.map((k, i) => {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          return `${col} = $${i + 1}`;
        });
        const whereClauses = whereKeys.map((k, i) => {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          return `${col} = $${setClauses.length + i + 1}`;
        });

        const values = [...Object.values(snakeData), ...whereKeys.map(k => where[k])];
        const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')} RETURNING *`;
        const { rows } = await pgPool.query(sql, values);
        return rows.length ? camelCase(rows[0]) : null;
      }
      const list = jsonAdapter.read(entityName);
      const idx = list.findIndex(item =>
        Object.entries(where).every(([k, v]) => item[k] === v)
      );
      if (idx === -1) return null;
      Object.assign(list[idx], data);
      jsonAdapter.write(entityName, list);
      return list[idx];
    },

    async delete(where) {
      if (pgPool) {
        const table = TABLE_MAP[entityName];
        const keys = Object.keys(where);
        const clauses = keys.map((k, i) => {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          return `${col} = $${i + 1}`;
        });
        const sql = `DELETE FROM ${table} WHERE ${clauses.join(' AND ')} RETURNING *`;
        const { rows } = await pgPool.query(sql, keys.map(k => where[k]));
        return rows.length ? camelCase(rows[0]) : null;
      }
      const list = jsonAdapter.read(entityName);
      const idx = list.findIndex(item =>
        Object.entries(where).every(([k, v]) => item[k] === v)
      );
      if (idx === -1) return null;
      const removed = list.splice(idx, 1)[0];
      jsonAdapter.write(entityName, list);
      return removed;
    },

    async deleteMany(where) {
      if (pgPool) {
        const table = TABLE_MAP[entityName];
        const keys = Object.keys(where);
        const clauses = keys.map((k, i) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = $${i + 1}`);
        const sql = `DELETE FROM ${table} WHERE ${clauses.join(' AND ')}`;
        const { rowCount } = await pgPool.query(sql, keys.map(k => where[k]));
        return rowCount;
      }
      const before = jsonAdapter.read(entityName).length;
      const list = jsonAdapter.read(entityName).filter(item =>
        !Object.entries(where).every(([k, v]) => item[k] === v)
      );
      jsonAdapter.write(entityName, list);
      return before - list.length;
    },

    async query(sql, params = []) {
      if (pgPool) {
        const { rows } = await pgPool.query(sql, params);
        return rows.map(camelCase);
      }
      throw new Error('query() not available in JSON mode');
    },

    async rawQuery(sql, params = []) {
      if (pgPool) {
        const { rows } = await pgPool.query(sql, params);
        return rows;
      }
      throw new Error('rawQuery() not available in JSON mode');
    },
  };
}

// ── Export ─────────────────────────────────────────────────────────────────
const db = {
  _ready,
  _isPg: () => pgPool !== null,
  _pool: () => pgPool,

  // Entities
  enterprises:      createEntity('enterprises'),
  employees:        createEntity('employees'),
  restaurants:      createEntity('restaurants'),
  menus:            createEntity('menus'),
  dailyMenus:       createEntity('dailyMenus'),
  affiliations:     createEntity('affiliations'),
  offers:           createEntity('offers'),
  choices:          createEntity('choices'),
  orders:           createEntity('orders'),
  subscriptions:    createEntity('subscriptions'),
  invoices:         createEntity('invoices'),
  notifications:    createEntity('notifications'),
  messages:         createEntity('messages'),
  ratings:          createEntity('ratings'),
  passwordResets:   createEntity('passwordResets'),
  deletionRequests: createEntity('deletionRequests'),

  // Legacy compatibility (read/write by key)
  async read(key)        { await _ready; return jsonAdapter.read(key); },
  async write(key, data) { await _ready; return jsonAdapter.write(key, data); },
};

module.exports = db;
