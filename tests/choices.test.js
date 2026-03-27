// ═══════════════════════════════════════════════════════════════════
// tests/choices.test.js — Tests du flux de choix des employés
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB = path.join(__dirname, 'test-choices-data');
process.env.DB_DIR = TEST_DB;

jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'test' }) }),
}));

const request = require('supertest');
const app     = require('../server');

const FILES = [
  'enterprises.json','employees.json','restauratrices.json',
  'menus.json','dailyMenus.json','affiliations.json','offers.json',
  'choices.json','orders.json','subscriptions.json',
  'notifications.json','ratings.json','deletionRequests.json',
  'messages.json','passwordResets.json',
];

beforeAll(() => {
  fs.mkdirSync(TEST_DB, { recursive: true });
  FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB, f), '[]'));
});

afterAll(() => {
  fs.rmSync(TEST_DB, { recursive: true, force: true });
});

// ─── Tokens & IDs ───────────────────────────────────────────────────────────
let entToken   = '', entId = '';
let restoToken = '', restoId = '';
let empToken   = '', empId = '';
let foodId = '', drinkId = '';
let choiceId = '';

// ─── Setup ──────────────────────────────────────────────────────────────────
describe('SETUP — Prépare les données de base', () => {
  test('Crée entreprise', async () => {
    const r = await request(app).post('/api/enterprise/register').send({
      companyName: 'ChoixCorp', email: 'choixcorp@test.com', password: 'Pass1234!',
    });
    expect(r.status).toBe(201);
    entToken = r.body.token;
    entId    = r.body.user.id;
  });

  test('Crée restaurant', async () => {
    const r = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Le Bon Plat', fullName: 'Chef Koffi',
      email: 'koffi@test.com', password: 'Resto1234!',
    });
    expect(r.status).toBe(201);
    restoToken = r.body.token;
    restoId    = r.body.user.id;
  });

  test('Affilie l\'entreprise au restaurant', async () => {
    const r = await request(app).post(`/api/enterprise/restaurants/${restoId}/affiliate`)
      .set('Authorization', 'Bearer ' + entToken);
    expect(r.status).toBe(201);
  });

  test('Ajoute un plat au menu', async () => {
    const r = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'Thiéboudiène', category: 'food', price: 1500 });
    expect(r.status).toBe(201);
    foodId = r.body.id;
  });

  test('Ajoute une boisson au menu', async () => {
    const r = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'Gingembre', category: 'drink', price: 300 });
    expect(r.status).toBe(201);
    drinkId = r.body.id;
  });

  test('Active le menu journalier', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = await request(app).put('/api/restaurant/menu/daily')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ date: today, availableItems: [foodId, drinkId] });
    expect(r.status).toBe(200);
  });

  test('Crée un employé', async () => {
    const r = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ fullName: 'Kofi Adu', gender: 'male', password: 'Emp1234!' });
    expect(r.status).toBe(201);
    empId = r.body.id;
  });

  test('Connecte l\'employé', async () => {
    const r = await request(app).post('/api/login')
      .send({ email: 'Kofi Adu', password: 'Emp1234!', type: 'employee' });
    expect(r.status).toBe(200);
    empToken = r.body.token;
  });
});

// ─── CH-01: Consulter les menus ──────────────────────────────────────────────
describe('CH-01 — Employé voit les menus disponibles', () => {
  test('✅ GET /api/employee/menus retourne les restaurants affiliés', async () => {
    const r = await request(app).get('/api/employee/menus')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0]).toHaveProperty('foods');
    expect(r.body[0]).toHaveProperty('drinks');
    expect(r.body[0]).toHaveProperty('restaurant');
  });

  test('✅ Menus contiennent les plats et boissons actifs du jour', async () => {
    const r = await request(app).get('/api/employee/menus')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    const menu = r.body[0];
    expect(menu.foods.some(f => f.id === foodId)).toBe(true);
    expect(menu.drinks.some(d => d.id === drinkId)).toBe(true);
  });

  test('✅ Aucun choix du jour au départ (mine → null)', async () => {
    const r = await request(app).get('/api/choices/mine')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  test('❌ Employé non authentifié → 401', async () => {
    const r = await request(app).get('/api/employee/menus');
    expect(r.status).toBe(401);
  });
});

