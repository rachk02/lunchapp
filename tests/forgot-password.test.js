// ═══════════════════════════════════════════════════════════════════
// tests/forgot-password.test.js — Tests récupération de compte
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB_DIR = path.join(__dirname, 'test-data-forgot');
process.env.DB_DIR = TEST_DB_DIR;

// ── Mock nodemailer — capture sendMail ────────────────────────────
let mockSendMail;
jest.mock('nodemailer', () => {
  mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock-reset-id' });
  return { createTransport: () => ({ sendMail: mockSendMail }) };
});

const request = require('supertest');
const app     = require('../server');

const DATA_FILES = [
  'enterprises.json', 'employees.json', 'restauratrices.json',
  'menus.json', 'dailyMenus.json', 'affiliations.json', 'offers.json',
  'choices.json', 'orders.json', 'subscriptions.json',
  'notifications.json', 'ratings.json', 'deletionRequests.json',
  'messages.json', 'passwordResets.json',
];

const PWD      = 'Pass1234!';
const NEW_PWD  = 'NewPass99!';
const WEAK_PWD = '1234';

// ── Helpers ───────────────────────────────────────────────────────
function readDB(file) {
  return JSON.parse(fs.readFileSync(path.join(TEST_DB_DIR, file), 'utf8'));
}

function resetDB() {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]'));
}

// ── Comptes de test ───────────────────────────────────────────────
let entEmail  = 'forgot-ent@test.com';
let rstoEmail = 'forgot-rst@test.com';

beforeAll(async () => {
  resetDB();

  // Entreprise
  await request(app).post('/api/enterprise/register').send({
    companyName: 'ForgotCorp', email: entEmail, password: PWD,
  });

  // Restaurant
  await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'ForgotResto', fullName: 'Chef Oubli',
    email: rstoEmail, password: PWD,
  });
});

beforeEach(() => {
  mockSendMail.mockClear();
  // Remettre le fichier passwordResets à vide entre certains tests
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════
// FP-01 — Demande de réinitialisation
// ════════════════════════════════════════════════════════════════════
describe('FP-01 — Demande de réinitialisation (forgot-password)', () => {
  test('✅ Réponse 200 pour email entreprise valide', async () => {
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: entEmail });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    await new Promise(r => setImmediate(r));
  });

  test('✅ sendMail appelé avec le bon destinataire (entreprise)', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe(entEmail);
  });

  test('✅ Sujet de l\'email contient "mot de passe" ou "Réinitialisation"', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const subject = mockSendMail.mock.calls[0][0].subject.toLowerCase();
    expect(subject).toMatch(/r.initialisation|mot de passe|password/i);
  });

  test('✅ Corps HTML contient un lien de réinitialisation (?reset=)', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    expect(mockSendMail.mock.calls[0][0].html).toContain('?reset=');
  });

  test('✅ Corps HTML contient le nom de l\'entreprise', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    expect(mockSendMail.mock.calls[0][0].html).toContain('ForgotCorp');
  });

  test('✅ Expéditeur = MAIL_FROM du .env', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    expect(mockSendMail.mock.calls[0][0].from).toBe(process.env.MAIL_FROM);
  });

  test('✅ Réponse 200 pour email restaurant valide', async () => {
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: rstoEmail });
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toBe(rstoEmail);
  });

  test('✅ Corps HTML contient le nom du restaurant', async () => {
    await request(app).post('/api/auth/forgot-password').send({ email: rstoEmail });
    await new Promise(r => setImmediate(r));
    expect(mockSendMail.mock.calls[0][0].html).toContain('ForgotResto');
  });

  test('✅ Même réponse 200 pour email inconnu (pas de fuite d\'info)', async () => {
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'inconnu@nowhere.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
    await new Promise(r => setImmediate(r));
    // Aucun email envoyé pour un email inconnu
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('❌ Sans email → 400', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});
    expect(res.status).toBe(400);
  });

  test('✅ Token stocké en base après la demande', async () => {
    // Vider les resets
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const resets = readDB('passwordResets.json');
    expect(resets.length).toBe(1);
    expect(resets[0].email).toBe(entEmail);
    expect(resets[0].token).toBeDefined();
    expect(resets[0].expiresAt).toBeDefined();
  });

  test('✅ Token expire dans ~30 minutes', async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const resets = readDB('passwordResets.json');
    const diff = (new Date(resets[0].expiresAt) - Date.now()) / 60000;
    expect(diff).toBeGreaterThan(28);
    expect(diff).toBeLessThanOrEqual(31);
  });

  test('✅ Nouvelle demande remplace l\'ancien token (un seul actif par email)', async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const first = readDB('passwordResets.json')[0].token;

    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const resets = readDB('passwordResets.json');
    expect(resets.length).toBe(1);
    expect(resets[0].token).not.toBe(first);
  });
});

