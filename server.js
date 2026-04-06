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
      <h2 style="margin-top:0">Félicitations pour votre inscription, ${name} !</h2>
      <p>Bienvenue sur la plateforme <strong>LunchApp</strong> ! Votre compte <strong>${roleLabel}</strong> a été créé avec succès.</p>
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
      subject: `🎉 Félicitations pour votre inscription sur LunchApp !`,
      html,
    });
  } catch (err) {
    console.error('[Mailer] Échec envoi email à', to, ':', err.message);
  }
}

// ── Base de données (PostgreSQL si DATABASE_URL, sinon JSON) ──────────────────
const db = require('./db');

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
  if (!pwd || pwd.length < 8) return false;
  if (!/[a-z]/.test(pwd)) return false;
  if (!/[A-Z]/.test(pwd)) return false;
  if (!/[0-9]/.test(pwd)) return false;
  if (!/[^A-Za-z0-9]/.test(pwd)) return false;
  return true;
}

// ── SSE ───────────────────────────────────────────────────────────────────────
const sseClients = new Map();

function sseSend(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(payload);
    return true;
  } catch (e) {
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
  res.setHeader('X-Accel-Buffering', 'no');

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
    const n = {
      id: uid(), userId: String(userId), userRole, type,
      title, message, data, isRead: false,
      createdAt: new Date().toISOString(),
    };
    await db.notifications.create(n);
    sseNotify(userId, 'notification', n);
    return n;
  } catch (e) {
    console.error('[pushNotif] Error:', e.message);
  }
}

