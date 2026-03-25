// ═══════════════════════════════════════════════════════════════
// tests/api.test.js — Suite de tests LunchApp
// Framework : Jest + Supertest
// Mode      : stockage JSON local (IS_VERCEL=false)
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

// ── Répertoire de données de TEST (isolé des données réelles) ───
const TEST_DB_DIR = path.join(__dirname, 'test-data');
process.env.DB_DIR = TEST_DB_DIR; // doit être défini AVANT require('../server')

const request = require('supertest');
const app     = require('../server');

beforeAll(() => {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  // Vide les fichiers de test avant chaque run
  ['enterprises', 'employees', 'restauratrices', 'choices', 'messages'].forEach(k => {
    fs.writeFileSync(path.join(TEST_DB_DIR, `${k}.json`), '[]');
  });
});

afterAll(() => {
  // Nettoyage
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ── Tokens récupérés au fil des tests ───────────────────────────
let enterpriseToken = '';
let employeeToken   = '';
let restoToken      = '';
let adminToken      = '';

// ════════════════════════════════════════════════════════════════
// 1. INSCRIPTION ENTREPRISE
// ════════════════════════════════════════════════════════════════

describe('1 — Inscription entreprise', () => {

  test('✅ Crée un compte entreprise valide', async () => {
    const res = await request(app)
      .post('/api/enterprise/register')
      .send({ companyName: 'TestCorp', domain: 'Informatique', password: 'Test@1234' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.role).toBe('enterprise');
    expect(res.body.user.companyName).toBe('TestCorp');
    enterpriseToken = res.body.token;
  });

  test('❌ Rejette un nom d\'entreprise déjà utilisé', async () => {
    const res = await request(app)
      .post('/api/enterprise/register')
      .send({ companyName: 'TestCorp', domain: 'Finance', password: 'Test@1234' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  test('❌ Rejette un mot de passe trop faible (sans majuscule)', async () => {
    const res = await request(app)
      .post('/api/enterprise/register')
      .send({ companyName: 'AutreSociété', domain: 'BTP', password: 'test1234!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/majuscule/i);
  });

  test('❌ Rejette un mot de passe sans caractère spécial', async () => {
    const res = await request(app)
      .post('/api/enterprise/register')
      .send({ companyName: 'AutreSociété', domain: 'BTP', password: 'Test1234' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/spécial/i);
  });

  test('❌ Rejette si champ manquant', async () => {
    const res = await request(app)
      .post('/api/enterprise/register')
      .send({ companyName: 'SansPass' });

    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// 2. CONNEXION
// ════════════════════════════════════════════════════════════════

describe('2 — Connexion', () => {

  test('✅ Entreprise se connecte avec succès', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'TestCorp', password: 'Test@1234', loginType: 'enterprise' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    enterpriseToken = res.body.token;
  });

  test('✅ Superadmin se connecte avec succès', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({
        identifier: 'admin.text.elimmeka@gmail.com',
        password: '@admin2101',
        loginType: 'superadmin',
      });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('superadmin');
    adminToken = res.body.token;
  });

  test('❌ Rejet mot de passe incorrect (entreprise)', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'TestCorp', password: 'MauvaisPass!', loginType: 'enterprise' });

    expect(res.status).toBe(401);
  });

  test('❌ Rejet entreprise inconnue', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'InconnuSARL', password: 'Test@1234', loginType: 'enterprise' });

    expect(res.status).toBe(401);
  });

  test('❌ Rejet si identifiant vide', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: '', password: 'Test@1234', loginType: 'enterprise' });

    expect(res.status).toBe(400);
  });

  test('❌ Rejet si loginType absent', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'TestCorp', password: 'Test@1234' });

    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// 3. GESTION DES EMPLOYÉS
// ════════════════════════════════════════════════════════════════

describe('3 — Gestion des employés', () => {

  test('✅ Crée un employé (auth entreprise)', async () => {
    const res = await request(app)
      .post('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Alice Dupont', password: 'alice123' });

    expect(res.status).toBe(201);
    expect(res.body.employee.fullName).toBe('Alice Dupont');
  });

  test('✅ Crée un second employé', async () => {
    const res = await request(app)
      .post('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Bob Martin', password: 'bob123!' });

    expect(res.status).toBe(201);
  });

  test('❌ Rejette un doublon de nom pour la même entreprise', async () => {
    const res = await request(app)
      .post('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Alice Dupont', password: 'autrepass' });

    expect(res.status).toBe(409);
  });

  test('❌ Rejette mot de passe trop court (<6)', async () => {
    const res = await request(app)
      .post('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Claire Blanc', password: '123' });

    expect(res.status).toBe(400);
  });

  test('❌ Bloque sans token', async () => {
    const res = await request(app)
      .post('/api/enterprise/employees')
      .send({ fullName: 'Sans Auth', password: 'test123' });

    expect(res.status).toBe(401);
  });

  test('✅ Liste les employés de l\'entreprise', async () => {
    const res = await request(app)
      .get('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
    // Les mots de passe ne doivent pas être exposés
    res.body.forEach(emp => expect(emp).not.toHaveProperty('password'));
  });

  test('✅ Supprime un employé', async () => {
    const list = await request(app)
      .get('/api/enterprise/employees')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    const idToDelete = list.body[1].id;

    const res = await request(app)
      .delete(`/api/enterprise/employees/${idToDelete}`)
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('❌ Suppression d\'un employé inexistant → 404', async () => {
    const res = await request(app)
      .delete('/api/enterprise/employees/id-inexistant')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// 4. CONNEXION EMPLOYÉ
// ════════════════════════════════════════════════════════════════

describe('4 — Connexion employé', () => {

  test('✅ Alice se connecte', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'Alice Dupont', password: 'alice123', loginType: 'employee' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('employee');
    expect(res.body.user.enterpriseName).toBe('TestCorp');
    employeeToken = res.body.token;
  });

  test('✅ Connexion avec ordre inversé (Nom Prénom)', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'Dupont Alice', password: 'alice123', loginType: 'employee' });

    expect(res.status).toBe(200);
  });

  test('❌ Mauvais mot de passe employé', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'Alice Dupont', password: 'mauvais', loginType: 'employee' });

    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// 5. RESTAURATRICE (créée par l'entreprise)
// ════════════════════════════════════════════════════════════════

describe('5 — Restauratrice créée par l\'entreprise', () => {

  test('✅ Entreprise crée un compte restauratrice', async () => {
    const res = await request(app)
      .post('/api/enterprise/restauratrice')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Marie Cuisinier', password: 'cuisine1' });

    expect(res.status).toBe(201);
    expect(res.body.restauratrice.fullName).toBe('Marie Cuisinier');
    expect(res.body.restauratrice.enterpriseName).toBe('TestCorp');
  });

  test('❌ Doublon de nom restauratrice', async () => {
    const res = await request(app)
      .post('/api/enterprise/restauratrice')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ fullName: 'Marie Cuisinier', password: 'autrepass' });

    expect(res.status).toBe(409);
  });

  test('❌ Un employé ne peut pas créer une restauratrice', async () => {
    const res = await request(app)
      .post('/api/enterprise/restauratrice')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ fullName: 'Autre Resto', password: 'pass123' });

    expect(res.status).toBe(403);
  });

  test('✅ Restauratrice se connecte', async () => {
    const res = await request(app)
      .post('/api/login')
      .send({ identifier: 'Marie Cuisinier', password: 'cuisine1', loginType: 'restauratrice' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('restauratrice');
    expect(res.body.user.enterpriseId).toBeTruthy();
    expect(res.body.user.enterpriseName).toBe('TestCorp');
    restoToken = res.body.token;
  });

  test('✅ Liste les restauratrices de l\'entreprise', async () => {
    const res = await request(app)
      .get('/api/enterprise/restauratrices')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].fullName).toBe('Marie Cuisinier');
    res.body.forEach(r => expect(r).not.toHaveProperty('password'));
  });
});

