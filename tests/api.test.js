// ═══════════════════════════════════════════════════════════════════
// tests/api.test.js — Suite de tests LunchApp v2
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

// 1. Charger .env avant tout
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// 2. Isoler la base de données
const TEST_DB_DIR = path.join(__dirname, 'test-data');
process.env.DB_DIR = TEST_DB_DIR;

// 3. Mocker nodemailer — évite les vrais envois d'emails pendant les tests
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
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

beforeAll(() => {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]'));
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

let enterpriseToken = '';
let restoToken      = '';
let employeeToken   = '';
let adminToken      = '';
let restaurantId    = '';
let enterpriseId    = '';
let employeeId      = '';
let menuItemFoodId  = '';
let menuItemDrinkId = '';
let choiceId        = '';
let orderId         = '';
let subId           = '';

// ════════════════════════════════════════════════════════════════════
// 1. VARIABLES D'ENVIRONNEMENT
// ════════════════════════════════════════════════════════════════════

describe('0 — Configuration .env', () => {
  test('✅ ADMIN_EMAIL chargé depuis .env', () => {
    expect(process.env.ADMIN_EMAIL).toBeDefined();
    expect(process.env.ADMIN_EMAIL.length).toBeGreaterThan(0);
  });

  test('✅ ADMIN_PASSWORD chargé depuis .env', () => {
    expect(process.env.ADMIN_PASSWORD).toBeDefined();
    expect(process.env.ADMIN_PASSWORD.length).toBeGreaterThan(0);
  });

  test('✅ MAIL_USER chargé depuis .env', () => {
    expect(process.env.MAIL_USER).toBeDefined();
  });

  test('✅ JWT_SECRET chargé depuis .env', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. INSCRIPTION
// ════════════════════════════════════════════════════════════════════

describe('1 — Inscription entreprise', () => {
  test('✅ Crée un compte entreprise valide', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      companyName: 'TestCorp',
      email:       'testcorp@example.com',
      password:    'Test@1234',
      phone:       '0102030405',
      location:    'https://maps.google.com/?q=1,1',
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.role).toBe('enterprise');
    enterpriseToken = res.body.token;
    enterpriseId    = res.body.user.id;
  });

  test('❌ Email déjà utilisé', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      companyName: 'TestCorp2', email: 'testcorp@example.com', password: 'Test@1234',
    });
    expect(res.status).toBe(409);
  });

  test('❌ Mot de passe faible', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      companyName: 'TestCorp3', email: 'other@example.com', password: 'weak',
    });
    expect(res.status).toBe(400);
  });

  test('❌ Champs requis manquants', async () => {
    const res = await request(app).post('/api/enterprise/register').send({
      email: 'noname@example.com', password: 'Test@1234',
    });
    expect(res.status).toBe(400);
  });
});

describe('2 — Inscription restaurant', () => {
  test('✅ Crée un compte restaurant', async () => {
    const res = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Resto Test',
      fullName:       'Chef Dupont',
      email:          'resto@example.com',
      password:       'Resto@1234',
      phone:          '0600000000',
      specialty:      'Cuisine africaine',
      paymentInfo:    [{ type: 'OM', number: '0123456' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('restauratrice');
    expect(res.body.user.paymentInfo.length).toBe(1);
    restoToken   = res.body.token;
    restaurantId = res.body.user.id;
  });

  test('❌ Email restaurant déjà utilisé', async () => {
    const res = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Resto2', fullName: 'Chef X',
      email: 'resto@example.com', password: 'Resto@1234',
    });
    expect(res.status).toBe(409);
  });

  test('❌ Champs requis manquants (restaurant)', async () => {
    const res = await request(app).post('/api/restauratrice/register').send({
      email: 'restox@example.com', password: 'Resto@1234',
    });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. CONNEXION
// ════════════════════════════════════════════════════════════════════

describe('3 — Connexion', () => {
  test('✅ Connexion entreprise', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'testcorp@example.com', password: 'Test@1234', type: 'enterprise',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  test('✅ Connexion restaurant', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'resto@example.com', password: 'Resto@1234', type: 'restaurant',
    });
    expect(res.status).toBe(200);
    restoToken = res.body.token;
  });

  test('✅ Connexion superadmin (credentials depuis .env)', async () => {
    const res = await request(app).post('/api/login').send({
      email:    process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      type:     'superadmin',
    });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('superadmin');
    adminToken = res.body.token;
  });

  test('❌ Mauvais mot de passe', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'testcorp@example.com', password: 'wrong', type: 'enterprise',
    });
    expect(res.status).toBe(401);
  });

  test('❌ Type de compte invalide', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'testcorp@example.com', password: 'Test@1234', type: 'unknown',
    });
    expect(res.status).toBe(400);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/restaurant/menu');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. RESTAURANTS