// ════════════════════════════════════════════════════════════════════
// FP-02 — Réinitialisation du mot de passe
// ════════════════════════════════════════════════════════════════════
describe('FP-02 — Réinitialisation du mot de passe (reset-password)', () => {
  let resetToken;

  beforeEach(async () => {
    // Obtenir un token frais avant chaque test
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    resetToken = readDB('passwordResets.json')[0]?.token;

    // Remettre le mot de passe d'origine (en cas de modification par un test précédent)
    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(PWD, 10);
    const list = JSON.parse(fs.readFileSync(path.join(TEST_DB_DIR, 'enterprises.json'), 'utf8'));
    const idx = list.findIndex(e => e.email === entEmail);
    if (idx !== -1) { list[idx].password = hashed; }
    fs.writeFileSync(path.join(TEST_DB_DIR, 'enterprises.json'), JSON.stringify(list, null, 2));
  });

  test('✅ Réinitialisation réussie avec token valide', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  test('✅ Connexion avec le NOUVEAU mot de passe après reset', async () => {
    await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });

    const login = await request(app).post('/api/login').send({
      type: 'enterprise', email: entEmail, password: NEW_PWD,
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
  });

  test('❌ Connexion avec l\'ANCIEN mot de passe échoue après reset', async () => {
    await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });

    const login = await request(app).post('/api/login').send({
      type: 'enterprise', email: entEmail, password: PWD,
    });
    expect(login.status).toBe(401);
  });

  test('❌ Token invalidé après utilisation (ne peut pas resservir)', async () => {
    await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });

    const res2 = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'AnotherPwd1!' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toMatch(/invalide|utilisé/i);
  });

  test('❌ Token invalide → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: 'faux-token-inexistant', newPassword: NEW_PWD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test('❌ Token expiré → 400', async () => {
    // Forcer l'expiration dans la base
    const resets = readDB('passwordResets.json');
    resets[0].expiresAt = new Date(Date.now() - 1000).toISOString(); // déjà expiré
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), JSON.stringify(resets, null, 2));

    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expir/i);
  });

  test('❌ Token expiré supprimé de la base', async () => {
    const resets = readDB('passwordResets.json');
    resets[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), JSON.stringify(resets, null, 2));

    await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });

    expect(readDB('passwordResets.json').length).toBe(0);
  });

  test('❌ Mot de passe faible → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: WEAK_PWD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/faible|mot de passe/i);
  });

  test('❌ Sans token → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ newPassword: NEW_PWD });
    expect(res.status).toBe(400);
  });

  test('❌ Sans nouveau mot de passe → 400', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// FP-03 — Récupération compte restaurant
// ════════════════════════════════════════════════════════════════════
describe('FP-03 — Récupération compte restaurant', () => {
  let resetToken;

  beforeAll(async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: rstoEmail });
    await new Promise(r => setImmediate(r));
    resetToken = readDB('passwordResets.json')[0]?.token;
  });

  test('✅ Token généré pour le restaurant', () => {
    expect(resetToken).toBeDefined();
    const entry = readDB('passwordResets.json')[0];
    expect(entry.role).toBe('restaurant');
    expect(entry.email).toBe(rstoEmail);
  });

  test('✅ Reset mot de passe restaurant réussi', async () => {
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: NEW_PWD });
    expect(res.status).toBe(200);
  });

  test('✅ Connexion restaurant avec nouveau mot de passe', async () => {
    const login = await request(app).post('/api/login').send({
      type: 'restaurant', email: rstoEmail, password: NEW_PWD,
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeDefined();
    expect(login.body.user.role).toBe('restauratrice');
  });

  test('❌ Connexion restaurant avec ancien mot de passe échoue', async () => {
    const login = await request(app).post('/api/login').send({
      type: 'restaurant', email: rstoEmail, password: PWD,
    });
    expect(login.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// FP-04 — Sécurité et cas limites
// ════════════════════════════════════════════════════════════════════
describe('FP-04 — Sécurité', () => {
  test('✅ Email en majuscules accepté (insensible à la casse)', async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: entEmail.toUpperCase() });
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r));
    // Le token doit être généré malgré la casse différente
    const resets = readDB('passwordResets.json');
    expect(resets.length).toBe(1);
  });

  test('✅ Réponse identique email connu / inconnu (anti-énumération)', async () => {
    const r1 = await request(app).post('/api/auth/forgot-password')
      .send({ email: entEmail });
    const r2 = await request(app).post('/api/auth/forgot-password')
      .send({ email: 'fantome@nul.com' });
    expect(r1.status).toBe(r2.status);
    expect(r1.body.message).toBe(r2.body.message);
  });

  test('✅ Le token n\'apparaît pas dans la réponse HTTP', async () => {
    const res = await request(app).post('/api/auth/forgot-password')
      .send({ email: entEmail });
    expect(JSON.stringify(res.body)).not.toMatch(/token/i);
  });

  test('✅ Ancien token invalidé quand nouvelle demande faite', async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const oldToken = readDB('passwordResets.json')[0].token;

    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));

    // Essayer d'utiliser l'ancien token
    const res = await request(app).post('/api/auth/reset-password')
      .send({ token: oldToken, newPassword: NEW_PWD });
    expect(res.status).toBe(400);
  });

  test('✅ Token supprimé de la base après reset réussi', async () => {
    fs.writeFileSync(path.join(TEST_DB_DIR, 'passwordResets.json'), '[]');
    await request(app).post('/api/auth/forgot-password').send({ email: entEmail });
    await new Promise(r => setImmediate(r));
    const token = readDB('passwordResets.json')[0].token;

    await request(app).post('/api/auth/reset-password')
      .send({ token, newPassword: NEW_PWD });

    expect(readDB('passwordResets.json').length).toBe(0);
  });
});
