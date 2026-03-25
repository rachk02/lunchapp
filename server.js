const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const cors    = require('cors');
const path    = require('path');

// Vercel KV : stockage clé-valeur persistant (remplace les fichiers JSON)
const { kv } = require('@vercel/kv');

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lunchapp_2024_key';
const LOCK_MS    = 5 * 60 * 1000; // 5 minutes

// ── Superadmin hardcodé ───────────────────────────────────────────────────────
const SUPERADMIN = {
  id:       'superadmin-001',
  email:    'admin.text.elimmeka@gmail.com',
  password: '@admin2101',
  fullName: 'Super Administrateur',
  role:     'superadmin',
};

// ── Clés de stockage KV ───────────────────────────────────────────────────────
const KEYS = {
  enterprises:    'la:enterprises',
  employees:      'la:employees',
  restauratrices: 'la:restauratrices',
  choices:        'la:choices',
  messages:       'la:messages',
};

// ── Fonctions de lecture/écriture (remplace readDB/writeDB fichiers) ──────────

// Lit un tableau depuis Vercel KV — retourne [] si absent
async function readDB(key) {
  try {
    const data = await kv.get(key);
    return data || [];
  } catch {
    return [];
  }
}

// Écrit un tableau dans Vercel KV
async function writeDB(key, data) {
  await kv.set(key, data);
}

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// ── Validation mot de passe entreprise ───────────────────────────────────────
function validateEnterprisePwd(pwd) {
  if (!pwd || pwd.length < 8)          return 'Minimum 8 caractères requis';
  if (!/[A-Z]/.test(pwd))              return 'Au moins une lettre majuscule requise';
  if (!/[a-z]/.test(pwd))              return 'Au moins une lettre minuscule requise';
  if (!/[0-9]/.test(pwd))              return 'Au moins un chiffre requis';
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

      if (!ent || !(await bcrypt.compare(password, ent.password)))
        return res.status(401).json({ error: "Nom d'entreprise ou mot de passe incorrect" });

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

      if (!resto || !(await bcrypt.compare(password, resto.password)))
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });

      const token = jwt.sign(
        { id: resto.id, role: 'restauratrice', fullName: resto.fullName },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: resto.id, fullName: resto.fullName, role: 'restauratrice' }
      });
    }

    // ── Employé ───────────────────────────────────────────────────────────────
    if (loginType === 'employee') {
      const employees = await readDB(KEYS.employees);
      const variants  = nameVariants(id);
      const emp       = employees.find(e =>
        variants.includes(e.fullName.trim().toLowerCase())
      );

      if (!emp || !(await bcrypt.compare(password, emp.password)))
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });

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

// ════════════════════════════════════════════════════════════════════
// CHOIX DE REPAS
// ════════════════════════════════════════════════════════════════════

app.get('/api/choices/today', auth, async (req, res) => {
  const all = (await readDB(KEYS.choices)).filter(c => c.date === todayStr());

  if (req.user.role === 'employee')
    return res.json(all.filter(c => c.enterpriseId === req.user.enterpriseId));
  if (req.user.role === 'enterprise')
    return res.json(all.filter(c => c.enterpriseId === req.user.id));

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
    id:           existingIdx >= 0 ? choices[existingIdx].id : Date.now().toString(),
    userId:       req.user.id,
    userName:     req.user.fullName,
    enterpriseId: req.user.enterpriseId,
    food,
    customFood:   food === 'Autres' ? customFood : null,
    date:         today,
    orderLaunched: false,
    createdAt:    existingIdx >= 0 ? choices[existingIdx].createdAt : now,
    updatedAt:    now,
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
  const all     = await readDB(KEYS.choices);
  const history = all
    .filter(c => c.userId === req.user.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});

// ════════════════════════════════════════════════════════════════════
// MESSAGERIE
// ════════════════════════════════════════════════════════════════════

app.get('/api/messages', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const messages = (await readDB(KEYS.messages))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json(messages);
});

app.post('/api/messages', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { content } = req.body;
  if (!content?.trim())
    return res.status(400).json({ error: 'Le message ne peut pas être vide' });

  const messages = await readDB(KEYS.messages);
  const msg = {
    id:         Date.now().toString(),
    senderId:   req.user.id,
    senderName: req.user.fullName,
    senderRole: req.user.role,
    content:    content.trim(),
    timestamp:  new Date().toISOString(),
    readBy:     [req.user.id],
  };

  messages.push(msg);
  await writeDB(KEYS.messages, messages);
  res.status(201).json(msg);
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


// Vercel n'utilise pas app.listen() — on exporte l'app
module.exports = app;

// En local (npm start), on écoute normalement
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  LunchApp → http://localhost:${PORT}`);
    console.log(`  Superadmin : ${SUPERADMIN.email}\n`);
  });
}