async function notifyMenuUpdate(restaurantId, restaurantName, changeType) {
  try {
    const affiliations = await db.affiliations.find({ restaurantId });
    if (!affiliations.length) return;
    const employees = await db.employees.find();
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

  if (id === SUPERADMIN.email.toLowerCase() && password === SUPERADMIN.password) {
    const token = jwt.sign({ id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: SUPERADMIN.id, role: 'superadmin', fullName: SUPERADMIN.fullName } });
  }

  let userObj = null;
  const ent = await db.enterprises.findOne({ email: id });
  if (!ent) {
    const allEnt = await db.enterprises.find();
    const match = allEnt.find(u => u.companyName?.toLowerCase() === id);
    if (match) userObj = match;
  } else {
    userObj = ent;
  }

  if (!userObj) {
    const rst = await db.restaurants.findOne({ email: id });
    if (!rst) {
      const allRst = await db.restaurants.find();
      const match = allRst.find(u => u.restaurantName?.toLowerCase() === id);
      if (match) userObj = match;
    } else {
      userObj = rst;
    }
  }

  if (!userObj) {
    const allEmp = await db.employees.find();
    userObj = allEmp.find(u => {
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

  const lower = email.toLowerCase().trim();
  let found = null, role = null;
  const ent = await db.enterprises.findOne({ email: lower });
  if (ent)  { found = ent;  role = 'enterprise'; }
  if (!found) {
    const rst = await db.restaurants.findOne({ email: lower });
    if (rst)  { found = rst;  role = 'restaurant'; }
  }

  res.json({ message: 'Si cet email est enregistré, vous recevrez un lien de réinitialisation.' });

  if (!found) return;

  const token    = uid() + uid();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await db.passwordResets.deleteMany({ email: lower });
  await db.passwordResets.create({ token, email: lower, role, expiresAt });

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

  const entry = await db.passwordResets.findOne({ token });
  if (!entry)                          return res.status(400).json({ error: 'Lien invalide ou déjà utilisé' });
  if (new Date(entry.expiresAt) < new Date()) {
    await db.passwordResets.delete({ token });
    return res.status(400).json({ error: 'Lien expiré. Veuillez refaire une demande.' });
  }

  const hashed = await bcrypt.hash(newPassword, 10);

  if (entry.role === 'enterprise') {
    const updated = await db.enterprises.update({ email: entry.email }, { password: hashed });
    if (!updated) return res.status(404).json({ error: 'Compte introuvable' });
  } else {
    const updated = await db.restaurants.update({ email: entry.email }, { password: hashed });
    if (!updated) return res.status(404).json({ error: 'Compte introuvable' });
  }

  await db.passwordResets.delete({ token });
  res.json({ message: 'Mot de passe mis à jour avec succès.' });
});

// ── Inscription entreprise ────────────────────────────────────────────────────
app.post('/api/enterprise/register', async (req, res) => {
  const { companyName, email, password, phone, location } = req.body;
  if (!companyName || !email || !password) return res.status(400).json({ error: 'Champs requis' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Mot de passe trop faible (8 car. min, maj, min, chiffre, spécial)' });

  if (await db.enterprises.find().some(e => e.companyName?.toLowerCase() === companyName.trim().toLowerCase()))
    return res.status(409).json({ error: 'Ce nom d\'entreprise est déjà utilisé' });
  if (await db.enterprises.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hashed = await bcrypt.hash(password, 10);
  const enterprise = {
    id: uid(), companyName: companyName.trim(), email: email.toLowerCase().trim(),
    password: hashed, phone: phone || '', location: location || '',
    role: 'enterprise', createdAt: new Date().toISOString(),
  };
  await db.enterprises.create(enterprise);

  const token = jwt.sign({ id: enterprise.id, role: 'enterprise', companyName: enterprise.companyName }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = enterprise;
  res.status(201).json({ token, user: safe });

  sendWelcomeEmail({ to: enterprise.email, name: enterprise.companyName, role: 'enterprise' });
});

// ── Inscription restaurant ────────────────────────────────────────────────────
app.post('/api/restauratrice/register', async (req, res) => {
  const { restaurantName, fullName, email, password, phone, specialty, address, paymentInfo } = req.body;
  if (!restaurantName || !fullName || !email || !password) return res.status(400).json({ error: 'Champs requis' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Mot de passe trop faible' });

  if (await db.restaurants.find().some(r => r.restaurantName?.toLowerCase() === restaurantName.trim().toLowerCase()))
    return res.status(409).json({ error: 'Ce nom de restaurant est déjà utilisé' });
  if (await db.restaurants.findOne({ email: email.toLowerCase() }))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hashed = await bcrypt.hash(password, 10);
  const restaurant = {
    id: uid(), restaurantName: restaurantName.trim(), fullName: fullName.trim(),
    email: email.toLowerCase().trim(), password: hashed,
    phone: phone || '',
    specialty: Array.isArray(specialty) ? specialty : (specialty ? [specialty] : []),
    address: address || '',
    description: '', photo: '',
    paymentInfo: Array.isArray(paymentInfo) ? paymentInfo : [],
    role: 'restauratrice', createdAt: new Date().toISOString(),
  };
  await db.restaurants.create(restaurant);

  const token = jwt.sign({ id: restaurant.id, role: 'restauratrice', restaurantName: restaurant.restaurantName }, JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = restaurant;
  res.status(201).json({ token, user: safe });

  sendWelcomeEmail({ to: restaurant.email, name: restaurant.restaurantName, role: 'restaurant' });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESTAURANTS (lecture publique)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurants', auth, async (req, res) => {
  const restaurants = await db.restaurants.find().map(({ password, ...r }) => r);
  res.json(restaurants);
});

app.get('/api/restaurants/:id', auth, async (req, res) => {
  const r = await db.restaurants.findOne({ id: req.params.id });
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable' });
  const { password, ...safe } = r;
  res.json(safe);
});

// ── Profil restaurant ─────────────────────────────────────────────────────────
app.patch('/api/restaurant/profile', auth, requireRole('restauratrice'), async (req, res) => {
  const { restaurantName, fullName, phone, address, specialty, description, photo, paymentInfo, password, newPassword } = req.body;

  const r = await db.restaurants.findOne({ id: req.user.id });
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable' });

  const updates = {};
  if (restaurantName !== undefined) updates.restaurantName = restaurantName.trim();
  if (fullName      !== undefined) updates.fullName = fullName.trim();
  if (phone         !== undefined) updates.phone = phone;
  if (address       !== undefined) updates.address = address;
  if (specialty     !== undefined) updates.specialty = Array.isArray(specialty) ? specialty : (specialty ? [specialty] : []);
  if (description   !== undefined) updates.description = description;
  if (photo         !== undefined) updates.photo = photo;
  if (paymentInfo   !== undefined) updates.paymentInfo = paymentInfo;

  if (newPassword && password) {
    const valid = await bcrypt.compare(password, r.password);
    if (!valid) return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    updates.password = await bcrypt.hash(newPassword, 10);
  }
  updates.updatedAt = new Date().toISOString();

  const updated = await db.restaurants.update({ id: req.user.id }, updates);
  const { password: _, ...safe } = updated;
  res.json(safe);
});

// ── Profil actuel du restaurant connecté ─────────────────────────────────────
app.get('/api/restaurant/me', auth, requireRole('restauratrice'), async (req, res) => {
  const r = await db.restaurants.findOne({ id: req.user.id });
  if (!r) return res.status(404).json({ error: 'Restaurant introuvable' });
  const { password, ...safe } = r;
  res.json(safe);
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU COMPLET (gestion par le restaurant)
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurant/menu', auth, requireRole('restauratrice'), async (req, res) => {
  const menu = await db.menus.findOne({ restaurantId: req.user.id }) || { restaurantId: req.user.id, items: [] };
  res.json(menu);
});

app.post('/api/restaurant/menu/items', auth, requireRole('restauratrice'), async (req, res) => {
  const { name, category, price, description } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Nom et catégorie requis' });
  if (!['food', 'drink'].includes(category)) return res.status(400).json({ error: 'Catégorie invalide (food ou drink)' });
  if (price === undefined || price === null || isNaN(Number(price))) return res.status(400).json({ error: 'Prix requis' });

  let menu = await db.menus.findOne({ restaurantId: req.user.id });
  if (!menu) {
    menu = { restaurantId: req.user.id, items: [] };
    await db.menus.create(menu);
  }

  const item = { id: uid(), name: name.trim(), category, price: Number(price), description: description || '', available: true };
  menu.items.push(item);
  menu.updatedAt = new Date().toISOString();
  await db.menus.update({ restaurantId: req.user.id }, { items: menu.items, updatedAt: menu.updatedAt });
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_added');
  res.status(201).json(item);
});

app.put('/api/restaurant/menu/items/:itemId', auth, requireRole('restauratrice'), async (req, res) => {
  const menu = await db.menus.findOne({ restaurantId: req.user.id });
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

  await db.menus.update({ restaurantId: req.user.id }, { items: menu.items, updatedAt: menu.updatedAt });
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_updated');
  res.json(menu.items[idx]);
});

app.delete('/api/restaurant/menu/items/:itemId', auth, requireRole('restauratrice'), async (req, res) => {
  const menu = await db.menus.findOne({ restaurantId: req.user.id });
  if (!menu) return res.status(404).json({ error: 'Menu introuvable' });

  menu.items = menu.items.filter(i => i.id !== req.params.itemId);
  menu.updatedAt = new Date().toISOString();
  await db.menus.update({ restaurantId: req.user.id }, { items: menu.items, updatedAt: menu.updatedAt });

  const dailyMenus = await db.dailyMenus.find({ restaurantId: req.user.id });
  for (const d of dailyMenus) {
    const newItems = (d.availableItems || []).filter(id => id !== req.params.itemId);
    await db.dailyMenus.update({ restaurantId: d.restaurantId, date: d.date }, { availableItems: newItems, updatedAt: new Date().toISOString() });
  }
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'item_deleted');
  res.json({ success: true });
});

// Menu d'un restaurant (visible par toute entreprise pour consultation ; employés uniquement affiliés)
app.get('/api/restaurants/:id/menu', auth, async (req, res) => {
  if (req.user.role === 'employee') {
    const aff = await db.affiliations.findOne({ enterpriseId: req.user.enterpriseId, restaurantId: req.params.id });
    if (!aff) return res.status(403).json({ error: 'Non affilié à ce restaurant' });
  }
  const menu = await db.menus.findOne({ restaurantId: req.params.id }) || { restaurantId: req.params.id, items: [] };
  res.json(menu);
});

// ─────────────────────────────────────────────────────────────────────────────
// MENU JOURNALIER
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/restaurant/menu/daily', auth, requireRole('restauratrice'), async (req, res) => {
  const date = req.query.date || todayStr();
  const daily = await db.dailyMenus.findOne({ restaurantId: req.user.id, date });
  if (daily) {
    res.json(daily);
  } else {
    const menu = await db.menus.findOne({ restaurantId: req.user.id }) || { items: [] };
    res.json({ restaurantId: req.user.id, date, availableItems: menu.items.map(i => i.id) });
  }
});

app.put('/api/restaurant/menu/daily', auth, requireRole('restauratrice'), async (req, res) => {
  const { date, availableItems } = req.body;
  const d = date || todayStr();
  if (!Array.isArray(availableItems)) return res.status(400).json({ error: 'availableItems requis' });

  const existing = await db.dailyMenus.findOne({ restaurantId: req.user.id, date: d });
  if (existing) {
    await db.dailyMenus.update({ restaurantId: req.user.id, date: d }, { availableItems, updatedAt: new Date().toISOString() });
  } else {
    await db.dailyMenus.create({ restaurantId: req.user.id, date: d, availableItems, updatedAt: new Date().toISOString() });
  }
  await notifyMenuUpdate(req.user.id, req.user.restaurantName, 'daily_updated');
  res.json({ date: d, availableItems });
});

// Menu journalier d'un restaurant donné (pour entreprise/employé affilié)
app.get('/api/restaurants/:id/menu/daily', auth, async (req, res) => {
  if (req.user.role === 'enterprise') {
    const aff = await db.affiliations.findOne({ enterpriseId: req.user.id, restaurantId: req.params.id });
    if (!aff) return res.status(403).json({ error: 'Non affilié' });
  } else if (req.user.role === 'employee') {
    const aff = await db.affiliations.findOne({ enterpriseId: req.user.enterpriseId, restaurantId: req.params.id });
    if (!aff) return res.status(403).json({ error: 'Non affilié' });
  }

  const menu  = await db.menus.findOne({ restaurantId: req.params.id }) || { items: [] };
  const items = menu.items.filter(i => i.available !== false);
  res.json({ restaurantId: req.params.id, items, foods: items.filter(i => i.category === 'food'), drinks: items.filter(i => i.category === 'drink') });
});

// ─────────────────────────────────────────────────────────────────────────────
// AFFILIATIONS
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/enterprise/restaurants/:restaurantId/affiliate', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId } = req.params;
  if (!await db.restaurants.findOne({ id: restaurantId }))
    return res.status(404).json({ error: 'Restaurant introuvable' });

  const existing = await db.affiliations.findOne({ enterpriseId: req.user.id, restaurantId });
  if (existing) return res.status(409).json({ error: 'Déjà affilié' });

  const aff = { id: uid(), enterpriseId: req.user.id, enterpriseName: req.user.companyName, restaurantId, createdAt: new Date().toISOString() };
  await db.affiliations.create(aff);

  await pushNotif(restaurantId, 'restauratrice', 'new_affiliation', 'Nouvelle affiliation',
    `${req.user.companyName} s'est affiliée à votre restaurant.`,
    { enterpriseId: req.user.id });

  res.status(201).json(aff);
});

app.delete('/api/enterprise/restaurants/:restaurantId/affiliate', auth, requireRole('enterprise'), async (req, res) => {
  await db.affiliations.delete({ enterpriseId: req.user.id, restaurantId: req.params.restaurantId });
  res.json({ success: true });
});

app.get('/api/enterprise/restaurants', auth, requireRole('enterprise'), async (req, res) => {
  const affiliations = await db.affiliations.find({ enterpriseId: req.user.id });
  const restaurants  = await db.restaurants.find().map(({ password, ...r }) => r);
  const menus        = await db.menus.find();

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

app.post('/api/restaurant/enterprises/:enterpriseId/offer', auth, requireRole('restauratrice'), async (req, res) => {
  const { enterpriseId } = req.params;
  if (!await db.enterprises.findOne({ id: enterpriseId }))
    return res.status(404).json({ error: 'Entreprise introuvable' });

  const existing = await db.offers.findOne({ restaurantId: req.user.id, enterpriseId });
  if (existing) return res.status(409).json({ error: 'Offre déjà envoyée' });

  const offer = { id: uid(), restaurantId: req.user.id, restaurantName: req.user.restaurantName, enterpriseId, createdAt: new Date().toISOString() };
  await db.offers.create(offer);

  await pushNotif(enterpriseId, 'enterprise', 'service_offer', 'Offre de service',
    `${req.user.restaurantName} vous propose ses services.`,
    { restaurantId: req.user.id });

  res.status(201).json(offer);
});

app.delete('/api/restaurant/enterprises/:enterpriseId/offer', auth, requireRole('restauratrice'), async (req, res) => {
  await db.offers.delete({ restaurantId: req.user.id, enterpriseId: req.params.enterpriseId });
  await db.affiliations.delete({ restaurantId: req.user.id, enterpriseId: req.params.enterpriseId });
  res.json({ success: true });
});

app.get('/api/restaurant/clientele', auth, requireRole('restauratrice'), async (req, res) => {
  const affiliations = await db.affiliations.find({ restaurantId: req.user.id });
  const enterprises  = await db.enterprises.find().map(({ password, ...e }) => e);
  const t            = todayStr();
  const choices      = await db.choices.find({ restaurantId: req.user.id, date: t });

  const result = affiliations.map(a => {
    const e = enterprises.find(e => e.id === a.enterpriseId);
    if (!e) return null;
    return { ...e, affiliatedAt: a.createdAt, todayChoices: choices.filter(c => c.enterpriseId === a.enterpriseId) };
  }).filter(Boolean);

  res.json(result);
});

app.get('/api/restaurant/enterprises', auth, requireRole('restauratrice'), async (req, res) => {
  const enterprises  = await db.enterprises.find().map(({ password, ...e }) => e);
  const affiliations = await db.affiliations.find({ restaurantId: req.user.id });
  const offers       = await db.offers.find({ restaurantId: req.user.id });

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
  res.json(await db.employees.find({ enterpriseId: req.user.id }).map(({ password, ...e }) => e));
});

app.post('/api/enterprise/employees', auth, requireRole('enterprise'), async (req, res) => {
  const { firstName, lastName, whatsapp, email, gender, password, employeeId: customId } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ error: 'Prénom et nom requis' });
  if (!['male', 'female'].includes(gender)) return res.status(400).json({ error: 'Genre requis (male/female)' });
  if (!customId || !/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(String(customId))) return res.status(400).json({ error: 'ID employé invalide — commence par une lettre, 3 à 30 caractères' });

  const finalPassword = (password && password.length >= 6) ? password : 'Temp1234';
  if (password && password.length < 6) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });

  const fullName = `${firstName.trim()} ${lastName.trim()}`;
  const employees = await db.employees.find({ enterpriseId: req.user.id });

  const lower = fullName.toLowerCase();
  const dup = employees.find(e => {
    const n = (e.fullName || '').toLowerCase();
    return n === lower || n.split(' ').reverse().join(' ') === lower;
  });
  if (dup) return res.status(409).json({ error: 'Un employé avec ce nom existe déjà' });

  if (await db.employees.find().some(e => e.employeeId === customId)) return res.status(409).json({ error: 'Cet ID employé est déjà utilisé' });

  const hashed = await bcrypt.hash(finalPassword, 10);
  const employeeId = customId;
  const employee = {
    id: uid(), employeeId, firstName: firstName.trim(), lastName: lastName.trim(),
    fullName, gender, whatsapp: whatsapp || '', email: email || '',
    password: hashed,
    role: 'employee', enterpriseId: req.user.id, enterpriseName: req.user.companyName,
    createdAt: new Date().toISOString(),
  };
  await db.employees.create(employee);

  const enterpriseName = req.user.companyName || 'votre entreprise';

  if (email) {
    sendCredentialsEmail({ to: email, firstName, employeeId, password: finalPassword, enterpriseName });
  }

  const { password: _, ...safe } = employee;
  res.status(201).json({ ...safe, plainPassword: finalPassword });
});

app.put('/api/enterprise/employees/:id', auth, requireRole('enterprise'), async (req, res) => {
  const employee = await db.employees.findOne({ id: req.params.id, enterpriseId: req.user.id });
  if (!employee) return res.status(404).json({ error: 'Employé introuvable' });

  const { firstName, lastName, fullName, gender, whatsapp, password, newPassword, employeeId: newEmpId } = req.body;
  const updates = {};
  if (firstName) { updates.firstName = firstName.trim(); updates.fullName = `${firstName.trim()} ${employee.lastName || ''}`; }
  if (lastName)  { updates.lastName  = lastName.trim();  updates.fullName = `${employee.firstName || ''} ${lastName.trim()}`; }
  if (fullName)  updates.fullName = fullName.trim();
  if (gender)    updates.gender = gender;
  if (whatsapp !== undefined) updates.whatsapp = whatsapp;
  if (newEmpId) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(String(newEmpId))) return res.status(400).json({ error: 'ID employé invalide — commence par une lettre, 3 à 30 caractères' });
    const clash = await db.employees.find().find((e, i) => e.id !== req.params.id && e.employeeId === newEmpId);
    if (clash) return res.status(409).json({ error: 'Cet ID employé est déjà utilisé' });
    updates.employeeId = newEmpId;
  }

  if (newPassword && password) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    const valid = await bcrypt.compare(password, employee.password);
    if (!valid) return res.status(400).json({ error: 'Ancien mot de passe incorrect' });
    updates.password = await bcrypt.hash(newPassword, 10);
  } else if (password && password.length >= 6) {
    updates.password = await bcrypt.hash(password, 10);
  }
  updates.updatedAt = new Date().toISOString();

  const updated = await db.employees.update({ id: req.params.id }, updates);
  const { password: _, ...safe } = updated;
  res.json(safe);
});