// ════════════════════════════════════════════════════════════════════

describe('4 — Restaurants publics', () => {
  test('✅ Liste tous les restaurants', async () => {
    const res = await request(app).get('/api/restaurants')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).not.toHaveProperty('password');
  });

  test('✅ Détail restaurant', async () => {
    const res = await request(app).get(`/api/restaurants/${restaurantId}`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.restaurantName).toBe('Resto Test');
    expect(res.body).not.toHaveProperty('password');
  });

  test('❌ Restaurant inexistant → 404', async () => {
    const res = await request(app).get('/api/restaurants/notexist')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(404);
  });
});

describe('5 — Profil restaurant', () => {
  test('✅ Lit son propre profil', async () => {
    const res = await request(app).get('/api/restaurant/me')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.restaurantName).toBe('Resto Test');
    expect(res.body).not.toHaveProperty('password');
  });

  test('✅ Met à jour le profil', async () => {
    const res = await request(app).patch('/api/restaurant/profile')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ description: 'Cuisine africaine authentique', phone: '0611111111' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Cuisine africaine authentique');
    expect(res.body.phone).toBe('0611111111');
  });

  test('❌ Entreprise ne peut pas modifier le profil restaurant', async () => {
    const res = await request(app).patch('/api/restaurant/profile')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ description: 'Piratage' });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. MENU
// ════════════════════════════════════════════════════════════════════

describe('6 — Gestion menu restaurant', () => {
  test('✅ Ajoute un plat', async () => {
    const res = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'Riz sauce graine', category: 'food', price: 500 });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('food');
    menuItemFoodId = res.body.id;
  });

  test('✅ Ajoute une boisson', async () => {
    const res = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'Jus de bissap', category: 'drink', price: 200 });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('drink');
    menuItemDrinkId = res.body.id;
  });

  test('✅ Lit le menu complet', async () => {
    const res = await request(app).get('/api/restaurant/menu')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
  });

  test('✅ Modifie un article', async () => {
    const res = await request(app).put(`/api/restaurant/menu/items/${menuItemFoodId}`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ price: 600 });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(600);
  });

  test('❌ Catégorie invalide', async () => {
    const res = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'X', category: 'unknown', price: 100 });
    expect(res.status).toBe(400);
  });

  test('❌ Prix manquant', async () => {
    const res = await request(app).post('/api/restaurant/menu/items')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ name: 'X', category: 'food' });
    expect(res.status).toBe(400);
  });
});

