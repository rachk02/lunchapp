// ═══════════════════════════════════════════════════════════════════
// server.js — Backend LunchApp
// Stockage : fichiers JSON en local | Vercel KV en production
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lunchapp_2024_key';
const LOCK_MS    = 5 * 60 * 1000; // 5 minutes en millisecondes

// ── Détecte si on est sur Vercel (variables KV présentes) ─────────────────────
const IS_VERCEL = !!process.env.KV_REST_API_URL;

// ── Superadmin hardcodé ───────────────────────────────────────────────────────
const SUPERADMIN = {
  id:       'superadmin-001',
  email:    'admin.text.elimmeka@gmail.com',
  password: '@admin2101',
  fullName: 'Super Administrateur',
  role:     'superadmin',
};

// ── Clés de stockage KV (Vercel) / noms de fichiers (local) ──────────────────
const KEYS = {
  enterprises:    'la:enterprises',
  employees:      'la:employees',
  restauratrices: 'la:restauratrices',
  choices:        'la:choices',
  messages:       'la:messages',
};

// ── Dossier data/ pour le stockage local (override possible via DB_DIR pour les tests) ──
const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
if (!IS_VERCEL && !fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// ── Lecture des données (JSON local OU Vercel KV) ─────────────────────────────
async function readDB(key) {
  if (IS_VERCEL) {
    // Production Vercel : lit depuis le KV Redis
    try {
      const { kv } = require('@vercel/kv');
      const data   = await kv.get(key);
      return data || [];
    } catch (err) {
      console.error('KV readDB error:', err.message);
      return [];
    }
  } else {
    // Local : lit depuis un fichier JSON
    const fileName = key.replace('la:', '') + '.json';
    const filePath = path.join(DB_DIR, fileName);
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch { return []; }
  }
}

// ── Écriture des données (JSON local OU Vercel KV) ────────────────────────────
async function writeDB(key, data) {
  if (IS_VERCEL) {
    // Production Vercel : écrit dans le KV Redis
    try {
      const { kv } = require('@vercel/kv');
      await kv.set(key, data);
    } catch (err) {
      console.error('KV writeDB error:', err.message);
      throw err;
    }
  } else {
    // Local : écrit dans un fichier JSON
    const fileName = key.replace('la:', '') + '.json';
    const filePath = path.join(DB_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '8mb' })); // 8 MB pour les messages audio base64
app.use(express.static(path.join(__dirname, 'public')));

// ── SSE : Map userId → [Response, ...] ───────────────────────────────────────
const sseClients = new Map();

function pushSSE(userId, payload) {
  const clients = sseClients.get(userId) || [];
  const data    = `data: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(res => { try { res.write(data); } catch {} });
}

// ── Middleware JWT ────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── Middleware JWT pour SSE (accepte aussi ?token= en query) ──────────────────
function authSSE(req, res, next) {
  const header = req.headers.authorization;
  const t = header?.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!t) return res.status(401).end();
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    res.status(401).end();
  }
}

// ── Validation mot de passe entreprise ───────────────────────────────────────
function validateEnterprisePwd(pwd) {
  if (!pwd || pwd.length < 8)
    return 'Minimum 8 caractères requis';
  if (!/[A-Z]/.test(pwd))
    return 'Au moins une lettre majuscule requise';
  if (!/[a-z]/.test(pwd))
    return 'Au moins une lettre minuscule requise';
  if (!/[0-9]/.test(pwd))
    return 'Au moins un chiffre requis';
  if (!/[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/.test(pwd))
    return 'Au moins un caractère spécial requis';
  return null;
}

// ── Variantes Prénom Nom / Nom Prénom ─────────────────────────────────────────
function nameVariants(inputName) {
  const normalized = inputName.trim().toLowerCase();
  const parts      = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 2)
    return [parts.join(' '), `${parts[1]} ${parts[0]}`];
  return [normalized];
}

// ── Date du jour YYYY-MM-DD ───────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ════════════════════════════════════════════════════════════════════
// ROUTES D'AUTHENTIFICATION
// ════════════════════════════════════════════════════════════════════

app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password, loginType } = req.body;

    if (!identifier || !identifier.toString().trim())
      return res.status(400).json({ error: 'Identifiant requis' });
    if (!password)
      return res.status(400).json({ error: 'Mot de passe requis' });
    if (!loginType)
      return res.status(400).json({ error: 'Type de connexion requis' });

    const id = identifier.toString().trim();

    // ── Superadmin ────────────────────────────────────────────────────────────
    if (loginType === 'superadmin') {
      const emailMatch = id.toLowerCase() === SUPERADMIN.email.toLowerCase();
      const pwdMatch   = password === SUPERADMIN.password;
      if (!emailMatch || !pwdMatch) {
        console.log(`[ADMIN] Échec : reçu="${id}" | attendu="${SUPERADMIN.email}"`);
        return res.status(401).json({ error: 'Identifiants administrateur incorrects' });
      }
      const token = jwt.sign(
        { id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: SUPERADMIN.id, fullName: SUPERADMIN.fullName, role: 'superadmin' }
      });
    }

    // ── Entreprise ────────────────────────────────────────────────────────────
    if (loginType === 'enterprise') {
      const enterprises = await readDB(KEYS.enterprises);
      const ent = enterprises.find(e =>
        e.companyName.toLowerCase().trim() === id.toLowerCase()
      );
      if (!ent) return res.status(401).json({ error: "Nom d'entreprise ou mot de passe incorrect" });
      const valid = await bcrypt.compare(password, ent.password);
      if (!valid) return res.status(401).json({ error: "Nom d'entreprise ou mot de passe incorrect" });
      const token = jwt.sign(
        { id: ent.id, role: 'enterprise', fullName: ent.companyName, companyName: ent.companyName, domain: ent.domain },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: ent.id, fullName: ent.companyName, role: 'enterprise', companyName: ent.companyName, domain: ent.domain }
      });
    }

    // ── Restauratrice ─────────────────────────────────────────────────────────
    if (loginType === 'restauratrice') {
      const restauratrices = await readDB(KEYS.restauratrices);
      const variants       = nameVariants(id);
      const resto          = restauratrices.find(r =>
        variants.includes(r.fullName.trim().toLowerCase())
      );
      if (!resto) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      const valid = await bcrypt.compare(password, resto.password);
      if (!valid) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      const token = jwt.sign(
        { id: resto.id, role: 'restauratrice', fullName: resto.fullName, enterpriseId: resto.enterpriseId, enterpriseName: resto.enterpriseName },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: resto.id, fullName: resto.fullName, role: 'restauratrice', enterpriseId: resto.enterpriseId, enterpriseName: resto.enterpriseName }
      });
    }

    // ── Employé ───────────────────────────────────────────────────────────────
    if (loginType === 'employee') {
      const employees = await readDB(KEYS.employees);
      const variants  = nameVariants(id);
      const emp       = employees.find(e =>
        variants.includes(e.fullName.trim().toLowerCase())
      );
      if (!emp) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      const valid = await bcrypt.compare(password, emp.password);
      if (!valid) return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      const token = jwt.sign(
        { id: emp.id, role: 'employee', fullName: emp.fullName, enterpriseId: emp.enterpriseId, enterpriseName: emp.enterpriseName },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: emp.id, fullName: emp.fullName, role: 'employee', enterpriseId: emp.enterpriseId, enterpriseName: emp.enterpriseName }
      });
    }

    return res.status(400).json({ error: 'Type de connexion non reconnu' });

  } catch (err) {
    console.error('Erreur /api/login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Inscription entreprise ────────────────────────────────────────────────────
app.post('/api/enterprise/register', async (req, res) => {
  try {
    const { companyName, domain, password } = req.body;

    if (!companyName || !domain || !password)
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });

    const pwdError = validateEnterprisePwd(password);
    if (pwdError) return res.status(400).json({ error: pwdError });

    const enterprises = await readDB(KEYS.enterprises);

    if (enterprises.find(e =>
      e.companyName.toLowerCase().trim() === companyName.toLowerCase().trim()
    )) return res.status(409).json({ error: "Ce nom d'entreprise est déjà utilisé" });

    const hashedPwd     = await bcrypt.hash(password, 10);
    const newEnterprise = {
      id:          Date.now().toString(),
      companyName: companyName.trim(),
      domain:      domain.trim(),
      password:    hashedPwd,
      role:        'enterprise',
      createdAt:   new Date().toISOString(),
    };

    enterprises.push(newEnterprise);
    await writeDB(KEYS.enterprises, enterprises);

    const token = jwt.sign(
      { id: newEnterprise.id, role: 'enterprise', fullName: newEnterprise.companyName, companyName: newEnterprise.companyName, domain: newEnterprise.domain },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.status(201).json({
      token,
      user: { id: newEnterprise.id, fullName: newEnterprise.companyName, role: 'enterprise', companyName: newEnterprise.companyName, domain: newEnterprise.domain }
    });

  } catch (err) {
    console.error('Erreur register enterprise:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Inscription restauratrice ─────────────────────────────────────────────────
app.post('/api/restauratrice/register', async (req, res) => {
  try {
    const { fullName, password } = req.body;

    if (!fullName || !password)
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });

    const restauratrices = await readDB(KEYS.restauratrices);

    if (restauratrices.find(r =>
      r.fullName.toLowerCase().trim() === fullName.toLowerCase().trim()
    )) return res.status(409).json({ error: 'Ce nom est déjà utilisé' });

    const hashedPwd = await bcrypt.hash(password, 10);
    const newResto  = {
      id:        Date.now().toString(),
      fullName:  fullName.trim(),
      password:  hashedPwd,
      role:      'restauratrice',
      createdAt: new Date().toISOString(),
    };

    restauratrices.push(newResto);
    await writeDB(KEYS.restauratrices, restauratrices);

    const token = jwt.sign(
      { id: newResto.id, role: 'restauratrice', fullName: newResto.fullName },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.status(201).json({
      token,
      user: { id: newResto.id, fullName: newResto.fullName, role: 'restauratrice' }
    });

  } catch (err) {
    console.error('Erreur register restauratrice:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ════════════════════════════════════════════════════════════════════
// EMPLOYÉS
// ════════════════════════════════════════════════════════════════════

app.post('/api/enterprise/employees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'enterprise')
      return res.status(403).json({ error: 'Accès réservé aux entreprises' });

    const { fullName, password } = req.body;
    if (!fullName || !password)
      return res.status(400).json({ error: 'Nom complet et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });

    const employees = await readDB(KEYS.employees);

    if (employees.find(e =>
      e.fullName.toLowerCase().trim() === fullName.toLowerCase().trim() &&
      e.enterpriseId === req.user.id
    )) return res.status(409).json({ error: 'Un employé avec ce nom existe déjà' });

    const hashedPwd   = await bcrypt.hash(password, 10);
    const newEmployee = {
      id:             Date.now().toString(),
      fullName:       fullName.trim(),
      password:       hashedPwd,
      role:           'employee',
      enterpriseId:   req.user.id,
      enterpriseName: req.user.companyName,
      createdAt:      new Date().toISOString(),
    };

    employees.push(newEmployee);
    await writeDB(KEYS.employees, employees);

    res.status(201).json({
      success:  true,
      employee: { id: newEmployee.id, fullName: newEmployee.fullName, enterpriseName: newEmployee.enterpriseName }
    });

  } catch (err) {
    console.error('Erreur création employé:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/enterprise/employees', auth, async (req, res) => {
  if (!['enterprise', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  const employees = await readDB(KEYS.employees);
  const filtered  = req.user.role === 'superadmin'
    ? employees
    : employees.filter(e => e.enterpriseId === req.user.id);
  res.json(filtered.map(({ password, ...e }) => e));
});

app.delete('/api/enterprise/employees/:id', auth, async (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: 'Accès refusé' });
  let employees = await readDB(KEYS.employees);
  const idx     = employees.findIndex(e =>
    e.id === req.params.id && e.enterpriseId === req.user.id
  );
  if (idx === -1) return res.status(404).json({ error: 'Employé non trouvé' });
  employees.splice(idx, 1);
  await writeDB(KEYS.employees, employees);
  res.json({ success: true });
});

// ── Création restauratrice par l'entreprise ───────────────────────────────────
app.post('/api/enterprise/restauratrice', auth, async (req, res) => {
  try {
    if (req.user.role !== 'enterprise')
      return res.status(403).json({ error: 'Accès réservé aux entreprises' });

    const { fullName, password } = req.body;
    if (!fullName || !password)
      return res.status(400).json({ error: 'Nom complet et mot de passe requis' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });

    const restauratrices = await readDB(KEYS.restauratrices);

    if (restauratrices.find(r =>
      r.fullName.toLowerCase().trim() === fullName.toLowerCase().trim()
    )) return res.status(409).json({ error: 'Ce nom est déjà utilisé' });

    const hashedPwd = await bcrypt.hash(password, 10);
    const newResto  = {
      id:             Date.now().toString(),
      fullName:       fullName.trim(),
      password:       hashedPwd,
      role:           'restauratrice',
      enterpriseId:   req.user.id,
      enterpriseName: req.user.companyName,
      createdAt:      new Date().toISOString(),
    };

    restauratrices.push(newResto);
    await writeDB(KEYS.restauratrices, restauratrices);

    res.status(201).json({
      success:       true,
      restauratrice: { id: newResto.id, fullName: newResto.fullName, enterpriseName: newResto.enterpriseName }
    });

  } catch (err) {
    console.error('Erreur création restauratrice:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Liste des restauratrices d'une entreprise ─────────────────────────────────
app.get('/api/enterprise/restauratrices', auth, async (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: 'Accès refusé' });
  const restauratrices = await readDB(KEYS.restauratrices);
  const filtered = restauratrices.filter(r => r.enterpriseId === req.user.id);
  res.json(filtered.map(({ password, ...r }) => r));
});

// ── Suppression restauratrice par l'entreprise ────────────────────────────────
app.delete('/api/enterprise/restauratrices/:id', auth, async (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: 'Accès refusé' });
  let restauratrices = await readDB(KEYS.restauratrices);
  const idx = restauratrices.findIndex(r =>
    r.id === req.params.id && r.enterpriseId === req.user.id
  );
  if (idx === -1) return res.status(404).json({ error: 'Restauratrice non trouvée' });
  restauratrices.splice(idx, 1);
  await writeDB(KEYS.restauratrices, restauratrices);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// CHOIX DE REPAS
// ════════════════════════════════════════════════════════════════════

app.get('/api/choices/today', auth, async (req, res) => {
  const all = (await readDB(KEYS.choices)).filter(c => c.date === todayStr());
  if (req.user.role === 'employee')
    return res.json(all.filter(c => c.enterpriseId === req.user.enterpriseId));
  if (req.user.role === 'enterprise')
    return res.json(all.filter(c => c.enterpriseId === req.user.id));
  if (req.user.role === 'restauratrice' && req.user.enterpriseId)
    return res.json(all.filter(c => c.enterpriseId === req.user.enterpriseId));
  res.json(all);
});

app.get('/api/choices/mine', auth, async (req, res) => {
  const all  = await readDB(KEYS.choices);
  const mine = all.find(c => c.userId === req.user.id && c.date === todayStr());
  res.json(mine || null);
});

app.post('/api/choices', auth, async (req, res) => {
  if (req.user.role !== 'employee')
    return res.status(403).json({ error: 'Seuls les employés peuvent faire des choix' });

  const { food, customFood } = req.body;
  if (!food) return res.status(400).json({ error: 'Choix de repas requis' });

  const choices = await readDB(KEYS.choices);
  const today   = todayStr();

  const isLaunched = choices.some(c =>
    c.date === today && c.enterpriseId === req.user.enterpriseId && c.orderLaunched
  );
  if (isLaunched)
    return res.status(403).json({ error: "La commande a déjà été lancée aujourd'hui" });

  const existingIdx = choices.findIndex(c => c.userId === req.user.id && c.date === today);
  if (existingIdx >= 0) {
    const elapsed = Date.now() - new Date(choices[existingIdx].updatedAt).getTime();
    if (elapsed > LOCK_MS)
      return res.status(403).json({ error: 'Le délai de 5 minutes est expiré.', locked: true });
  }

  const now        = new Date().toISOString();
  const choiceData = {
    id:            existingIdx >= 0 ? choices[existingIdx].id : Date.now().toString(),
    userId:        req.user.id,
    userName:      req.user.fullName,
    enterpriseId:  req.user.enterpriseId,
    food,
    customFood:    food === 'Autres' ? customFood : null,
    date:          today,
    orderLaunched: false,
    createdAt:     existingIdx >= 0 ? choices[existingIdx].createdAt : now,
    updatedAt:     now,
  };

  if (existingIdx >= 0) choices[existingIdx] = choiceData;
  else choices.push(choiceData);

  await writeDB(KEYS.choices, choices);
  res.json(choiceData);
});

app.delete('/api/choices/mine', auth, async (req, res) => {
  let choices = await readDB(KEYS.choices);
  const today = todayStr();
  const idx   = choices.findIndex(c => c.userId === req.user.id && c.date === today);

  if (idx === -1) return res.status(404).json({ error: 'Aucun choix trouvé' });
  if (choices[idx].orderLaunched)
    return res.status(403).json({ error: 'La commande a déjà été lancée' });

  const elapsed = Date.now() - new Date(choices[idx].updatedAt).getTime();
  if (elapsed > LOCK_MS)
    return res.status(403).json({ error: 'Le délai de 5 minutes est expiré.', locked: true });

  choices.splice(idx, 1);
  await writeDB(KEYS.choices, choices);
  res.json({ success: true });
});

app.post('/api/choices/launch', auth, async (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: "Seule l'entreprise peut lancer la commande" });

  let choices = await readDB(KEYS.choices);
  const today = todayStr();
  let count   = 0;

  choices = choices.map(c => {
    if (c.date === today && c.enterpriseId === req.user.id) {
      count++;
      return { ...c, orderLaunched: true };
    }
    return c;
  });

  if (count === 0)
    return res.status(400).json({ error: "Aucun choix pour aujourd'hui" });

  await writeDB(KEYS.choices, choices);
  res.json({ success: true, count });
});

app.get('/api/history', auth, async (req, res) => {
  const all = await readDB(KEYS.choices);
  const history = all
    .filter(c => c.userId === req.user.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});

// ════════════════════════════════════════════════════════════════════
// SSE — NOTIFICATIONS TEMPS RÉEL
// ════════════════════════════════════════════════════════════════════

app.get('/api/events', authSSE, (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).end();

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const uid = req.user.id;
  if (!sseClients.has(uid)) sseClients.set(uid, []);
  sseClients.get(uid).push(res);

  // Confirmation de connexion
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // Ping toutes les 25 s pour maintenir la connexion
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    const list = sseClients.get(uid) || [];
    sseClients.set(uid, list.filter(c => c !== res));
  });
});

// ════════════════════════════════════════════════════════════════════
// MESSAGERIE
// ════════════════════════════════════════════════════════════════════

app.get('/api/messages', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  // audioData exclu de la liste (trop lourd) → récupéré séparément
  const messages = (await readDB(KEYS.messages))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .map(({ audioData, ...m }) => m);
  res.json(messages);
});

// Récupère l'audio d'un message spécifique
app.get('/api/messages/:id/audio', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  const messages = await readDB(KEYS.messages);
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg || msg.type !== 'audio' || !msg.audioData)
    return res.status(404).json({ error: 'Audio non trouvé' });
  res.json({ audioData: msg.audioData });
});

app.post('/api/messages', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { content, type, audioData } = req.body;

  // Validation selon le type
  if (type === 'audio') {
    if (!audioData) return res.status(400).json({ error: 'Données audio manquantes' });
    if (audioData.length > 6 * 1024 * 1024)
      return res.status(400).json({ error: 'Audio trop long (2 min max)' });
  } else {
    if (!content?.trim()) return res.status(400).json({ error: 'Le message ne peut pas être vide' });
  }

  const messages = await readDB(KEYS.messages);
  const msg = {
    id:         Date.now().toString(),
    senderId:   req.user.id,
    senderName: req.user.fullName,
    senderRole: req.user.role,
    type:       type === 'audio' ? 'audio' : 'text',
    content:    type === 'audio' ? '🎤 Message vocal' : content.trim(),
    audioData:  type === 'audio' ? audioData : null,
    timestamp:  new Date().toISOString(),
    readBy:     [req.user.id],
  };

  messages.push(msg);
  await writeDB(KEYS.messages, messages);

  // ── Notification SSE au destinataire ──────────────────────────
  const notifPayload = { type: 'new_message', message: { ...msg, audioData: null } };
  const restauratrices = await readDB(KEYS.restauratrices);

  if (req.user.role === 'enterprise') {
    // Notifie les restauratrices liées à cette entreprise
    restauratrices
      .filter(r => r.enterpriseId === req.user.id)
      .forEach(r => pushSSE(r.id, notifPayload));
  } else if (req.user.role === 'restauratrice' && req.user.enterpriseId) {
    // Notifie l'entreprise liée
    pushSSE(req.user.enterpriseId, notifPayload);
  }

  res.status(201).json({ ...msg, audioData: null });
});

app.post('/api/messages/read', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });
  let messages = await readDB(KEYS.messages);
  messages = messages.map(m => ({
    ...m,
    readBy: m.readBy.includes(req.user.id) ? m.readBy : [...m.readBy, req.user.id],
  }));
  await writeDB(KEYS.messages, messages);
  res.json({ success: true });
});

app.get('/api/messages/unread', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.json({ count: 0 });
  const all   = await readDB(KEYS.messages);
  const count = all.filter(m =>
    !m.readBy.includes(req.user.id) && m.senderId !== req.user.id
  ).length;
  res.json({ count });
});

// ════════════════════════════════════════════════════════════════════
// SUPERADMIN
// ════════════════════════════════════════════════════════════════════

app.get('/api/admin/enterprises', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = (await readDB(KEYS.enterprises)).map(({ password, ...e }) => e);
  res.json(list);
});

app.get('/api/admin/employees', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = (await readDB(KEYS.employees)).map(({ password, ...e }) => e);
  res.json(list);
});

app.get('/api/admin/restauratrices', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = (await readDB(KEYS.restauratrices)).map(({ password, ...r }) => r);
  res.json(list);
});

app.get('/api/admin/choices/today', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const choices = (await readDB(KEYS.choices)).filter(c => c.date === todayStr());
  res.json(choices);
});

app.get('/api/admin/history', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const history = (await readDB(KEYS.choices)).sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});

// ── Renommer un utilisateur ───────────────────────────────────────────────────
app.patch('/api/admin/users/:type/:id', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });

  const { type, id } = req.params;
  const { newName, newDomain } = req.body;

  if (!newName?.trim()) return res.status(400).json({ error: 'Le nom ne peut pas être vide' });

  try {
    if (type === 'enterprise') {
      const enterprises = await readDB(KEYS.enterprises);
      const idx = enterprises.findIndex(e => e.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Entreprise non trouvée' });

      const oldName = enterprises[idx].companyName;
      enterprises[idx].companyName = newName.trim();
      if (newDomain?.trim()) enterprises[idx].domain = newDomain.trim();
      await writeDB(KEYS.enterprises, enterprises);

      // Cascade : met à jour enterpriseName dans employees et restauratrices
      const employees = await readDB(KEYS.employees);
      const updatedEmps = employees.map(e =>
        e.enterpriseId === id ? { ...e, enterpriseName: newName.trim() } : e
      );
      await writeDB(KEYS.employees, updatedEmps);

      const restos = await readDB(KEYS.restauratrices);
      const updatedRestos = restos.map(r =>
        r.enterpriseId === id ? { ...r, enterpriseName: newName.trim() } : r
      );
      await writeDB(KEYS.restauratrices, updatedRestos);

      return res.json({ success: true, oldName, newName: newName.trim() });
    }

    if (type === 'employee') {
      const employees = await readDB(KEYS.employees);
      const idx = employees.findIndex(e => e.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Employé non trouvé' });
      employees[idx].fullName = newName.trim();
      await writeDB(KEYS.employees, employees);
      return res.json({ success: true });
    }

    if (type === 'restauratrice') {
      const restos = await readDB(KEYS.restauratrices);
      const idx = restos.findIndex(r => r.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Restauratrice non trouvée' });
      restos[idx].fullName = newName.trim();
      await writeDB(KEYS.restauratrices, restos);
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Type inconnu' });
  } catch (err) {
    console.error('Erreur renommage admin:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Supprimer un utilisateur ──────────────────────────────────────────────────
app.delete('/api/admin/users/:type/:id', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });

  const { type, id } = req.params;

  try {
    if (type === 'enterprise') {
      let enterprises = await readDB(KEYS.enterprises);
      if (!enterprises.find(e => e.id === id))
        return res.status(404).json({ error: 'Entreprise non trouvée' });

      // Cascade : supprime employés, restauratrices et choix liés
      let employees = await readDB(KEYS.employees);
      await writeDB(KEYS.employees, employees.filter(e => e.enterpriseId !== id));

      let restos = await readDB(KEYS.restauratrices);
      await writeDB(KEYS.restauratrices, restos.filter(r => r.enterpriseId !== id));

      let choices = await readDB(KEYS.choices);
      await writeDB(KEYS.choices, choices.filter(c => c.enterpriseId !== id));

      await writeDB(KEYS.enterprises, enterprises.filter(e => e.id !== id));
      return res.json({ success: true });
    }

    if (type === 'employee') {
      let employees = await readDB(KEYS.employees);
      if (!employees.find(e => e.id === id))
        return res.status(404).json({ error: 'Employé non trouvé' });
      await writeDB(KEYS.employees, employees.filter(e => e.id !== id));
      return res.json({ success: true });
    }

    if (type === 'restauratrice') {
      let restos = await readDB(KEYS.restauratrices);
      if (!restos.find(r => r.id === id))
        return res.status(404).json({ error: 'Restauratrice non trouvée' });
      await writeDB(KEYS.restauratrices, restos.filter(r => r.id !== id));
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Type inconnu' });
  } catch (err) {
    console.error('Erreur suppression admin:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Modifier un choix (admin) ─────────────────────────────────────────────────
app.patch('/api/admin/choices/:id', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });

  const { food, customFood } = req.body;
  if (!food) return res.status(400).json({ error: 'Choix de repas requis' });

  let choices = await readDB(KEYS.choices);
  const idx   = choices.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Choix non trouvé' });

  choices[idx] = {
    ...choices[idx],
    food,
    customFood: food === 'Autres' ? (customFood || null) : null,
    updatedAt:  new Date().toISOString(),
  };
  await writeDB(KEYS.choices, choices);
  res.json(choices[idx]);
});

// ── Supprimer un choix (admin) ────────────────────────────────────────────────
app.delete('/api/admin/choices/:id', auth, async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });

  let choices = await readDB(KEYS.choices);
  if (!choices.find(c => c.id === req.params.id))
    return res.status(404).json({ error: 'Choix non trouvé' });

  await writeDB(KEYS.choices, choices.filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════
// DÉMARRAGE
// ════════════════════════════════════════════════════════════════════

// Vercel exporte l'app (pas de app.listen)
module.exports = app;

// En local (npm start), écoute normalement
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  LunchApp → http://localhost:${PORT}`);
    console.log(`  Superadmin : ${SUPERADMIN.email}`);
    console.log(`  Stockage   : ${IS_VERCEL ? 'Vercel KV' : 'Fichiers JSON locaux'}\n`);
  });
}