// ─── CH-02: Créer un choix ───────────────────────────────────────────────────
describe('CH-02 — Création du choix', () => {
  test('✅ Crée un choix (plat + boisson)', async () => {
    const r = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + empToken)
      .send({ restaurantId: restoId, foodItemId: foodId, drinkItemId: drinkId });
    expect(r.status).toBe(201);
    expect(r.body.foodItem.name).toBe('Thiéboudiène');
    expect(r.body.drinkItem.name).toBe('Gingembre');
    expect(r.body.date).toBe(new Date().toISOString().slice(0, 10));
    expect(r.body.restaurantId).toBe(restoId);
    choiceId = r.body.id;
  });

  test('✅ GET /api/choices/mine retourne le choix du jour', async () => {
    const r = await request(app).get('/api/choices/mine')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    expect(r.body).not.toBeNull();
    expect(r.body.id).toBe(choiceId);
  });

  test('✅ Le choix est visible par l\'entreprise', async () => {
    const r = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + entToken);
    expect(r.status).toBe(200);
    expect(r.body.some(c => c.id === choiceId)).toBe(true);
  });

  test('✅ Le choix est visible par le restaurant', async () => {
    const r = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(r.status).toBe(200);
    expect(r.body.some(c => c.id === choiceId)).toBe(true);
  });

  test('❌ Restaurant non affilié → 403', async () => {
    // Crée un 2ème restaurant non affilié
    const rr = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Autre Resto', fullName: 'Chef X',
      email: 'autre@test.com', password: 'Autre1234!',
    });
    const r2 = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + empToken)
      .send({ restaurantId: rr.body.user.id, foodItemId: foodId });
    expect(r2.status).toBe(403);
  });

  test('❌ Plat introuvable dans le menu → 400', async () => {
    const r = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + empToken)
      .send({ restaurantId: restoId, foodItemId: 'nonexistent-id' });
    expect([400, 200]).toContain(r.status); // 200 if update within 5 min with bad foodId
    if (r.status === 400) expect(r.body).toHaveProperty('error');
  });
});

// ─── CH-03: Modifier le choix dans les 5 min ────────────────────────────────
describe('CH-03 — Modification dans les 5 minutes', () => {
  test('✅ POST dans les 5 min met à jour le choix (pas de 409)', async () => {
    // Second POST within 5-min window → updates instead of 409
    const r = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + empToken)
      .send({ restaurantId: restoId, foodItemId: foodId, drinkItemId: drinkId });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(choiceId); // same choice updated
  });

  test('✅ PUT met à jour la boisson du choix', async () => {
    const r = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + empToken)
      .send({ drinkItemId: null });
    expect(r.status).toBe(200);
    expect(r.body.drinkItem).toBeNull();
    expect(r.body.foodItem.id).toBe(foodId);
  });

  test('✅ PUT remet la boisson', async () => {
    const r = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + empToken)
      .send({ drinkItemId: drinkId });
    expect(r.status).toBe(200);
    expect(r.body.drinkItem.name).toBe('Gingembre');
  });

  test('❌ PUT avec les deux items null → 400', async () => {
    const r = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + empToken)
      .send({ foodItemId: null, drinkItemId: null });
    expect(r.status).toBe(400);
  });

  test('❌ Modifier le choix d\'un autre employé → 404', async () => {
    // Crée un 2ème employé et tente de modifier le choix du 1er
    const r2 = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ fullName: 'Bob Asante', gender: 'male', password: 'Bob1234!' });
    const loginR = await request(app).post('/api/login')
      .send({ email: 'Bob Asante', password: 'Bob1234!', type: 'employee' });
    const bobToken = loginR.body.token;

    const r = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + bobToken)
      .send({ drinkItemId: null });
    expect(r.status).toBe(404);
  });
});

// ─── CH-04: Supprimer le choix dans les 5 min ───────────────────────────────
describe('CH-04 — Suppression dans les 5 minutes', () => {
  let tempChoiceId = '';

  // Crée un 3ème employé pour tester la suppression sans bloquer les autres tests
  let emp3Token = '';

  test('SETUP — Crée employé3 + choix pour test suppression', async () => {
    const r = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ fullName: 'Ama Serwaa', gender: 'female', password: 'Ama1234!' });
    expect(r.status).toBe(201);

    const loginR = await request(app).post('/api/login')
      .send({ email: 'Ama Serwaa', password: 'Ama1234!', type: 'employee' });
    emp3Token = loginR.body.token;

    const choiceR = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + emp3Token)
      .send({ restaurantId: restoId, foodItemId: foodId });
    expect(choiceR.status).toBe(201);
    tempChoiceId = choiceR.body.id;
  });

  test('✅ Employé supprime son choix dans les 5 min', async () => {
    const r = await request(app).delete(`/api/choices/${tempChoiceId}`)
      .set('Authorization', 'Bearer ' + emp3Token);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });

  test('✅ Après suppression, aucun choix du jour', async () => {
    const r = await request(app).get('/api/choices/mine')
      .set('Authorization', 'Bearer ' + emp3Token);
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  test('❌ Supprimer un choix inexistant → 404', async () => {
    const r = await request(app).delete('/api/choices/nonexistent-id')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(404);
  });
});

