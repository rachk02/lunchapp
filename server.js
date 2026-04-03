'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// server.js — Backend LunchApp v2
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config({ quiet: true });

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const path       = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const fs = require('fs');

let _shuttingDown = false;

const app        = express();
const PORT       = process.env.PORT       || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'lunchapp_2024_secret_key';
const APP_URL    = process.env.APP_URL    || `http://localhost:${PORT}`;
const LOCK_MIN   = 5; // minutes avant verrouillage du choix

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Superadmin (via .env) ─────────────────────────────────────────────────────
const SUPERADMIN = {
  id:       'superadmin-001',
  email:    process.env.ADMIN_EMAIL    || 'admin@lunchapp.com',
  password: process.env.ADMIN_PASSWORD || 'ChangeMe!',
  fullName: process.env.ADMIN_FULLNAME || 'Super Administrateur',
  role:     'superadmin',
};

// ── Mailer ────────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendCredentialsEmail({ to, firstName, employeeId, password, enterpriseName }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS ||
      process.env.MAIL_PASS === 'votre_mot_de_passe_application_gmail') return;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
    <div style="background:#F97316;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">🍽️ LunchApp</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin-top:0">Bonjour ${firstName} 👋</h2>
      <p>Votre compte employé chez <strong>${enterpriseName}</strong> a été créé sur <strong>LunchApp</strong>.</p>
      <p>Voici vos identifiants de connexion :</p>
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:20px 24px;margin:20px 0">
        <p style="margin:0 0 10px"><span style="color:#64748B;font-size:12px;text-transform:uppercase;font-weight:600;letter-spacing:.05em">Identifiant</span><br/>
          <strong style="font-family:monospace;font-size:18px;color:#F97316">${employeeId}</strong></p>
        <p style="margin:0 0 10px"><span style="color:#64748B;font-size:12px;text-transform:uppercase;font-weight:600;letter-spacing:.05em">Mot de passe</span><br/>
          <strong style="font-family:monospace;font-size:18px;color:#1E293B">${password}</strong></p>
        <p style="margin:0"><span style="color:#64748B;font-size:12px;text-transform:uppercase;font-weight:600;letter-spacing:.05em">Lien de connexion</span><br/>
          <a href="${APP_URL}" style="font-family:monospace;font-size:15px;color:#0EA5E9">${APP_URL.replace(/^https?:\/\//, '')}</a></p>
      </div>
      <p style="color:#475569">Connectez-vous sur l'application et changez votre mot de passe depuis votre profil.</p>
      <div style="margin:24px 0;text-align:center">
        <a href="${APP_URL}" style="background:#F97316;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Se connecter à LunchApp
        </a>
      </div>
      <p style="color:#94A3B8;font-size:12px">Ne partagez pas ces identifiants avec d'autres personnes.</p>
    </div>
    <div style="background:#F1F5F9;padding:14px 32px;font-size:12px;color:#94A3B8;text-align:center">
      © ${new Date().getFullYear()} LunchApp — Tous droits réservés
    </div>
  </div>`;
  try {
    await mailer.sendMail({
      from:    process.env.MAIL_FROM || 'LunchApp <noreply@lunchapp.com>',
      to,
      subject: `🔑 Vos identifiants LunchApp — ${enterpriseName}`,
      html,
    });
    console.log(`[Mail] Identifiants envoyés → ${to}`);
  } catch (e) {
    console.error('[Mail] Erreur envoi identifiants :', e.message);
  }
}

async function sendWelcomeEmail({ to, name, role }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS ||
      process.env.MAIL_PASS === 'votre_mot_de_passe_application_gmail') return;

  const roleLabel = role === 'enterprise' ? 'Entreprise' : 'Restaurant';
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
    <div style="background:#F97316;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">🍽️ LunchApp</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin-top:0">Bienvenue, ${name} !</h2>
      <p>Votre compte <strong>${roleLabel}</strong> a été créé avec succès sur <strong>LunchApp</strong>.</p>
      <p>Vous pouvez dès maintenant vous connecter et commencer à utiliser l'application :</p>
      <ul>
        ${role === 'enterprise' ? `
          <li>Affiliez-vous aux restaurants de votre choix</li>
          <li>Gérez vos employés et suivez leurs commandes</li>
          <li>Consultez les statistiques de consommation</li>
        ` : `
          <li>Publiez votre menu complet (plats & boissons)</li>
          <li>Définissez votre menu journalier</li>
          <li>Gérez vos commandes et votre clientèle</li>
        `}
      </ul>
      <div style="margin:24px 0;text-align:center">
        <a href="${APP_URL}" style="background:#F97316;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Accéder à LunchApp
        </a>
      </div>
      <p style="color:#64748B;font-size:13px">
        Si vous n'êtes pas à l'origine de cette inscription, ignorez cet e-mail.
      </p>
    </div>
    <div style="background:#F1F5F9;padding:14px 32px;font-size:12px;color:#94A3B8;text-align:center">
      © ${new Date().getFullYear()} LunchApp — Tous droits réservés
    </div>
  </div>`;

  try {
    await mailer.sendMail({
      from:    process.env.MAIL_FROM || 'LunchApp <noreply@lunchapp.com>',
      to,
      subject: `✅ Bienvenue sur LunchApp, ${name} !`,
      html,
    });
  } catch (err) {
    console.error('[Mailer] Échec envoi email à', to, ':', err.message);
  }
}

// ── Base de données (PostgreSQL si DATABASE_URL, sinon JSON) ──────────────────
const db = require('./db');
async function read(key)        { return db.read(key); }
async function write(key, data) { return db.write(key, data); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getStartDate(frequency) {
  const now = new Date();
  const d = new Date(now);
  switch (frequency) {
    case 'daily':       d.setHours(0, 0, 0, 0); return d;
    case 'weekly':      d.setDate(now.getDate() - 7); return d;
    case 'monthly':     d.setMonth(now.getMonth() - 1); return d;
    case 'quarterly':   d.setMonth(now.getMonth() - 3); return d;
    case 'semi-annual': d.setMonth(now.getMonth() - 6); return d;
    case 'annual':      d.setFullYear(now.getFullYear() - 1); return d;
    default:            return new Date(0);
  }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    res.status(401).json({ error: 'Token invalide' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Accès refusé' });
    next();
  };
}

function validatePassword(pwd) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])[A-Za-z\d@$!%*?&._-]{8,}$/.test(pwd);
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const sseClients = new Map();

// Écriture sécurisée sur un stream SSE — retourne false si la connexion est fermée
function sseSend(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(payload);
    return true;
  } catch (e) {
    // EPIPE ou write-after-end : connexion morte, on la retire
    return false;
  }
}

function sseNotify(userId, event, data) {
  const res = sseClients.get(String(userId));
  if (!res) return;
  const ok = sseSend(res, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (!ok) sseClients.delete(String(userId));
}

app.get('/api/events', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();
  let user;
  try { user = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).end(); }

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx si présent

  // Absorbe les erreurs réseau (EPIPE, ECONNRESET) sans crasher Node
  res.on('error', () => {
    sseClients.delete(String(user.id));
    try { res.destroy(); } catch {}
  });

  sseSend(res, `event: connected\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);
  sseClients.set(String(user.id), res);

  const ping = setInterval(() => {
    const ok = sseSend(res, ': ping\n\n');
    if (!ok) { clearInterval(ping); sseClients.delete(String(user.id)); }
  }, 25000);

  req.on('close', () => { clearInterval(ping); sseClients.delete(String(user.id)); });
});

// ── Helpers notifications ─────────────────────────────────────────────────────
async function pushNotif(userId, userRole, type, title, message, data = {}) {
  try {
    const notifs = await read('notifications');
    const n = {
      id: uid(), userId: String(userId), userRole, type,
      title, message, data, read: false,
      createdAt: new Date().toISOString(),
    };
    notifs.push(n);
    await write('notifications', notifs);
    sseNotify(userId, 'notification', n);
    return n;
  } catch (e) {
    console.error('[pushNotif] Error:', e.message);
  }
}

// Notifie tous les employés des entreprises affiliées au restaurant que le menu a changé
async function notifyMenuUpdate(restaurantId, restaurantName, changeType) {
  try {
    const affiliations = (await read('affiliations')).filter(a => a.restaurantId === restaurantId);
    if (!affiliations.length) return;
    const employees = await read('employees');
    const enterpriseIds = [...new Set(affiliations.map(a => a.enterpriseId))];
    const titles = {
      item_added:   '🍽️ Menu mis à jour',
      item_updated: '🍽️ Menu mis à jour',
      item_deleted: '🍽️ Menu mis à jour',
      daily_updated:'📋 Menu du jour mis à jour',
    };
    const messages = {
      item_added:   `${restaurantName} a ajouté un nouveau plat/boisson à son menu.`,
      item_updated: `${restaurantName} a modifié un article de son menu.`,
      item_deleted: `${restaurantName} a retiré un article de son menu.`,
      daily_updated:`${restaurantName} a mis à jour son menu du jour.`,
    };
    const title   = titles[changeType]   || '🍽️ Menu mis à jour';
    const message = messages[changeType] || `${restaurantName} a mis à jour son menu.`;
    await Promise.all(
      employees
        .filter(e => enterpriseIds.includes(e.enterpriseId))
        .map(e => pushNotif(e.id, 'employee', 'menu_updated', title, message, { restaurantId }))
    );
  } catch (e) {
    console.error('[notifyMenuUpdate] Error:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Champs requis' });

  const id = email.toLowerCase().trim();

  // Superadmin
  if (id === SUPERADMIN.email.toLowerCase() && password === SUPERADMIN.password) {
    const token = jwt.sign({ id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName } });
  }

  // Chercher par email OU nom d'entreprise/restaurant
  let userObj = null;
  const enterprises = await read('enterprises');
  const ent = enterprises.find(u =>
    (u.email && u.email.toLowerCase() === id) ||
    u.companyName?.toLowerCase() === id
  );
  if (ent) userObj = ent;

  if (!userObj) {
    const restaurants = await read('restaurants');
    const rst = restaurants.find(u =>
      (u.email && u.email.toLowerCase() === id) ||
      u.restaurantName?.toLowerCase() === id
    );
    if (rst) userObj = rst;
  }

  // Chercher par identifiant employé (employeeId) ou nom complet
  if (!userObj) {
    userObj = (await read('employees')).find(u => {
      if (u.employeeId && u.employeeId.toLowerCase() === id) return true;
      const n = u.fullName.toLowerCase();
      return n === id || n.split(' ').reverse().join(' ') === id;
    });
  }

  if (!userObj) return res.status(401).json({ error: 'Identifiants invalides' });

  const valid = await bcrypt.compare(password, userObj.password);
  if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

  const payload = { id: userObj.id, role: userObj.role };
  if (userObj.role === 'enterprise')   payload.companyName    = userObj.companyName;
  if (userObj.role === 'restauratrice') payload.restaurantName = userObj.restaurantName;
  if (userObj.role === 'employee') {
    payload.fullName      = userObj.fullName;
    payload.enterpriseId  = userObj.enterpriseId;
    payload.enterpriseName = userObj.enterpriseName;
  }

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = userObj;
  res.json({ token, user: safe });
});

// ── Mot de passe oublié ───────────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  // Chercher dans entreprises et restaurants
  const lower = email.toLowerCase().trim();
  let found = null, role = null;
  const ent = (await read('enterprises')).find(e => e.email?.toLowerCase() === lower);
  if (ent)  { found = ent;  role = 'enterprise'; }
  const rst = !found && (await read('restaurants')).find(r => r.email?.toLowerCase() === lower);
  if (rst)  { found = rst;  role = 'restaurant'; }

  // Réponse identique que l'email existe ou non (sécurité)
  res.json({ message: 'Si cet email est enregistré, vous recevrez un lien de réinitialisation.' });

  if (!found) return;

  // Générer token (valable 30 min)
  const token    = uid() + uid();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const resets   = (await read('passwordResets')).filter(r => r.email !== lower); // un seul token actif par email
  resets.push({ token, email: lower, role, expiresAt });
  await write('passwordResets', resets);

  const resetLink = `${APP_URL}/?reset=${token}`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden">
    <div style="background:#F97316;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">🍽️ LunchApp</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin-top:0">Réinitialisation du mot de passe</h2>
      <p>Bonjour <strong>${found.companyName || found.restaurantName}</strong>,</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous :</p>
      <div style="margin:24px 0;text-align:center">
        <a href="${resetLink}" style="background:#F97316;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
          Réinitialiser mon mot de passe
        </a>
      </div>
      <p style="color:#64748B;font-size:13px">Ce lien expire dans <strong>30 minutes</strong>.<br/>
      Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.</p>
    </div>
    <div style="background:#F1F5F9;padding:14px 32px;font-size:12px;color:#94A3B8;text-align:center">
      © ${new Date().getFullYear()} LunchApp — Tous droits réservés
    </div>
  </div>`;

  try {
    await mailer.sendMail({
      from:    process.env.MAIL_FROM || 'LunchApp <noreply@lunchapp.com>',
      to:      found.email,
      subject: '🔑 Réinitialisation de votre mot de passe LunchApp',
      html,
    });
  } catch (err) {
    console.error('[Mailer] Échec reset email :', err.message);
  }
});

