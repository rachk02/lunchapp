const express = require('express');      // Framework HTTP Node.js
const bcrypt  = require('bcryptjs');     // Hashage sécurisé des mots de passe
const jwt     = require('jsonwebtoken'); // Tokens d'authentification JWT
const cors    = require('cors');         // Autorise les requêtes cross-origin
const fs      = require('fs');           // Lecture/écriture de fichiers
const path    = require('path');         // Construction de chemins de fichiers

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lunchapp_2024_key';
const LOCK_MS    = 5 * 60 * 1000;        // 5 minutes en millisecondes

// ── Compte superadmin hardcodé ────────────────────────────────────────────────
// CORRECTION : "text" et non "test" dans l'email
const SUPERADMIN = {
  id:       'superadmin-001',
  email:    'admin.text.elimmeka@gmail.com', // ← CORRIGÉ (text, pas test)
  password: '@admin2101',                    // Mot de passe en clair (hardcodé volontairement)
  fullName: 'Super Administrateur',
  role:     'superadmin',
};

// ── Stockage JSON ─────────────────────────────────────────────────────────────
const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR); // Crée le dossier si absent

const FILES = {
  enterprises:    path.join(DB_DIR, 'enterprises.json'),
  employees:      path.join(DB_DIR, 'employees.json'),
  restauratrices: path.join(DB_DIR, 'restauratrices.json'),
  choices:        path.join(DB_DIR, 'choices.json'),
  messages:       path.join(DB_DIR, 'messages.json'),
};

// Lit un fichier JSON → retourne [] si absent ou invalide
function readDB(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}

// Écrit les données dans un fichier JSON indenté
function writeDB(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());                                            // CORS toutes origines
app.use(express.json());                                    // Parse le corps JSON
app.use(express.static(path.join(__dirname, 'public')));   // Sert les fichiers statiques

// ── Middleware d'authentification JWT ─────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'Non autorisé' });
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET); // Décode le token
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// ── Validation du mot de passe entreprise ─────────────────────────────────────
// Règles : 8+ car., 1 maj., 1 min., 1 chiffre, 1 caractère spécial
function validateEnterprisePwd(pwd) {
  if (!pwd || pwd.length < 8)
    return 'Minimum 8 caractères requis';
  if (!/[A-Z]/.test(pwd))
    return 'Au moins une lettre majuscule (A-Z) requise';
  if (!/[a-z]/.test(pwd))
    return 'Au moins une lettre minuscule (a-z) requise';
  if (!/[0-9]/.test(pwd))
    return 'Au moins un chiffre (0-9) requis';
  if (!/[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/.test(pwd))
    return 'Au moins un caractère spécial requis (!@#$... etc.)';
  return null; // null = valide
}

// ── Génère les variantes Prénom Nom / Nom Prénom ──────────────────────────────
// Permet la connexion dans les deux sens pour les employés et restauratrices
function nameVariants(inputName) {
  const normalized = inputName.trim().toLowerCase();
  const parts      = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 2) {
    return [parts.join(' '), `${parts[1]} ${parts[0]}`]; // ["jean dupont", "dupont jean"]
  }
  return [normalized]; // 1 ou 3+ mots : retourne tel quel
}

