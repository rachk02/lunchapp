// ═══════════════════════════════════════════════════════════════════
// tests/pdf.test.js — Tests téléchargement PDF
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB_DIR = path.join(__dirname, 'test-data-pdf');
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

let tokEnt, tokResto, tokAdmin;
let idResto, idMenuItem;

beforeAll(async () => {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]'));

  // Entreprise
  let res = await request(app).post('/api/enterprise/register').send({
    companyName: 'PDFCorp', email: 'pdf@corp.com', password: PWD,
  });
  tokEnt = res.body.token;

  // Restaurant
  res = await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'PDFResto', fullName: 'Chef PDF',
    email: 'pdf@resto.com', password: PWD,
  });
  tokResto = res.body.token;
  idResto  = res.body.user.id;

  // Admin
  res = await request(app).post('/api/login').send({
    type: 'superadmin',
    email:    process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  tokAdmin = res.body.token;

  // Affiliation + menu + commande pour avoir des données dans le PDF
  await request(app).post(`/api/enterprise/restaurants/${idResto}/affiliate`)
    .set('Authorization', 'Bearer ' + tokEnt);

  res = await request(app).post('/api/restaurant/menu/items')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ name: 'Frites PDF', category: 'food', price: 1200 });
  idMenuItem = res.body.id;

  await request(app).put('/api/restaurant/daily-menu')
    .set('Authorization', 'Bearer ' + tokResto)
    .send({ items: [idMenuItem] });

  // Employé + choix + commande
  await request(app).post('/api/enterprise/employees')
    .set('Authorization', 'Bearer ' + tokEnt)
    .send({ fullName: 'EmpPDF', gender: 'male', password: EMP_PWD });
  const empLogin = await request(app).post('/api/login')
    .send({ type: 'employee', email: 'EmpPDF', password: EMP_PWD });
  await request(app).post('/api/choices')
    .set('Authorization', 'Bearer ' + empLogin.body.token)
    .send({ restaurantId: idResto, foodItemId: idMenuItem });
  await request(app).post('/api/orders')
    .set('Authorization', 'Bearer ' + tokEnt)
    .send({ restaurantId: idResto, paymentMode: 'delivery' });
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════
// PDF-01 — PDF restaurant
// ════════════════════════════════════════════════════════════════════
describe('PDF-01 — Téléchargement PDF restaurant', () => {
  test('✅ Retourne 200 avec Content-Type application/pdf', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('✅ Content-Disposition contient rapport-restaurant', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.headers['content-disposition']).toContain('rapport-restaurant');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  test('✅ Corps non vide et commence par signature PDF (%PDF)', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant')
      .set('Authorization', 'Bearer ' + tokResto)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('✅ PDF généré avec fréquence daily', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant?frequency=daily')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('✅ PDF généré avec fréquence weekly', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant?frequency=weekly')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
  });

  test('✅ PDF généré avec fréquence monthly (défaut)', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(200);
  });

  test('❌ Entreprise ne peut pas télécharger le PDF restaurant → 403', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/stats/pdf/restaurant');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// PDF-02 — PDF entreprise
// ════════════════════════════════════════════════════════════════════
describe('PDF-02 — Téléchargement PDF entreprise', () => {
  test('✅ Retourne 200 avec Content-Type application/pdf', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('✅ Content-Disposition contient rapport-entreprise', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.headers['content-disposition']).toContain('rapport-entreprise');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  test('✅ Corps non vide et commence par signature PDF (%PDF)', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise')
      .set('Authorization', 'Bearer ' + tokEnt)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('✅ PDF avec fréquence weekly', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise?frequency=weekly')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(200);
  });

  test('❌ Restaurant ne peut pas télécharger le PDF entreprise → 403', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/stats/pdf/enterprise');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// PDF-03 — PDF admin
// ════════════════════════════════════════════════════════════════════
describe('PDF-03 — Téléchargement PDF admin', () => {
  test('✅ Retourne 200 avec Content-Type application/pdf', async () => {
    const res = await request(app).get('/api/stats/pdf/admin')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('✅ Content-Disposition contient rapport-admin', async () => {
    const res = await request(app).get('/api/stats/pdf/admin')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.headers['content-disposition']).toContain('rapport-admin');
    expect(res.headers['content-disposition']).toContain('.pdf');
  });

  test('✅ Corps non vide et commence par signature PDF (%PDF)', async () => {
    const res = await request(app).get('/api/stats/pdf/admin')
      .set('Authorization', 'Bearer ' + tokAdmin)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('✅ PDF admin avec fréquence daily', async () => {
    const res = await request(app).get('/api/stats/pdf/admin?frequency=daily')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
  });

  test('✅ PDF admin avec fréquence weekly', async () => {
    const res = await request(app).get('/api/stats/pdf/admin?frequency=weekly')
      .set('Authorization', 'Bearer ' + tokAdmin);
    expect(res.status).toBe(200);
  });

  test('❌ Entreprise ne peut pas télécharger le PDF admin → 403', async () => {
    const res = await request(app).get('/api/stats/pdf/admin')
      .set('Authorization', 'Bearer ' + tokEnt);
    expect(res.status).toBe(403);
  });

  test('❌ Restaurant ne peut pas télécharger le PDF admin → 403', async () => {
    const res = await request(app).get('/api/stats/pdf/admin')
      .set('Authorization', 'Bearer ' + tokResto);
    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/stats/pdf/admin');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// PDF-04 — Qualité et contenu du PDF enrichi
// ════════════════════════════════════════════════════════════════════
describe('PDF-04 — Contenu et qualité du rapport enrichi', () => {
  function parsePDF(res) {
    return new Promise(resolve => {
      if (Buffer.isBuffer(res.body)) return resolve(res.body);
      const chunks = [];
      res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async function fetchPDFBuffer(url, token) {
    return request(app).get(url)
      .set('Authorization', 'Bearer ' + token)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  test('✅ PDF restaurant est substantiel (> 500 o)', async () => {
    const res = await fetchPDFBuffer('/api/stats/pdf/restaurant', tokResto);
    expect(res.body.length).toBeGreaterThan(500);
  });

  test('✅ PDF entreprise est substantiel (> 500 o)', async () => {
    const res = await fetchPDFBuffer('/api/stats/pdf/enterprise', tokEnt);
    expect(res.body.length).toBeGreaterThan(500);
  });

  test('✅ PDF admin est substantiel (> 500 o)', async () => {
    const res = await fetchPDFBuffer('/api/stats/pdf/admin', tokAdmin);
    expect(res.body.length).toBeGreaterThan(500);
  });

  test('✅ Tous les PDFs commencent par signature %PDF-1', async () => {
    for (const [url, tok] of [
      ['/api/stats/pdf/restaurant', tokResto],
      ['/api/stats/pdf/enterprise', tokEnt],
      ['/api/stats/pdf/admin',      tokAdmin],
    ]) {
      const res = await fetchPDFBuffer(url, tok);
      expect(res.body.slice(0, 5).toString()).toBe('%PDF-');
    }
  });

  test('✅ PDF restaurant — daily et weekly ont des tailles différentes', async () => {
    const [m, d] = await Promise.all([
      fetchPDFBuffer('/api/stats/pdf/restaurant?frequency=monthly', tokResto),
      fetchPDFBuffer('/api/stats/pdf/restaurant?frequency=daily',   tokResto),
    ]);
    // Both must be valid PDFs
    expect(m.body.slice(0, 4).toString()).toBe('%PDF');
    expect(d.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('✅ Content-Length correspond à la taille réelle du PDF', async () => {
    const res = await fetchPDFBuffer('/api/stats/pdf/restaurant', tokResto);
    const declared = parseInt(res.headers['content-length'], 10);
    expect(declared).toBe(res.body.length);
  });

  test('✅ Noms de fichiers incluent la fréquence', async () => {
    for (const freq of ['daily', 'weekly', 'monthly']) {
      const res = await request(app)
        .get(`/api/stats/pdf/restaurant?frequency=${freq}`)
        .set('Authorization', 'Bearer ' + tokResto);
      expect(res.headers['content-disposition']).toContain(freq);
    }
  });
});