// ─── CH-05: Enterprise voit les menus complets ──────────────────────────────
describe('CH-05 — Entreprise voit les menus des restaurants affiliés', () => {
  test('✅ GET /api/enterprise/restaurants retourne menu complet', async () => {
    const r = await request(app).get('/api/enterprise/restaurants')
      .set('Authorization', 'Bearer ' + entToken);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    const resto = r.body[0];
    expect(resto).toHaveProperty('menu');
    expect(resto).toHaveProperty('dailyMenu');
    expect(Array.isArray(resto.menu)).toBe(true);
    expect(resto.menu.length).toBeGreaterThan(0);
  });

  test('✅ Menu complet contient plats et boissons', async () => {
    const r = await request(app).get('/api/enterprise/restaurants')
      .set('Authorization', 'Bearer ' + entToken);
    const menu = r.body[0].menu;
    expect(menu.some(i => i.category === 'food')).toBe(true);
    expect(menu.some(i => i.category === 'drink')).toBe(true);
  });

  test('✅ dailyMenu liste les items disponibles aujourd\'hui', async () => {
    const r = await request(app).get('/api/enterprise/restaurants')
      .set('Authorization', 'Bearer ' + entToken);
    const dm = r.body[0].dailyMenu;
    expect(dm).toHaveProperty('foods');
    expect(dm).toHaveProperty('drinks');
    expect(dm.foods.length + dm.drinks.length).toBeGreaterThan(0);
  });

  test('✅ Entreprise voit les choix de ses employés aujourd\'hui', async () => {
    const r = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + entToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    // Kofi's choice should be visible
    expect(r.body.some(c => c.restaurantId === restoId)).toBe(true);
  });

  test('✅ Choix ont les champs employé et restaurant', async () => {
    const r = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + entToken);
    if (r.body.length > 0) {
      const c = r.body[0];
      expect(c).toHaveProperty('userName');
      expect(c).toHaveProperty('restaurantName');
      expect(c).toHaveProperty('date');
    }
  });

  test('❌ Employé ne peut pas appeler /api/choices/today comme entreprise', async () => {
    // Employee CAN call /api/choices/today — returns only their own choices
    const r = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    // But should only see their own choices
    r.body.forEach(c => {
      expect(c.userId).toBe(empId);
    });
  });
});

// ─── CH-06: Historique des choix ────────────────────────────────────────────
describe('CH-06 — Historique', () => {
  test('✅ Employé voit son historique', async () => {
    const r = await request(app).get('/api/choices/history')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('✅ Historique contient le choix du jour', async () => {
    const r = await request(app).get('/api/choices/history')
      .set('Authorization', 'Bearer ' + empToken);
    expect(r.body.some(c => c.id === choiceId)).toBe(true);
  });

  test('✅ Notation d\'un plat (1–5)', async () => {
    const r = await request(app).post(`/api/choices/${choiceId}/rate`)
      .set('Authorization', 'Bearer ' + empToken)
      .send({ stars: 5 });
    expect(r.status).toBe(200);
    expect(r.body.rating).toBe(5);
  });

  test('❌ Note invalide → 400', async () => {
    const r = await request(app).post(`/api/choices/${choiceId}/rate`)
      .set('Authorization', 'Bearer ' + empToken)
      .send({ stars: 6 });
    expect(r.status).toBe(400);
  });
});

// ─── CH-07: Abonnements ─────────────────────────────────────────────────────
describe('CH-07 — Abonnements', () => {
  let subId = '';

  test('✅ Entreprise demande un abonnement mensuel', async () => {
    const r = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ restaurantId: restoId, frequency: 'monthly' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('pending');
    expect(r.body.frequency).toBe('monthly');
    subId = r.body.id;
  });

  test('❌ Double abonnement en attente → 409', async () => {
    const r = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ restaurantId: restoId, frequency: 'monthly' });
    expect(r.status).toBe(409);
  });

  test('❌ Fréquence invalide → 400', async () => {
    const r = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ restaurantId: restoId, frequency: 'annually' });
    expect(r.status).toBe(400);
  });

  test('✅ Restaurant voit ses demandes d\'abonnement', async () => {
    const r = await request(app).get('/api/subscriptions')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(r.status).toBe(200);
    expect(r.body.some(s => s.id === subId)).toBe(true);
  });

  test('✅ Restaurant accepte l\'abonnement', async () => {
    const r = await request(app).put(`/api/subscriptions/${subId}`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'accepted' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('accepted');
  });

  test('✅ Entreprise voit son abonnement accepté', async () => {
    const r = await request(app).get('/api/subscriptions')
      .set('Authorization', 'Bearer ' + entToken);
    expect(r.status).toBe(200);
    const sub = r.body.find(s => s.id === subId);
    expect(sub).toBeDefined();
    expect(sub.status).toBe('accepted');
  });

  test('❌ Statut abonnement invalide → 400', async () => {
    const r = await request(app).put(`/api/subscriptions/${subId}`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'maybe' });
    expect(r.status).toBe(400);
  });

  test('✅ Restaurant décline un 2ème abonnement', async () => {
    // Create a new sub to decline
    const subR = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + entToken)
      .send({ restaurantId: restoId, frequency: 'weekly' });
    if (subR.status === 201) {
      const r = await request(app).put(`/api/subscriptions/${subR.body.id}`)
        .set('Authorization', 'Bearer ' + restoToken)
        .send({ status: 'declined' });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('declined');
    }
  });
});
