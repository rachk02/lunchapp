// ═══════════════════════════════════════════════════════════════════
// tests/messaging.test.js — Tests complets de la messagerie
// ═══════════════════════════════════════════════════════════════════

const path = require('path');
const fs   = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB_DIR = path.join(__dirname, 'test-data-msg');
process.env.DB_DIR = TEST_DB_DIR;

jest.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }) }),
}));

const request = require('supertest');
const app     = require('../server');

const DATA_FILES = [
  'enterprises.json','employees.json','restauratrices.json','menus.json',
  'dailyMenus.json','affiliations.json','offers.json','choices.json',
  'orders.json','subscriptions.json','notifications.json','ratings.json',
  'deletionRequests.json','messages.json',
];

beforeAll(() => {
  if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  DATA_FILES.forEach(f => fs.writeFileSync(path.join(TEST_DB_DIR, f), '[]'));
});
afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

// ── Tokens & IDs partagés ─────────────────────────────────────────
let tokEnt1, tokEnt2, tokRst1, tokRst2;
let idEnt1, idEnt2, idRst1, idRst2;

// ── Mise en place : 2 entreprises + 2 restaurants ─────────────────
beforeAll(async () => {
  const e1 = await request(app).post('/api/enterprise/register').send({
    companyName: 'EntA', email: 'enta@test.com', password: 'EntA@1234',
  });
  tokEnt1 = e1.body.token; idEnt1 = e1.body.user.id;

  const e2 = await request(app).post('/api/enterprise/register').send({
    companyName: 'EntB', email: 'entb@test.com', password: 'EntB@1234',
  });
  tokEnt2 = e2.body.token; idEnt2 = e2.body.user.id;

  const r1 = await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'RestoX', fullName: 'Chef X', email: 'restox@test.com', password: 'RestoX@1234',
  });
  tokRst1 = r1.body.token; idRst1 = r1.body.user.id;

  const r2 = await request(app).post('/api/restauratrice/register').send({
    restaurantName: 'RestoY', fullName: 'Chef Y', email: 'restoy@test.com', password: 'RestoY@1234',
  });
  tokRst2 = r2.body.token; idRst2 = r2.body.user.id;

  // Affiliations : EntA ↔ RestoX, EntB ↔ RestoY
  await request(app).post(`/api/enterprise/restaurants/${idRst1}/affiliate`)
    .set('Authorization', 'Bearer ' + tokEnt1);
  await request(app).post(`/api/enterprise/restaurants/${idRst2}/affiliate`)
    .set('Authorization', 'Bearer ' + tokEnt2);
});

// ════════════════════════════════════════════════════════════════════
// ENVOI — Texte
// ════════════════════════════════════════════════════════════════════