// ── Réinitialisation du mot de passe ─────────────────────────────────────────
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token et nouveau mot de passe requis' });
  if (!validatePassword(newPassword)) return res.status(400).json({ error: 'Mot de passe trop faible (8 car. min, maj, min, chiffre, spécial)' });

  const resets = await read('passwordResets');
  const entry  = resets.find(r => r.token === token);
  if (!entry)                          return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  if (new Date(entry.expiresAt) < new Date()) {
    await write('passwordResets', resets.filter(r => r.token !== token));
    return res.status(400).json({ error: 'Lien expiré. Veuillez refaire une demande.' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  if (entry.role === 'enterprise') {
    const list = await read('enterprises');
    const idx  = list.findIndex(e => e.email === entry.email);
    if (idx === -1) return res.status(404).json({ error: 'Compte introuvable' });
    list[idx].password = hashed;
    await write('enterprises', list);
  } else {
    const list = await read('restaurants');
    const idx  = list.findIndex(r => r.email === entry.email);
    if (idx === -1) return res.status(404).json({ error: 'Compte introuvable' });
    list[idx].password = hashed;
    await write('restaurants', list);
  }

  // Invalider le token
  await write('passwordResets', resets.filter(r => r.token !== token));
  res.json({ message: 'Mot de passe mis à jour avec succès.' });
});

// ── Inscription entreprise ────────────────────────────────────────────────────
app.post('/api/enterprise/register', async (req, res) => {
  const { companyName, email, password, phone, location } = req.body;
  if (!companyName || !password) return res.status(400).json({ error: 'Champs requis' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Mot de passe trop faible (8 car. min, maj, min, chiffre, spécial)' });

  const enterprises = await read('enterprises');
  if (enterprises.find(e => e.companyName?.toLowerCase() === companyName.trim().toLowerCase()))
    return res.status(409).json({ error: 'Ce nom d\'entreprise est déjà utilisé' });
  if (email && enterprises.find(e => e.email?.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hashed = await bcrypt.hash(password, 10);
  const enterprise = {
    id: uid(), companyName: companyName.trim(), email: email ? email.toLowerCase().trim() : '',
    password: hashed, phone: phone || '', location: location || '',
    role: 'enterprise', createdAt: new Date().toISOString(),
  };
  enterprises.push(enterprise);
  await write('enterprises', enterprises);

  const token = jwt.sign({ id: enterprise.id, role: 'enterprise', companyName: enterprise.companyName }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = enterprise;
  res.status(201).json({ token, user: safe });

  // Email de bienvenue (non bloquant)
  sendWelcomeEmail({ to: enterprise.email, name: enterprise.companyName, role: 'enterprise' });
});

// ── Inscription restaurant ────────────────────────────────────────────────────
app.post('/api/restauratrice/register', async (req, res) => {
  const { restaurantName, fullName, email, password, phone, specialty, address, paymentInfo } = req.body;
  if (!restaurantName || !fullName || !password) return res.status(400).json({ error: 'Champs requis' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Mot de passe trop faible' });

  const restaurants = await read('restaurants');
  if (restaurants.find(r => r.restaurantName?.toLowerCase() === restaurantName.trim().toLowerCase()))
    return res.status(409).json({ error: 'Ce nom de restaurant est déjà utilisé' });
  if (email && restaurants.find(r => r.email?.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hashed = await bcrypt.hash(password, 10);
  const restaurant = {
    id: uid(), restaurantName: restaurantName.trim(), fullName: fullName.trim(),
    email: email ? email.toLowerCase().trim() : '', password: hashed,
    phone: phone || '',
    specialty: Array.isArray(specialty) ? specialty : (specialty ? [specialty] : []),
    address: address || '',
    description: '', photo: '',
    paymentInfo: Array.isArray(paymentInfo) ? paymentInfo : [],
    role: 'restauratrice', createdAt: new Date().toISOString(),
  };
  restaurants.push(restaurant);
  await write('restaurants', restaurants);

  const token = jwt.sign({ id: restaurant.id, role: 'restauratrice', restaurantName: restaurant.restaurantName }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = restaurant;
  res.status(201).json({ token, user: safe });

  // Email de bienvenue (non bloquant)
  sendWelcomeEmail({ to: restaurant.email, name: restaurant.restaurantName, role: 'restaurant' });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESTAURANTS (lecture publique)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurants', auth, async (req, res) => {
  const restaurants = (await read('restaurants')).map(({ password, ...r }) => r);
  res.json(restaurants);
});

app.get('/api/restaurants/:id', auth, async (req, res) => {
  const r = (await read('restaurants')).find(r => r.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable' });
  const { password, ...safe } = r;
  res.json(safe);
});

// ── Profil restaurant ─────────────────────────────────────────────────────────
app.patch('/api/restaurant/profile', auth, requireRole('restauratrice'), async (req, res) => {
  const { restaurantName, fullName, phone, address, specialty, description, photo, paymentInfo, password, newPassword } = req.body;

  const restaurants = await read('restaurants');
  const idx = restaurants.findIndex(r => r.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Restaurant introuvable' });
  const r = restaurants[idx];

  if (restaurantName !== undefined) r.restaurantName = restaurantName.trim();
  if (fullName      !== undefined) r.fullName = fullName.trim();
  if (phone         !== undefined) r.phone = phone;
  if (address       !== undefined) r.address = address;
  if (specialty     !== undefined) r.specialty = Array.isArray(specialty) ? specialty : (specialty ? [specialty] : []);
  if (description   !== undefined) r.description = description;
  if (photo         !== undefined) r.photo = photo;
  if (paymentInfo   !== undefined) r.paymentInfo = paymentInfo;

  if (newPassword && password) {
    const valid = await bcrypt.compare(password, r.password);
    if (!valid) return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    r.password = await bcrypt.hash(newPassword, 10);
  }
  r.updatedAt = new Date().toISOString();

  await write('restaurants', restaurants);
  const { password: _, ...safe } = r;
  res.json(safe);
});

// ── Profil actuel du restaurant connecté ─────────────────────────────────────
app.get('/api/restaurant/me', auth, requireRole('restauratrice'), async (req, res) => {
  const r = (await read('restaurants')).find(r => r.id === req.user.id);
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable' });
  const { password, ...safe } = r;
  res.json(safe);
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU COMPLET (gestion par le restaurant)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurant/menu', auth, requireRole('restauratrice'), async (req, res) => {
  const menu = (await read('menus')).find(m => m.restaurantId === req.user.id) || { restaurantId: req.user.id, items: [] };
  res.json(menu);
});

app.post('/api/restaurant/menu/items', auth, requireRole('restauratrice'), async (req, res) => {
  const { name, category, price, description } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Nom et catégorie requis' });
  if (!['food', 'drink'].includes(category)) return res.status(400).json({ error: 'Catégorie invalide (food ou drink)' });
  if (price === undefined || price === null || isNaN(Number(price))) return res.status(400).json({ error: 'Prix requis' });

  const menus = await read('menus');
  let menu = menus.find(m => m.restaurantId === req.user.id);
  if (!menu) { menu = { restaurantId: req.user.id, items: [] }; menus.push(menu); }

  const item = { id: uid(), name: name.trim(), category, price: Number(price), description: description || '', available: true };
  menu.items.push(item);
  menu.updatedAt = new Date().toISOString();
  await write('menus', menus);
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_added');
  res.status(201).json(item);
});

app.put('/api/restaurant/menu/items/:itemId', auth, requireRole('restauratrice'), async (req, res) => {
  const menus = await read('menus');
  const menu = menus.find(m => m.restaurantId === req.user.id);
  if (!menu) return res.status(404).json({ error: 'Menu introuvable' });

  const idx = menu.items.findIndex(i => i.id === req.params.itemId);
  if (idx === -1) return res.status(404).json({ error: 'Article introuvable' });

  const { name, category, price, description, available } = req.body;
  if (name        !== undefined) menu.items[idx].name = name.trim();
  if (category    !== undefined) menu.items[idx].category = category;
  if (price       !== undefined) menu.items[idx].price = Number(price);
  if (description !== undefined) menu.items[idx].description = description;
  if (available   !== undefined) menu.items[idx].available = Boolean(available);
  menu.updatedAt = new Date().toISOString();

  await write('menus', menus);
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_updated');
  res.json(menu.items[idx]);
});

app.delete('/api/restaurant/menu/items/:itemId', auth, requireRole('restauratrice'), async (req, res) => {
  const menus = await read('menus');
  const menu = menus.find(m => m.restaurantId === req.user.id);
  if (!menu) return res.status(404).json({ error: 'Menu introuvable' });

  menu.items = menu.items.filter(i => i.id !== req.params.itemId);
  menu.updatedAt = new Date().toISOString();
  await write('menus', menus);

  // Supprimer aussi des menus journaliers
  const dailyMenus = await read('dailyMenus');
  dailyMenus.forEach(d => {
    if (d.restaurantId === req.user.id)
      d.availableItems = (d.availableItems || []).filter(id => id !== req.params.itemId);
  });
  await write('dailyMenus', dailyMenus);
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_deleted');
  res.json({ success: true });
});

// Menu d'un restaurant (visible par toute entreprise pour consultation ; employés uniquement affiliés)
app.get('/api/restaurants/:id/menu', auth, async (req, res) => {
  if (req.user.role === 'employee') {
    const aff = await read('affiliations');
    if (!aff.some(a => a.enterpriseId === req.user.enterpriseId && a.restaurantId === req.params.id))
      return res.status(403).json({ error: 'Non affilié à ce restaurant' });
  }
  const menu = (await read('menus')).find(m => m.restaurantId === req.params.id) || { restaurantId: req.params.id, items: [] };
  res.json(menu);
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU JOURNALIER
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurant/menu/daily', auth, requireRole('restauratrice'), async (req, res) => {
  const date = req.query.date || todayStr();
  const dailyMenus = await read('dailyMenus');
  const daily = dailyMenus.find(d => d.restaurantId === req.user.id && d.date === date);
  if (daily) {
    res.json(daily);
  } else {
    // Default: all items are available
    const menu = (await read('menus')).find(m => m.restaurantId === req.user.id) || { items: [] };
    res.json({ restaurantId: req.user.id, date, availableItems: menu.items.map(i => i.id) });
  }
});

app.put('/api/restaurant/menu/daily', auth, requireRole('restauratrice'), async (req, res) => {
  const { date, availableItems } = req.body;
  const d = date || todayStr();
  if (!Array.isArray(availableItems)) return res.status(400).json({ error: 'availableItems requis' });

  const dailyMenus = await read('dailyMenus');
  const idx = dailyMenus.findIndex(dm => dm.restaurantId === req.user.id && dm.date === d);
  if (idx >= 0) {
    dailyMenus[idx].availableItems = availableItems;
    dailyMenus[idx].updatedAt = new Date().toISOString();
  } else {
    dailyMenus.push({ restaurantId: req.user.id, date: d, availableItems, updatedAt: new Date().toISOString() });
  }
  await write('dailyMenus', dailyMenus);
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'daily_updated');
  res.json({ date: d, availableItems });
});

// Menu journalier d'un restaurant donné (pour entreprise/employé affilié)
app.get('/api/restaurants/:id/menu/daily', auth, async (req, res) => {
  if (req.user.role === 'enterprise') {
    const aff = await read('affiliations');
    if (!aff.some(a => a.enterpriseId === req.user.id && a.restaurantId === req.params.id))
      return res.status(403).json({ error: 'Non affilié' });
  } else if (req.user.role === 'employee') {
    const aff = await read('affiliations');
    if (!aff.some(a => a.enterpriseId === req.user.enterpriseId && a.restaurantId === req.params.id))
      return res.status(403).json({ error: 'Non affilié' });
  }

  const menu  = (await read('menus')).find(m => m.restaurantId === req.params.id) || { items: [] };
  const items = menu.items.filter(i => i.available !== false);
  res.json({ restaurantId: req.params.id, items, foods: items.filter(i => i.category === 'food'), drinks: items.filter(i => i.category === 'drink') });
});

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATIONS
// ─────────────────────────────────────────────────────────────────────────────

// Entreprise s'affilie à un restaurant
app.post('/api/enterprise/restaurants/:restaurantId/affiliate', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId } = req.params;
  if (!(await read('restaurants')).find(r => r.id === restaurantId))
    return res.status(404).json({ error: 'Restaurant introuvable' });

  const affiliations = await read('affiliations');
  if (affiliations.some(a => a.enterpriseId === req.user.id && a.restaurantId === restaurantId))
    return res.status(409).json({ error: 'Déjà affilié' });

  const aff = { id: uid(), enterpriseId: req.user.id, enterpriseName: req.user.companyName, restaurantId, createdAt: new Date().toISOString() };
  affiliations.push(aff);
  await write('affiliations', affiliations);

  await pushNotif(restaurantId, 'restauratrice', 'new_affiliation', 'Nouvelle affiliation',
    `${req.user.companyName} s'est affiliée à votre restaurant.`,
    { enterpriseId: req.user.id });

  res.status(201).json(aff);
});

// Entreprise se désaffilie
app.delete('/api/enterprise/restaurants/:restaurantId/affiliate', auth, requireRole('enterprise'), async (req, res) => {
  const affiliations = (await read('affiliations')).filter(a => !(a.enterpriseId === req.user.id && a.restaurantId === req.params.restaurantId));
  await write('affiliations', affiliations);
  res.json({ success: true });
});

// Liste des restaurants affiliés de l'entreprise (avec menus)
app.get('/api/enterprise/restaurants', auth, requireRole('enterprise'), async (req, res) => {
  const affiliations = (await read('affiliations')).filter(a => a.enterpriseId === req.user.id);
  const restaurants  = (await read('restaurants')).map(({ password, ...r }) => r);
  const menus        = await read('menus');

  const result = affiliations.map(a => {
    const r = restaurants.find(r => r.id === a.restaurantId);
    if (!r) return null;
    const menu = menus.find(m => m.restaurantId === a.restaurantId) || { items: [] };
    const availableItems = menu.items.filter(i => i.available !== false);
    return {
      ...r, affiliatedAt: a.createdAt,
      menu: menu.items,
      dailyMenu: { foods: availableItems.filter(i => i.category === 'food'), drinks: availableItems.filter(i => i.category === 'drink') },
    };
  }).filter(Boolean);

  res.json(result);
});

// Restaurant offre ses services à une entreprise
app.post('/api/restaurant/enterprises/:enterpriseId/offer', auth, requireRole('restauratrice'), async (req, res) => {
  const { enterpriseId } = req.params;
  if (!(await read('enterprises')).find(e => e.id === enterpriseId))
    return res.status(404).json({ error: 'Entreprise introuvable' });

  const offers = await read('offers');
  if (offers.some(o => o.restaurantId === req.user.id && o.enterpriseId === enterpriseId))
    return res.status(409).json({ error: 'Offre déjà envoyée' });

  const offer = { id: uid(), restaurantId: req.user.id, restaurantName: req.user.restaurantName, enterpriseId, createdAt: new Date().toISOString() };
  offers.push(offer);
  await write('offers', offers);

  await pushNotif(enterpriseId, 'enterprise', 'service_offer', 'Offre de service',
    `${req.user.restaurantName} vous propose ses services.`,
    { restaurantId: req.user.id });

  res.status(201).json(offer);
});

// Restaurant retire son offre (et désaffilie)
app.delete('/api/restaurant/enterprises/:enterpriseId/offer', auth, requireRole('restauratrice'), async (req, res) => {
  await write('offers', (await read('offers')).filter(o => !(o.restaurantId === req.user.id && o.enterpriseId === req.params.enterpriseId)));
  await write('affiliations', (await read('affiliations')).filter(a => !(a.restaurantId === req.user.id && a.enterpriseId === req.params.enterpriseId)));
  res.json({ success: true });
});

// Clientèle du restaurant
app.get('/api/restaurant/clientele', auth, requireRole('restauratrice'), async (req, res) => {
  const affiliations = (await read('affiliations')).filter(a => a.restaurantId === req.user.id);
  const enterprises  = (await read('enterprises')).map(({ password, ...e }) => e);
  const t            = todayStr();
  const choices      = (await read('choices')).filter(c => c.restaurantId === req.user.id && c.date === t);

  const result = affiliations.map(a => {
    const e = enterprises.find(e => e.id === a.enterpriseId);
    if (!e) return null;
    return { ...e, affiliatedAt: a.createdAt, todayChoices: choices.filter(c => c.enterpriseId === a.enterpriseId) };
  }).filter(Boolean);

  res.json(result);
});

// Toutes les entreprises disponibles pour le restaurant
app.get('/api/restaurant/enterprises', auth, requireRole('restauratrice'), async (req, res) => {
  const enterprises  = (await read('enterprises')).map(({ password, ...e }) => e);
  const affiliations = (await read('affiliations')).filter(a => a.restaurantId === req.user.id);
  const offers       = (await read('offers')).filter(o => o.restaurantId === req.user.id);

  const result = enterprises.map(e => ({
    ...e,
    isAffiliated: affiliations.some(a => a.enterpriseId === e.id),
    hasOffer:     offers.some(o => o.enterpriseId === e.id),
  }));
  res.json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYÉS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/enterprise/employees', auth, requireRole('enterprise'), async (req, res) => {
  res.json((await read('employees')).filter(e => e.enterpriseId === req.user.id).map(({ password, ...e }) => e));
});

app.post('/api/enterprise/employees', auth, requireRole('enterprise'), async (req, res) => {
  const { firstName, lastName, whatsapp, email, gender, password, employeeId: customId } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ error: 'Prénom et nom requis' });
  if (!['male', 'female'].includes(gender)) return res.status(400).json({ error: 'Genre requis (male/female)' });
  if (!customId || !/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(String(customId))) return res.status(400).json({ error: 'ID employé invalide — commence par une lettre, 3 à 30 caractères' });

  const finalPassword = (password && password.length >= 6) ? password : 'Temp1234';
  if (password && password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });

  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  const employees = await read('employees');

  // Vérifier unicité du nom
  const lower = fullName.toLowerCase();
  const dup = employees.find(e => {
    if (e.enterpriseId !== req.user.id) return false;
    const n = (e.fullName || '').toLowerCase();
    return n === lower || n.split(' ').reverse().join(' ') === lower;
  });
  if (dup) return res.status(409).json({ error: 'Un employé avec ce nom existe déjà' });

  // Vérifier unicité de l'ID
  if (employees.some(e => e.employeeId === customId)) return res.status(409).json({ error: 'Cet ID employé est déjà utilisé' });

  const hashed = await bcrypt.hash(finalPassword, 10);
  const employeeId = customId;
  const employee = {
    id: uid(), employeeId, firstName: firstName.trim(), lastName: lastName.trim(),
    fullName, gender, whatsapp: whatsapp || '', email: email || '',
    password: hashed,
    role: 'employee', enterpriseId: req.user.id, enterpriseName: req.user.companyName,
    createdAt: new Date().toISOString(),
  };
  employees.push(employee);
  await write('employees', employees);

  const enterpriseName = req.user.companyName || 'votre entreprise';

  // Envoyer identifiants par email
  if (email) {
    sendCredentialsEmail({ to: email, firstName, employeeId, password: finalPassword, enterpriseName });
  }

  const { password: _, ...safe } = employee;
  res.status(201).json({ ...safe, plainPassword: finalPassword });
});

app.put('/api/enterprise/employees/:id', auth, requireRole('enterprise'), async (req, res) => {
  const employees = await read('employees');
  const idx = employees.findIndex(e => e.id === req.params.id && e.enterpriseId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Employé introuvable' });

  const { firstName, lastName, fullName, gender, whatsapp, password, newPassword, employeeId: newEmpId } = req.body;
  if (firstName) { employees[idx].firstName = firstName.trim(); employees[idx].fullName = `${firstName.trim()} ${employees[idx].lastName || ''}`; }
  if (lastName)  { employees[idx].lastName  = lastName.trim();  employees[idx].fullName = `${employees[idx].firstName || ''} ${lastName.trim()}`; }
  if (fullName)  employees[idx].fullName = fullName.trim();
  if (gender)    employees[idx].gender = gender;
  if (whatsapp !== undefined) employees[idx].whatsapp = whatsapp;
  if (newEmpId) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(String(newEmpId))) return res.status(400).json({ error: 'ID employé invalide — commence par une lettre, 3 à 30 caractères' });
    const clash = employees.find((e, i) => i !== idx && e.employeeId === newEmpId);
    if (clash) return res.status(409).json({ error: 'Cet ID employé est déjà utilisé' });
    employees[idx].employeeId = newEmpId;
  }

  if (newPassword && password) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    const valid = await bcrypt.compare(password, employees[idx].password);
    if (!valid) return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    employees[idx].password = await bcrypt.hash(newPassword, 10);
  } else if (password && password.length >= 6) {
    // Direct password update (enterprise resetting employee password)
    employees[idx].password = await bcrypt.hash(password, 10);
  }
  employees[idx].updatedAt = new Date().toISOString();
  await write('employees', employees);

  const { password: _, ...safe } = employees[idx];
  res.json(safe);
});

app.delete('/api/enterprise/employees/:id', auth, requireRole('enterprise'), async (req, res) => {
  const employees = await read('employees');
  if (!employees.find(e => e.id === req.params.id && e.enterpriseId === req.user.id))
    return res.status(404).json({ error: 'Employé introuvable' });
  await write('employees', employees.filter(e => e.id !== req.params.id));
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFIL EMPLOYÉ (self-update)
// ─────────────────────────────────────────────────────────────────────────────

app.put('/api/employee/me', auth, requireRole('employee'), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  const employees = await read('employees');
  const idx = employees.findIndex(e => e.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Employé introuvable' });
  const valid = await bcrypt.compare(currentPassword, employees[idx].password);
  if (!valid) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  employees[idx].password = await bcrypt.hash(newPassword, 10);
  employees[idx].updatedAt = new Date().toISOString();
  await write('employees', employees);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHOIX DES EMPLOYÉS
// ─────────────────────────────────────────────────────────────────────────────

// Menus journaliers disponibles pour l'employé (tous restaurants affiliés)
app.get('/api/employee/menus', auth, requireRole('employee'), async (req, res) => {
  const affiliations = (await read('affiliations')).filter(a => a.enterpriseId === req.user.enterpriseId);
  const restaurants  = (await read('restaurants')).map(({ password, ...r }) => r);
  const menus        = await read('menus');

  const result = affiliations.map(a => {
    const r = restaurants.find(r => r.id === a.restaurantId);
    if (!r) return null;
    const menu   = menus.find(m => m.restaurantId === a.restaurantId) || { items: [] };
    const items  = menu.items.filter(i => i.available !== false);
    const foods  = items.filter(i => i.category === 'food');
    const drinks = items.filter(i => i.category === 'drink');
    if (!foods.length && !drinks.length) return null;
    return {
      restaurant: { id: r.id, restaurantName: r.restaurantName, photo: r.photo, specialty: r.specialty },
      foods,
      drinks,
    };
  }).filter(Boolean);

  res.json(result);
});

// Créer un choix
app.post('/api/choices', auth, requireRole('employee'), async (req, res) => {
  const { restaurantId, foodItemId, drinkItemId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'Restaurant requis' });
  if (!foodItemId && !drinkItemId) return res.status(400).json({ error: 'Sélectionnez au moins un plat ou une boisson' });

  const aff = await read('affiliations');
  if (!aff.some(a => a.enterpriseId === req.user.enterpriseId && a.restaurantId === restaurantId))
    return res.status(403).json({ error: 'Restaurant non affilié à votre entreprise' });

  const t = todayStr();
  const choices = await read('choices');
  const existing = choices.find(c => c.userId === req.user.id && c.date === t);

  if (existing) {
    const elapsed = (Date.now() - new Date(existing.createdAt).getTime()) / 60000;
    if (elapsed > LOCK_MIN) return res.status(409).json({ error: 'Vous avez déjà fait votre choix aujourd\'hui' });
    if (existing.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

    const menu = (await read('menus')).find(m => m.restaurantId === existing.restaurantId) || { items: [] };
    if (foodItemId !== undefined) {
      if (foodItemId === null) { existing.foodItem = null; }
      else {
        const item = menu.items.find(i => i.id === foodItemId && i.category === 'food');
        if (!item) return res.status(400).json({ error: 'Plat introuvable dans le menu' });
        existing.foodItem = { id: item.id, name: item.name, price: item.price };
      }
    }
    if (drinkItemId !== undefined) {
      if (drinkItemId === null) { existing.drinkItem = null; }
      else {
        const item = menu.items.find(i => i.id === drinkItemId && i.category === 'drink');
        if (!item) return res.status(400).json({ error: 'Boisson introuvable dans le menu' });
        existing.drinkItem = { id: item.id, name: item.name, price: item.price };
      }
    }
    if (!existing.foodItem && !existing.drinkItem)
      return res.status(400).json({ error: 'Sélectionnez au moins un plat ou une boisson' });
    existing.updatedAt = new Date().toISOString();
    await write('choices', choices);
    sseNotify(existing.restaurantId, 'update_choice', { choice: existing });
    return res.json(existing);
  }

  const menu = (await read('menus')).find(m => m.restaurantId === restaurantId) || { items: [] };
  let foodItem = null, drinkItem = null;

  if (foodItemId) {
    const item = menu.items.find(i => i.id === foodItemId && i.category === 'food');
    if (!item) return res.status(400).json({ error: 'Plat introuvable dans le menu' });
    foodItem = { id: item.id, name: item.name, price: item.price };
  }
  if (drinkItemId) {
    const item = menu.items.find(i => i.id === drinkItemId && i.category === 'drink');
    if (!item) return res.status(400).json({ error: 'Boisson introuvable dans le menu' });
    drinkItem = { id: item.id, name: item.name, price: item.price };
  }

  const restaurant = (await read('restaurants')).find(r => r.id === restaurantId);
  const choice = {
    id: uid(),
    userId: req.user.id,
    userName: req.user.fullName,
    enterpriseId: req.user.enterpriseId,
    enterpriseName: req.user.enterpriseName,
    restaurantId,
    restaurantName: restaurant?.restaurantName || '',
    foodItem,
    drinkItem,
    date: t,
    rating: null,
    orderLaunched: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  choices.push(choice);
  await write('choices', choices);
  sseNotify(restaurantId, 'new_choice', { choice });

  res.status(201).json(choice);
});

// Modifier un choix (5 minutes)
app.put('/api/choices/:id', auth, requireRole('employee'), async (req, res) => {
  const choices = await read('choices');
  const idx = choices.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Choix introuvable' });

  const choice = choices[idx];
  const elapsed = (Date.now() - new Date(choice.createdAt).getTime()) / 60000;
  if (elapsed > LOCK_MIN) return res.status(403).json({ error: `Délai de modification dépassé (${LOCK_MIN} min)` });
  if (choice.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

  const { foodItemId, drinkItemId } = req.body;
  const menu = (await read('menus')).find(m => m.restaurantId === choice.restaurantId) || { items: [] };

  if (foodItemId !== undefined) {
    if (foodItemId === null) {
      choice.foodItem = null;
    } else {
      const item = menu.items.find(i => i.id === foodItemId && i.category === 'food');
      if (!item) return res.status(400).json({ error: 'Plat introuvable' });
      choice.foodItem = { id: item.id, name: item.name, price: item.price };
    }
  }
  if (drinkItemId !== undefined) {
    if (drinkItemId === null) {
      choice.drinkItem = null;
    } else {
      const item = menu.items.find(i => i.id === drinkItemId && i.category === 'drink');
      if (!item) return res.status(400).json({ error: 'Boisson introuvable' });
      choice.drinkItem = { id: item.id, name: item.name, price: item.price };
    }
  }
  if (!choice.foodItem && !choice.drinkItem)
    return res.status(400).json({ error: 'Le choix doit contenir au moins un plat ou une boisson' });

  choice.updatedAt = new Date().toISOString();

  await write('choices', choices);
  res.json(choice);
});

// Vider le cache historique (employé — hors aujourd'hui) — AVANT /:id
app.delete('/api/choices/history', auth, requireRole('employee'), async (req, res) => {
  const t = todayStr();
  await write('choices', (await read('choices')).filter(c => !(c.userId === req.user.id && c.date !== t)));
  res.json({ success: true });
});

// Supprimer un choix (5 minutes)
app.delete('/api/choices/:id', auth, requireRole('employee'), async (req, res) => {
  const choices = await read('choices');
  const choice = choices.find(c => c.id === req.params.id && c.userId === req.user.id);
  if (!choice) return res.status(404).json({ error: 'Choix introuvable' });

  const elapsed = (Date.now() - new Date(choice.createdAt).getTime()) / 60000;
  if (elapsed > LOCK_MIN) return res.status(403).json({ error: `Délai de suppression dépassé (${LOCK_MIN} min)` });
  if (choice.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

  await write('choices', choices.filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// Mon choix aujourd'hui
app.get('/api/choices/mine', auth, requireRole('employee'), async (req, res) => {
  const t = todayStr();
  const choice = (await read('choices')).find(c => c.userId === req.user.id && c.date === t) || null;
  res.json(choice);
});

// Choix du jour (filtré par rôle)
app.get('/api/choices/today', auth, async (req, res) => {
  const t = todayStr();
  let choices = (await read('choices')).filter(c => c.date === t);
  if (req.user.role === 'employee')     choices = choices.filter(c => c.userId === req.user.id);
  else if (req.user.role === 'enterprise') choices = choices.filter(c => c.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') choices = choices.filter(c => c.restaurantId === req.user.id);
  res.json(choices);
});

// Noter un plat (1-5 étoiles)
app.post('/api/choices/:id/rate', auth, requireRole('employee'), async (req, res) => {
  const { stars } = req.body;
  const s = Number(stars);
  if (!s || s < 1 || s > 5) return res.status(400).json({ error: 'Note invalide (1 à 5 étoiles)' });

  const choices = await read('choices');
  const idx = choices.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Choix introuvable' });

  choices[idx].rating = s;
  await write('choices', choices);

  const choice = choices[idx];
  const ratings = await read('ratings');
  ratings.push({
    id: uid(),
    employeeId:     req.user.id,
    employeeName:   req.user.fullName,
    enterpriseId:   req.user.enterpriseId,
    enterpriseName: req.user.enterpriseName,
    restaurantId:   choice.restaurantId,
    restaurantName: choice.restaurantName,
    itemId:         choice.foodItem?.id,
    itemName:       choice.foodItem?.name,
    stars: s, date: choice.date,
    createdAt: new Date().toISOString(),
  });
  await write('ratings', ratings);

  const starEmoji = '⭐'.repeat(s);
  const platName  = choice.foodItem?.name || choice.drinkItem?.name || 'votre service';
  await pushNotif(choice.restaurantId, 'restauratrice', 'new_rating', 'Nouvelle évaluation',
    `${req.user.fullName} (${req.user.enterpriseName || 'Employé'}) note votre plat "${platName}" ${starEmoji} (${s}/5).`,
    { stars: s, employeeId: req.user.id, enterpriseId: req.user.enterpriseId });

  res.json(choices[idx]);
});

// Historique des choix
app.get('/api/choices/history', auth, async (req, res) => {
  let choices = await read('choices');
  if (req.user.role === 'employee')      choices = choices.filter(c => c.userId === req.user.id);
  else if (req.user.role === 'enterprise') choices = choices.filter(c => c.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') choices = choices.filter(c => c.restaurantId === req.user.id);
  res.json(choices.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDES (ORDERS)
// ─────────────────────────────────────────────────────────────────────────────

// Soumettre une commande (lancer la commande)
app.post('/api/orders', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'Restaurant requis' });

  const t = todayStr();
  const todayChoices = (await read('choices')).filter(c =>
    c.enterpriseId === req.user.id && c.restaurantId === restaurantId && c.date === t && !c.orderLaunched
  );
  if (!todayChoices.length) return res.status(400).json({ error: 'Aucun choix non soumis pour ce restaurant aujourd\'hui' });

  const restaurant = (await read('restaurants')).find(r => r.id === restaurantId);
  let totalAmount = 0;
  const items = todayChoices.map(c => {
    const amount = (c.foodItem?.price || 0) + (c.drinkItem?.price || 0);
    totalAmount += amount;
    return { employeeId: c.userId, employeeName: c.userName, foodItem: c.foodItem, drinkItem: c.drinkItem, amount };
  });

  const activeSub = (await read('subscriptions')).find(s =>
    s.enterpriseId === req.user.id && s.restaurantId === restaurantId && s.status === 'accepted'
  );

  const order = {
    id: uid(),
    enterpriseId:   req.user.id,
    enterpriseName: req.user.companyName,
    restaurantId,
    restaurantName: restaurant?.restaurantName || '',
    date: t, items, totalAmount,
    paymentMode: 'delivery',
    subscriptionId: activeSub?.id || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  const orders = await read('orders');
  orders.push(order);
  await write('orders', orders);

  const allChoices = (await read('choices')).map(c => {
    if (c.enterpriseId === req.user.id && c.restaurantId === restaurantId && c.date === t)
      return { ...c, orderLaunched: true };
    return c;
  });
  await write('choices', allChoices);

  await pushNotif(restaurantId, 'restauratrice', 'new_order', 'Nouvelle commande',
    `${req.user.companyName} vient de passer une commande de ${items.length} repas. Total: ${totalAmount.toLocaleString('fr-FR')} FCFA.`,
    { orderId: order.id, enterpriseId: req.user.id });

  res.status(201).json(order);
});

// Lister les commandes (sans screenshot)
app.get('/api/orders', auth, async (req, res) => {
  let orders = await read('orders');
  if (req.user.role === 'enterprise')   orders = orders.filter(o => o.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') orders = orders.filter(o => o.restaurantId === req.user.id);
  res.json(orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ depositScreenshot, ...o }) => o));
});

// Mettre à jour le statut d'une commande (restaurant)
app.put('/api/orders/:id/status', auth, requireRole('restauratrice'), async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'preparing', 'delivered', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide' });

  const orders = await read('orders');
  const idx = orders.findIndex(o => o.id === req.params.id && o.restaurantId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Commande introuvable' });

  orders[idx].status = status;
  orders[idx].updatedAt = new Date().toISOString();
  await write('orders', orders);

  const messages = {
    confirmed: `${req.user.restaurantName} a accusé réception de votre commande (${orders[idx].items?.length || 0} repas).`,
    preparing: `Votre commande chez ${req.user.restaurantName} est en cours de préparation.`,
    delivered: `Votre commande chez ${req.user.restaurantName} a été livrée. Bon appétit !`,
    cancelled: `Votre commande chez ${req.user.restaurantName} a été annulée.`,
  };
  await pushNotif(orders[idx].enterpriseId, 'enterprise', 'order_status',
    status === 'confirmed' ? 'Réception accusée' : 'Statut de commande',
    messages[status] || `Commande mise à jour : ${status}.`,
    { orderId: req.params.id, status });

  res.json(orders[idx]);
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTURES (INVOICES)
// ─────────────────────────────────────────────────────────────────────────────

// Créer une facture (restaurant pour une entreprise)
app.post('/api/invoices', auth, requireRole('restauratrice'), async (req, res) => {
  const { orderId, frequency } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId requis' });

  const orders = await read('orders');
  const order  = orders.find(o => o.id === orderId && o.restaurantId === req.user.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  const existingInvoices = await read('invoices');
  if (existingInvoices.find(i => i.orderId === orderId))
    return res.status(409).json({ error: 'Facture déjà générée pour cette commande' });

  const restaurant  = (await read('restaurants')).find(r => r.id === req.user.id) || {};
  const enterprises = await read('enterprises');
  const enterprise  = enterprises.find(e => e.id === order.enterpriseId) || {};

  // Agréger les articles
  const itemMap = {};
  (order.items || []).forEach(it => {
    if (it.foodItem)  { const k = it.foodItem.name;  itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.foodItem.price||0 }; }
    if (it.drinkItem) { const k = it.drinkItem.name; itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.drinkItem.price||0 }; }
  });
  const items = Object.values(itemMap).map(i => ({ ...i, total: i.qty * i.unitPrice }));

  const now  = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const dateISO = now.toISOString().slice(0, 10);
  const invId   = uid();
  const invNum  = `FACT-${dateISO.replace(/-/g,'')}-${invId.slice(0,6).toUpperCase()}`;

  const invoice = {
    id: invId, number: invNum,
    restaurantId: req.user.id, restaurantName: req.user.restaurantName,
    enterpriseId: order.enterpriseId, enterpriseName: order.enterpriseName,
    orderId, date: dateISO, items,
    totalAmount: order.totalAmount || 0,
    frequency: frequency || 'monthly',
    status: 'sent',
    createdAt: now.toISOString(),
  };

  try {
    const buf  = await buildInvoicePDF(invoice, restaurant, enterprise, invNum, dateStr);
    invoice.pdfBase64 = buf.toString('base64');
  } catch (e) {
    console.error('PDF invoice error:', e.message);
  }

  existingInvoices.push(invoice);
  await write('invoices', existingInvoices);

  await pushNotif(order.enterpriseId, 'enterprise', 'new_invoice', '🧾 Nouvelle facture',
    `${req.user.restaurantName} vous a envoyé une facture de ${(order.totalAmount||0).toLocaleString('fr-FR')} FCFA (commande du ${order.date}).`,
    { invoiceId: invId, invoiceNumber: invNum });

  const { pdfBase64: _, ...safe } = invoice;
  res.status(201).json(safe);
});

// Lister les factures
app.get('/api/invoices', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  let invoices = await read('invoices');
  if (req.user.role === 'enterprise')    invoices = invoices.filter(i => i.enterpriseId === req.user.id);
  if (req.user.role === 'restauratrice') invoices = invoices.filter(i => i.restaurantId === req.user.id);
  res.json(invoices.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    .map(({ pdfBase64: _, ...i }) => i));
});

// Télécharger le PDF d'une facture
app.get('/api/invoices/:id/pdf', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const inv = (await read('invoices')).find(i => i.id === req.params.id &&
    (i.enterpriseId === req.user.id || i.restaurantId === req.user.id));
  if (!inv) return res.status(404).json({ error: 'Facture introuvable' });
  if (!inv.pdfBase64) return res.status(404).json({ error: 'PDF non disponible' });
  const buf = Buffer.from(inv.pdfBase64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

// Confirmer réception d'une facture (enterprise)
app.put('/api/invoices/:id/confirm', auth, requireRole('enterprise'), async (req, res) => {
  const invoices = await read('invoices');
  const idx = invoices.findIndex(i => i.id === req.params.id && i.enterpriseId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Facture introuvable' });
  invoices[idx].status      = 'confirmed';
  invoices[idx].confirmedAt = new Date().toISOString();
  await write('invoices', invoices);
  await pushNotif(invoices[idx].restaurantId, 'restauratrice', 'invoice_confirmed', '✅ Facture confirmée',
    `${req.user.companyName} a confirmé la réception de la facture ${invoices[idx].number}.`,
    { invoiceId: invoices[idx].id });
  res.json(invoices[idx]);
});

// ─────────────────────────────────────────────────────────────────────────────
// ABONNEMENTS
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/subscriptions', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId, frequency } = req.body;
  const valid = ['weekly', 'monthly', 'quarterly', 'semi-annual', 'annual'];
  if (!restaurantId || !valid.includes(frequency))
    return res.status(400).json({ error: 'Restaurant et fréquence valide requis' });

  const subs = await read('subscriptions');
  if (subs.find(s => s.enterpriseId === req.user.id && s.restaurantId === restaurantId && s.status === 'pending'))
    return res.status(409).json({ error: 'Une demande est déjà en attente' });

  const restaurant = (await read('restaurants')).find(r => r.id === restaurantId);
  const sub = {
    id: uid(),
    enterpriseId: req.user.id, enterpriseName: req.user.companyName,
    restaurantId, restaurantName: restaurant?.restaurantName || '',
    frequency, status: 'pending',
    createdAt: new Date().toISOString(),
  };
  subs.push(sub);
  await write('subscriptions', subs);

  const labels = { weekly: 'hebdomadaire', monthly: 'mensuel', quarterly: 'trimestriel', 'semi-annual': 'semestriel', annual: 'annuel' };
  await pushNotif(restaurantId, 'restauratrice', 'subscription_request', 'Demande d\'abonnement',
    `${req.user.companyName} demande un abonnement ${labels[frequency]}.`,
    { subscriptionId: sub.id });

  res.status(201).json(sub);
});

app.put('/api/subscriptions/:id', auth, requireRole('restauratrice'), async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });

  const subs = await read('subscriptions');
  const idx = subs.findIndex(s => s.id === req.params.id && s.restaurantId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Abonnement introuvable' });

  subs[idx].status = status;
  subs[idx].updatedAt = new Date().toISOString();
  if (status === 'accepted') subs[idx].acceptedAt = new Date().toISOString();
  await write('subscriptions', subs);

  const label = status === 'accepted' ? 'accepté' : 'décliné';
  await pushNotif(subs[idx].enterpriseId, 'enterprise', 'subscription_response', 'Réponse à votre demande',
    `${req.user.restaurantName} a ${label} votre demande d'abonnement.`,
    { subscriptionId: req.params.id, status });

  res.json(subs[idx]);
});

app.get('/api/subscriptions', auth, async (req, res) => {
  let subs = await read('subscriptions');
  if (req.user.role === 'enterprise')   subs = subs.filter(s => s.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') subs = subs.filter(s => s.restaurantId === req.user.id);
  res.json(subs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// Générer une facture globale pour un abonnement (restaurant)
app.post('/api/subscriptions/:id/invoice', auth, requireRole('restauratrice'), async (req, res) => {
  const subs = await read('subscriptions');
  const sub  = subs.find(s => s.id === req.params.id && s.restaurantId === req.user.id);
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  if (sub.status !== 'accepted') return res.status(400).json({ error: "L'abonnement n'est pas actif" });

  const existingInvoices = await read('invoices');
  if (existingInvoices.find(i => i.subscriptionId === sub.id))
    return res.status(409).json({ error: 'Une facture a déjà été générée pour cet abonnement' });

  const orders = (await read('orders')).filter(o =>
    o.enterpriseId === sub.enterpriseId && o.restaurantId === req.user.id
  );
  if (!orders.length) return res.status(400).json({ error: "Aucune commande trouvée pour cette période d'abonnement" });

  const itemMap    = {};
  let totalAmount  = 0;
  orders.forEach(o => {
    totalAmount += o.totalAmount || 0;
    (o.items || []).forEach(it => {
      if (it.foodItem)  { const k = it.foodItem.name;  itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.foodItem.price||0 }; }
      if (it.drinkItem) { const k = it.drinkItem.name; itemMap[k] = { name: k, qty: (itemMap[k]?.qty||0)+1, unitPrice: it.drinkItem.price||0 }; }
    });
  });
  const items = Object.values(itemMap).map(i => ({ ...i, total: i.qty * i.unitPrice }));

  const restaurant = (await read('restaurants')).find(r => r.id === req.user.id) || {};
  const enterprise = (await read('enterprises')).find(e => e.id === sub.enterpriseId) || {};

  const now     = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const dateISO = now.toISOString().slice(0, 10);
  const invId   = uid();
  const invNum  = `FACT-${dateISO.replace(/-/g,'')}-${invId.slice(0,6).toUpperCase()}`;

  const freqLabels = { weekly: 'hebdomadaire', monthly: 'mensuel', quarterly: 'trimestriel', 'semi-annual': 'semestriel', annual: 'annuel' };

  const invoice = {
    id: invId, number: invNum,
    restaurantId:   req.user.id, restaurantName: req.user.restaurantName,
    enterpriseId:   sub.enterpriseId, enterpriseName: sub.enterpriseName,
    subscriptionId: sub.id,
    orderId: orders.map(o => o.id).join(','),
    date: dateISO, items, totalAmount,
    frequency: sub.frequency,
    status: 'sent',
    createdAt: now.toISOString(),
  };

  try {
    const buf = await buildInvoicePDF(invoice, restaurant, enterprise, invNum, dateStr);
    invoice.pdfBase64 = buf.toString('base64');
  } catch (e) {
    console.error('[Invoice] PDF error:', e.message);
  }

  existingInvoices.push(invoice);
  await write('invoices', existingInvoices);

  await pushNotif(sub.enterpriseId, 'enterprise', 'new_invoice', '🧾 Facture d\'abonnement',
    `${req.user.restaurantName} vous a envoyé une facture d'abonnement ${freqLabels[sub.frequency]||sub.frequency} de ${totalAmount.toLocaleString('fr-FR')} FCFA.`,
    { invoiceId: invId, invoiceNumber: invNum, subscriptionId: sub.id });

  const { pdfBase64: _, ...safe } = invoice;
  res.status(201).json(safe);
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/notifications', auth, async (req, res) => {
  const notifs = (await read('notifications'))
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notifs);
});

app.put('/api/notifications/read-all', auth, async (req, res) => {
  const notifs = (await read('notifications')).map(n => n.userId === req.user.id ? { ...n, read: true } : n);
  await write('notifications', notifs);
  res.json({ success: true });
});

app.put('/api/notifications/:id/read', auth, async (req, res) => {
  const notifs = await read('notifications');
  const idx = notifs.findIndex(n => n.id === req.params.id && n.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Notification introuvable' });
  notifs[idx].read = true;
  await write('notifications', notifs);
  res.json(notifs[idx]);
});

app.delete('/api/notifications/:id', auth, async (req, res) => {
  await write('notifications', (await read('notifications')).filter(n => !(n.id === req.params.id && n.userId === req.user.id)));
  res.json({ success: true });
});

app.delete('/api/notifications', auth, async (req, res) => {
  await write('notifications', (await read('notifications')).filter(n => n.userId !== req.user.id));
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATISTIQUES
// ─────────────────────────────────────────────────────────────────────────────

// Stats entreprise
app.get('/api/stats/enterprise', auth, requireRole('enterprise'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const choices = (await read('choices')).filter(c => c.enterpriseId === req.user.id && new Date(c.date) >= start);
  const orders  = (await read('orders')).filter(o => o.enterpriseId === req.user.id && new Date(o.createdAt) >= start);

  const foodCounts = {}, drinkCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  foodCounts[c.foodItem.name]  = (foodCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) drinkCounts[c.drinkItem.name] = (drinkCounts[c.drinkItem.name] || 0) + 1;
  });

  const totalBudget = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const employees = (await read('employees')).filter(e => e.enterpriseId === req.user.id);
  const employeeStats = employees.map(({ password, ...e }) => ({
    ...e, choicesCount: choices.filter(c => c.userId === e.id).length,
  }));

  res.json({ totalChoices: choices.length, totalBudget, foodCounts, drinkCounts, employeeStats, period: { frequency } });
});

// Stats restaurant
app.get('/api/stats/restaurant', auth, requireRole('restauratrice'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const orders  = (await read('orders')).filter(o => o.restaurantId === req.user.id && new Date(o.createdAt) >= start);
  const ratings = (await read('ratings')).filter(r => r.restaurantId === req.user.id && new Date(r.createdAt) >= start);

  const totalRevenue = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const itemCounts = {};
  orders.forEach(order => {
    (order.items || []).forEach(item => {
      if (item.foodItem)  itemCounts[item.foodItem.name]  = (itemCounts[item.foodItem.name]  || 0) + 1;
      if (item.drinkItem) itemCounts[item.drinkItem.name] = (itemCounts[item.drinkItem.name] || 0) + 1;
    });
  });

  const paymentMethods = {};
  orders.forEach(o => { paymentMethods[o.paymentMode] = (paymentMethods[o.paymentMode] || 0) + 1; });

  const avgRating = ratings.length ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length : 0;

  res.json({
    totalOrders: orders.length, totalRevenue,
    itemCounts, paymentMethods,
    avgRating: Math.round(avgRating * 10) / 10,
    ratingCount: ratings.length,
    period: { frequency },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/admin/enterprises', auth, requireRole('superadmin'), async (req, res) => {
  res.json((await read('enterprises')).map(({ password, ...e }) => e));
});

app.get('/api/admin/restaurants', auth, requireRole('superadmin'), async (req, res) => {
  res.json((await read('restaurants')).map(({ password, ...r }) => r));
});

app.get('/api/admin/employees', auth, requireRole('superadmin'), async (req, res) => {
  res.json((await read('employees')).map(({ password, ...e }) => e));
});

app.get('/api/admin/stats', auth, requireRole('superadmin'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const enterprises = await read('enterprises');
  const restaurants = await read('restaurants');
  const employees   = await read('employees');
  const choices     = (await read('choices')).filter(c => new Date(c.date) >= start);
  const orders = (await read('orders'))
    .filter(o => new Date(o.createdAt) >= start)
    .map(({ depositScreenshot, ...o }) => o);

  const maleCount   = employees.filter(e => e.gender === 'male').length;
  const femaleCount = employees.filter(e => e.gender === 'female').length;

  const foodCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  foodCounts[c.foodItem.name]  = (foodCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) foodCounts[c.drinkItem.name] = (foodCounts[c.drinkItem.name] || 0) + 1;
  });

  const paymentMethods = {};
  orders.forEach(o => { paymentMethods[o.paymentMode] = (paymentMethods[o.paymentMode] || 0) + 1; });

  const totalMobilized = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const restaurantRevenue = {};
  orders.forEach(o => { restaurantRevenue[o.restaurantName] = (restaurantRevenue[o.restaurantName] || 0) + (o.totalAmount || 0); });

  const enterpriseBudget = {};
  orders.forEach(o => { enterpriseBudget[o.enterpriseName] = (enterpriseBudget[o.enterpriseName] || 0) + (o.totalAmount || 0); });

  res.json({
    counts: { enterprises: enterprises.length, restaurants: restaurants.length, employees: employees.length },
    gender: { male: maleCount, female: femaleCount },
    foodCounts, paymentMethods, totalMobilized,
    restaurantRevenue, enterpriseBudget,
    period: { frequency },
  });
});

app.get('/api/admin/orders', auth, requireRole('superadmin'), async (req, res) => {
  res.json((await read('orders')).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/admin/orders/:id/screenshot', auth, requireRole('superadmin'), async (req, res) => {
  const order = (await read('orders')).find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (!order.depositScreenshot)
    return res.status(404).json({ error: 'Aucun screenshot pour cette commande' });
  res.json({ depositScreenshot: order.depositScreenshot, depositType: order.depositType });
});

app.get('/api/admin/deletion-requests', auth, requireRole('superadmin'), async (req, res) => {
  res.json((await read('deletionRequests')).sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt)));
});

app.delete('/api/admin/users/:type/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { type, id } = req.params;
  if (type === 'enterprise') {
    await write('enterprises', (await read('enterprises')).filter(e => e.id !== id));
    await write('employees', (await read('employees')).filter(e => e.enterpriseId !== id));
    await write('affiliations', (await read('affiliations')).filter(a => a.enterpriseId !== id));
  } else if (type === 'restaurant') {
    await write('restaurants', (await read('restaurants')).filter(r => r.id !== id));
    await write('affiliations', (await read('affiliations')).filter(a => a.restaurantId !== id));
  } else if (type === 'employee') {
    await write('employees', (await read('employees')).filter(e => e.id !== id));
  } else {
    return res.status(400).json({ error: 'Type invalide' });
  }
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUPPRESSION DE COMPTE
// ─────────────────────────────────────────────────────────────────────────────

app.delete('/api/account', auth, async (req, res) => {
  if (!['enterprise', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Seules les entreprises et restaurants peuvent supprimer leur compte' });

  const { reason, feedback, badExperience, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  let user, type;
  if (req.user.role === 'enterprise') {
    user = (await read('enterprises')).find(e => e.id === req.user.id);
    type = 'enterprise';
  } else {
    user = (await read('restaurants')).find(r => r.id === req.user.id);
    type = 'restaurant';
  }

  if (!user) return res.status(404).json({ error: 'Compte introuvable' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Mot de passe incorrect' });

  const reqs = await read('deletionRequests');
  reqs.push({
    id: uid(),
    userId: req.user.id,
    userType: type,
    userName: user.companyName || user.restaurantName || '',
    email: user.email,
    reason: reason || '',
    feedback: feedback || '',
    badExperience: badExperience || '',
    deletedAt: new Date().toISOString(),
  });
  await write('deletionRequests', reqs);

  if (type === 'enterprise') {
    await write('enterprises', (await read('enterprises')).filter(e => e.id !== req.user.id));
    await write('employees', (await read('employees')).filter(e => e.enterpriseId !== req.user.id));
    await write('affiliations', (await read('affiliations')).filter(a => a.enterpriseId !== req.user.id));
  } else {
    await write('restaurants', (await read('restaurants')).filter(r => r.id !== req.user.id));
    await write('affiliations', (await read('affiliations')).filter(a => a.restaurantId !== req.user.id));
  }

  res.json({ success: true, message: 'Votre compte a été supprimé avec succès.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGERIE — entreprise ↔ restaurant
// ─────────────────────────────────────────────────────────────────────────────
// Modèle message :
//   { id, senderId, senderName, senderRole,
//     recipientId, recipientName, recipientRole,
//     type: 'text'|'audio',
//     content,          // texte ou null
//     audioData,        // base64 complet — omis dans la liste, chargé à la demande
//     audioDuration,    // secondes (optionnel)
//     readBy: [userId],
//     timestamp }

const MAX_AUDIO_MB = 10;
const MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024;

// Qui peut parler à qui : entreprise ↔ restaurant affiliés
async function canMessage(req, otherId) {
  const affiliations = await read('affiliations');
  if (req.user.role === 'enterprise') {
    return affiliations.some(a => a.enterpriseId === req.user.id && a.restaurantId === otherId);
  }
  if (req.user.role === 'restauratrice') {
    return affiliations.some(a => a.restaurantId === req.user.id && a.enterpriseId === otherId);
  }
  return false;
}

async function resolveDisplayName(id, role) {
  if (role === 'enterprise') {
    const e = (await read('enterprises')).find(e => e.id === id);
    return e ? e.companyName : 'Entreprise';
  }
  if (role === 'restauratrice') {
    const r = (await read('restaurants')).find(r => r.id === id);
    return r ? r.restaurantName : 'Restaurant';
  }
  return 'Inconnu';
}

// Liste des conversations (interlocuteurs uniques)
app.get('/api/messages/conversations', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const msgs = (await read('messages')).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const seen = new Map();
  for (const m of msgs) {
    if (m.senderId === req.user.id || m.recipientId === req.user.id) {
      const otherId   = m.senderId === req.user.id ? m.recipientId : m.senderId;
      const otherRole = m.senderId === req.user.id ? m.recipientRole : m.senderRole;
      if (!seen.has(otherId)) {
        const unread = msgs.filter(x =>
          x.recipientId === req.user.id && x.senderId === otherId &&
          !x.readBy.includes(req.user.id)
        ).length;
        seen.set(otherId, {
          id: otherId,
          role: otherRole,
          name: await resolveDisplayName(otherId, otherRole),
          lastMessage: m.type === 'text' ? m.content : '🎵 Message audio',
          lastTimestamp: m.timestamp,
          unread,
        });
      }
    }
  }
  res.json([...seen.values()].sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp)));
});

// Historique d'une conversation
app.get('/api/messages', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const { withId } = req.query;
  if (!withId) return res.status(400).json({ error: 'Paramètre withId requis' });

  const msgs = (await read('messages'))
    .filter(m =>
      (m.senderId === req.user.id && m.recipientId === withId) ||
      (m.senderId === withId && m.recipientId === req.user.id)
    )
    .map(({ audioData, ...m }) => m)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json(msgs);
});

// Charger l'audio d'un message (lazy)
app.get('/api/messages/:id/audio', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const msg = (await read('messages')).find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  if (msg.type !== 'audio') return res.status(400).json({ error: 'Pas un message audio' });
  if (msg.senderId !== req.user.id && msg.recipientId !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé' });
  res.json({ audioData: msg.audioData });
});

// Envoyer un message (texte ou audio)
app.post('/api/messages', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const { recipientId, type, content, audioData, audioDuration } = req.body;
  if (!recipientId) return res.status(400).json({ error: 'Destinataire requis' });
  if (!['text', 'audio'].includes(type)) return res.status(400).json({ error: 'Type invalide (text|audio)' });
  if (type === 'text' && !content?.trim()) return res.status(400).json({ error: 'Contenu requis' });
  if (type === 'audio' && !audioData) return res.status(400).json({ error: 'Données audio requises' });

  if (!(await canMessage(req, recipientId)))
    return res.status(403).json({ error: 'Vous n\'êtes pas affilié à cet interlocuteur' });

  if (type === 'audio') {
    const base64Data = audioData.includes(',') ? audioData.split(',')[1] : audioData;
    const bytes = Buffer.byteLength(base64Data, 'base64');
    if (bytes > MAX_AUDIO_BYTES)
      return res.status(413).json({ error: `Audio trop lourd (max ${MAX_AUDIO_MB} Mo)` });
  }

  let recipientRole, recipientName;
  const ent = (await read('enterprises')).find(e => e.id === recipientId);
  const rst = (await read('restaurants')).find(r => r.id === recipientId);
  if (ent)      { recipientRole = 'enterprise';   recipientName = ent.companyName; }
  else if (rst) { recipientRole = 'restauratrice'; recipientName = rst.restaurantName; }
  else return res.status(404).json({ error: 'Destinataire introuvable' });

  const senderName = await resolveDisplayName(req.user.id, req.user.role);

  const msg = {
    id: uid(),
    senderId:      req.user.id,
    senderName,
    senderRole:    req.user.role,
    recipientId,
    recipientName,
    recipientRole,
    type,
    content:       type === 'text' ? content.trim() : null,
    audioData:     type === 'audio' ? audioData : null,
    audioDuration: audioDuration || null,
    readBy:        [req.user.id],
    timestamp:     new Date().toISOString(),
  };

  const messages = await read('messages');
  messages.push(msg);
  await write('messages', messages);

  const { audioData: _, ...msgSafe } = msg;
  sseNotify(recipientId, 'new_message', msgSafe);
  await pushNotif(recipientId, recipientRole, 'new_message', `Nouveau message de ${senderName}`,
    type === 'text' ? content.trim() : '🎵 Vous avez reçu un message audio.',
    { messageId: msg.id, senderId: req.user.id });

  res.status(201).json(msgSafe);
});

// Marquer des messages comme lus
app.post('/api/messages/read', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const { withId } = req.body;
  if (!withId) return res.status(400).json({ error: 'withId requis' });
  const messages = (await read('messages')).map(m => {
    if (m.senderId === withId && m.recipientId === req.user.id && !m.readBy.includes(req.user.id)) {
      return { ...m, readBy: [...m.readBy, req.user.id] };
    }
    return m;
  });
  await write('messages', messages);
  res.json({ success: true });
});

// Nombre de messages non lus
app.get('/api/messages/unread', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const count = (await read('messages')).filter(m =>
    m.recipientId === req.user.id && !m.readBy.includes(req.user.id)
  ).length;
  res.json({ count });
});

// Supprimer un message (expéditeur seulement)
app.delete('/api/messages/:id', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const messages = await read('messages');
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  if (msg.senderId !== req.user.id) return res.status(403).json({ error: 'Seul l\'expéditeur peut supprimer' });
  await write('messages', messages.filter(m => m.id !== req.params.id));
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// TÉLÉCHARGEMENT PDF
// ─────────────────────────────────────────────────────────────────────────────

function buildInvoicePDF(invoice, restaurant, enterprise, invNum, dateStr) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;
    const M  = 40;
    const CW = PW - M * 2;

    // ── Bandeau orange ──────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 70).fill('#F97316');
    doc.fontSize(26).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('LunchApp', M, 18, { width: CW/2, lineBreak: false });
    doc.fontSize(11).font('Helvetica').fillColor('#FFF7ED')
      .text('Gestion des repas d\'entreprise', M, 46, { width: CW/2, lineBreak: false });
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('FACTURE', M + CW/2, 22, { width: CW/2, align: 'right', lineBreak: false });
    doc.fontSize(10).font('Helvetica').fillColor('#FFF7ED')
      .text(invNum, M + CW/2, 46, { width: CW/2, align: 'right', lineBreak: false });

    // ── Infos restaurant / entreprise ───────────────────────────────────────
    const infoY = 88;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#F97316')
      .text('DE :', M, infoY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1E293B')
      .text(restaurant.restaurantName || invoice.restaurantName, M, infoY + 14);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(restaurant.address || '', M, infoY + 27)
      .text(restaurant.phone   || '', M, infoY + 39);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#F97316')
      .text('FACTURÉ À :', M + CW/2, infoY);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1E293B')
      .text(enterprise.companyName || invoice.enterpriseName, M + CW/2, infoY + 14);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(enterprise.email    || '', M + CW/2, infoY + 27)
      .text(enterprise.phone    || '', M + CW/2, infoY + 39);

    // Date + référence commande
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(`Date : ${dateStr}   ·   Commande : ${invoice.orderId?.slice(0,8).toUpperCase() || '—'}`, M, infoY + 56);

    // ── Séparateur ──────────────────────────────────────────────────────────
    const sepY = infoY + 74;
    doc.moveTo(M, sepY).lineTo(PW-M, sepY).strokeColor('#E2E8F0').lineWidth(1).stroke();

    // ── Tableau des articles ─────────────────────────────────────────────────
    const cols  = [30, 220, 80, 95, 90]; // N°, Article, Qté, Prix unit., Total
    const heads = ['N°', 'Article', 'Qté', 'Prix unit.', 'Total FCFA'];
    const RH    = 24;
    let ty = sepY + 14;

    // En-tête tableau
    doc.rect(M, ty, CW, RH).fill('#1E293B');
    let cx = M;
    heads.forEach((h, i) => {
      const align = i >= 2 ? 'right' : 'left';
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(h, cx + 5, ty + 7, { width: cols[i] - 10, lineBreak: false, align });
      cx += cols[i];
    });
    ty += RH;

    // Lignes
    (invoice.items || []).forEach((item, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(M, ty, CW, RH).fillAndStroke(bg, '#E2E8F0');
      cx = M;
      const cells = [
        String(idx + 1), item.name || '—',
        String(item.qty || 1),
        `${(item.unitPrice||0).toLocaleString('fr-FR')}`,
        `${(item.total||0).toLocaleString('fr-FR')}`,
      ];
      cells.forEach((cell, i) => {
        const align = i >= 2 ? 'right' : 'left';
        doc.fontSize(9).font('Helvetica').fillColor('#334155')
          .text(cell, cx + 5, ty + 7, { width: cols[i] - 10, lineBreak: false, align, ellipsis: true });
        cx += cols[i];
      });
      ty += RH;
    });

    if (!(invoice.items || []).length) {
      doc.rect(M, ty, CW, RH).fill('#FAFAFA');
      doc.fontSize(9).font('Helvetica').fillColor('#94A3B8')
        .text('Aucun article', M, ty + 7, { width: CW, align: 'center', lineBreak: false });
      ty += RH;
    }

    // ── Ligne total ──────────────────────────────────────────────────────────
    ty += 6;
    doc.rect(M + CW - 185, ty, 185, 28).fill('#FFF7ED');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#F97316')
      .text(`TOTAL  ${(invoice.totalAmount||0).toLocaleString('fr-FR')} FCFA`,
        M, ty + 7, { width: CW, align: 'right', lineBreak: false });
    ty += 28;

    // ── Pied de page ────────────────────────────────────────────────────────
    ty += 20;
    doc.rect(0, ty, PW, 1).fill('#E2E8F0');
    ty += 10;
    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text('Paiement à la livraison', M, ty, { continued: true })
      .text('LunchApp — Tous droits réservés', { align: 'right' });
    doc.fontSize(8).fillColor('#94A3B8')
      .text(`Généré le ${dateStr} · ${invNum}`, M, ty + 16, { align: 'center', width: CW });

    doc.end();
  });
}

function buildPDF(blocks) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    doc.fontSize(18).fillColor('#F97316').text('LunchApp', { align: 'center' });
    doc.fontSize(10).fillColor('#64748B').text(`Généré le ${now}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor('#E2E8F0').stroke();
    doc.moveDown(0.5);

    blocks.forEach(({ title, lines }) => {
      doc.fontSize(13).fillColor('#1E293B').text(title);
      doc.moveDown(0.2);
      lines.forEach(l => doc.fontSize(10).fillColor('#334155').text(`• ${l}`));
      doc.moveDown(0.8);
    });

    doc.end();
  });
}

function sendPDF(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

const PERIOD_LABELS = { daily: "Aujourd'hui", weekly: 'Cette semaine', monthly: 'Ce mois' };

// ── PDF stats restaurant ───────────────────────────────────────────────────────
app.get('/api/stats/pdf/restaurant', auth, requireRole('restauratrice'), async (req, res) => {
  const frequency = req.query.frequency || 'monthly';
  const start     = getStartDate(frequency);
  const user      = req.user;
  const orders    = (await read('orders')).filter(o => o.restaurantId === user.id && new Date(o.createdAt) >= start);
  const choices   = (await read('choices')).filter(c => c.restaurantId === user.id && new Date(c.date) >= start);
  const totalRev  = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const ratings   = choices.filter(c => c.rating).map(c => c.rating);
  const avgRating = ratings.length ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1) : 'N/A';

  const itemCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  itemCounts[c.foodItem.name]  = (itemCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) itemCounts[c.drinkItem.name] = (itemCounts[c.drinkItem.name] || 0) + 1;
  });
  const topItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const blocks = [
    {
      title: `Rapport ${user.restaurantName} — ${PERIOD_LABELS[frequency] || frequency}`,
      lines: [
        `Commandes reçues : ${orders.length}`,
        `Revenu total : ${totalRev} FCFA`,
        `Repas commandés : ${choices.length}`,
        `Note moyenne : ${avgRating} / 5`,
      ],
    },
    {
      title: 'Articles les plus commandés',
      lines: topItems.length
        ? topItems.map(([name, cnt]) => `${name} : ${cnt} commande(s)`)
        : ['Aucune donnée'],
    },
  ];

  try {
    const buf = await buildPDF(blocks);
    sendPDF(res, `rapport-restaurant-${frequency}.pdf`, buf);
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération PDF' });
  }
});

// ── PDF stats entreprise ───────────────────────────────────────────────────────
app.get('/api/stats/pdf/enterprise', auth, requireRole('enterprise'), async (req, res) => {
  const frequency  = req.query.frequency || 'monthly';
  const start      = getStartDate(frequency);
  const user       = req.user;
  const orders     = (await read('orders')).filter(o => o.enterpriseId === user.id && new Date(o.createdAt) >= start);
  const choices    = (await read('choices')).filter(c => c.enterpriseId === user.id && new Date(c.date) >= start);
  const employees  = (await read('employees')).filter(e => e.enterpriseId === user.id);
  const totalSpent = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const byResto = {};
  orders.forEach(o => {
    const k = o.restaurantName || 'Inconnu';
    byResto[k] = (byResto[k] || 0) + (o.totalAmount || 0);
  });

  const blocks = [
    {
      title: `Rapport ${user.companyName} — ${PERIOD_LABELS[frequency] || frequency}`,
      lines: [
        `Employés : ${employees.length}`,
        `Commandes passées : ${orders.length}`,
        `Budget total : ${totalSpent} FCFA`,
        `Repas commandés : ${choices.length}`,
      ],
    },
    {
      title: 'Dépenses par restaurant',
      lines: Object.entries(byResto).length
        ? Object.entries(byResto)
            .sort((a, b) => b[1] - a[1])
            .map(([name, amount]) => `${name} : ${amount} FCFA`)
        : ['Aucune commande'],
    },
  ];

  try {
    const buf = await buildPDF(blocks);
    sendPDF(res, `rapport-entreprise-${frequency}.pdf`, buf);
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération PDF' });
  }
});

// ── PDF stats admin ────────────────────────────────────────────────────────────
app.get('/api/stats/pdf/admin', auth, requireRole('superadmin'), async (req, res) => {
  const frequency   = req.query.frequency || 'monthly';
  const start       = getStartDate(frequency);
  const enterprises = await read('enterprises');
  const restaurants = await read('restaurants');
  const employees   = await read('employees');
  const orders      = (await read('orders')).filter(o => new Date(o.createdAt) >= start);
  const choices     = (await read('choices')).filter(c => new Date(c.date) >= start);
  const totalMob    = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const byResto = {};
  orders.forEach(o => {
    const k = o.restaurantName || 'Inconnu';
    byResto[k] = (byResto[k] || 0) + (o.totalAmount || 0);
  });

  const blocks = [
    {
      title: `Tableau de bord admin — ${PERIOD_LABELS[frequency] || frequency}`,
      lines: [
        `Entreprises : ${enterprises.length}`,
        `Restaurants : ${restaurants.length}`,
        `Employés : ${employees.length}`,
        `Commandes (période) : ${orders.length}`,
        `Chiffre d'affaires : ${totalMob} FCFA`,
        `Repas commandés : ${choices.length}`,
      ],
    },
    {
      title: 'CA par restaurant',
      lines: Object.entries(byResto).length
        ? Object.entries(byResto)
            .sort((a, b) => b[1] - a[1])
            .map(([name, amount]) => `${name} : ${amount} FCFA`)
        : ['Aucune commande'],
    },
  ];

  try {
    const buf = await buildPDF(blocks);
    sendPDF(res, `rapport-admin-${frequency}.pdf`, buf);
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération PDF' });
  }
});

// ── PDF liste des commandes du jour ──────────────────────────────────────────
function buildOrderListPDF({ dateStr, summary, employees }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;
    const M  = 40;
    const CW = PW - M * 2;

    // En-tête
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#F97316')
      .text('LunchApp', M, M, { width: CW, lineBreak: false });
    doc.moveDown(0.4);
    doc.fontSize(13).font('Helvetica').fillColor('#1E293B')
      .text('Liste des commandes du repas de midi', { width: CW });
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica').fillColor('#64748B')
      .text(dateStr, { width: CW });
    doc.moveDown(0.6);

    // Séparateur
    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.8);

    // RÉSUMÉ
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1E293B')
      .text('RÉSUMÉ DES COMMANDES', { width: CW });
    doc.moveDown(0.4);

    if (summary.length) {
      summary.forEach(({ name, count }) => {
        doc.fontSize(10).font('Helvetica').fillColor('#334155')
          .text(`${name} × ${count}`, { width: CW });
        doc.moveDown(0.1);
      });
    } else {
      doc.fontSize(10).font('Helvetica').fillColor('#94A3B8')
        .text('Aucune commande enregistrée.', { width: CW });
    }
    doc.moveDown(0.4);

    const totalRepas = employees.length;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#1E293B')
      .text(`TOTAL  ${totalRepas} repas`, { width: CW });
    doc.moveDown(0.8);

    // Séparateur
    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.moveDown(0.8);

    // DÉTAIL PAR EMPLOYÉ
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1E293B')
      .text('DÉTAIL PAR EMPLOYÉ', { width: CW });
    doc.moveDown(0.5);

    // Tableau
    const cols   = [30, 190, 210, 85]; // N°, Employé, Repas choisi, Heure
    const labels = ['N°', 'Employé', 'Repas choisi', 'Heure'];
    const RH     = 22;
    let ty = doc.y;

    // En-tête du tableau
    doc.rect(M, ty, CW, RH).fill('#1E293B');
    let cx = M;
    labels.forEach((h, i) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(h, cx + 5, ty + 6, { width: cols[i] - 10, lineBreak: false });
      cx += cols[i];
    });
    ty += RH;

    // Lignes de données
    employees.forEach((emp, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(M, ty, CW, RH).fillAndStroke(bg, '#E2E8F0');
      cx = M;
      [String(emp.num), emp.name, emp.meal, emp.time].forEach((cell, i) => {
        doc.fontSize(9).font('Helvetica').fillColor('#334155')
          .text(cell, cx + 5, ty + 6, { width: cols[i] - 10, lineBreak: false, ellipsis: true });
        cx += cols[i];
      });
      ty += RH;
    });

    if (!employees.length) {
      doc.rect(M, ty, CW, RH).fill('#FAFAFA');
      doc.fontSize(9).font('Helvetica').fillColor('#94A3B8')
        .text("Aucun employ\u00e9 n'a encore fait son choix.", M, ty + 6, { width: CW, align: 'center', lineBreak: false });
    }

    doc.end();
  });
}

app.get('/api/stats/pdf/orders', auth, requireRole('enterprise'), async (req, res) => {
  const user    = req.user;
  const today   = new Date().toISOString().split('T')[0];
  const choices = (await read('choices')).filter(c => c.enterpriseId === user.id && c.date === today);

  const now     = new Date();
  const raw     = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateStr = raw.charAt(0).toUpperCase() + raw.slice(1);

  // Résumé
  const itemCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  itemCounts[c.foodItem.name]  = (itemCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) itemCounts[c.drinkItem.name] = (itemCounts[c.drinkItem.name] || 0) + 1;
  });
  const summary = Object.entries(itemCounts).map(([name, count]) => ({ name, count }));

  // Détail
  const employees = choices.map((c, i) => ({
    num:  i + 1,
    name: c.userName || c.userId,
    meal: [c.foodItem?.name, c.drinkItem?.name].filter(Boolean).join(' + ') || '—',
    time: new Date(c.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }));

  try {
    const buf = await buildOrderListPDF({ dateStr, summary, employees });
    sendPDF(res, `commandes-${today}.pdf`, buf);
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération PDF' });
  }
});

// ── Stats publiques (sans auth) ───────────────────────────────────────────────
app.get('/api/stats/public', async (req, res) => {
  const enterprises = (await read('enterprises')).length;
  const restaurants = (await read('restaurants')).length;
  res.json({ enterprises, restaurants });
});

// ── Gestionnaire d'erreurs global (évite les crashs serveur) ─────────────────
process.on('uncaughtException', err => {
  console.error('[CRASH] Exception non capturée :', err.message);
  console.error('[CRASH] Stack :', err.stack);
});
process.on('unhandledRejection', reason => {
  console.error('[CRASH] Promesse rejetée :', reason?.message || reason);
  if (reason?.stack) console.error('[CRASH] Stack :', reason.stack);
});
process.on('exit', code => {
  console.log(`[EXIT] Process terminé — code ${code}`);
});

// ── Arrêt propre ─────────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\n[Shutdown] Signal ${signal} reçu — fermeture en cours…`);
  process.exit(0);
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => gracefulShutdown(sig)));

// ── Démarrage du serveur ──────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 LunchApp v2 démarré → http://localhost:${PORT}`);
  });
}

module.exports = app;
