// ═══════════════════════════════════════════════════════════════════
// tests/email.test.js — Tests envoi d'emails (nodemailer)
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

// 1. Charger .env avant tout
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 2. Isoler la base de données
const TEST_DB_DIR = path.join(__dirname, 'test-data-email');
process.env.DB_DIR = TEST_DB_DIR;

// 3. Capturer le mock nodemailer pour espionner sendMail
let mockSendMail;
jest.mock('nodemailer', () => {
  mockSendMail = jest.fn().mockResolvedValue({ messageId: 'mock-id' });
  return {
    createTransport: () => ({ sendMail: mockSendMail }),
  };
});

const request = require('supertest');
const app     = require('../server');

const DATA_FILES = [
  'enterprises.json', 'employees.json', 'restauratrices.json',
  'menus.json', 'dailyMenus.json', 'affiliations.json', 'offers.json',
  'choices.json', 'orders.json', 'subscriptions.json',
  'notifications.json', 'ratings.json', 'deletionRequests.json',
  'messages.json',
];

function resetDB() {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => {
    fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]');
  });
}

beforeEach(() => {
  resetDB();
  mockSendMail.mockClear();
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// Mot de passe fort requis par validatePassword (8+ car., maj, min, chiffre, spécial)
const PWD = 'Pass1234!';

// ════════════════════════════════════════════════════════════════════
// EMAIL-01 — Inscription entreprise
// ════════════════════════════════════════════════════════════════════
describe('EMAIL-01 — Inscription entreprise', () => {
  test('✅ sendMail appelé après inscription entreprise', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      companyName: 'Acme Corp',
      email: 'acme@test.com',
      password: PWD,
      phone: '0600000001',
      location: 'Paris',
    });
    expect(res.status).toBe(201);

    // Laisser la promesse async se résoudre
    await new Promise(r => setImmediate(r));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('✅ Email envoyé à la bonne adresse', async () => {
    await request(app).post('/api/enterprise/register').send({
      companyName: 'Bêta SA',
      email: 'beta@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('beta@test.com');
  });

  test('✅ Sujet contient le nom de l\'entreprise', async () => {
    await request(app).post('/api/enterprise/register').send({
      companyName: 'Gamma SARL',
      email: 'gamma@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain('Gamma SARL');
  });

  test('✅ Corps HTML contient le nom et le rôle Entreprise', async () => {
    await request(app).post('/api/enterprise/register').send({
      companyName: 'Delta Inc',
      email: 'delta@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.html).toContain('Delta Inc');
    expect(call.html).toContain('Entreprise');
  });

  test('✅ Expéditeur configuré depuis MAIL_FROM', async () => {
    await request(app).post('/api/enterprise/register').send({
      companyName: 'Epsilon Ltd',
      email: 'epsilon@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe(process.env.MAIL_FROM);
  });
});

// ════════════════════════════════════════════════════════════════════
// EMAIL-02 — Inscription restaurant
// ════════════════════════════════════════════════════════════════════
describe('EMAIL-02 — Inscription restaurant', () => {
  test('✅ sendMail appelé après inscription restaurant', async () => {
    const res = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Le Bon Goût',
      fullName: 'Marie Dupont',
      email: 'lebongout@test.com',
      password: PWD,
      phone: '0600000002',
      address: '12 rue de la Paix, Paris',
    });
    expect(res.status).toBe(201);
    await new Promise(r => setImmediate(r));

    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  test('✅ Email envoyé à la bonne adresse', async () => {
    await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Chez Zara',
      fullName: 'Zara Ali',
      email: 'chezzara@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('chezzara@test.com');
  });

  test('✅ Sujet contient le nom du restaurant', async () => {
    await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'La Table Ronde',
      fullName: 'Jean Valjean',
      email: 'tableronde@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.subject).toContain('La Table Ronde');
  });

  test('✅ Corps HTML contient le nom et le rôle Restaurant', async () => {
    await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Saveurs du Monde',
      fullName: 'Pierre Martin',
      email: 'saveurs@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    const call = mockSendMail.mock.calls[0][0];
    expect(call.html).toContain('Saveurs du Monde');
    expect(call.html).toContain('Restaurant');
  });
});

// ════════════════════════════════════════════════════════════════════
// EMAIL-03 — Robustesse (email fail ne bloque pas l'inscription)
// ════════════════════════════════════════════════════════════════════
describe('EMAIL-03 — Robustesse', () => {
  test('✅ Inscription réussie même si sendMail échoue', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP error'));

    const res = await request(app).post('/api/enterprise/register').send({
      companyName: 'Resilient Corp',
      email: 'resilient@test.com',
      password: PWD,
    });

    // L'inscription doit réussir malgré l'erreur email
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
  });

  test('✅ Pas de double envoi si même email enregistré deux fois', async () => {
    await request(app).post('/api/enterprise/register').send({
      companyName: 'Unique Corp',
      email: 'unique@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));
    const firstCount = mockSendMail.mock.calls.length;
    expect(firstCount).toBe(1);

    // Deuxième tentative avec même email → 409, pas de nouvel email
    const res2 = await request(app).post('/api/enterprise/register').send({
      companyName: 'Unique Corp',
      email: 'unique@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));
    expect(res2.status).toBe(409);
    expect(mockSendMail.mock.calls.length).toBe(1); // toujours 1, pas de 2ème envoi
  });

  test('✅ Pas d\'email envoyé lors de la connexion', async () => {
    // Créer un compte
    await request(app).post('/api/enterprise/register').send({
      companyName: 'LoginTest Corp',
      email: 'logintest@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));
    mockSendMail.mockClear();

    // Se connecter → aucun email envoyé
    const res = await request(app).post('/api/login').send({
      type: 'enterprise',
      email: 'logintest@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    expect(res.status).toBe(200);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('✅ Pas d\'email envoyé si inscription échoue (champs manquants)', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      // companyName manquant
      email: 'incomplete@test.com',
      password: PWD,
    });
    await new Promise(r => setImmediate(r));

    expect(res.status).toBe(400);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