describe('MSG-01 — Envoi texte entreprise → restaurant', () => {
  let msgId;

  test('✅ Envoi réussi', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'Bonjour RestoX !' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('text');
    expect(res.body.content).toBe('Bonjour RestoX !');
    expect(res.body.senderRole).toBe('enterprise');
    expect(res.body.recipientRole).toBe('restauratrice');
    expect(res.body.senderName).toBe('EntA');
    expect(res.body.recipientName).toBe('RestoX');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('audioData');
    msgId = res.body.id;
  });

  test('✅ Le message figure dans l\'historique', async () => {
    const res = await request(app).get(`/api/messages?withId=${idRst1}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(200);
    expect(res.body.some(m => m.id === msgId)).toBe(true);
  });

  test('✅ Le restaurant voit le message', async () => {
    const res = await request(app).get(`/api/messages?withId=${idEnt1}`)
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    expect(res.body.some(m => m.id === msgId)).toBe(true);
  });

  test('✅ readBy ne contient que l\'expéditeur initialement', async () => {
    const res = await request(app).get(`/api/messages?withId=${idEnt1}`)
      .set('Authorization', 'Bearer ' + tokRst1);
    const msg = res.body.find(m => m.id === msgId);
    expect(msg.readBy).toContain(idEnt1);
    expect(msg.readBy).not.toContain(idRst1);
  });
});

// ════════════════════════════════════════════════════════════════════
// ENVOI — Texte restaurant → entreprise
// ════════════════════════════════════════════════════════════════════

describe('MSG-02 — Envoi texte restaurant → entreprise', () => {
  let msgId;

  test('✅ Envoi réussi', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokRst1)
      .send({ recipientId: idEnt1, type: 'text', content: 'Votre commande est prête !' });
    expect(res.status).toBe(201);
    expect(res.body.senderRole).toBe('restauratrice');
    expect(res.body.recipientRole).toBe('enterprise');
    msgId = res.body.id;
  });

  test('✅ Conversation bidirectionnelle visible des deux côtés', async () => {
    const fromEnt = await request(app).get(`/api/messages?withId=${idRst1}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    const fromRst = await request(app).get(`/api/messages?withId=${idEnt1}`)
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(fromEnt.body.length).toBe(fromRst.body.length);
    expect(fromEnt.body.length).toBeGreaterThanOrEqual(2);
  });

  test('✅ Ordre chronologique respecté', async () => {
    const res = await request(app).get(`/api/messages?withId=${idRst1}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    for (let i = 1; i < res.body.length; i++) {
      expect(new Date(res.body[i-1].timestamp) <= new Date(res.body[i].timestamp)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// ENVOI — Audio
// ════════════════════════════════════════════════════════════════════

describe('MSG-03 — Envoi audio', () => {
  const fakeAudio = 'data:audio/webm;base64,' + Buffer.from('FAKEAUDIO_BYTES').toString('base64');
  let audioMsgId;

  test('✅ Envoi audio entreprise → restaurant', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'audio', audioData: fakeAudio, audioDuration: 7 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('audio');
    expect(res.body.audioDuration).toBe(7);
    expect(res.body.content).toBeNull();
    expect(res.body).not.toHaveProperty('audioData'); // pas dans la réponse POST
    audioMsgId = res.body.id;
  });

  test('✅ audioData absent de la liste (lazy load)', async () => {
    const res = await request(app).get(`/api/messages?withId=${idRst1}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(200);
    res.body.forEach(m => expect(m).not.toHaveProperty('audioData'));
  });

  test('✅ Lazy load audio — expéditeur', async () => {
    const res = await request(app).get(`/api/messages/${audioMsgId}/audio`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(200);
    expect(res.body.audioData).toBe(fakeAudio);
  });

  test('✅ Lazy load audio — destinataire', async () => {
    const res = await request(app).get(`/api/messages/${audioMsgId}/audio`)
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    expect(res.body.audioData).toBe(fakeAudio);
  });

  test('❌ Tiers non concerné ne peut pas charger l\'audio → 403', async () => {
    const res = await request(app).get(`/api/messages/${audioMsgId}/audio`)
      .set('Authorization', 'Bearer ' + tokEnt2); // autre entreprise
    expect(res.status).toBe(403);
  });

  test('✅ Envoi audio restaurant → entreprise', async () => {
    const replyAudio = 'data:audio/webm;base64,' + Buffer.from('REPLY_AUDIO').toString('base64');
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokRst1)
      .send({ recipientId: idEnt1, type: 'audio', audioData: replyAudio, audioDuration: 3 });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('audio');
  });

  test('❌ Audio trop lourd (>10 Mo) → 413', async () => {
    const huge = 'data:audio/webm;base64,' + 'A'.repeat(15 * 1024 * 1024);
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'audio', audioData: huge });
    expect(res.status).toBe(413);
  });

  test('❌ Audio sans données → 400', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'audio' });
    expect(res.status).toBe(400);
  });

  test('❌ Charger audio d\'un message texte → 400', async () => {
    const send = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'Texte normal' });
    const res = await request(app).get(`/api/messages/${send.body.id}/audio`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ════════════════════════════════════════════════════════════════════

describe('MSG-04 — Liste des conversations', () => {
  test('✅ Restaurant voit ses conversations', async () => {
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const conv = res.body[0];
    expect(conv).toHaveProperty('id');
    expect(conv).toHaveProperty('name');
    expect(conv).toHaveProperty('role');
    expect(conv).toHaveProperty('lastMessage');
    expect(conv).toHaveProperty('lastTimestamp');
    expect(conv).toHaveProperty('unread');
  });

  test('✅ Entreprise voit ses conversations', async () => {
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('✅ EntB ne voit que ses propres conversations (pas celles de EntA)', async () => {
    const resB = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokEnt2);
    expect(res2 => res2).toBeDefined();
    // EntB n'a pas encore échangé de messages → 0 conversations
    expect(resB.body.length).toBe(0);
  });

  test('✅ Conversations triées par date décroissante', async () => {
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokRst1);
    for (let i = 1; i < res.body.length; i++) {
      expect(new Date(res.body[i-1].lastTimestamp) >= new Date(res.body[i].lastTimestamp)).toBe(true);
    }
  });

  test('✅ lastMessage audio affiché comme 🎵 Message audio', async () => {
    // Envoyer un audio en dernier pour que lastMessage soit l'audio
    const fakeA = 'data:audio/webm;base64,' + Buffer.from('LAST').toString('base64');
    await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'audio', audioData: fakeA, audioDuration: 2 });
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokRst1);
    const conv = res.body.find(c => c.id === idEnt1);
    expect(conv.lastMessage).toBe('🎵 Message audio');
  });
});

// ════════════════════════════════════════════════════════════════════
// LU / NON-LU
// ════════════════════════════════════════════════════════════════════