app.delete('/api/enterprise/employees/:id', auth, requireRole('enterprise'), async (req, res) => {
  const employee = await db.employees.findOne({ id: req.params.id, enterpriseId: req.user.id });
  if (!employee) return res.status(404).json({ error: 'Employé introuvable' });
  await db.employees.delete({ id: req.params.id });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFIL EMPLOYÉ (self-update)
// ─────────────────────────────────────────────────────────────────────────────

app.put('/api/employee/me', auth, requireRole('employee'), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Mot de passe actuel et nouveau requis' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
  const employee = await db.employees.findOne({ id: req.user.id });
  if (!employee) return res.status(404).json({ error: 'Employé introuvable' });
  const valid = await bcrypt.compare(currentPassword, employee.password);
  if (!valid) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  await db.employees.update({ id: req.user.id }, {
    password: await bcrypt.hash(newPassword, 10),
    updatedAt: new Date().toISOString(),
  });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHOIX DES EMPLOYÉS
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/employee/menus', auth, requireRole('employee'), async (req, res) => {
  const affiliations = await db.affiliations.find({ enterpriseId: req.user.enterpriseId });
  const restaurants  = await db.restaurants.find().map(({ password, ...r }) => r);
  const menus        = await db.menus.find();

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

app.post('/api/choices', auth, requireRole('employee'), async (req, res) => {
  const { restaurantId, foodItemId, drinkItemId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'Restaurant requis' });
  if (!foodItemId && !drinkItemId) return res.status(400).json({ error: 'Sélectionnez au moins un plat ou une boisson' });

  const aff = await db.affiliations.findOne({ enterpriseId: req.user.enterpriseId, restaurantId });
  if (!aff) return res.status(403).json({ error: 'Restaurant non affilié à votre entreprise' });

  const t = todayStr();
  const existing = await db.choices.findOne({ userId: req.user.id, date: t });

  if (existing) {
    const elapsed = (Date.now() - new Date(existing.createdAt).getTime()) / 60000;
    if (elapsed > LOCK_MIN) return res.status(409).json({ error: 'Vous avez déjà fait votre choix aujourd\'hui' });
    if (existing.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

    const menu = await db.menus.findOne({ restaurantId: existing.restaurantId }) || { items: [] };
    const updates = {};
    if (foodItemId !== undefined) {
      if (foodItemId === null) { updates.foodItem = null; }
      else {
        const item = menu.items.find(i => i.id === foodItemId && i.category === 'food');
        if (!item) return res.status(400).json({ error: 'Plat introuvable dans le menu' });
        updates.foodItem = { id: item.id, name: item.name, price: item.price };
      }
    }
    if (drinkItemId !== undefined) {
      if (drinkItemId === null) { updates.drinkItem = null; }
      else {
        const item = menu.items.find(i => i.id === drinkItemId && i.category === 'drink');
        if (!item) return res.status(400).json({ error: 'Boisson introuvable dans le menu' });
        updates.drinkItem = { id: item.id, name: item.name, price: item.price };
      }
    }
    if (!updates.foodItem && !updates.drinkItem && !existing.foodItem && !existing.drinkItem)
      return res.status(400).json({ error: 'Sélectionnez au moins un plat ou une boisson' });
    updates.updatedAt = new Date().toISOString();
    const updated = await db.choices.update({ id: existing.id }, updates);
    sseNotify(existing.restaurantId, 'update_choice', { choice: updated });
    return res.json(updated);
  }

  const menu = await db.menus.findOne({ restaurantId }) || { items: [] };

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

  const restaurant = await db.restaurants.findOne({ id: restaurantId });
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

  await db.choices.create(choice);
  sseNotify(restaurantId, 'new_choice', { choice });

  res.status(201).json(choice);
});

app.put('/api/choices/:id', auth, requireRole('employee'), async (req, res) => {
  const choice = await db.choices.findOne({ id: req.params.id, userId: req.user.id });
  if (!choice) return res.status(404).json({ error: 'Choix introuvable' });

  const elapsed = (Date.now() - new Date(choice.createdAt).getTime()) / 60000;
  if (elapsed > LOCK_MIN) return res.status(403).json({ error: `Délai de modification dépassé (${LOCK_MIN} min)` });
  if (choice.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

  const { foodItemId, drinkItemId } = req.body;
  const menu = await db.menus.findOne({ restaurantId: choice.restaurantId }) || { items: [] };

  const updates = {};
  if (foodItemId !== undefined) {
    if (foodItemId === null) {
      updates.foodItem = null;
    } else {
      const item = menu.items.find(i => i.id === foodItemId && i.category === 'food');
      if (!item) return res.status(400).json({ error: 'Plat introuvable' });
      updates.foodItem = { id: item.id, name: item.name, price: item.price };
    }
  }
  if (drinkItemId !== undefined) {
    if (drinkItemId === null) {
      updates.drinkItem = null;
    } else {
      const item = menu.items.find(i => i.id === drinkItemId && i.category === 'drink');
      if (!item) return res.status(400).json({ error: 'Boisson introuvable' });
      updates.drinkItem = { id: item.id, name: item.name, price: item.price };
    }
  }
  if (!updates.foodItem && !updates.drinkItem && !choice.foodItem && !choice.drinkItem)
    return res.status(400).json({ error: 'Le choix doit contenir au moins un plat ou une boisson' });

  updates.updatedAt = new Date().toISOString();

  const updated = await db.choices.update({ id: req.params.id }, updates);
  res.json(updated);
});

app.delete('/api/choices/history', auth, requireRole('employee'), async (req, res) => {
  const t = todayStr();
  await db.choices.query(
    `DELETE FROM choices WHERE user_id = $1 AND date != $2`,
    [req.user.id, t]
  );
  res.json({ success: true });
});

app.delete('/api/choices/:id', auth, requireRole('employee'), async (req, res) => {
  const choice = await db.choices.findOne({ id: req.params.id, userId: req.user.id });
  if (!choice) return res.status(404).json({ error: 'Choix introuvable' });

  const elapsed = (Date.now() - new Date(choice.createdAt).getTime()) / 60000;
  if (elapsed > LOCK_MIN) return res.status(403).json({ error: `Délai de suppression dépassé (${LOCK_MIN} min)` });
  if (choice.orderLaunched) return res.status(403).json({ error: 'La commande a déjà été lancée' });

  await db.choices.delete({ id: req.params.id });
  res.json({ success: true });
});

app.get('/api/choices/mine', auth, requireRole('employee'), async (req, res) => {
  const t = todayStr();
  const choice = await db.choices.findOne({ userId: req.user.id, date: t }) || null;
  res.json(choice);
});

app.get('/api/choices/today', auth, async (req, res) => {
  const t = todayStr();
  let choices = await db.choices.find({ date: t });
  if (req.user.role === 'employee')     choices = choices.filter(c => c.userId === req.user.id);
  else if (req.user.role === 'enterprise') choices = choices.filter(c => c.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') choices = choices.filter(c => c.restaurantId === req.user.id);
  res.json(choices);
});

app.post('/api/choices/:id/rate', auth, requireRole('employee'), async (req, res) => {
  const { stars } = req.body;
  const s = Number(stars);
  if (!s || s < 1 || s > 5) return res.status(400).json({ error: 'Note invalide (1 à 5 étoiles)' });

  const choice = await db.choices.findOne({ id: req.params.id, userId: req.user.id });
  if (!choice) return res.status(404).json({ error: 'Choix introuvable' });

  await db.choices.update({ id: req.params.id }, { rating: s });

  await db.ratings.create({
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

  const starEmoji = '⭐'.repeat(s);
  const platName  = choice.foodItem?.name || choice.drinkItem?.name || 'votre service';
  await pushNotif(choice.restaurantId, 'restauratrice', 'new_rating', 'Nouvelle évaluation',
    `${req.user.fullName} (${req.user.enterpriseName || 'Employé'}) note votre plat "${platName}" ${starEmoji} (${s}/5).`,
    { stars: s, employeeId: req.user.id, enterpriseId: req.user.enterpriseId });

  res.json(await db.choices.findOne({ id: req.params.id }));
});

app.get('/api/choices/history', auth, async (req, res) => {
  let choices = await db.choices.find();
  if (req.user.role === 'employee')      choices = choices.filter(c => c.userId === req.user.id);
  else if (req.user.role === 'enterprise') choices = choices.filter(c => c.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') choices = choices.filter(c => c.restaurantId === req.user.id);
  res.json(choices.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDES (ORDERS)
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/orders', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'Restaurant requis' });

  const t = todayStr();
  const todayChoices = await db.choices.find({ enterpriseId: req.user.id, restaurantId, date: t }).filter(c => !c.orderLaunched);
  if (!todayChoices.length) return res.status(400).json({ error: 'Aucun choix non soumis pour ce restaurant aujourd\'hui' });

  const restaurant = await db.restaurants.findOne({ id: restaurantId });
  let totalAmount = 0;
  const items = todayChoices.map(c => {
    const amount = (c.foodItem?.price || 0) + (c.drinkItem?.price || 0);
    totalAmount += amount;
    return { employeeId: c.userId, employeeName: c.userName, foodItem: c.foodItem, drinkItem: c.drinkItem, amount };
  });

  const activeSub = await db.subscriptions.findOne({ enterpriseId: req.user.id, restaurantId, status: 'accepted' });

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

  await db.orders.create(order);

  await db.choices.query(
    `UPDATE choices SET order_launched = true, updated_at = NOW() WHERE enterprise_id = $1 AND restaurant_id = $2 AND date = $3`,
    [req.user.id, restaurantId, t]
  );

  await pushNotif(restaurantId, 'restauratrice', 'new_order', 'Nouvelle commande',
    `${req.user.companyName} vient de passer une commande de ${items.length} repas. Total: ${totalAmount.toLocaleString('fr-FR')} FCFA.`,
    { orderId: order.id, enterpriseId: req.user.id });

  res.status(201).json(order);
});

app.get('/api/orders', auth, async (req, res) => {
  let orders = await db.orders.find();
  if (req.user.role === 'enterprise')   orders = orders.filter(o => o.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') orders = orders.filter(o => o.restaurantId === req.user.id);
  res.json(orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(({ depositScreenshot, ...o }) => o));
});

app.put('/api/orders/:id/status', auth, requireRole('restauratrice'), async (req, res) => {
  const { status } = req.body;
  if (!['confirmed', 'preparing', 'delivered', 'cancelled'].includes(status))
    return res.status(400).json({ error: 'Statut invalide' });

  const order = await db.orders.findOne({ id: req.params.id, restaurantId: req.user.id });
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  const updated = await db.orders.update({ id: req.params.id }, {
    status,
    updatedAt: new Date().toISOString(),
  });

  const messages = {
    confirmed: `${req.user.restaurantName} a accusé réception de votre commande (${order.items?.length || 0} repas).`,
    preparing: `Votre commande chez ${req.user.restaurantName} est en cours de préparation.`,
    delivered: `Votre commande chez ${req.user.restaurantName} a été livrée. Bon appétit !`,
    cancelled: `Votre commande chez ${req.user.restaurantName} a été annulée.`,
  };
  await pushNotif(order.enterpriseId, 'enterprise', 'order_status',
    status === 'confirmed' ? 'Réception accusée' : 'Statut de commande',
    messages[status] || `Commande mise à jour : ${status}.`,
    { orderId: req.params.id, status });

  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTURES (INVOICES)
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/invoices', auth, requireRole('restauratrice'), async (req, res) => {
  const { orderId, frequency } = req.body;
  if (!orderId) return res.status(400).json({ error: 'orderId requis' });

  const order = await db.orders.findOne({ id: orderId, restaurantId: req.user.id });
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  const existingInvoices = await db.invoices.find();
  if (existingInvoices.find(i => i.orderId === orderId))
    return res.status(409).json({ error: 'Facture déjà générée pour cette commande' });

  const restaurant  = await db.restaurants.findOne({ id: req.user.id }) || {};
  const enterprise  = await db.enterprises.findOne({ id: order.enterpriseId }) || {};

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

  await db.invoices.create(invoice);

  await pushNotif(order.enterpriseId, 'enterprise', 'new_invoice', '🧾 Nouvelle facture',
    `${req.user.restaurantName} vous a envoyé une facture de ${(order.totalAmount||0).toLocaleString('fr-FR')} FCFA (commande du ${order.date}).`,
    { invoiceId: invId, invoiceNumber: invNum });

  const { pdfBase64: _, ...safe } = invoice;
  res.status(201).json(safe);
});

app.get('/api/invoices', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  let invoices = await db.invoices.find();
  if (req.user.role === 'enterprise')    invoices = invoices.filter(i => i.enterpriseId === req.user.id);
  if (req.user.role === 'restauratrice') invoices = invoices.filter(i => i.restaurantId === req.user.id);
  res.json(invoices.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
    .map(({ pdfBase64: _, ...i }) => i));
});

app.get('/api/invoices/:id/pdf', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const inv = await db.invoices.findOne({ id: req.params.id });
  if (!inv || (inv.enterpriseId !== req.user.id && inv.restaurantId !== req.user.id))
    return res.status(404).json({ error: 'Facture introuvable' });
  if (!inv.pdfBase64) return res.status(404).json({ error: 'PDF non disponible' });
  const buf = Buffer.from(inv.pdfBase64, 'base64');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.number}.pdf"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

app.put('/api/invoices/:id/confirm', auth, requireRole('enterprise'), async (req, res) => {
  const invoice = await db.invoices.findOne({ id: req.params.id, enterpriseId: req.user.id });
  if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
  const updated = await db.invoices.update({ id: req.params.id }, {
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
  });
  await pushNotif(invoice.restaurantId, 'restauratrice', 'invoice_confirmed', '✅ Facture confirmée',
    `${req.user.companyName} a confirmé la réception de la facture ${invoice.number}.`,
    { invoiceId: invoice.id });
  res.json(updated);
});

// ─────────────────────────────────────────────────────────────────────────────
// ABONNEMENTS
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/subscriptions', auth, requireRole('enterprise'), async (req, res) => {
  const { restaurantId, frequency } = req.body;
  const valid = ['weekly', 'monthly', 'quarterly', 'semi-annual', 'annual'];
  if (!restaurantId || !valid.includes(frequency))
    return res.status(400).json({ error: 'Restaurant et fréquence valide requis' });

  const existing = await db.subscriptions.findOne({ enterpriseId: req.user.id, restaurantId, status: 'pending' });
  if (existing) return res.status(409).json({ error: 'Une demande est déjà en attente' });

  const restaurant = await db.restaurants.findOne({ id: restaurantId });
  const sub = {
    id: uid(),
    enterpriseId: req.user.id, enterpriseName: req.user.companyName,
    restaurantId, restaurantName: restaurant?.restaurantName || '',
    frequency, status: 'pending',
    createdAt: new Date().toISOString(),
  };
  await db.subscriptions.create(sub);

  const labels = { weekly: 'hebdomadaire', monthly: 'mensuel', quarterly: 'trimestriel', 'semi-annual': 'semestriel', annual: 'annuel' };
  await pushNotif(restaurantId, 'restauratrice', 'subscription_request', 'Demande d\'abonnement',
    `${req.user.companyName} demande un abonnement ${labels[frequency]}.`,
    { subscriptionId: sub.id });

  res.status(201).json(sub);
});

app.put('/api/subscriptions/:id', auth, requireRole('restauratrice'), async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Statut invalide' });

  const sub = await db.subscriptions.findOne({ id: req.params.id, restaurantId: req.user.id });
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });

  const updates = { status, updatedAt: new Date().toISOString() };
  if (status === 'accepted') updates.acceptedAt = new Date().toISOString();
  const updated = await db.subscriptions.update({ id: req.params.id }, updates);

  const label = status === 'accepted' ? 'accepté' : 'décliné';
  await pushNotif(sub.enterpriseId, 'enterprise', 'subscription_response', 'Réponse à votre demande',
    `${req.user.restaurantName} a ${label} votre demande d'abonnement.`,
    { subscriptionId: req.params.id, status });

  res.json(updated);
});

app.get('/api/subscriptions', auth, async (req, res) => {
  let subs = await db.subscriptions.find();
  if (req.user.role === 'enterprise')   subs = subs.filter(s => s.enterpriseId === req.user.id);
  else if (req.user.role === 'restauratrice') subs = subs.filter(s => s.restaurantId === req.user.id);
  res.json(subs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.post('/api/subscriptions/:id/invoice', auth, requireRole('restauratrice'), async (req, res) => {
  const sub = await db.subscriptions.findOne({ id: req.params.id, restaurantId: req.user.id });
  if (!sub) return res.status(404).json({ error: 'Abonnement introuvable' });
  if (sub.status !== 'accepted') return res.status(400).json({ error: "L'abonnement n'est pas actif" });

  const existingInvoices = await db.invoices.find();
  if (existingInvoices.find(i => i.subscriptionId === sub.id))
    return res.status(409).json({ error: 'Une facture a déjà été générée pour cet abonnement' });

  const orders = await db.orders.find().filter(o =>
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

  const restaurant = await db.restaurants.findOne({ id: req.user.id }) || {};
  const enterprise = await db.enterprises.findOne({ id: sub.enterpriseId }) || {};

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

  await db.invoices.create(invoice);

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
  const notifs = (await db.notifications.find({ userId: req.user.id }))
    .map(n => ({ ...n, read: n.isRead }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(notifs);
});

app.put('/api/notifications/read-all', auth, async (req, res) => {
  await db.notifications.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1`,
    [req.user.id]
  );
  res.json({ success: true });
});

app.put('/api/notifications/:id/read', auth, async (req, res) => {
  const notif = await db.notifications.findOne({ id: req.params.id, userId: req.user.id });
  if (!notif) return res.status(404).json({ error: 'Notification introuvable' });
  const updated = await db.notifications.update({ id: req.params.id }, { isRead: true });
  res.json({ ...updated, read: updated.isRead });
});

app.delete('/api/notifications/:id', auth, async (req, res) => {
  await db.notifications.delete({ id: req.params.id, userId: req.user.id });
  res.json({ success: true });
});

app.delete('/api/notifications', auth, async (req, res) => {
  await db.notifications.deleteMany({ userId: req.user.id });
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATISTIQUES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/stats/enterprise', auth, requireRole('enterprise'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const choices = await db.choices.find({ enterpriseId: req.user.id }).filter(c => new Date(c.date) >= start);
  const orders  = await db.orders.find({ enterpriseId: req.user.id }).filter(o => new Date(o.createdAt) >= start);

  const foodCounts = {}, drinkCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  foodCounts[c.foodItem.name]  = (foodCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) drinkCounts[c.drinkItem.name] = (drinkCounts[c.drinkItem.name] || 0) + 1;
  });

  const totalBudget = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);

  const employees = await db.employees.find({ enterpriseId: req.user.id });
  const employeeStats = employees.map(({ password, ...e }) => ({
    ...e, choicesCount: choices.filter(c => c.userId === e.id).length,
  }));

  res.json({ totalChoices: choices.length, totalBudget, foodCounts, drinkCounts, employeeStats, period: { frequency } });
});

app.get('/api/stats/restaurant', auth, requireRole('restauratrice'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const orders  = await db.orders.find({ restaurantId: req.user.id }).filter(o => new Date(o.createdAt) >= start);
  const ratings = await db.ratings.find({ restaurantId: req.user.id }).filter(r => new Date(r.createdAt) >= start);

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
  res.json(await db.enterprises.find().map(({ password, ...e }) => e));
});

app.get('/api/admin/restaurants', auth, requireRole('superadmin'), async (req, res) => {
  res.json(await db.restaurants.find().map(({ password, ...r }) => r));
});

app.get('/api/admin/employees', auth, requireRole('superadmin'), async (req, res) => {
  res.json(await db.employees.find().map(({ password, ...e }) => e));
});

app.get('/api/admin/stats', auth, requireRole('superadmin'), async (req, res) => {
  const { frequency } = req.query;
  const start = getStartDate(frequency);

  const enterprises = await db.enterprises.find();
  const restaurants = await db.restaurants.find();
  const employees   = await db.employees.find();
  const choices     = await db.choices.find().filter(c => new Date(c.date) >= start);
  const orders = await db.orders.find()
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
  res.json(await db.orders.find().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

app.get('/api/admin/orders/:id/screenshot', auth, requireRole('superadmin'), async (req, res) => {
  const order = await db.orders.findOne({ id: req.params.id });
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  if (!order.depositScreenshot)
    return res.status(404).json({ error: 'Aucun screenshot pour cette commande' });
  res.json({ depositScreenshot: order.depositScreenshot, depositType: order.depositType });
});

app.get('/api/admin/deletion-requests', auth, requireRole('superadmin'), async (req, res) => {
  res.json(await db.deletionRequests.find().sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt)));
});

app.delete('/api/admin/users/:type/:id', auth, requireRole('superadmin'), async (req, res) => {
  const { type, id } = req.params;
  if (type === 'enterprise') {
    await db.enterprises.delete({ id });
    await db.employees.deleteMany({ enterpriseId: id });
    await db.affiliations.deleteMany({ enterpriseId: id });
  } else if (type === 'restaurant') {
    await db.restaurants.delete({ id });
    await db.affiliations.deleteMany({ restaurantId: id });
  } else if (type === 'employee') {
    await db.employees.delete({ id });
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
    user = await db.enterprises.findOne({ id: req.user.id });
    type = 'enterprise';
  } else {
    user = await db.restaurants.findOne({ id: req.user.id });
    type = 'restaurant';
  }

  if (!user) return res.status(404).json({ error: 'Compte introuvable' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Mot de passe incorrect' });

  await db.deletionRequests.create({
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

  if (type === 'enterprise') {
    await db.enterprises.delete({ id: req.user.id });
    await db.employees.deleteMany({ enterpriseId: req.user.id });
    await db.affiliations.deleteMany({ enterpriseId: req.user.id });
  } else {
    await db.restaurants.delete({ id: req.user.id });
    await db.affiliations.deleteMany({ restaurantId: req.user.id });
  }

  res.json({ success: true, message: 'Votre compte a été supprimé avec succès.' });
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGERIE — entreprise ↔ restaurant
// ─────────────────────────────────────────────────────────────────────────────

const MAX_AUDIO_MB = 10;
const MAX_AUDIO_BYTES = MAX_AUDIO_MB * 1024 * 1024;

async function canMessage(req, otherId) {
  const affiliations = await db.affiliations.find();
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
    const e = await db.enterprises.findOne({ id });
    return e ? e.companyName : 'Entreprise';
  }
  if (role === 'restauratrice') {
    const r = await db.restaurants.findOne({ id });
    return r ? r.restaurantName : 'Restaurant';
  }
  return 'Inconnu';
}

app.get('/api/messages/conversations', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const msgs = await db.messages.find().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
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

app.get('/api/messages', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const { withId } = req.query;
  if (!withId) return res.status(400).json({ error: 'Paramètre withId requis' });

  const msgs = await db.messages.find()
    .filter(m =>
      (m.senderId === req.user.id && m.recipientId === withId) ||
      (m.senderId === withId && m.recipientId === req.user.id)
    )
    .map(({ audioData, ...m }) => m)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  res.json(msgs);
});

app.get('/api/messages/:id/audio', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const msg = await db.messages.findOne({ id: req.params.id });
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  if (msg.type !== 'audio') return res.status(400).json({ error: 'Pas un message audio' });
  if (msg.senderId !== req.user.id && msg.recipientId !== req.user.id)
    return res.status(403).json({ error: 'Accès refusé' });
  res.json({ audioData: msg.audioData });
});

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
  const ent = await db.enterprises.findOne({ id: recipientId });
  const rst = await db.restaurants.findOne({ id: recipientId });
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

  await db.messages.create(msg);

  const { audioData: _, ...msgSafe } = msg;
  sseNotify(recipientId, 'new_message', msgSafe);
  await pushNotif(recipientId, recipientRole, 'new_message', `Nouveau message de ${senderName}`,
    type === 'text' ? content.trim() : '🎵 Vous avez reçu un message audio.',
    { messageId: msg.id, senderId: req.user.id });

  res.status(201).json(msgSafe);
});

app.post('/api/messages/read', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const { withId } = req.body;
  if (!withId) return res.status(400).json({ error: 'withId requis' });
  const messages = await db.messages.find();
  for (const m of messages) {
    if (m.senderId === withId && m.recipientId === req.user.id && !m.readBy.includes(req.user.id)) {
      await db.messages.update({ id: m.id }, { readBy: [...m.readBy, req.user.id] });
    }
  }
  res.json({ success: true });
});

app.get('/api/messages/unread', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const count = await db.messages.find().filter(m =>
    m.recipientId === req.user.id && !m.readBy.includes(req.user.id)
  ).length;
  res.json({ count });
});

app.delete('/api/messages/:id', auth, requireRole('enterprise', 'restauratrice'), async (req, res) => {
  const msg = await db.messages.findOne({ id: req.params.id });
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  if (msg.senderId !== req.user.id) return res.status(403).json({ error: 'Seul l\'expéditeur peut supprimer' });
  await db.messages.delete({ id: req.params.id });
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

    doc.rect(0, 0, PW, 70).fill('#F97316');
    doc.fontSize(26).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('LunchApp', M, 18, { width: CW/2, lineBreak: false });
    doc.fontSize(11).font('Helvetica').fillColor('#FFF7ED')
      .text('Gestion des repas d\'entreprise', M, 46, { width: CW/2, lineBreak: false });
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text('FACTURE', M + CW/2, 22, { width: CW/2, align: 'right', lineBreak: false });
    doc.fontSize(10).font('Helvetica').fillColor('#FFF7ED')
      .text(invNum, M + CW/2, 46, { width: CW/2, align: 'right', lineBreak: false });

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

    doc.fontSize(9).font('Helvetica').fillColor('#64748B')
      .text(`Date : ${dateStr}   ·   Commande : ${invoice.orderId?.slice(0,8).toUpperCase() || '—'}`, M, infoY + 56);

    const sepY = infoY + 74;
    doc.moveTo(M, sepY).lineTo(PW-M, sepY).strokeColor('#E2E8F0').lineWidth(1).stroke();

    const cols  = [30, 220, 80, 95, 90];
    const heads = ['N°', 'Article', 'Qté', 'Prix unit.', 'Total FCFA'];
    const RH    = 24;
    let ty = sepY + 14;

    doc.rect(M, ty, CW, RH).fill('#1E293B');
    let cx = M;
    heads.forEach((h, i) => {
      const align = i >= 2 ? 'right' : 'left';
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(h, cx + 5, ty + 7, { width: cols[i] - 10, lineBreak: false, align });
      cx += cols[i];
    });
    ty += RH;

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

    ty += 6;
    doc.rect(M + CW - 185, ty, 185, 28).fill('#FFF7ED');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#F97316')
      .text(`TOTAL  ${(invoice.totalAmount||0).toLocaleString('fr-FR')} FCFA`,
        M, ty + 7, { width: CW, align: 'right', lineBreak: false });
    ty += 28;

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

app.get('/api/stats/pdf/restaurant', auth, requireRole('restauratrice'), async (req, res) => {
  const frequency = req.query.frequency || 'monthly';
  const start     = getStartDate(frequency);
  const user      = req.user;
  const orders    = await db.orders.find({ restaurantId: user.id }).filter(o => new Date(o.createdAt) >= start);
  const choices   = await db.choices.find({ restaurantId: user.id }).filter(c => new Date(c.date) >= start);
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

app.get('/api/stats/pdf/enterprise', auth, requireRole('enterprise'), async (req, res) => {
  const frequency  = req.query.frequency || 'monthly';
  const start      = getStartDate(frequency);
  const user       = req.user;
  const orders     = await db.orders.find({ enterpriseId: user.id }).filter(o => new Date(o.createdAt) >= start);
  const choices    = await db.choices.find({ enterpriseId: user.id }).filter(c => new Date(c.date) >= start);
  const employees  = await db.employees.find({ enterpriseId: user.id });
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

app.get('/api/stats/pdf/admin', auth, requireRole('superadmin'), async (req, res) => {
  const frequency   = req.query.frequency || 'monthly';
  const start       = getStartDate(frequency);
  const enterprises = await db.enterprises.find();
  const restaurants = await db.restaurants.find();
  const employees   = await db.employees.find();
  const orders      = await db.orders.find().filter(o => new Date(o.createdAt) >= start);
  const choices     = await db.choices.find().filter(c => new Date(c.date) >= start);
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

    doc.fontSize(24).font('Helvetica-Bold').fillColor('#F97316')
      .text('LunchApp', M, M, { width: CW, lineBreak: false });
    doc.moveDown(0.4);
    doc.fontSize(13).font('Helvetica').fillColor('#1E293B')
      .text('Liste des commandes du repas de midi', { width: CW });
    doc.moveDown(0.2);
    doc.fontSize(11).font('Helvetica').fillColor('#64748B')
      .text(dateStr, { width: CW });
    doc.moveDown(0.6);

    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.8);

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

    doc.moveTo(M, doc.y).lineTo(PW - M, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.moveDown(0.8);

    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1E293B')
      .text('DÉTAIL PAR EMPLOYÉ', { width: CW });
    doc.moveDown(0.5);

    const cols   = [30, 190, 210, 85];
    const labels = ['N°', 'Employé', 'Repas choisi', 'Heure'];
    const RH     = 22;
    let ty = doc.y;

    doc.rect(M, ty, CW, RH).fill('#1E293B');
    let cx = M;
    labels.forEach((h, i) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(h, cx + 5, ty + 6, { width: cols[i] - 10, lineBreak: false });
      cx += cols[i];
    });
    ty += RH;

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
  const choices = await db.choices.find({ enterpriseId: user.id, date: today });

  const now     = new Date();
  const raw     = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateStr = raw.charAt(0).toUpperCase() + raw.slice(1);

  const itemCounts = {};
  choices.forEach(c => {
    if (c.foodItem)  itemCounts[c.foodItem.name]  = (itemCounts[c.foodItem.name]  || 0) + 1;
    if (c.drinkItem) itemCounts[c.drinkItem.name] = (itemCounts[c.drinkItem.name] || 0) + 1;
  });
  const summary = Object.entries(itemCounts).map(([name, count]) => ({ name, count }));

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

app.get('/api/stats/public', async (req, res) => {
  const enterprises = await db.enterprises.find().length;
  const restaurants = await db.restaurants.find().length;
  res.json({ enterprises, restaurants });
});

// ── Gestionnaire d'erreurs global ─────────────────────────────────────────────
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

function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`\n[Shutdown] Signal ${signal} reçu — fermeture en cours…`);
  process.exit(0);
}

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => process.on(sig, () => gracefulShutdown(sig)));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 LunchApp v2 démarré → http://localhost:${PORT}`);
  });
}

module.exports = app;
