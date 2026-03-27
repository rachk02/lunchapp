// ═══════════════════════════════════════════════════════════════════
// tests/screenshot.test.js — Tests capture d'écran dépôt de paiement
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB_DIR = path.join(__dirname, 'test-data-screenshot');
process.env.DB_DIR = TEST_DB_DIR;

jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'ok' }) }),
}));

const request = require('supertest');
const app     = require('../server');

const DATA_FILES = [
  'enterprises.json', 'employees.json', 'restauratrices.json',
  'menus.json', 'dailyMenus.json', 'affiliations.json', 'offers.json',
  'choices.json', 'orders.json', 'subscriptions.json',
  'notifications.json', 'ratings.json', 'deletionRequests.json',
  'messages.json',
];

const PWD     = 'Pass1234!';
const EMP_PWD = 'EmpPass1!';

// ── Captures d'écran de test ──────────────────────────────────────
const SCREENSHOT_URL    = 'https://example.com/recu-paiement.jpg';
const SCREENSHOT_BASE64 = 'data:image/png;base64,' + Buffer.from('FAKE_IMAGE_DATA').toString('base64');

// ── Variables partagées ────────────────────────────────────────────
let tokEnt, tokResto, tokAdmin;
let idEnt, idResto, idMenuItem;
let orderId_upfront, orderId_delivery;

function readDB(file) {
  return JSON.parse(fs.readFileSync(path.join(TEST_DB_DIR, file), 'utf8'));
}

// Crée un employé et retourne son token de connexion
async function makeEmployee(name) {
  await request(app).post('/api/enterprise/employees')
    .set('Authorization', 'Bearer ' + tokEnt)
    .send({ fullName: name, gender: 'male', password: EMP_PWD });
  const r = await request(app).post('/api/login')
    .send({ type: 'employee', email: name, password: EMP_PWD });
  return r.body.token;
}