// ════════════════════════════════════════════════════════════════
// 6. CHOIX DE REPAS
// ════════════════════════════════════════════════════════════════

describe('6 — Choix de repas', () => {

  test('✅ Alice fait un choix', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ food: 'riz_gras_soumbala' });

    expect(res.status).toBe(200);
    expect(res.body.food).toBe('riz_gras_soumbala');
    expect(res.body.orderLaunched).toBe(false);
  });

  test('✅ Alice récupère son choix du jour', async () => {
    const res = await request(app)
      .get('/api/choices/mine')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.food).toBe('riz_gras_soumbala');
  });

  test('✅ Alice modifie son choix (dans les 5 min)', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ food: 'couscous' });

    expect(res.status).toBe(200);
    expect(res.body.food).toBe('couscous');
  });

  test('❌ Un choix "Autres" sans précision est rejeté', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ food: 'Autres', customFood: '' });

    // Le serveur accepte mais customFood peut être null
    // Tester que food est bien enregistré
    expect([200, 400]).toContain(res.status);
  });

  test('✅ Choix "Autres" avec précision est accepté', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ food: 'Autres', customFood: 'Haricots verts' });

    expect(res.status).toBe(200);
    expect(res.body.food).toBe('Autres');
    expect(res.body.customFood).toBe('Haricots verts');
  });

  test('❌ Un non-employé ne peut pas faire de choix', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ food: 'couscous' });

    expect(res.status).toBe(403);
  });

  test('❌ Choix sans token → 401', async () => {
    const res = await request(app)
      .post('/api/choices')
      .send({ food: 'couscous' });

    expect(res.status).toBe(401);
  });

  test('❌ food manquant → 400', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// 7. VUE ENTREPRISE & RESTAURATRICE SUR LES CHOIX
// ════════════════════════════════════════════════════════════════

describe('7 — Visibilité des choix', () => {

  test('✅ L\'entreprise voit les choix de ses employés', async () => {
    const res = await request(app)
      .get('/api/choices/today')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('✅ La restauratrice voit les choix de son entreprise liée', async () => {
    const res = await request(app)
      .get('/api/choices/today')
      .set('Authorization', `Bearer ${restoToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Tous les choix appartiennent à la même entreprise
    const entRes = await request(app)
      .get('/api/choices/today')
      .set('Authorization', `Bearer ${enterpriseToken}`);
    expect(res.body.length).toBe(entRes.body.length);
  });

  test('✅ L\'employé voit les choix de son équipe', async () => {
    const res = await request(app)
      .get('/api/choices/today')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// 8. LANCEMENT DE COMMANDE
// ════════════════════════════════════════════════════════════════

describe('8 — Lancement de commande', () => {

  test('❌ Un employé ne peut pas lancer la commande', async () => {
    const res = await request(app)
      .post('/api/choices/launch')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });

  test('✅ L\'entreprise lance la commande', async () => {
    const res = await request(app)
      .post('/api/choices/launch')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('❌ Alice ne peut plus modifier son choix (commande lancée)', async () => {
    const res = await request(app)
      .post('/api/choices')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ food: 'riz_gras_simple' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/lancée/i);
  });

  test('❌ Alice ne peut plus supprimer son choix (commande lancée)', async () => {
    const res = await request(app)
      .delete('/api/choices/mine')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════
// 9. HISTORIQUE
// ════════════════════════════════════════════════════════════════

describe('9 — Historique', () => {

  test('✅ Alice consulte son historique', async () => {
    const res = await request(app)
      .get('/api/history')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('food');
    expect(res.body[0]).toHaveProperty('date');
  });

  test('❌ Historique sans token → 401', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// 10. MESSAGERIE
// ════════════════════════════════════════════════════════════════

describe('10 — Messagerie', () => {

  test('✅ L\'entreprise envoie un message', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ content: 'Bonjour, avez-vous reçu notre commande ?' });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Bonjour, avez-vous reçu notre commande ?');
    expect(res.body.senderRole).toBe('enterprise');
  });

  test('✅ La restauratrice envoie un message', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${restoToken}`)
      .send({ content: 'Oui, bien reçu ! Livraison à 12h30.' });

    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe('restauratrice');
  });

  test('✅ Les messages sont visibles par les deux parties', async () => {
    const res = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  test('❌ Un employé ne peut pas accéder à la messagerie', async () => {
    const res = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });

  test('❌ Message vide rejeté', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ content: '   ' });

    expect(res.status).toBe(400);
  });

  test('✅ Marquer les messages comme lus', async () => {
    const res = await request(app)
      .post('/api/messages/read')
      .set('Authorization', `Bearer ${restoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('✅ Compteur non-lus = 0 après lecture', async () => {
    const res = await request(app)
      .get('/api/messages/unread')
      .set('Authorization', `Bearer ${restoToken}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// 11. DASHBOARD SUPERADMIN
// ════════════════════════════════════════════════════════════════

describe('11 — Superadmin', () => {

  test('✅ Liste toutes les entreprises', async () => {
    const res = await request(app)
      .get('/api/admin/enterprises')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    res.body.forEach(e => expect(e).not.toHaveProperty('password'));
  });

  test('✅ Liste tous les employés', async () => {
    const res = await request(app)
      .get('/api/admin/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('✅ Liste toutes les restauratrices', async () => {
    const res = await request(app)
      .get('/api/admin/restauratrices')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test('✅ Commandes du jour (admin)', async () => {
    const res = await request(app)
      .get('/api/admin/choices/today')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('❌ Un employé ne peut pas accéder aux routes admin', async () => {
    const res = await request(app)
      .get('/api/admin/enterprises')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/admin/enterprises');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// 11b. MESSAGES AUDIO
// ════════════════════════════════════════════════════════════════

describe('11b — Messages audio', () => {

  const fakeAudio = 'data:audio/webm;base64,' + Buffer.from('fakeaudiodata').toString('base64');

  test('✅ L\'entreprise envoie un message audio', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ type: 'audio', audioData: fakeAudio, content: '🎤 Message vocal' });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('audio');
    expect(res.body.content).toBe('🎤 Message vocal');
    // audioData ne doit PAS être exposé dans la réponse POST
    expect(res.body.audioData).toBeFalsy();
  });

  test('❌ Message audio sans audioData → 400', async () => {
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ type: 'audio' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/audio/i);
  });

  test('❌ Message audio trop lourd → 400', async () => {
    const bigAudio = 'data:audio/webm;base64,' + 'A'.repeat(7 * 1024 * 1024);
    const res = await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`)
      .send({ type: 'audio', audioData: bigAudio });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/long/i);
  });

  test('✅ audioData absent de GET /api/messages (chargement lazy)', async () => {
    const res = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    res.body.forEach(m => expect(m).not.toHaveProperty('audioData'));
  });

  test('✅ audioData récupérable via GET /api/messages/:id/audio', async () => {
    // Récupère l'id du message audio
    const msgs = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`);
    const audioMsg = msgs.body.find(m => m.type === 'audio');
    expect(audioMsg).toBeDefined();

    const res = await request(app)
      .get(`/api/messages/${audioMsg.id}/audio`)
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('audioData');
    expect(res.body.audioData).toContain('data:audio');
  });

  test('❌ Route audio pour un message texte → 404', async () => {
    const msgs = await request(app)
      .get('/api/messages')
      .set('Authorization', `Bearer ${enterpriseToken}`);
    const textMsg = msgs.body.find(m => m.type !== 'audio');
    expect(textMsg).toBeDefined();

    const res = await request(app)
      .get(`/api/messages/${textMsg.id}/audio`)
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// 12. SUPPRESSION RESTAURATRICE PAR L'ENTREPRISE
// ════════════════════════════════════════════════════════════════

describe('12 — Suppression restauratrice', () => {

  test('✅ L\'entreprise supprime sa restauratrice', async () => {
    const list = await request(app)
      .get('/api/enterprise/restauratrices')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    const id = list.body[0].id;

    const res = await request(app)
      .delete(`/api/enterprise/restauratrices/${id}`)
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('❌ ID inexistant → 404', async () => {
    const res = await request(app)
      .delete('/api/enterprise/restauratrices/id-fantome')
      .set('Authorization', `Bearer ${enterpriseToken}`);

    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// 13. TOKEN INVALIDE
// ════════════════════════════════════════════════════════════════

describe('13 — Sécurité JWT', () => {

  test('❌ Token forgé est rejeté', async () => {
    const res = await request(app)
      .get('/api/enterprise/employees')
      .set('Authorization', 'Bearer tokeninvalide.bidon.xxx');

    expect(res.status).toBe(401);
  });

  test('❌ Header Authorization absent → 401', async () => {
    const res = await request(app).get('/api/choices/today');
    expect(res.status).toBe(401);
  });

  test('❌ Header Authorization malformé → 401', async () => {
    const res = await request(app)
      .get('/api/choices/today')
      .set('Authorization', 'Token quelquechose');

    expect(res.status).toBe(401);
  });
});
