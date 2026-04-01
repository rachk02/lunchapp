// ═══════════════════════════════════════════════════════════════════
// tests/screenshot.test.js — Tests commandes (paiement à la livraison)
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
  'messages.json', 'invoices.json',
];

const PWD     = 'Pass1234!';
const EMP_PWD = 'EmpPass1!';

let tokEnt, tokResto, tokAdmin;
let idEnt, idResto, idMenuItem;
let orderId1, orderId2;

function readDB(file) {
  return JSON.parse(fs.readFileSync(path.join(TEST_DB_DIR, file), 'utf8'));
}

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

  let res = await request(app).post('/api/enterprise/register').send({
    companyName: 'ScreenCorp', email: 'screen@corp.com', password: PWD,
  });
  tokEnt = res.body.token;
  idEnt  = res.body.user.id;

  res = await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'ScreenResto', fullName: 'Chef Dupont',
    email: 'screen@resto.com', password: PWD,
  });
  tokResto = res.body.token;
  idResto  = res.body.user.id;

  res = await request(app).post('/api/login').send({
    type: 'superadmin',
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  tokAdmin = res.body.token;

  await request(app).post(`/api/enterprise/restaurants/${idResto}/affiliate`)
    .set('Authorization', 'Bearer ' + tokEnt);

  res = await request(app).post('/api/restaurant/menu/items')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ name: 'Riz Sauce', category: 'food', price: 1500 });
  idMenuItem = res.body.id;

  await request(app).put('/api/restaurant/daily-menu')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ items: [idMenuItem] });
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════
// SCR-01 — Commande à la livraison (seul mode disponible)
// ════════════════════════════════════════════════════════════════════
describe('SCR-01 — Commande à la livraison', () => {
  beforeAll(async () => {
    const tokEmp = await makeEmployee('Emp Livraison 1');
    await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + tokEmp)
      .send({ restaurantId: idResto, foodItemId: idMenuItem });
  });

  test('✅ Commande créée avec paiement à la livraison', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({ restaurantId: idResto });
    expect(res.status).toBe(201);
    expect(res.body.paymentMode).toBe('delivery');
    orderId1 = res.body.id;
  });

  test('✅ paymentMode = delivery en base', async () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderId1);
    expect(order).toBeDefined();
    expect(order.paymentMode).toBe('delivery');
  });

  test('✅ Commande visible via GET /api/orders (entreprise)', async () => {
    const res = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(200);
    const order = res.body.find(o => o.id === orderId1);
    expect(order).toBeDefined();
    expect(order.paymentMode).toBe('delivery');
  });

  test('✅ Commande visible via GET /api/orders (restaurant)', async () => {
    const res = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
    const order = res.body.find(o => o.id === orderId1);
    expect(order).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-02 — Seconde commande pour un autre restaurant
// ════════════════════════════════════════════════════════════════════
describe('SCR-02 — Deuxième commande', () => {
  beforeAll(async () => {
    const tokEmp = await makeEmployee('Emp Livraison 2');
    await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + tokEmp)
      .send({ restaurantId: idResto, foodItemId: idMenuItem });

    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({ restaurantId: idResto });
    orderId2 = res.body.id;
  });

  test('✅ Deux commandes en base', () => {
    const orders = readDB('orders.json');
    expect(orders.length).toBeGreaterThanOrEqual(2);
  });

  test('✅ paymentMode toujours delivery', async () => {
    const orders = readDB('orders.json');
    orders.forEach(o => expect(o.paymentMode).toBe('delivery'));
  });

  test('✅ Aucune commande sans choix → 400', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + tokEnt)
      .send({ restaurantId: idResto });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-03 — Accès admin aux commandes
// ════════════════════════════════════════════════════════════════════
describe('SCR-03 — Accès admin aux commandes', () => {
  test('✅ Admin liste toutes les commandes', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test('✅ Commande admin contient totalAmount et items', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokAdmin);
    const order = res.body.find(o => o.id === orderId1);
    expect(order).toBeDefined();
    expect(order).toHaveProperty('totalAmount');
    expect(Array.isArray(order.items)).toBe(true);
  });

  test('✅ Admin screenshot endpoint → 404 (pas de screenshot en livraison)', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId1}/screenshot`)
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(404);
  });

  test('✅ Admin → 404 pour commande inexistante', async () => {
    const res = await request(app)
      .get('/api/admin/orders/id-inexistant/screenshot')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-04 — Sécurité : endpoints admin
// ════════════════════════════════════════════════════════════════════
describe('SCR-04 — Sécurité des endpoints admin', () => {
  test('❌ Entreprise ne peut pas accéder aux commandes admin → 403', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });

  test('❌ Restaurant ne peut pas accéder aux commandes admin → 403', async () => {
    const res = await request(app).get('/api/admin/orders')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/admin/orders');
    expect(res.status).toBe(401);
  });

  test('❌ Entreprise ne peut pas accéder au screenshot admin → 403', async () => {
    const res = await request(app)
      .get(`/api/admin/orders/${orderId1}/screenshot`)
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// SCR-05 — Workflow statut commande
// ════════════════════════════════════════════════════════════════════
describe('SCR-05 — Workflow statut commande', () => {
  test('✅ Commande commence en pending', () => {
    const orders = readDB('orders.json');
    const order  = orders.find(o => o.id === orderId1);
    expect(order.status).toBe('pending');
  });

  test('✅ Restaurant accuse réception → confirmed', async () => {
    const res = await request(app)
      .put(`/api/orders/${orderId1}/status`)
      .set('Authorization', 'Bearer ' + tokResto)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  test('✅ Restaurant passe en préparation → preparing', async () => {
    const res = await request(app)
      .put(`/api/orders/${orderId1}/status`)
      .set('Authorization', 'Bearer ' + tokResto)
      .send({ status: 'preparing' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('preparing');
  });

  test('✅ Restaurant livre → delivered', async () => {
    const res = await request(app)
      .put(`/api/orders/${orderId1}/status`)
      .set('Authorization', 'Bearer ' + tokResto)
      .send({ status: 'delivered' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('delivered');
  });

  test('❌ Statut invalide → 400', async () => {
    const res = await request(app)
      .put(`/api/orders/${orderId1}/status`)
      .set('Authorization', 'Bearer ' + tokResto)
      .send({ status: 'unknown' });
    expect(res.status).toBe(400);
  });
});
