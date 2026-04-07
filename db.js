// ═══════════════════════════════════════════════════════════════════════════
// db.js — Couche d'accès aux données (Supabase ou JSON fichiers)
// ═══════════════════════════════════════════════════════════════════════════
// Si SUPABASE_URL est défini → Supabase via @supabase/supabase-js
// Sinon                      → JSON fichiers locaux (développement local)
//
// API : db.<entity>.find(), .findOne(), .create(), .update(), .delete()
//       + query() / raw() pour requêtes SQL brutes
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
// JSON Adapter (développement local / tests)
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
// Supabase Adapter
// ═══════════════════════════════════════════════════════════════════════════
let supabase = null;

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
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[camel] = JSON.parse(v); continue; } catch {}
    }
    out[camel] = v;
  }
  return out;
}

async function initSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return null;

  try {
    const { createClient } = require('@supabase/supabase-js');

    const client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      {
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    // Test connection
    const { error } = await client.from('enterprises').select('id', { count: 'exact', head: true });
    if (error && error.code !== 'PGRST116') throw new Error(error.message);

    console.log('[DB] Supabase connecté —', process.env.SUPABASE_URL);
    supabase = client;
    return client;
  } catch (err) {
    console.error('[DB] Échec connexion Supabase — fallback JSON local:', err.message);
    return null;
  }
}

const _ready = initSupabase();

// ── Generic entity CRUD for Supabase ─────────────────────────────────────
function createEntity(entityName) {
  return {
    async find(where = {}) {
      if (supabase) {
        const table = TABLE_MAP[entityName];
        if (!table) throw new Error(`Unknown entity: ${entityName}`);
        let q = supabase.from(table).select('*');

        const keys = Object.keys(where);
        for (const k of keys) {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          const val = where[k];
          if (val === null || val === undefined) q = q.is(col, null);
          else q = q.eq(col, val);
        }

        q = q.order('created_at', { ascending: false });
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return (data || []).map(camelCase);
      }
      return jsonAdapter.read(entityName).filter(item =>
        Object.entries(where).every(([k, v]) => item[k] === v)
      );
    },

    async findOne(where = {}) {
      if (supabase) {
        const table = TABLE_MAP[entityName];
        if (!table) throw new Error(`Unknown entity: ${entityName}`);
        let q = supabase.from(table).select('*').limit(1);

        const keys = Object.keys(where);
        for (const k of keys) {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          const val = where[k];
          if (val === null || val === undefined) q = q.is(col, null);
          else q = q.eq(col, val);
        }

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data && data.length ? camelCase(data[0]) : null;
      }
      const results = jsonAdapter.read(entityName).filter(item =>
        Object.entries(where).every(([k, v]) => item[k] === v)
      );
      return results[0] || null;
    },

    async create(data) {
      if (supabase) {
        const table = TABLE_MAP[entityName];
        const snake = snakeCase(data);
        const { data: result, error } = await supabase
          .from(table)
          .insert(snake)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return camelCase(result);
      }
      const list = jsonAdapter.read(entityName);
      list.push(data);
      jsonAdapter.write(entityName, list);
      return data;
    },

    async update(where, data) {
      if (supabase) {
        const table = TABLE_MAP[entityName];
        const snakeData = snakeCase(data);
        let q = supabase.from(table).update(snakeData).select();

        const keys = Object.keys(where);
        for (const k of keys) {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          const val = where[k];
          if (val === null || val === undefined) q = q.is(col, null);
          else q = q.eq(col, val);
        }

        const { data: result, error } = await q;
        if (error) throw new Error(error.message);
        return result && result.length ? camelCase(result[0]) : null;
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
      if (supabase) {
        const table = TABLE_MAP[entityName];
        let q = supabase.from(table).delete().select();

        const keys = Object.keys(where);
        for (const k of keys) {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          const val = where[k];
          if (val === null || val === undefined) q = q.is(col, null);
          else q = q.eq(col, val);
        }

        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return data && data.length ? camelCase(data[0]) : null;
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
      if (supabase) {
        const table = TABLE_MAP[entityName];
        let q = supabase.from(table).delete();

        const keys = Object.keys(where);
        for (const k of keys) {
          const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
          const val = where[k];
          if (val === null || val === undefined) q = q.is(col, null);
          else q = q.eq(col, val);
        }

        const { count, error } = await q;
        if (error) throw new Error(error.message);
        return count || 0;
      }
      const before = jsonAdapter.read(entityName).length;
      const list = jsonAdapter.read(entityName).filter(item =>
        !Object.entries(where).every(([k, v]) => item[k] === v)
      );
      jsonAdapter.write(entityName, list);
      return before - list.length;
    },

    async query(sql, params = []) {
      if (supabase) {
        // Supabase JS doesn't support raw SQL — convert common patterns
        // DELETE FROM table WHERE col = $1 AND col2 != $2
        const delMatch = sql.match(/^DELETE FROM (\w+) WHERE (.+)$/i);
        if (delMatch) {
          const table = delMatch[1];
          const tableEntity = Object.entries(TABLE_MAP).find(([, t]) => t === table)?.[0];
          if (!tableEntity) throw new Error(`Unknown table: ${table}`);
          const entity = createEntity(tableEntity);

          // Parse WHERE conditions
          const conditions = delMatch[2].split(/\s+AND\s+/i);
          let q = supabase.from(table).delete();
          for (const cond of conditions) {
            const m = cond.match(/(\w+)\s*([=!<>]+)\s*\$(\d+)/);
            if (!m) continue;
            const col = m[1];
            const op = m[2];
            const val = params[parseInt(m[3]) - 1];
            if (op === '=') q = q.eq(col, val);
            else if (op === '!=') q = q.neq(col, val);
          }
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return (data || []).map(camelCase);
        }

        // UPDATE table SET col = $1 WHERE col2 = $2
        const updMatch = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i);
        if (updMatch) {
          const table = updMatch[1];
          const tableEntity = Object.entries(TABLE_MAP).find(([, t]) => t === table)?.[0];
          if (!tableEntity) throw new Error(`Unknown table: ${table}`);
          const entity = createEntity(tableEntity);

          // Parse SET
          const setParts = updMatch[2].split(/\s*,\s*/);
          const updates = {};
          for (const part of setParts) {
            const m = part.match(/(\w+)\s*=\s*(.+)$/);
            if (!m) continue;
            const col = m[1];
            let val = m[2].trim();
            if (val === 'NOW()') val = new Date().toISOString();
            else if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (val.startsWith("'")) val = val.slice(1, -1);
            else {
              const pm = val.match(/\$(\d+)/);
              if (pm) val = params[parseInt(pm[1]) - 1];
            }
            const camelCol = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            updates[camelCol] = val;
          }

          // Parse WHERE
          const whereParts = updMatch[3].split(/\s+AND\s+/i);
          let q = supabase.from(table).update(snakeCase(updates));
          for (const cond of whereParts) {
            const m = cond.match(/(\w+)\s*=\s*\$(\d+)/);
            if (!m) continue;
            const col = m[1];
            const val = params[parseInt(m[2]) - 1];
            q = q.eq(col, val);
          }

          const { data, error } = await q;
          if (error) throw new Error(error.message);
          return (data || []).map(camelCase);
        }

        throw new Error(`Unsupported raw SQL query: ${sql}`);
      }
      throw new Error('query() not available in JSON mode');
    },

    async raw(sql, params = []) {
      return this.query(sql, params);
    },
  };
}

// ── Export ─────────────────────────────────────────────────────────────────
const db = {
  _ready,
  _isSupabase: () => supabase !== null,
  _client: () => supabase,

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