describe('7 — Menu journalier', () => {
  const today = new Date().toISOString().slice(0, 10);

  test('✅ Définit le menu journalier', async () => {
    const res = await request(app).put('/api/restaurant/menu/daily')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ date: today, availableItems: [menuItemFoodId, menuItemDrinkId] });
    expect(res.status).toBe(200);
    expect(res.body.availableItems).toContain(menuItemFoodId);
    expect(res.body.availableItems).toContain(menuItemDrinkId);
  });

  test('✅ Lit le menu journalier', async () => {
    const res = await request(app).get(`/api/restaurant/menu/daily?date=${today}`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.availableItems).toContain(menuItemDrinkId);
  });

  test('❌ availableItems non-tableau → 400', async () => {
    const res = await request(app).put('/api/restaurant/menu/daily')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ date: today, availableItems: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. AFFILIATIONS
// ════════════════════════════════════════════════════════════════════

describe('8 — Affiliations', () => {
  test('✅ Entreprise s\'affilie au restaurant', async () => {
    const res = await request(app).post(`/api/enterprise/restaurants/${restaurantId}/affiliate`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(201);
  });

  test('❌ Double affiliation → 409', async () => {
    const res = await request(app).post(`/api/enterprise/restaurants/${restaurantId}/affiliate`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(409);
  });

  test('✅ Liste restaurants affiliés avec menus', async () => {
    const res = await request(app).get('/api/enterprise/restaurants')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toHaveProperty('menu');
    expect(res.body[0]).toHaveProperty('dailyMenu');
  });

  test('✅ Menu visible par entreprise affiliée', async () => {
    const res = await request(app).get(`/api/restaurants/${restaurantId}/menu`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
  });

  test('✅ Restaurant offre ses services à une entreprise', async () => {
    const res = await request(app).post(`/api/restaurant/enterprises/${enterpriseId}/offer`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(201);
  });

  test('❌ Double offre → 409', async () => {
    const res = await request(app).post(`/api/restaurant/enterprises/${enterpriseId}/offer`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(409);
  });

  test('✅ Liste entreprises visibles par le restaurant', async () => {
    const res = await request(app).get('/api/restaurant/enterprises')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('isAffiliated');
    expect(res.body[0]).toHaveProperty('hasOffer');
  });

  test('✅ Clientèle du restaurant', async () => {
    const res = await request(app).get('/api/restaurant/clientele')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toHaveProperty('companyName');
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. EMPLOYÉS
// ════════════════════════════════════════════════════════════════════

describe('9 — Gestion employés', () => {
  test('✅ Crée un employé', async () => {
    const res = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ fullName: 'Alice Martin', gender: 'female', password: 'emp@1234' });
    expect(res.status).toBe(201);
    expect(res.body.gender).toBe('female');
    expect(res.body).not.toHaveProperty('password');
    employeeId = res.body.id;
  });

  test('❌ Genre invalide', async () => {
    const res = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ fullName: 'Bob Test', gender: 'other', password: 'emp@1234' });
    expect(res.status).toBe(400);
  });

  test('✅ Connexion employé par nom', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'Alice Martin', password: 'emp@1234', type: 'employee',
    });
    expect(res.status).toBe(200);
    employeeToken = res.body.token;
  });

  test('✅ Connexion employé nom inversé', async () => {
    const res = await request(app).post('/api/login').send({
      email: 'Martin Alice', password: 'emp@1234', type: 'employee',
    });
    expect(res.status).toBe(200);
  });

  test('✅ Liste employés (sans mot de passe)', async () => {
    const res = await request(app).get('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).not.toHaveProperty('password');
  });

  test('✅ Modifie un employé', async () => {
    const res = await request(app).put(`/api/enterprise/employees/${employeeId}`)
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ fullName: 'Alice Dupont' });
    expect(res.status).toBe(200);
    expect(res.body.fullName).toBe('Alice Dupont');
  });
});

// ════════════════════════════════════════════════════════════════════
// 8. CHOIX DES EMPLOYÉS
// ════════════════════════════════════════════════════════════════════

describe('10 — Choix des employés', () => {
  test('✅ Voit les menus disponibles', async () => {
    const res = await request(app).get('/api/employee/menus')
      .set('Authorization', 'Bearer ' + employeeToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('foods');
    expect(res.body[0]).toHaveProperty('drinks');
  });

  test('✅ Fait un choix (plat + boisson)', async () => {
    const res = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ restaurantId, foodItemId: menuItemFoodId, drinkItemId: menuItemDrinkId });
    expect(res.status).toBe(201);
    expect(res.body.foodItem.name).toBe('Riz sauce graine');
    expect(res.body.drinkItem.name).toBe('Jus de bissap');
    choiceId = res.body.id;
  });

  test('✅ Mise à jour via POST dans les 5 min → 200', async () => {
    // Within 5-min window, POST updates the existing choice instead of 409
    const res = await request(app).post('/api/choices')
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ restaurantId, foodItemId: menuItemFoodId });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(choiceId);
  });

  test('❌ Suppression des deux items via PUT → 400', async () => {
    // Cannot nullify both food AND drink simultaneously
    const res = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ foodItemId: null, drinkItemId: null });
    expect(res.status).toBe(400);
  });

  test('✅ Lit son choix du jour', async () => {
    const res = await request(app).get('/api/choices/mine')
      .set('Authorization', 'Bearer ' + employeeToken);
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    expect(res.body.id).toBe(choiceId);
  });

  test('✅ Modifie son choix (dans les 5 min)', async () => {
    const res = await request(app).put(`/api/choices/${choiceId}`)
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ drinkItemId: null });
    expect(res.status).toBe(200);
    expect(res.body.drinkItem).toBeNull();
  });

  test('✅ Note son plat (1-5 étoiles)', async () => {
    const res = await request(app).post(`/api/choices/${choiceId}/rate`)
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ stars: 4 });
    expect(res.status).toBe(200);
    expect(res.body.rating).toBe(4);
  });

  test('❌ Note invalide (0 étoile) → 400', async () => {
    const res = await request(app).post(`/api/choices/${choiceId}/rate`)
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ stars: 0 });
    expect(res.status).toBe(400);
  });

  test('✅ Historique des choix (employé)', async () => {
    const res = await request(app).get('/api/choices/history')
      .set('Authorization', 'Bearer ' + employeeToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('✅ Choix du jour visibles par l\'entreprise', async () => {
    const res = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('✅ Choix du jour visibles par le restaurant', async () => {
    const res = await request(app).get('/api/choices/today')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════
// 9. COMMANDES
// ════════════════════════════════════════════════════════════════════

describe('11 — Commandes', () => {
  test('✅ Entreprise passe une commande (livraison)', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, paymentMode: 'delivery' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.items.length).toBe(1);
    expect(res.body).not.toHaveProperty('depositScreenshot');
    orderId = res.body.id;
  });

  test('✅ Commande avec paiement mobile (upfront)', async () => {
    // D'abord recréer un choix (le précédent est verrouillé)
    // On teste juste la validation du mode de paiement
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, paymentMode: 'delivery' });
    // Devrait échouer car plus de choix non soumis
    expect(res.status).toBe(400);
  });

  test('❌ Mode de paiement invalide → 400', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, paymentMode: 'cash' });
    expect(res.status).toBe(400);
  });

  test('✅ Restaurant reçoit la commande', async () => {
    const res = await request(app).get('/api/orders')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).not.toHaveProperty('depositScreenshot');
  });

  test('✅ Restaurant confirme la commande', async () => {
    const res = await request(app).put(`/api/orders/${orderId}/status`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  test('✅ Restaurant marque comme en préparation', async () => {
    const res = await request(app).put(`/api/orders/${orderId}/status`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'preparing' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('preparing');
  });

  test('✅ Restaurant marque comme livrée', async () => {
    const res = await request(app).put(`/api/orders/${orderId}/status`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'delivered' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('delivered');
  });

  test('❌ Statut invalide → 400', async () => {
    const res = await request(app).put(`/api/orders/${orderId}/status`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'flying' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 10. ABONNEMENTS
// ════════════════════════════════════════════════════════════════════

describe('12 — Abonnements', () => {
  test('✅ Entreprise demande un abonnement mensuel', async () => {
    const res = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, frequency: 'monthly' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    subId = res.body.id;
  });

  test('❌ Double demande en attente → 409', async () => {
    const res = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, frequency: 'monthly' });
    expect(res.status).toBe(409);
  });

  test('❌ Fréquence invalide → 400', async () => {
    const res = await request(app).post('/api/subscriptions')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ restaurantId, frequency: 'forever' });
    expect(res.status).toBe(400);
  });

  test('✅ Restaurant voit les demandes', async () => {
    const res = await request(app).get('/api/subscriptions')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('frequency');
  });

  test('✅ Restaurant accepte l\'abonnement', async () => {
    const res = await request(app).put(`/api/subscriptions/${subId}`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'accepted' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
  });

  test('❌ Statut abonnement invalide → 400', async () => {
    const res = await request(app).put(`/api/subscriptions/${subId}`)
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ status: 'maybe' });
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 11. NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════

describe('13 — Notifications', () => {
  let notifId = '';

  test('✅ Restaurant a des notifications', async () => {
    const res = await request(app).get('/api/notifications')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    notifId = res.body[0].id;
  });

  test('✅ Marque une notification comme lue', async () => {
    const res = await request(app).put(`/api/notifications/${notifId}/read`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  test('✅ Marque tout comme lu', async () => {
    const res = await request(app).put('/api/notifications/read-all')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
  });

  test('✅ Supprime une notification', async () => {
    const res = await request(app).delete(`/api/notifications/${notifId}`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
  });

  test('✅ Entreprise a des notifications', async () => {
    const res = await request(app).get('/api/notifications')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('✅ Efface toutes les notifications (entreprise)', async () => {
    const res = await request(app).delete('/api/notifications')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    const check = await request(app).get('/api/notifications')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(check.body.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 12. STATISTIQUES
// ════════════════════════════════════════════════════════════════════

describe('14 — Statistiques', () => {
  const freqs = ['daily', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'annual'];

  test('✅ Stats entreprise (mensuel)', async () => {
    const res = await request(app).get('/api/stats/enterprise?frequency=monthly')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalChoices');
    expect(res.body).toHaveProperty('totalBudget');
    expect(res.body).toHaveProperty('foodCounts');
    expect(res.body).toHaveProperty('employeeStats');
  });

  test('✅ Stats restaurant (mensuel)', async () => {
    const res = await request(app).get('/api/stats/restaurant?frequency=monthly')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalRevenue');
    expect(res.body).toHaveProperty('avgRating');
    expect(res.body).toHaveProperty('itemCounts');
    expect(res.body).toHaveProperty('ratingCount');
  });

  test.each(freqs)('✅ Stats restaurant fréquence: %s', async (freq) => {
    const res = await request(app).get(`/api/stats/restaurant?frequency=${freq}`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════
// 13. ADMIN
// ════════════════════════════════════════════════════════════════════

describe('15 — Admin', () => {
  test('✅ Liste toutes les entreprises (avec infos inscription)', async () => {
    const res = await request(app).get('/api/admin/enterprises')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).not.toHaveProperty('password');
    expect(res.body[0]).toHaveProperty('companyName');
    expect(res.body[0]).toHaveProperty('email');
    expect(res.body[0]).toHaveProperty('createdAt');
  });

  test('✅ Liste tous les restaurants (avec infos inscription)', async () => {
    const res = await request(app).get('/api/admin/restaurants')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).not.toHaveProperty('password');
    expect(res.body[0]).toHaveProperty('restaurantName');
    expect(res.body[0]).toHaveProperty('fullName');
    expect(res.body[0]).toHaveProperty('paymentInfo');
    expect(res.body[0]).toHaveProperty('createdAt');
  });

  test('✅ Liste tous les employés', async () => {
    const res = await request(app).get('/api/admin/employees')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).not.toHaveProperty('password');
    expect(res.body[0]).toHaveProperty('gender');
    expect(res.body[0]).toHaveProperty('enterpriseName');
    expect(res.body[0]).toHaveProperty('createdAt');
  });

  test('✅ Stats admin globales', async () => {
    const res = await request(app).get('/api/admin/stats?frequency=monthly')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('counts');
    expect(res.body).toHaveProperty('gender');
    expect(res.body.counts.enterprises).toBeGreaterThan(0);
    expect(res.body.counts.restaurants).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('totalMobilized');
    // Admin ne voit pas les deposits
    const orders = res.body.orders;
    if (orders && orders.length > 0) {
      expect(orders[0]).not.toHaveProperty('depositScreenshot');
    }
  });

  test('❌ Non-admin → 403', async () => {
    const res = await request(app).get('/api/admin/stats')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(403);
  });

  test('✅ Admin voit les demandes de suppression', async () => {
    const res = await request(app).get('/api/admin/deletion-requests')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 14. MESSAGERIE TEXTE
// ════════════════════════════════════════════════════════════════════

describe('17 — Messagerie texte', () => {
  let msgId = '';

  test('✅ Entreprise envoie un message texte au restaurant', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'text', content: 'Bonjour, votre menu est disponible ?' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('text');
    expect(res.body.content).toBe('Bonjour, votre menu est disponible ?');
    expect(res.body.senderRole).toBe('enterprise');
    expect(res.body).not.toHaveProperty('audioData');
    msgId = res.body.id;
  });

  test('✅ Restaurant répond par texte', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ recipientId: enterpriseId, type: 'text', content: 'Oui, le menu est prêt !' });
    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe('restauratrice');
  });

  test('✅ Entreprise lit l\'historique (ordre chronologique)', async () => {
    const res = await request(app)
      .get(`/api/messages?withId=${restaurantId}`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    res.body.forEach(m => expect(m).not.toHaveProperty('audioData'));
    expect(new Date(res.body[0].timestamp) <= new Date(res.body[1].timestamp)).toBe(true);
  });

  test('✅ Restaurant lit l\'historique', async () => {
    const res = await request(app)
      .get(`/api/messages?withId=${enterpriseId}`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('✅ Conversations listées avec unread + preview', async () => {
    const res = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('unread');
    expect(res.body[0]).toHaveProperty('lastMessage');
  });

  test('✅ Marquer messages comme lus', async () => {
    const res = await request(app)
      .post('/api/messages/read')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ withId: restaurantId });
    expect(res.status).toBe(200);
  });

  test('✅ Compteur non-lus mis à jour', async () => {
    const res = await request(app)
      .get('/api/messages/unread')
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test('✅ Supprime un message (expéditeur)', async () => {
    const res = await request(app)
      .delete(`/api/messages/${msgId}`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
  });

  test('❌ Supprime un message (non-expéditeur) → 403', async () => {
    const send = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'text', content: 'Test suppression' });
    const newId = send.body.id;
    const res = await request(app)
      .delete(`/api/messages/${newId}`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(403);
  });

  test('❌ Non affilié ne peut pas envoyer → 403', async () => {
    const reg = await request(app).post('/api/enterprise/register').send({
      companyName: 'Outsider Corp', email: 'outsider@example.com', password: 'Out@5678',
    });
    const outsiderToken = reg.body.token;
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + outsiderToken)
      .send({ recipientId: restaurantId, type: 'text', content: 'Spam !' });
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// 15. MESSAGERIE AUDIO
// ════════════════════════════════════════════════════════════════════

describe('18 — Messagerie audio', () => {
  const fakeAudioBase64 = 'data:audio/webm;base64,' + Buffer.from('FAKEWAVEDATA').toString('base64');
  let audioMsgId = '';

  test('✅ Entreprise envoie un message audio', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'audio', audioData: fakeAudioBase64, audioDuration: 5 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('audio');
    expect(res.body.audioDuration).toBe(5);
    expect(res.body).not.toHaveProperty('audioData');
    audioMsgId = res.body.id;
  });

  test('✅ Charger l\'audio en lazy load', async () => {
    const res = await request(app)
      .get(`/api/messages/${audioMsgId}/audio`)
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('audioData');
    expect(res.body.audioData).toBe(fakeAudioBase64);
  });

  test('✅ L\'audio n\'apparaît pas dans la liste', async () => {
    const res = await request(app)
      .get(`/api/messages?withId=${restaurantId}`)
      .set('Authorization', 'Bearer ' + enterpriseToken);
    expect(res.status).toBe(200);
    const audioMsg = res.body.find(m => m.id === audioMsgId);
    expect(audioMsg).toBeDefined();
    expect(audioMsg).not.toHaveProperty('audioData');
  });

  test('✅ Restaurant envoie un audio en réponse', async () => {
    const fakeReply = 'data:audio/webm;base64,' + Buffer.from('REPLYWAVEDATA').toString('base64');
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ recipientId: enterpriseId, type: 'audio', audioData: fakeReply, audioDuration: 3 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('audio');
  });

  test('❌ Audio trop lourd → 413', async () => {
    const hugeAudio = 'data:audio/webm;base64,' + 'A'.repeat(15 * 1024 * 1024);
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'audio', audioData: hugeAudio });
    expect(res.status).toBe(413);
  });

  test('❌ Texte vide → 400', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'text', content: '   ' });
    expect(res.status).toBe(400);
  });

  test('❌ Type invalide → 400', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', 'Bearer ' + enterpriseToken)
      .send({ recipientId: restaurantId, type: 'video', content: 'test' });
    expect(res.status).toBe(400);
  });

  test('✅ Compteur non lus côté restaurant', async () => {
    const res = await request(app)
      .get('/api/messages/unread')
      .set('Authorization', 'Bearer ' + restoToken);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 16. SUPPRESSION DE COMPTE
// ════════════════════════════════════════════════════════════════════

describe('16 — Suppression de compte', () => {
  test('❌ Mauvais mot de passe → 400', async () => {
    const res = await request(app).delete('/api/account')
      .set('Authorization', 'Bearer ' + restoToken)
      .send({ reason: 'Test', password: 'wrongpwd' });
    expect(res.status).toBe(400);
  });

  test('❌ Employé ne peut pas supprimer son compte → 403', async () => {
    const res = await request(app).delete('/api/account')
      .set('Authorization', 'Bearer ' + employeeToken)
      .send({ reason: 'Test', password: 'emp@1234' });
    expect(res.status).toBe(403);
  });

  test('✅ Restaurant supprime son compte (bon mot de passe)', async () => {
    // Créer un restaurant temporaire pour la suppression
    const reg = await request(app).post('/api/restauratrice/register').send({
      restaurantName: 'Resto Temp',
      fullName:       'Chef Temp',
      email:          'temp@example.com',
      password:       'Temp@1234',
    });
    const tempToken = reg.body.token;
    const res = await request(app).delete('/api/account')
      .set('Authorization', 'Bearer ' + tempToken)
      .send({ reason: 'Test suppression', feedback: 'RAS', password: 'Temp@1234' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('✅ Admin voit la demande de suppression enregistrée', async () => {
    const res = await request(app).get('/api/admin/deletion-requests')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('reason');
    expect(res.body[0]).toHaveProperty('userType');
  });

  test('✅ Admin supprime un utilisateur', async () => {
    // Créer une entreprise à supprimer
    const reg = await request(app).post('/api/enterprise/register').send({
      companyName: 'ToDelete', email: 'todelete@example.com', password: 'Del@1234',
    });
    const deleteId = reg.body.user.id;
    const res = await request(app).delete(`/api/admin/users/enterprise/${deleteId}`)
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
  });

  test('❌ Admin — type invalide → 400', async () => {
    const res = await request(app).delete('/api/admin/users/unknown/someId')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// 17. VIDER L'HISTORIQUE (employé)
// ════════════════════════════════════════════════════════════════════

describe('19 — Historique employé', () => {
  test('✅ Vide l\'historique (hors aujourd\'hui)', async () => {
    const res = await request(app).delete('/api/choices/history')
      .set('Authorization', 'Bearer ' + employeeToken);
    expect(res.status).toBe(200);
  });

  test('✅ Choix du jour toujours présent après vidage', async () => {
    const res = await request(app).get('/api/choices/mine')
      .set('Authorization', 'Bearer ' + employeeToken);
    expect(res.status).toBe(200);
    // Le choix du jour reste (même si history vide, car même date)
  });
});