// ── Date du jour YYYY-MM-DD ───────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ── Connexion universelle (tous les rôles) ────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { identifier, password, loginType } = req.body;

    // ── Validation basique des champs ──
    // On vérifie que identifier et password ne sont pas vides/undefined
    if (!identifier || !identifier.toString().trim()) {
      return res.status(400).json({ error: 'Identifiant requis' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Mot de passe requis' });
    }
    if (!loginType) {
      return res.status(400).json({ error: 'Type de connexion requis' });
    }

    const id = identifier.toString().trim(); // Nettoie l'identifiant

    // ── CAS 1 : Superadmin ────────────────────────────────────────────────────
    if (loginType === 'superadmin') {
      // Comparaison insensible à la casse pour l'email
      const emailMatch = id.toLowerCase() === SUPERADMIN.email.toLowerCase();
      const pwdMatch   = password === SUPERADMIN.password;

      if (!emailMatch || !pwdMatch) {
        // Log utile en développement pour diagnostiquer les erreurs de saisie
        console.log(`[ADMIN] Tentative: email="${id}" | attendu="${SUPERADMIN.email}" | match=${emailMatch}`);
        return res.status(401).json({ error: 'Identifiants administrateur incorrects' });
      }

      const token = jwt.sign(
        { id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      console.log(`[ADMIN] Connexion superadmin réussie`);
      return res.json({
        token,
        user: { id: SUPERADMIN.id, fullName: SUPERADMIN.fullName, role: 'superadmin' }
      });
    }

    // ── CAS 2 : Entreprise (par nom d'entreprise) ─────────────────────────────
    if (loginType === 'enterprise') {
      const enterprises = readDB(FILES.enterprises);
      const ent = enterprises.find(e =>
        e.companyName.toLowerCase().trim() === id.toLowerCase()
      );

      if (!ent) {
        return res.status(401).json({ error: "Nom d'entreprise ou mot de passe incorrect" });
      }

      const valid = await bcrypt.compare(password, ent.password);
      if (!valid) {
        return res.status(401).json({ error: "Nom d'entreprise ou mot de passe incorrect" });
      }

      const token = jwt.sign(
        {
          id:          ent.id,
          role:        'enterprise',
          fullName:    ent.companyName,
          companyName: ent.companyName,
          domain:      ent.domain
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: ent.id, fullName: ent.companyName, role: 'enterprise', companyName: ent.companyName, domain: ent.domain }
      });
    }

    // ── CAS 3 : Restauratrice (par nom, ordre flexible) ───────────────────────
    if (loginType === 'restauratrice') {
      const restauratrices = readDB(FILES.restauratrices);
      const variants       = nameVariants(id);

      const resto = restauratrices.find(r =>
        variants.includes(r.fullName.trim().toLowerCase())
      );

      if (!resto) {
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      }

      const valid = await bcrypt.compare(password, resto.password);
      if (!valid) {
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      }

      const token = jwt.sign(
        { id: resto.id, role: 'restauratrice', fullName: resto.fullName },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: { id: resto.id, fullName: resto.fullName, role: 'restauratrice' }
      });
    }

    // ── CAS 4 : Employé (par nom, ordre flexible) ─────────────────────────────
    if (loginType === 'employee') {
      const employees = readDB(FILES.employees);
      const variants  = nameVariants(id);

      const emp = employees.find(e =>
        variants.includes(e.fullName.trim().toLowerCase())
      );

      if (!emp) {
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      }

      const valid = await bcrypt.compare(password, emp.password);
      if (!valid) {
        return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
      }

      const token = jwt.sign(
        {
          id:             emp.id,
          role:           'employee',
          fullName:       emp.fullName,
          enterpriseId:   emp.enterpriseId,
          enterpriseName: emp.enterpriseName
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({
        token,
        user: {
          id:             emp.id,
          fullName:       emp.fullName,
          role:           'employee',
          enterpriseId:   emp.enterpriseId,
          enterpriseName: emp.enterpriseName
        }
      });
    }

    // Aucun loginType reconnu
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

    const enterprises = readDB(FILES.enterprises);

    if (enterprises.find(e =>
      e.companyName.toLowerCase().trim() === companyName.toLowerCase().trim()
    )) return res.status(409).json({ error: "Ce nom d'entreprise est déjà utilisé" });

    const hashedPwd    = await bcrypt.hash(password, 10);
    const newEnterprise = {
      id:          Date.now().toString(),
      companyName: companyName.trim(),
      domain:      domain.trim(),
      password:    hashedPwd,
      role:        'enterprise',
      createdAt:   new Date().toISOString(),
    };

    enterprises.push(newEnterprise);
    writeDB(FILES.enterprises, enterprises);

    const token = jwt.sign(
      {
        id:          newEnterprise.id,
        role:        'enterprise',
        fullName:    newEnterprise.companyName,
        companyName: newEnterprise.companyName,
        domain:      newEnterprise.domain
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id:          newEnterprise.id,
        fullName:    newEnterprise.companyName,
        role:        'enterprise',
        companyName: newEnterprise.companyName,
        domain:      newEnterprise.domain
      }
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

    const restauratrices = readDB(FILES.restauratrices);

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
    writeDB(FILES.restauratrices, restauratrices);

    const token = jwt.sign(
      { id: newResto.id, role: 'restauratrice', fullName: newResto.fullName },
      JWT_SECRET,
      { expiresIn: '7d' }
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


// ── Créer un employé (entreprise seulement) ───────────────────────────────────
app.post('/api/enterprise/employees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'enterprise')
      return res.status(403).json({ error: 'Accès réservé aux entreprises' });

    const { fullName, password } = req.body;

    if (!fullName || !password)
      return res.status(400).json({ error: 'Nom complet et mot de passe requis' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Mot de passe minimum 6 caractères' });

    const employees = readDB(FILES.employees);

    if (employees.find(e =>
      e.fullName.toLowerCase().trim() === fullName.toLowerCase().trim() &&
      e.enterpriseId === req.user.id
    )) return res.status(409).json({ error: 'Un employé avec ce nom existe déjà dans votre entreprise' });

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
    writeDB(FILES.employees, employees);

    res.status(201).json({
      success:  true,
      employee: { id: newEmployee.id, fullName: newEmployee.fullName, enterpriseName: newEmployee.enterpriseName }
    });

  } catch (err) {
    console.error('Erreur création employé:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Lister les employés ───────────────────────────────────────────────────────
app.get('/api/enterprise/employees', auth, (req, res) => {
  if (!['enterprise', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const employees = readDB(FILES.employees);
  const filtered  = req.user.role === 'superadmin'
    ? employees
    : employees.filter(e => e.enterpriseId === req.user.id);

  // Ne retourne jamais le mot de passe hashé
  res.json(filtered.map(({ password, ...e }) => e));
});

// ── Supprimer un employé ──────────────────────────────────────────────────────
app.delete('/api/enterprise/employees/:id', auth, (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: 'Accès refusé' });

  let employees = readDB(FILES.employees);
  const idx     = employees.findIndex(e =>
    e.id === req.params.id && e.enterpriseId === req.user.id
  );

  if (idx === -1) return res.status(404).json({ error: 'Employé non trouvé' });

  employees.splice(idx, 1);
  writeDB(FILES.employees, employees);
  res.json({ success: true });
});

// ── Choix du jour (filtrés selon le rôle) ────────────────────────────────────
app.get('/api/choices/today', auth, (req, res) => {
  const all = readDB(FILES.choices).filter(c => c.date === todayStr());

  if (req.user.role === 'employee')
    return res.json(all.filter(c => c.enterpriseId === req.user.enterpriseId));

  if (req.user.role === 'enterprise')
    return res.json(all.filter(c => c.enterpriseId === req.user.id));

  res.json(all); // restauratrice et superadmin voient tout
});

// ── Mon choix du jour ─────────────────────────────────────────────────────────
app.get('/api/choices/mine', auth, (req, res) => {
  const mine = readDB(FILES.choices).find(
    c => c.userId === req.user.id && c.date === todayStr()
  );
  res.json(mine || null);
});

// ── Soumettre / modifier un choix ────────────────────────────────────────────
app.post('/api/choices', auth, (req, res) => {
  if (req.user.role !== 'employee')
    return res.status(403).json({ error: 'Seuls les employés peuvent faire des choix' });

  const { food, customFood } = req.body;
  if (!food) return res.status(400).json({ error: 'Choix de repas requis' });

  const choices = readDB(FILES.choices);
  const today   = todayStr();

  // Vérifie si la commande de cette entreprise a déjà été lancée
  const isLaunched = choices.some(c =>
    c.date === today && c.enterpriseId === req.user.enterpriseId && c.orderLaunched
  );
  if (isLaunched)
    return res.status(403).json({ error: "La commande a déjà été lancée aujourd'hui" });

  const existingIdx = choices.findIndex(c => c.userId === req.user.id && c.date === today);

  // Vérifie le délai de 5 minutes pour les MODIFICATIONS
  if (existingIdx >= 0) {
    const elapsed = Date.now() - new Date(choices[existingIdx].updatedAt).getTime();
    if (elapsed > LOCK_MS)
      return res.status(403).json({
        error:  'Le délai de modification de 5 minutes est expiré.',
        locked: true
      });
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
    updatedAt:    now, // ← réinitialise le compteur de 5 min à chaque modif
  };

  if (existingIdx >= 0) choices[existingIdx] = choiceData;
  else choices.push(choiceData);

  writeDB(FILES.choices, choices);
  res.json(choiceData);
});

// ── Supprimer mon choix ───────────────────────────────────────────────────────
app.delete('/api/choices/mine', auth, (req, res) => {
  let choices = readDB(FILES.choices);
  const today = todayStr();
  const idx   = choices.findIndex(c => c.userId === req.user.id && c.date === today);

  if (idx === -1) return res.status(404).json({ error: 'Aucun choix trouvé' });
  if (choices[idx].orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

  const elapsed = Date.now() - new Date(choices[idx].updatedAt).getTime();
  if (elapsed > LOCK_MS)
    return res.status(403).json({
      error:  'Le délai de 5 minutes est expiré. Votre choix est verrouillé.',
      locked: true
    });

  choices.splice(idx, 1);
  writeDB(FILES.choices, choices);
  res.json({ success: true });
});

// ── Lancer la commande (entreprise seulement) ─────────────────────────────────
app.post('/api/choices/launch', auth, (req, res) => {
  if (req.user.role !== 'enterprise')
    return res.status(403).json({ error: "Seule l'entreprise peut lancer la commande" });

  let choices = readDB(FILES.choices);
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
    return res.status(400).json({ error: "Aucun choix enregistré pour aujourd'hui" });

  writeDB(FILES.choices, choices);
  res.json({ success: true, count });
});

// ── Historique de l'utilisateur connecté ─────────────────────────────────────
app.get('/api/history', auth, (req, res) => {
  const history = readDB(FILES.choices)
    .filter(c => c.userId === req.user.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});


// ── Récupérer tous les messages ───────────────────────────────────────────────
app.get('/api/messages', auth, (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: "Messagerie réservée à l'entreprise et à la restauratrice" });

  const messages = readDB(FILES.messages)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json(messages);
});

// ── Envoyer un message ────────────────────────────────────────────────────────
app.post('/api/messages', auth, (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Le message ne peut pas être vide' });

  const messages = readDB(FILES.messages);
  const msg = {
    id:         Date.now().toString(),
    senderId:   req.user.id,
    senderName: req.user.fullName,
    senderRole: req.user.role,
    content:    content.trim(),
    timestamp:  new Date().toISOString(),
    readBy:     [req.user.id], // L'expéditeur a déjà "lu" son propre message
  };

  messages.push(msg);
  writeDB(FILES.messages, messages);
  res.status(201).json(msg);
});

// ── Marquer les messages comme lus ────────────────────────────────────────────
app.post('/api/messages/read', auth, (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  let messages = readDB(FILES.messages);
  messages = messages.map(m => ({
    ...m,
    readBy: m.readBy.includes(req.user.id) ? m.readBy : [...m.readBy, req.user.id],
  }));
  writeDB(FILES.messages, messages);
  res.json({ success: true });
});

// ── Nombre de messages non lus ────────────────────────────────────────────────
app.get('/api/messages/unread', auth, (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.json({ count: 0 });

  const count = readDB(FILES.messages)
    .filter(m => !m.readBy.includes(req.user.id) && m.senderId !== req.user.id)
    .length;
  res.json({ count });
});


// ── Toutes les entreprises ────────────────────────────────────────────────────
app.get('/api/admin/enterprises', auth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = readDB(FILES.enterprises).map(({ password, ...e }) => e);
  res.json(list);
});

// ── Tous les employés ─────────────────────────────────────────────────────────
app.get('/api/admin/employees', auth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = readDB(FILES.employees).map(({ password, ...e }) => e);
  res.json(list);
});

// ── Toutes les restauratrices ─────────────────────────────────────────────────
app.get('/api/admin/restauratrices', auth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const list = readDB(FILES.restauratrices).map(({ password, ...r }) => r);
  res.json(list);
});

// ── Commandes du jour (toutes entreprises) ────────────────────────────────────
app.get('/api/admin/choices/today', auth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const choices = readDB(FILES.choices).filter(c => c.date === todayStr());
  res.json(choices);
});

// ── Historique global ─────────────────────────────────────────────────────────
app.get('/api/admin/history', auth, (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Accès refusé' });
  const history = readDB(FILES.choices).sort((a, b) => b.date.localeCompare(a.date));
  res.json(history);
});

app.listen(PORT, () => {
  console.log(`\n  LunchApp démarré → http://localhost:${PORT}`);
  console.log(`  Superadmin : ${SUPERADMIN.email}`);
  console.log(`🔑  Mot de passe : ${SUPERADMIN.password}\n`);
});