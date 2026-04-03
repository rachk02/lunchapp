'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// wa-worker.js — WhatsApp Web JS dans un processus isolé
// Si Puppeteer/Chromium crash, seul ce process meurt — le serveur HTTP survit.
// Communication avec server.js via IPC (process.send / process.on('message'))
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config({ quiet: true });

const path      = require('path');
const fs        = require('fs');
const QRCode    = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const WA_SENDER  = (process.env.WA_SENDER || '22664046120').replace(/^\+/, '');
const WA_QR_FILE = path.join(__dirname, 'public', 'wa-qr.html');
const PORT       = process.env.PORT || 3000;

let client  = null;
let ready   = false;

function send(type, data = {}) {
  try { process.send({ type, ...data }); } catch {}
}

function init() {
  client = new Client({
    authStrategy: new LocalAuth({ clientId: 'lunchapp' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    },
  });

  client.on('qr', async qr => {
    try {
      const img = await QRCode.toDataURL(qr, { width: 320, margin: 2 });
      fs.writeFileSync(WA_QR_FILE, `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp — LunchApp</title>
<style>
  body{margin:0;display:flex;flex-direction:column;align-items:center;
       justify-content:center;min-height:100vh;background:#f0f2f5;font-family:sans-serif}
  h2{color:#128C7E;margin-bottom:8px}
  img{border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.18)}
  p{color:#555;font-size:14px;margin:10px 0 4px}strong{color:#128C7E}
  small{color:#aaa;font-size:12px}
</style></head>
<body>
  <h2>📱 Connecter WhatsApp</h2>
  <img src="${img}" width="320" height="320" alt="QR WhatsApp"/>
  <p>Numéro : <strong>+${WA_SENDER}</strong></p>
  <p>WhatsApp → <strong>⋮ Appareils liés → Lier un appareil</strong> → scanner</p>
  <small>Recharger si le QR expire (~20 s)</small>
</body></html>`);
      console.log('[WA-Worker] QR généré → http://localhost:' + PORT + '/wa-qr.html');
      send('qr');
    } catch (e) {
      console.error('[WA-Worker] Erreur QR :', e.message);
    }
  });

  client.on('authenticated', () => {
    console.log('[WA-Worker] 🔐 Authentifié');
    send('authenticated');
  });

  client.on('ready', () => {
    ready = true;
    console.log('[WA-Worker] ✅ Prêt — +' + WA_SENDER);
    try { fs.unlinkSync(WA_QR_FILE); } catch {}
    send('ready');
  });

  client.on('auth_failure', msg => {
    console.error('[WA-Worker] ❌ Auth failure :', msg);
    ready = false;
    send('auth_failure');
    process.exit(1); // Le manager dans server.js relancea le worker
  });

  client.on('disconnected', reason => {
    console.warn('[WA-Worker] ⚠️  Déconnecté :', reason);
    ready = false;
    send('disconnected');
    process.exit(0); // Sortie propre → relance par le manager
  });

  client.initialize().catch(e => {
    console.error('[WA-Worker] Init error :', e.message);
    process.exit(1);
  });
}

// ── Recevoir les demandes d'envoi depuis server.js ────────────────────────────
process.on('message', async msg => {
  if (msg.type === 'send' && ready && client) {
    const num = msg.to.replace(/^\+/, '') + '@c.us';
    try {
      await client.sendMessage(num, msg.text);
      send('sent', { ok: true });
    } catch (e) {
      console.warn('[WA-Worker] Erreur envoi (tentative 1) :', e.message);
      // Frame temporairement détachée (rafraîchissement interne de WhatsApp Web) — on réessaie après 2s
      if (e.message && e.message.includes('detached')) {
        try {
          await new Promise(r => setTimeout(r, 2000));
          await client.sendMessage(num, msg.text);
          console.log('[WA-Worker] Envoi réussi au 2e essai');
          send('sent', { ok: true });
        } catch (e2) {
          console.error('[WA-Worker] Erreur envoi (tentative 2) :', e2.message);
          send('sent', { ok: false });
        }
      } else {
        send('sent', { ok: false });
      }
    }
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────
init();