describe('MSG-05 — Lecture et compteur non-lus', () => {
  test('✅ Compteur non-lus > 0 chez le restaurant avant lecture', async () => {
    const res = await request(app).get('/api/messages/unread')
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('✅ Marquer la conversation comme lue', async () => {
    const res = await request(app).post('/api/messages/read')
      .set('Authorization', 'Bearer ' + tokRst1)
      .send({ withId: idEnt1 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('✅ Compteur non-lus = 0 après lecture', async () => {
    const res = await request(app).get('/api/messages/unread')
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });

  test('✅ unread dans conversations = 0 après lecture', async () => {
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + tokRst1);
    const conv = res.body.find(c => c.id === idEnt1);
    if (conv) expect(conv.unread).toBe(0);
  });

  test('✅ Nouveau message → compteur remonte', async () => {
    await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'Nouveau message non lu' });
    const res = await request(app).get('/api/messages/unread')
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.body.count).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// SUPPRESSION
// ════════════════════════════════════════════════════════════════════

describe('MSG-06 — Suppression de messages', () => {
  let delMsgId;

  beforeAll(async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'À supprimer' });
    delMsgId = res.body.id;
  });

  test('✅ Expéditeur peut supprimer son message', async () => {
    const res = await request(app).delete(`/api/messages/${delMsgId}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('✅ Message supprimé absent de l\'historique', async () => {
    const res = await request(app).get(`/api/messages?withId=${idRst1}`)
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.body.some(m => m.id === delMsgId)).toBe(false);
  });

  test('❌ Non-expéditeur ne peut pas supprimer → 403', async () => {
    const send = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'Protégé' });
    const res = await request(app).delete(`/api/messages/${send.body.id}`)
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(403);
  });

  test('❌ Message inexistant → 404', async () => {
    const res = await request(app).delete('/api/messages/nonexistent')
      .set('Authorization', 'Bearer ' + tokEnt1);
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════
// GARDE-FOUS (sécurité)
// ════════════════════════════════════════════════════════════════════

describe('MSG-07 — Sécurité et garde-fous', () => {
  test('❌ Non affilié ne peut pas envoyer → 403', async () => {
    // EntA essaie d'envoyer à RestoY (non affiliée)
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst2, type: 'text', content: 'Intrus !' });
    expect(res.status).toBe(403);
  });

  test('❌ Restaurant non affilié ne peut pas envoyer → 403', async () => {
    // RestoX essaie d'envoyer à EntB (non affiliée)
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokRst1)
      .send({ recipientId: idEnt2, type: 'text', content: 'Intrus !' });
    expect(res.status).toBe(403);
  });

  test('❌ Texte vide → 400', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: '   ' });
    expect(res.status).toBe(400);
  });

  test('❌ Type inconnu → 400', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'video', content: 'x' });
    expect(res.status).toBe(400);
  });

  test('❌ Destinataire manquant → 400', async () => {
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ type: 'text', content: 'Oups' });
    expect(res.status).toBe(400);
  });

  test('❌ Destinataire inexistant → 404', async () => {
    // Nécessite que l\'affiliation soit fausse → d\'abord 403 (non affilié)
    // Pour tester 404 on utilise un ID inventé non présent dans affiliations
    const res = await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: 'ghost-id', type: 'text', content: 'Ghost' });
    // Soit 403 (affiliations) soit 404 (destinataire)
    expect([403, 404]).toContain(res.status);
  });

  test('❌ Sans token → 401', async () => {
    const res = await request(app).get('/api/messages/conversations');
    expect(res.status).toBe(401);
  });

  test('❌ Employé ne peut pas accéder à la messagerie → 403', async () => {
    // Créer un employé
    const emp = await request(app).post('/api/enterprise/employees')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ fullName: 'Test Emp', gender: 'male', password: 'emp@1234' });
    const empLogin = await request(app).post('/api/login')
      .send({ email: 'Test Emp', password: 'emp@1234', type: 'employee' });
    const empToken = empLogin.body.token;
    const res = await request(app).get('/api/messages/conversations')
      .set('Authorization', 'Bearer ' + empToken);
    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════
// NOTIFICATIONS SSE sur nouveau message
// ════════════════════════════════════════════════════════════════════

describe('MSG-08 — Notification sur nouveau message', () => {
  test('✅ Une notification est créée pour le destinataire', async () => {
    // Envoyer un message
    await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'text', content: 'Message test notif' });

    // Vérifier que RestoX a une notification de type new_message
    const res = await request(app).get('/api/notifications')
      .set('Authorization', 'Bearer ' + tokRst1);
    expect(res.status).toBe(200);
    const msgNotif = res.body.find(n => n.type === 'new_message');
    expect(msgNotif).toBeDefined();
    expect(msgNotif.title).toContain('EntA');
    expect(msgNotif.message).toBe('Message test notif');
  });

  test('✅ Notification audio contient le bon texte', async () => {
    const fakeA = 'data:audio/webm;base64,' + Buffer.from('NOTIF_AUDIO').toString('base64');
    await request(app).post('/api/messages')
      .set('Authorization', 'Bearer ' + tokEnt1)
      .send({ recipientId: idRst1, type: 'audio', audioData: fakeA });

    const res = await request(app).get('/api/notifications')
      .set('Authorization', 'Bearer ' + tokRst1);
    const audioNotif = res.body.find(n => n.type === 'new_message' && n.message.includes('audio'));
    expect(audioNotif).toBeDefined();
    expect(audioNotif.message).toContain('🎵');
  });
});