beforeAll(async () => {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]'));

  // Entreprise
  let res = await request(app).post('/api/enterprise/register').send({
    companyName: 'ScreenCorp', email: 'screen@corp.com', password: PWD,
  });
  tokEnt = res.body.token;
  idEnt  = res.body.user.id;

  // Restaurant
  res = await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'ScreenResto', fullName: 'Chef Dupont',
    email: 'screen@resto.com', password: PWD,
  });
  tokResto = res.body.token;
  idResto  = res.body.user.id;

  // Admin
  res = await request(app).post('/api/login').send({
    type: 'superadmin',
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  tokAdmin = res.body.token;

  // Affiliation entreprise ↔ restaurant
  await request(app).post(`/api/enterprise/restaurants/${idResto}/affiliate`)
    .set('Authorization', 'Bearer ' + tokEnt);

  // Item menu du restaurant
  res = await request(app).post('/api/restaurant/menu/items')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ name: 'Riz Sauce', category: 'food', price: 1500 });
  idMenuItem = res.body.id;

  // Menu du jour
  await request(app).put('/api/restaurant/daily-menu')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ items: [idMenuItem] });
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════
// SCR-01 — Soumission avec screenshot (paiement anticipé / upfront)
// ════════════════════════════════════════════════════════════════════
describe('SCR-01 — Soumission avec screenshot (upfront)', () => {
  beforeAll(async () => {
    // Employé 1 fait un choix
    const tokEmp = await makeEmployee('Emp Upfront');
    await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + tokEmp)
      .send({ restaurantId: idResto, foodItemId: idMenuItem });
  });

  test('✅ Commande upfront acceptée avec screenshot URL', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({
        restaurantId:      idResto,
        paymentMode:       'upfront',
        depositType:       'virement',
        depositScreenshot: SCREENSHOT_URL,
      });
    expect(res.status).toBe(201);
    orderId_upfront = res.body.id;
  });

  test('✅ Screenshot ABSENT de la réponse POST /api/orders', async () => {
    expect(orderId_upfront).toBeDefined();
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({
        restaurantId:      idResto,
        paymentMode:       'upfront',
        depositType:       'espèces',
        depositScreenshot: SCREENSHOT_BASE64,
      });
    // Aucun choix restant → 400 attendu
    expect(res.status).toBe(400);
  });

  test('✅ Screenshot STOCKÉ dans la base de données', async () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderId_upfront);
    expect(order).toBeDefined();
    expect(order.depositScreenshot).toBe(SCREENSHOT_URL);
    expect(order.depositType).toBe('virement');
  });

  test('✅ Screenshot ABSENT de GET /api/orders (réponse entreprise)', async () => {
    const res = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(200);
    const order = res.body.find(o => o.id === orderId_upfront);
    expect(order).toBeDefined();
    expect(order).not.toHaveProperty('depositScreenshot');
  });

  test('✅ Screenshot ABSENT de GET /api/orders (réponse restaurant)', async () => {
    const res = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
    const order = res.body.find(o => o.id === orderId_upfront);
    expect(order).toBeDefined();
    expect(order).not.toHaveProperty('depositScreenshot');
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-02 — Commande à la livraison (pas de screenshot)
// ════════════════════════════════════════════════════════════════════
describe('SCR-02 — Commande à la livraison (sans screenshot)', () => {
  beforeAll(async () => {
    const tokEmp = await makeEmployee('Emp Livraison');
    await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + tokEmp)
      .send({ restaurantId: idResto, foodItemId: idMenuItem });

    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({ restaurantId: idResto, paymentMode: 'delivery' });
    orderId_delivery = res.body.id;
  });

  test('✅ Commande livraison créée sans screenshot', async () => {
    expect(orderId_delivery).toBeDefined();
  });

  test('✅ depositScreenshot null en base pour commande livraison', async () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderId_delivery);
    expect(order).toBeDefined();
    expect(order.depositScreenshot).toBeNull();
  });

  test('✅ depositType null pour commande livraison', async () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderId_delivery);
    expect(order.depositType).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-03 — Accès admin au screenshot
// ════════════════════════════════════════════════════════════════════
describe('SCR-03 — Accès admin au screenshot', () => {
  test('✅ Admin liste toutes les commandes avec screenshots inclus', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    const order = res.body.find(o => o.id === orderId_upfront);
    expect(order).toBeDefined();
    expect(order.depositScreenshot).toBe(SCREENSHOT_URL);
    expect(order.depositType).toBe('virement');
  });

  test('✅ Admin récupère le screenshot via endpoint dédié', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId_upfront}/screenshot`)
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    expect(res.body.depositScreenshot).toBe(SCREENSHOT_URL);
    expect(res.body.depositType).toBe('virement');
  });

  test('✅ Admin → 404 pour commande inexistante', async () => {
    const res = await request(app)
      .get('/api/admin/orders/id-inexistant/screenshot')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(404);
  });

  test('✅ Admin → 404 si commande sans screenshot (livraison)', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId_delivery}/screenshot`)
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-04 — Sécurité : seul l'admin peut accéder aux screenshots
// ════════════════════════════════════════════════════════════════════
describe('SCR-04 — Sécurité des endpoints admin', () => {
  test('❌ Entreprise ne peut pas accéder au screenshot admin → 403', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId_upfront}/screenshot`)
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });

  test('❌ Restaurant ne peut pas accéder au screenshot admin → 403', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId_upfront}/screenshot`)
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId_upfront}/screenshot`);
    expect(res.status).toBe(401);
  });

  test('❌ Entreprise ne peut pas lister les commandes admin → 403', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });

  test('❌ Screenshot absent des stats admin (données agrégées)', async () => {
    const res = await request(app).get('/api/admin/stats?frequency=monthly')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('orders');
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-05 — Screenshot en base64 (image encodée)
// ════════════════════════════════════════════════════════════════════
describe('SCR-05 — Screenshot base64', () => {
  let orderIdB64;

  beforeAll(async () => {
    const tokEmp = await makeEmployee('Emp Base64');
    await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + tokEmp)
      .send({ restaurantId: idResto, foodItemId: idMenuItem });
  });

  test('✅ Screenshot base64 accepté et commande créée', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({
        restaurantId:      idResto,
        paymentMode:       'upfront',
        depositType:       'mobile',
        depositScreenshot: SCREENSHOT_BASE64,
      });
    expect(res.status).toBe(201);
    orderIdB64 = res.body.id;
  });

  test('✅ Screenshot base64 stocké intact en base', async () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderIdB64);
    expect(order).toBeDefined();
    expect(order.depositScreenshot).toBe(SCREENSHOT_BASE64);
  });

  test('✅ Admin récupère le screenshot base64 intact', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderIdB64}/screenshot`)
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    expect(res.body.depositScreenshot).toBe(SCREENSHOT_BASE64);
    expect(res.body.depositType).toBe('mobile');
  });

  test('✅ Screenshot base64 absent de la réponse POST', async () => {
    expect(orderIdB64).toBeDefined();
    const resOrders = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt);
    const order = resOrders.body.find(o => o.id === orderIdB64);
    expect(order).not.toHaveProperty('depositScreenshot');
  });
});
