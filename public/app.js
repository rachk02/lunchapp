// ═══════════════════════════════════════════════════════════════════════════
// app.js — LunchApp v2 Frontend
// ═══════════════════════════════════════════════════════════════════════════

// ─── État global ─────────────────────────────────────────────────────────────
let token     = localStorage.getItem('la_token') || null;
let me        = JSON.parse(localStorage.getItem('la_user') || 'null');
let sseSource = null;
let sseRetryTimer = null;

// Data caches (indexed by ID for safe onclick references)
const _menuItemCache = {};
const _empCache = {};

// UI temporaire
let _dailyDate        = todayStr();
let _profilePhotoData = null;
let _ratingChoiceId   = null;
let _ratingStars      = 0;
let _subRestaurantId  = null;
let _orderRestaurantId = null;
let _chatPartnerId    = null;
let _chatPartnerSuffix = ''; // '' or 'ent'
let _mediaRecorder    = null;
let _audioChunks      = [];
let _recTimerInterval = null;
let _recSeconds       = 0;
let _confirmCallback  = null;

const SPECIALTIES = [
  'Cuisine africaine','Cuisine ivoirienne','Cuisine burkinabè','Cuisine sénégalaise',
  'Grillades / Brochettes','Fast food / Sandwichs','Pizzas','Burgers',
  'Cuisine asiatique','Cuisine française','Fruits de mer','Soupes / Bouillons',
  'Cuisine végétarienne','Pâtisserie / Desserts','Cuisine fusion',
];

function renderSpecialtyCheckboxes(containerId, selected = []) {
  const sel = Array.isArray(selected) ? selected : (selected ? [selected] : []);
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = SPECIALTIES.map(s =>
    `<label class="spec-chip"><input type="checkbox" value="${s}" ${sel.includes(s)?'checked':''}> ${s}</label>`
  ).join('');
}

function collectSpecialties(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return [];
  return Array.from(c.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}
let _adminTab         = 'ov';

// ─── Utilitaires ─────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
function fmtDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('fr-FR') : '';
}
function fmtPrice(n) {
  return Number(n || 0).toLocaleString('fr-FR') + ' FCFA';
}
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function stars(n) {
  return '⭐'.repeat(Math.max(0, Math.min(5, Math.round(n || 0))));
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  el('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────
function confirm2(msg, cb) {
  el('confirm-msg').textContent = msg;
  _confirmCallback = cb;
  el('confirm-overlay').classList.remove('hidden');
}
document.addEventListener('DOMContentLoaded', () => {
  el('confirm-ok').onclick     = () => { el('confirm-overlay').classList.add('hidden'); if (_confirmCallback) _confirmCallback(); };
  el('confirm-cancel').onclick = () => { el('confirm-overlay').classList.add('hidden'); };
});

// ─── Modals ───────────────────────────────────────────────────────────────────
function openModal(id) { el(id).classList.remove('hidden'); }
function closeModal(id) { el(id).classList.add('hidden'); }

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (r.status === 401) {
    const msg = data.error || 'Session expirée';
    localStorage.removeItem('la_token');
    localStorage.removeItem('la_user');
    token = null; me = null;
    if (sseSource) { sseSource.close(); sseSource = null; }
    if (sseRetryTimer) { clearTimeout(sseRetryTimer); sseRetryTimer = null; }
    toast(msg + ' — Veuillez vous reconnecter.', 'error');
    setTimeout(showLanding, 1800);
    throw new Error(msg);
  }
  if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
  return data;
}

// ─── Password helpers ─────────────────────────────────────────────────────────
function toggleEye(inputId, btn) {
  const inp = el(inputId);
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
  else                         { inp.type = 'password'; btn.textContent = '👁'; }
}
function pwdMeter(input, meterId) {
  const v = input.value;
  let score = 0;
  if (v.length >= 8) score++;
  if (/[A-Z]/.test(v)) score++;
  if (/[0-9]/.test(v)) score++;
  if (/[@$!%*?&._-]/.test(v)) score++;
  const labels = ['', 'Faible', 'Moyen', 'Bon', 'Fort'];
  const colors = ['', '#EF4444', '#F97316', '#0EA5E9', '#22C55E'];
  const m = el(meterId);
  m.textContent = score ? labels[score] : '';
  m.style.color = colors[score] || '';
}

// ─── Pay entries ──────────────────────────────────────────────────────────────
function addPayEntry(containerId) {
  const div = document.createElement('div');
  div.className = 'pay-entry';
  div.innerHTML = `<select class="pay-type"><option value="">Type</option>
    <option value="OM">Orange Money</option><option value="Wave">Wave</option>
    <option value="Moov">Moov Money</option><option value="Telecash">Telecash</option></select>
    <input type="text" class="pay-num" placeholder="Numéro / code agent"/>
    <button type="button" class="btn danger sm" onclick="this.parentElement.remove()">✕</button>`;
  el(containerId).appendChild(div);
}
function collectPayEntries(containerId) {
  return Array.from(el(containerId).querySelectorAll('.pay-entry')).map(d => ({
    type: d.querySelector('.pay-type').value,
    number: d.querySelector('.pay-num').value.trim(),
  })).filter(p => p.type && p.number);
}

// ─── Navigation screens ───────────────────────────────────────────────────────
function fadeIn(id) {
  const s = el(id);
  s.classList.remove('hidden');
  s.classList.remove('screen-enter');
  void s.offsetWidth; // force reflow pour relancer l'animation
  s.classList.add('screen-enter');
}

function showLanding() {
  el('auth-modal').classList.add('hidden');
  el('screen-app').classList.add('hidden');
  fadeIn('screen-landing');
  loadPublicStats();
}

function closeAuthModal() {
  el('auth-modal').classList.add('hidden');
}

async function loadPublicStats() {
  try {
    const r = await fetch('/api/stats/public');
    if (!r.ok) return;
    const d = await r.json();
    const eEl = el('land-stat-enterprises');
    const rEl = el('land-stat-restaurants');
    if (eEl) eEl.textContent = d.enterprises || '—';
    if (rEl) rEl.textContent = d.restaurants || '—';
  } catch (_) {}
}

function showAuth(tab) {
  const modal = el('auth-modal');
  modal.classList.remove('hidden');
  const card = modal.querySelector('.auth-modal-card');
  card.classList.remove('screen-enter');
  void card.offsetWidth;
  card.classList.add('screen-enter');
  authTab(tab || 'login');
}
function authTab(tab) {
  el('pane-login').classList.toggle('hidden', tab !== 'login');
  el('pane-register').classList.toggle('hidden', tab !== 'register');
  el('pane-forgot').classList.add('hidden');
  el('pane-reset').classList.add('hidden');
  el('tab-login').classList.toggle('active', tab === 'login');
  el('tab-register').classList.toggle('active', tab === 'register');
}

function showForgot() {
  el('pane-login').classList.add('hidden');
  el('pane-register').classList.add('hidden');
  el('pane-forgot').classList.remove('hidden');
  el('pane-reset').classList.add('hidden');
}

function showLogin() {
  authTab('login');
}

async function doForgot() {
  const email = el('forgot-email').value.trim();
  if (!email) { toast('Entrez votre email', 'error'); return; }
  try {
    const d = await api('POST', '/api/auth/forgot-password', { email });
    toast(d.message, 'success');
    el('forgot-email').value = '';
    setTimeout(showLogin, 2500);
  } catch (e) { toast(e.message, 'error'); }
}

async function doResetPassword() {
  const token   = el('reset-token').value;
  const newPwd  = el('reset-pwd').value;
  if (!newPwd) { toast('Entrez un nouveau mot de passe', 'error'); return; }
  try {
    const d = await api('POST', '/api/auth/reset-password', { token, newPassword: newPwd });
    toast(d.message, 'success');
    // Nettoyer l'URL et retourner à la connexion
    history.replaceState({}, '', '/');
    setTimeout(showLogin, 1500);
  } catch (e) { toast(e.message, 'error'); }
}
function switchRegType(type) {
  el('reg-ent').classList.toggle('hidden', type !== 'enterprise');
  el('reg-rst').classList.toggle('hidden', type !== 'restaurant');
}

// ─── Panes ────────────────────────────────────────────────────────────────────
function showPane(id) {
  document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
  const target = el('pane-' + id);
  if (target) {
    target.classList.remove('hidden');
    // Sidebar + bottom-nav highlight
    document.querySelectorAll('.sidebar-item, .bnav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`[data-pane="${id}"]`).forEach(b => b.classList.add('active'));
    // Auto-load
    onPaneLoad(id);
  }
}
function onPaneLoad(id) {
  switch (id) {
    case 'resto-home':      loadRestoHome(); break;
    case 'menus':           loadMenus(); break;
    case 'clientele':       loadClientele(); break;
    case 'rst-messages':    loadConversations(''); break;
    case 'ent-today':       loadEntToday(); break;
    case 'ent-restaurants': loadEntRestaurants(); break;
    case 'ent-menus':       loadEntMenus(); break;
    case 'ent-employees':   switchEntTab('emps'); break;
    case 'ent-messages':    loadConversations('ent'); break;
    case 'emp-menu':        loadEmpMenu(); break;
    case 'emp-history':     loadEmpHistory(); break;
    case 'admin':           loadAdminStats(); break;
    case 'notifs':          loadNotifs(); break;
  }
}

// ─── Enterprise — onglets internes ────────────────────────────────────────────
let _entTab = 'emps';
function switchEntTab(tab) {
  _entTab = tab;
  ['emps', 'orders', 'invoices', 'stats'].forEach(t => {
    const btn   = el('dtab-' + t);
    const panel = el('dtab-panel-' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'emps')     loadEntEmployees();
  if (tab === 'orders')   loadEntOrders();
  if (tab === 'invoices') loadEntInvoices();
  if (tab === 'stats')    loadEntStats();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function buildSidebar(role) {
  const items = {
    restauratrice: [
      { id: 'resto-home',   icon: '🏠', label: 'Accueil' },
      { id: 'menus',        icon: '📝', label: 'Mes plats' },
      { id: 'clientele',    icon: '📦', label: 'Commandes' },
      { id: 'rst-messages', icon: '💬', label: 'Messages' },
    ],
    enterprise: [
      { id: 'ent-today',       icon: '📋', label: 'Aujourd\'hui' },
      { id: 'ent-restaurants', icon: '🍴', label: 'Restaurants' },
      { id: 'ent-menus',       icon: '🗒️', label: 'Menus' },
      { id: 'ent-employees',   icon: '👥', label: 'Gestion' },
      { id: 'ent-messages',    icon: '💬', label: 'Messages' },
    ],
    employee: [
      { id: 'emp-menu',    icon: '🍽️', label: 'Menu du jour' },
      { id: 'emp-history', icon: '📜', label: 'Mon historique' },
    ],
    superadmin: [
      { id: 'admin', icon: '⚙️', label: 'Administration' },
    ],
  };
  const list = items[role] || [];

  const displayName = me.companyName || me.restaurantName || me.fullName || 'Admin';
  const initials = getUserInitials();
  const roleLabel = { enterprise: 'Entreprise', restauratrice: 'Restaurant', employee: 'Employé', superadmin: 'Administrateur' }[role] || role;

  el('sidebar').innerHTML = `
    <div class="sidebar-nav">
      ${list.map(it => `<button class="sidebar-item" data-pane="${it.id}" onclick="showPane('${it.id}')"><span class="sb-icon">${it.icon}</span><span class="sb-label">${it.label}</span></button>`).join('')}
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-avatar-circle">${esc(initials)}</div>
      <div class="sidebar-user-meta">
        <div class="sidebar-user-name">${esc(displayName)}</div>
        <div class="sidebar-user-role">${roleLabel}</div>
      </div>
    </div>`;

  const bn = el('bottom-nav');
  if (bn) bn.innerHTML = list.map(it =>
    `<button class="bnav-item" data-pane="${it.id}" onclick="showPane('${it.id}')"><span class="bnav-icon">${it.icon}</span>${it.label}</button>`
  ).join('');
}

// ─── Login / Register / Logout ────────────────────────────────────────────────
async function doLogin() {
  const email = el('l-id').value.trim();
  const pwd   = el('l-pwd').value;
  if (!email || !pwd) { toast('Remplissez tous les champs', 'error'); return; }
  try {
    const d = await api('POST', '/api/login', { email, password: pwd });
    token = d.token;
    me    = d.user;
    localStorage.setItem('la_token', token);
    localStorage.setItem('la_user', JSON.stringify(me));
    startApp();
  } catch (e) { toast(e.message, 'error'); }
}

async function doRegister(type) {
  try {
    let d;
    if (type === 'enterprise') {
      const companyName = el('r-company').value.trim();
      const email    = el('r-email').value.trim();
      const phone    = el('r-phone').value.trim();
      const location = el('r-location').value.trim();
      const password = el('r-pwd').value;
      d = await api('POST', '/api/enterprise/register', { companyName, email, phone, location, password });
    } else {
      const restaurantName = el('r-rname').value.trim();
      const fullName       = el('r-owner').value.trim();
      const email          = el('r-remail').value.trim();
      const phone          = el('r-rphone').value.trim();
      const address        = el('r-addr').value.trim();
      const specialty      = collectSpecialties('r-spec-container');
      const paymentInfo    = collectPayEntries('pay-entries');
      const password       = el('r-rpwd').value;
      d = await api('POST', '/api/restauratrice/register', { restaurantName, fullName, email, phone, address, specialty, paymentInfo, password });
    }
    token = d.token;
    me    = d.user;
    localStorage.setItem('la_token', token);
    localStorage.setItem('la_user', JSON.stringify(me));
    toast('Compte créé avec succès !', 'success');
    startApp();
  } catch (e) { toast(e.message, 'error'); }
}

function doLogout() {
  localStorage.removeItem('la_token');
  localStorage.removeItem('la_user');
  token = null; me = null;
  delete document.body.dataset.role;
  if (sseSource) { sseSource.close(); sseSource = null; }
  showLanding();
}

// ─── App init ─────────────────────────────────────────────────────────────────
function getUserInitials() {
  const name = (me && (me.companyName || me.restaurantName || me.fullName)) || 'U';
  const words = name.trim().split(/\s+/);
  return (words.length === 1 ? words[0].slice(0, 2) : (words[0][0] + words[words.length - 1][0])).toUpperCase();
}

function startApp() {
  el('screen-landing').classList.add('hidden');
  el('auth-modal').classList.add('hidden');
  document.body.dataset.role = me.role;
  fadeIn('screen-app');

  el('uname').textContent = me.companyName || me.restaurantName || me.fullName || 'Admin';
  const roleLabels = { enterprise: 'Entreprise', restauratrice: 'Restaurant', employee: 'Employé', superadmin: 'Admin' };
  el('urole').textContent = roleLabels[me.role] || me.role;

  const avatarEl = el('app-avatar');
  if (avatarEl) avatarEl.textContent = getUserInitials();

  buildSidebar(me.role);
  connectSSE();

  // Show first pane per role
  const first = { restauratrice: 'resto-home', enterprise: 'ent-today', employee: 'emp-menu', superadmin: 'admin' };
  showPane(first[me.role] || 'notifs');
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
let _sseRetryCount = 0;
function connectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  if (!token) return;

  sseSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

  sseSource.addEventListener('connected', () => { _sseRetryCount = 0; });

  sseSource.addEventListener('notification', e => {
    const notif = JSON.parse(e.data);
    updateNotifBadge();
    toast(notif.title + ': ' + notif.message, 'info');
    // Si c'est une mise à jour de menu et que l'employé est sur la vue menu, rafraîchir
    if (notif.type === 'menu_updated' && me && me.role === 'employee') {
      const pane = el('pane-emp-menu');
      if (pane && !pane.classList.contains('hidden')) loadEmpMenu();
    }
  });

  // Rafraîchir le chat ouvert dès réception d'un nouveau message
  sseSource.addEventListener('new_message', e => {
    const msg = JSON.parse(e.data);
    if (_chatPartnerId && (msg.senderId === _chatPartnerId || msg.recipientId === _chatPartnerId)) {
      refreshChat(_chatPartnerSuffix);
    }
    // Mettre à jour le badge de notifications
    updateNotifBadge();
  });

  sseSource.onerror = () => {
    if (!token) return; // Déconnecté, pas de retry
    _sseRetryCount++;
    // Arrêter après 5 tentatives (token probablement invalide)
    if (_sseRetryCount > 5) {
      if (sseSource) { sseSource.close(); sseSource = null; }
      return;
    }
    if (!sseRetryTimer) {
      sseRetryTimer = setTimeout(() => {
        sseRetryTimer = null;
        if (token) connectSSE();
      }, Math.min(5000 * _sseRetryCount, 30000));
    }
  };
}

async function updateNotifBadge() {
  try {
    const notifs = await api('GET', '/api/notifications');
    const unread = notifs.filter(n => !n.read).length;
    const badge = el('notif-count');
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTAURANT — Accueil & Stats
// ═══════════════════════════════════════════════════════════════════════════

async function loadRestoHome() {
  try {
    const r = await api('GET', '/api/restaurant/me');
    el('resto-profile-view').innerHTML = `
      <div class="dash-welcome">
        ${r.photo
          ? `<img src="${esc(r.photo)}" class="dash-welcome-photo"/>`
          : '<div class="dash-welcome-ph">🍴</div>'}
        <div class="dash-welcome-info">
          <h2>${esc(r.restaurantName)}</h2>
          <p>${esc(r.fullName)}${r.phone ? ' · ' + esc(r.phone) : ''}</p>
          ${r.specialty ? `<p style="opacity:.75;font-size:12px;margin-top:2px">${esc(r.specialty)}</p>` : ''}
          ${r.address   ? `<p style="opacity:.7;font-size:12px">📍 ${esc(r.address)}</p>` : ''}
          ${r.paymentInfo?.length ? `<p style="opacity:.7;font-size:12px">💳 ${r.paymentInfo.map(p=>`${p.type}: ${esc(p.number)}`).join(' · ')}</p>` : ''}
        </div>
        <button class="btn sm welcome-edit" onclick="openProfileModal()">✏️ Modifier</button>
      </div>`;
    await loadRestoStats();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadRestoStats() {
  const freq = el('rst-freq')?.value || 'monthly';
  try {
    const s = await api('GET', `/api/stats/restaurant?frequency=${freq}`);
    const topItems = Object.entries(s.itemCounts || {}).sort((a,b) => b[1]-a[1]).slice(0,5);
    el('rst-stats').innerHTML = `
      <div class="section-header">
        <div class="section-icon">📊</div>
        <h3>Statistiques</h3>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-icon">📦</div>
          <div class="kpi-body"><div class="kpi-num">${s.totalOrders}</div><div class="kpi-lbl">Commandes</div></div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-icon">💰</div>
          <div class="kpi-body"><div class="kpi-num">${fmtPrice(s.totalRevenue)}</div><div class="kpi-lbl">Recettes totales</div></div>
        </div>
        <div class="kpi-card blue">
          <div class="kpi-icon">⭐</div>
          <div class="kpi-body"><div class="kpi-num">${s.avgRating ? s.avgRating.toFixed(1) : '—'}</div><div class="kpi-lbl">Note moyenne (${s.ratingCount} avis)</div></div>
        </div>
      </div>
      ${topItems.length ? `
      <div class="section-header" style="margin-top:8px">
        <div class="section-icon">🏆</div>
        <h3>Plats les plus demandés</h3>
      </div>
      <ul class="item-list">${topItems.map(([n,c]) => `<li>${esc(n)} <span class="badge">${c}x</span></li>`).join('')}</ul>` : ''}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function pdfRestoStats() {
  // ── Données ──────────────────────────────────────────────────────────────
  const freq = el('rst-freq')?.value || 'monthly';
  const freqLabels = { daily: "Aujourd'hui", weekly: '7 derniers jours', monthly: 'Ce mois', quarterly: 'Ce trimestre' };
  let s;
  try { s = await api('GET', `/api/stats/restaurant?frequency=${freq}`); }
  catch(e) { toast('Impossible de charger les données', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14, CW = W - 2 * M;
  const navy=[15,23,42], blue=[14,165,233], orange=[249,115,22], green=[34,197,94];
  const light=[241,245,249], border=[226,232,240], dark=[30,41,59], gray=[100,116,139], white=[255,255,255];
  const fmtN = n => Number(n||0).toLocaleString('fr-FR');
  const fmtP = n => Number(n||0).toLocaleString('fr-FR') + ' FCFA';

  function footer() {
    const t = doc.getNumberOfPages();
    for (let p = 1; p <= t; p++) {
      doc.setPage(p);
      doc.setFillColor(...navy); doc.rect(0, 285, W, 12, 'F');
      doc.setFillColor(...orange); doc.rect(0, 285, 5, 12, 'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text('LunchApp — Rapport de performance restaurant', M+5, 292);
      doc.text(`Page ${p} / ${t}`, W-M, 292, { align:'right' });
    }
  }

  const rName = (me && me.restaurantName) || 'Restaurant';
  const dateStr = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });

  // ── HEADER ──────────────────────────────────────────────────────────────
  doc.setFillColor(...navy); doc.rect(0, 0, W, 50, 'F');
  doc.setFillColor(...orange); doc.rect(0, 0, 5, 50, 'F');
  // Titre + sous-titre
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...orange);
  doc.text('LUNCHAPP — RAPPORT DE PERFORMANCE', M+5, 11);
  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(...white);
  doc.text(rName, M+5, 26);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(148,163,184);
  doc.text(`Periode : ${freqLabels[freq]||freq}   |   Genere le : ${dateStr}`, M+5, 39);
  // Badge note à droite
  if (s.avgRating) {
    doc.setFillColor(...orange); doc.roundedRect(W-M-30, 10, 30, 18, 3, 3, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...white);
    doc.text(s.avgRating.toFixed(1), W-M-15, 22, { align:'center' });
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(255,220,180);
    doc.text(`/ 5  (${fmtN(s.ratingCount)} avis)`, W-M-15, 28, { align:'center' });
  }

  let y = 60;

  // ── KPI CARDS (2 grandes) ────────────────────────────────────────────────
  const cw2 = (CW - 6) / 2;
  [[fmtN(s.totalOrders), 'Commandes recues', blue],
   [fmtP(s.totalRevenue), 'Recettes totales', green]
  ].forEach(([val, lbl, col], i) => {
    const cx = M + i*(cw2+6);
    doc.setFillColor(...light); doc.roundedRect(cx, y, cw2, 22, 2, 2, 'F');
    doc.setFillColor(...col); doc.roundedRect(cx, y, cw2, 3.5, 2, 2, 'F'); doc.rect(cx, y+1.5, cw2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(i===1?9:17); doc.setTextColor(...col);
    doc.text(val, cx+cw2/2, y+14, { align:'center', maxWidth: cw2-4 });
    doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    doc.text(lbl, cx+cw2/2, y+19, { align:'center' });
  });
  y += 30;

  // ── MOYENS DE PAIEMENT (barres) ──────────────────────────────────────────
  const pays = Object.entries(s.paymentMethods || {}).sort((a,b)=>b[1]-a[1]);
  if (pays.length) {
    doc.setFillColor(...blue); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Repartition des paiements', M+5, y+7.5);
    y += 15;

    const maxPay = Math.max(...pays.map(([,v])=>v));
    const barMaxW = CW - 55;
    pays.forEach(([method, count]) => {
      const pct = maxPay ? count / maxPay : 0;
      const barW = Math.max(2, pct * barMaxW);
      // Label
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...dark);
      const mLabel = { OM:'Orange Money', Wave:'Wave', Moov:'Moov Money', Telecash:'Telecash' }[method] || method;
      doc.text(mLabel, M, y+5.5);
      // Barre de fond
      doc.setFillColor(...border); doc.roundedRect(M+42, y+1, barMaxW, 6, 1, 1, 'F');
      // Barre colorée
      doc.setFillColor(...blue); doc.roundedRect(M+42, y+1, barW, 6, 1, 1, 'F');
      // Compteur
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...blue);
      doc.text(`${fmtN(count)}x  (${Math.round(pct*100)}%)`, M+42+barMaxW+3, y+5.5);
      y += 11;
    });
    y += 6;
  }

  // ── TOP PLATS avec rang ──────────────────────────────────────────────────
  const topItems = Object.entries(s.itemCounts||{}).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if (topItems.length) {
    if (y + 14 + topItems.length*9 > 272) { doc.addPage(); y = 20; }
    doc.setFillColor(...orange); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Classement des plats & boissons', M+5, y+7.5);
    y += 14;

    doc.setFillColor(...border); doc.rect(M, y, CW, 7, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    doc.text('#', M+3, y+5); doc.text('PLAT / BOISSON', M+14, y+5);
    doc.text('NB COMMANDES', W-M-4, y+5, { align:'right' });
    y += 9;

    const maxItem = topItems[0][1];
    topItems.forEach(([name, count], idx) => {
      if (y > 272) { doc.addPage(); y = 20; }
      if (idx%2===0) { doc.setFillColor(255,252,245); doc.rect(M, y-1, CW, 9, 'F'); }
      doc.setDrawColor(...border); doc.setLineWidth(0.15); doc.line(M, y+7.5, W-M, y+7.5);
      // Rang coloré si top 3
      const rankCol = idx===0?[249,115,22]:idx===1?[100,116,139]:idx===2?[180,140,80]:dark;
      doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(...rankCol);
      doc.text(`${idx+1}`, M+3, y+5.5);
      doc.setFont('helvetica','normal'); doc.setTextColor(...dark);
      const n = String(name); doc.text(n.length>42?n.slice(0,42)+'…':n, M+14, y+5.5);
      // Mini barre
      const bw = Math.max(1, (count/maxItem)*28);
      doc.setFillColor(...orange); doc.roundedRect(W-M-38, y+2, bw, 4, 0.5, 0.5, 'F');
      doc.setFont('helvetica','bold'); doc.setTextColor(...orange);
      doc.text(`${fmtN(count)}x`, W-M-4, y+5.5, { align:'right' });
      y += 9;
    });
  }

  footer();
  doc.save(`rapport-restaurant-${freq}-${new Date().toISOString().slice(0,10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTAURANT — Menus
// ═══════════════════════════════════════════════════════════════════════════

async function loadMenus() {
  try {
    const menu = await api('GET', '/api/restaurant/menu');
    const items = menu.items || [];
    const foods  = items.filter(i => i.category === 'food');
    const drinks = items.filter(i => i.category === 'drink');

    function renderItems(arr) {
      if (!arr.length) return '<p class="empty">Aucun article.</p>';
      return arr.map(i => {
        _menuItemCache[i.id] = i;
        return `<div class="item-row">
          <div class="item-main">
            <span class="item-name">${esc(i.name)}</span>
            ${i.description ? `<span class="item-desc">${esc(i.description)}</span>` : ''}
          </div>
          <span class="item-price">${fmtPrice(i.price)}</span>
          <button class="btn ghost sm" onclick="openItemModal('${i.id}')">✏️</button>
          <button class="btn danger sm" onclick="deleteItem('${i.id}')">🗑️</button>
        </div>`;
      }).join('');
    }

    el('full-menu-list').innerHTML = `
      <div class="pane-header" style="margin-top:8px">
        <h3>🍽️ Nourriture (${foods.length})</h3>
        <button class="btn primary sm" onclick="openItemModal(null,'food')">+ Plat</button>
      </div>${renderItems(foods)}
      <div class="pane-header" style="margin-top:16px">
        <h3>🥤 Boissons (${drinks.length})</h3>
        <button class="btn primary sm" onclick="openItemModal(null,'drink')">+ Boisson</button>
      </div>${renderItems(drinks)}`;

    // Daily menu
    if (!el('day-label').textContent) el('day-label').textContent = fmtDate(_dailyDate);
    await loadDailyMenu(items);
  } catch (e) { toast(e.message, 'error'); }
}

function shiftDay(n) {
  const d = new Date(_dailyDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  _dailyDate = d.toISOString().slice(0, 10);
  el('day-label').textContent = fmtDate(_dailyDate);
  loadDailyMenuOnly();
}

async function loadDailyMenuOnly() {
  try {
    const menu = await api('GET', '/api/restaurant/menu');
    await loadDailyMenu(menu.items || []);
  } catch {}
}

async function loadDailyMenu(allItems) {
  try {
    const daily = await api('GET', `/api/restaurant/menu/daily?date=${_dailyDate}`);
    const available = new Set(daily.availableItems || []);

    if (!allItems.length) { el('daily-menu-list').innerHTML = '<p class="empty">Ajoutez d\'abord des articles.</p>'; return; }

    el('daily-menu-list').innerHTML = allItems.map(i => `
      <div class="daily-row">
        <label class="toggle-label">
          <span class="item-name">${esc(i.name)}</span>
          <span class="item-cat">${i.category === 'food' ? '🍽️' : '🥤'}</span>
        </label>
        <label class="toggle-switch">
          <input type="checkbox" ${available.has(i.id) ? 'checked' : ''}
            onchange="toggleDailyItem('${i.id}', this.checked)"/>
          <span class="slider"></span>
        </label>
      </div>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleDailyItem(itemId, checked) {
  try {
    const daily = await api('GET', `/api/restaurant/menu/daily?date=${_dailyDate}`);
    let available = daily.availableItems || [];
    if (checked) { if (!available.includes(itemId)) available.push(itemId); }
    else          { available = available.filter(id => id !== itemId); }
    await api('PUT', '/api/restaurant/menu/daily', { date: _dailyDate, availableItems: available });
  } catch (e) { toast(e.message, 'error'); }
}

// Item modal
function openItemModal(itemIdOrNull, presetCategory) {
  const item = itemIdOrNull ? _menuItemCache[itemIdOrNull] : null;
  el('modal-item-title').textContent = item ? 'Modifier l\'article' : 'Nouvel article';
  el('mi-id').value    = item?.id || '';
  el('mi-name').value  = item?.name || '';
  el('mi-cat').value   = item?.category || presetCategory || '';
  el('mi-price').value = item?.price ?? '';
  el('mi-desc').value  = item?.description || '';
  openModal('modal-item');
}

async function saveItem() {
  const id    = el('mi-id').value;
  const name  = el('mi-name').value.trim();
  const cat   = el('mi-cat').value;
  const price = el('mi-price').value;
  const desc  = el('mi-desc').value.trim();
  if (!name || !cat || price === '') { toast('Nom, catégorie et prix requis', 'error'); return; }
  try {
    if (id) await api('PUT', `/api/restaurant/menu/items/${id}`, { name, category: cat, price: Number(price), description: desc });
    else    await api('POST', '/api/restaurant/menu/items', { name, category: cat, price: Number(price), description: desc });
    closeModal('modal-item');
    toast('Article enregistré', 'success');
    loadMenus();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteItem(id) {
  try {
    await api('DELETE', `/api/restaurant/menu/items/${id}`);
    toast('Article supprimé', 'success');
    loadMenus();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTAURANT — Clientèle
// ═══════════════════════════════════════════════════════════════════════════

async function loadClientele() {
  try {
    const [clients, orders, subs, enterprises, invoices] = await Promise.all([
      api('GET', '/api/restaurant/clientele'),
      api('GET', '/api/orders'),
      api('GET', '/api/subscriptions'),
      api('GET', '/api/restaurant/enterprises'),
      api('GET', '/api/invoices'),
    ]);

    const invoiceByOrder = {};
    invoices.forEach(i => { invoiceByOrder[i.orderId] = i; });

    // Grouper commandes par entreprise
    const byEnt = {};
    orders.forEach(o => {
      if (!byEnt[o.enterpriseId]) byEnt[o.enterpriseId] = { name: o.enterpriseName, orders: [] };
      byEnt[o.enterpriseId].orders.push(o);
    });
    // Ajouter les affiliés sans commandes
    clients.forEach(c => {
      if (!byEnt[c.id]) byEnt[c.id] = { name: c.companyName, orders: [], todayChoices: c.todayChoices || [] };
      else byEnt[c.id].todayChoices = c.todayChoices || [];
    });

    const statusBtns = o => {
      const inv = invoiceByOrder[o.id];
      const actions = [];
      if (o.status === 'pending')   actions.push(`<button class="btn primary sm" onclick="updateOrderStatus('${o.id}','confirmed')">✅ Accuser réception</button>`);
      if (o.status === 'confirmed') actions.push(`<button class="btn ghost sm" onclick="updateOrderStatus('${o.id}','preparing')">🍳 En préparation</button>`);
      if (['confirmed','preparing'].includes(o.status)) actions.push(`<button class="btn success sm" onclick="updateOrderStatus('${o.id}','delivered')">🚚 Livrée</button>`);
      if (!inv && o.status !== 'pending') actions.push(`<button class="btn primary sm" onclick="createInvoice('${o.id}')">🧾 Faire la facture</button>`);
      if (inv) actions.push(`<button class="btn outline sm" onclick="downloadInvoice('${inv.id}')">⬇ Facture (${inv.status})</button>`);
      return actions.join('');
    };

    el('clientele-list').innerHTML = Object.values(byEnt).length
      ? Object.values(byEnt).map(g => `
          <div class="enterprise-group">
            <div class="group-header">
              <strong>🏢 ${esc(g.name)}</strong>
              <span class="badge">${(g.todayChoices||[]).length} choix aujourd'hui</span>
            </div>
            ${g.orders.length ? `
            <table class="choice-table" style="margin-top:10px">
              <thead><tr><th>Date</th><th>Repas</th><th>Total</th><th>Statut</th><th>Actions</th></tr></thead>
              <tbody>${g.orders.map(o => `<tr>
                <td>${fmtDateTime(o.createdAt)}</td>
                <td>${o.items?.length||0} repas</td>
                <td>${fmtPrice(o.totalAmount)}</td>
                <td><span class="badge ${o.status}">${o.status}</span></td>
                <td class="order-btns">${statusBtns(o)}</td>
              </tr>`).join('')}</tbody>
            </table>` : '<p class="empty" style="margin:6px 0">Aucune commande pour cette entreprise.</p>'}
          </div>`).join('')
      : '<p class="empty">Aucune entreprise affiliée.</p>';

    // Abonnements
    const freqLabels = { weekly: 'Hebdomadaire', monthly: 'Mensuel', quarterly: 'Trimestriel', 'semi-annual': 'Semestriel', annual: 'Annuel' };
    const statusLabels = { pending: 'En attente', accepted: 'Actif', declined: 'Refusé' };
    el('rst-subs-list').innerHTML = subs.length
      ? subs.map(s => {
          const hasSubInvoice = invoices.some(i => i.subscriptionId === s.id);
          return `
          <div class="sub-card">
            <div>
              <span><strong>${esc(s.enterpriseName)}</strong> — <em>${freqLabels[s.frequency] || s.frequency}</em></span>
              <span class="badge ${s.status}">${statusLabels[s.status] || s.status}</span>
            </div>
            ${s.status === 'pending' ? `
              <div class="sub-btns">
                <button class="btn primary sm" onclick="respondSub('${s.id}','accepted')">✓ Accepter</button>
                <button class="btn danger sm"  onclick="respondSub('${s.id}','declined')">✕ Refuser</button>
              </div>` : ''}
            ${s.status === 'accepted' ? `
              <div class="sub-btns">
                ${hasSubInvoice
                  ? '<span class="badge success">✅ Facture envoyée</span>'
                  : `<button class="btn primary sm" onclick="createSubInvoice('${s.id}')">🧾 Générer la facture</button>`}
              </div>` : ''}
          </div>`;
        }).join('')
      : '<p class="empty">Aucune demande d\'abonnement.</p>';

    // Proposer services
    el('rst-enterprises-list').innerHTML = enterprises.map(e => `
      <div class="ent-row">
        <span>${esc(e.companyName)}</span>
        ${e.isAffiliated ? '<span class="badge success">Affiliée</span>' : ''}
        ${!e.hasOffer && !e.isAffiliated
          ? `<button class="btn primary sm" onclick="offerService('${e.id}')">📤 Proposer</button>`
          : e.hasOffer && !e.isAffiliated
          ? `<button class="btn outline sm" onclick="withdrawOffer('${e.id}')">Retirer l'offre</button>`
          : ''}
      </div>`).join('') || '<p class="empty">Aucune entreprise.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

// Créer une facture pour une commande (restaurant)
async function createInvoice(orderId) {
  try {
    await api('POST', '/api/invoices', { orderId });
    toast('Facture générée et envoyée !', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

// Créer une facture globale pour un abonnement (restaurant)
async function createSubInvoice(subId) {
  try {
    await api('POST', `/api/subscriptions/${subId}/invoice`);
    toast('Facture d\'abonnement générée et envoyée !', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

// Télécharger une facture (restaurant)
async function downloadInvoice(invoiceId) {
  try {
    const res = await fetch(`/api/invoices/${invoiceId}/pdf`, { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) { toast('PDF non disponible', 'error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `facture-${invoiceId.slice(0,8)}.pdf`;
    a.click();
  } catch (e) { toast(e.message, 'error'); }
}

async function updateOrderStatus(orderId, status) {
  try {
    await api('PUT', `/api/orders/${orderId}/status`, { status });
    toast('Statut mis à jour', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

async function respondSub(id, status) {
  try {
    await api('PUT', `/api/subscriptions/${id}`, { status });
    toast(status === 'accepted' ? 'Abonnement accepté' : 'Abonnement refusé', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

async function offerService(enterpriseId) {
  try {
    await api('POST', `/api/restaurant/enterprises/${enterpriseId}/offer`);
    toast('Offre envoyée', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

async function withdrawOffer(enterpriseId) {
  try {
    await api('DELETE', `/api/restaurant/enterprises/${enterpriseId}/offer`);
    toast('Offre retirée', 'success');
    loadClientele();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTAURANT — Profil
// ═══════════════════════════════════════════════════════════════════════════

async function openProfileModal() {
  try {
    const r = await api('GET', '/api/restaurant/me');
    el('prof-rname').value = r.restaurantName || '';
    el('prof-fname').value = r.fullName || '';
    el('prof-phone').value = r.phone || '';
    el('prof-addr').value  = r.address || '';
    const spec = Array.isArray(r.specialty) ? r.specialty : (r.specialty ? [r.specialty] : []);
    renderSpecialtyCheckboxes('prof-spec-container', spec);
    el('prof-desc').value  = r.description || '';
    el('prof-oldpwd').value = '';
    el('prof-newpwd').value = '';
    _profilePhotoData = r.photo || null;

    const img = el('prof-img');
    if (r.photo) { img.src = r.photo; img.classList.remove('hidden'); el('prof-clear-btn').classList.remove('hidden'); }
    else         { img.classList.add('hidden'); el('prof-clear-btn').classList.add('hidden'); }

    // Payment info
    const container = el('prof-pay-entries');
    container.innerHTML = '';
    (r.paymentInfo || []).forEach(p => {
      addPayEntry('prof-pay-entries');
      const entries = container.querySelectorAll('.pay-entry');
      const last = entries[entries.length - 1];
      last.querySelector('.pay-type').value = p.type;
      last.querySelector('.pay-num').value  = p.number;
    });

    openModal('modal-profile');
  } catch (e) { toast(e.message, 'error'); }
}

function onPhotoFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _profilePhotoData = e.target.result;
    el('prof-img').src = _profilePhotoData;
    el('prof-img').classList.remove('hidden');
    el('prof-clear-btn').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearProfilePhoto() {
  _profilePhotoData = '';
  el('prof-img').classList.add('hidden');
  el('prof-clear-btn').classList.add('hidden');
}

async function saveProfile() {
  const body = {
    restaurantName: el('prof-rname').value.trim(),
    fullName:       el('prof-fname').value.trim(),
    phone:          el('prof-phone').value.trim(),
    address:        el('prof-addr').value.trim(),
    specialty:      collectSpecialties('prof-spec-container'),
    description:    el('prof-desc').value.trim(),
    paymentInfo:    collectPayEntries('prof-pay-entries'),
    photo:          _profilePhotoData || '',
  };
  const oldpwd = el('prof-oldpwd').value;
  const newpwd = el('prof-newpwd').value;
  if (newpwd) { body.password = oldpwd; body.newPassword = newpwd; }
  try {
    await api('PATCH', '/api/restaurant/profile', body);
    closeModal('modal-profile');
    toast('Profil enregistré', 'success');
    loadRestoHome();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE — Aujourd'hui
// ═══════════════════════════════════════════════════════════════════════════

async function loadEntToday() {
  try {
    const [choices, affiliated, orders] = await Promise.all([
      api('GET', '/api/choices/today'),
      api('GET', '/api/enterprise/restaurants'),
      api('GET', '/api/orders'),
    ]);

    if (!affiliated.length) {
      el('ent-today-content').innerHTML = '<p class="empty">Aucun restaurant affilié. Affiliez-vous dans l\'onglet Restaurants.</p>';
      return;
    }

    // Commandes déjà lancées aujourd'hui
    const today = todayStr();
    const orderedToday = new Set(orders.filter(o => o.date === today).map(o => o.restaurantId));

    // Group choices by restaurant
    const byResto = {};
    choices.forEach(c => {
      if (!byResto[c.restaurantId]) byResto[c.restaurantId] = { name: c.restaurantName, choices: [] };
      byResto[c.restaurantId].choices.push(c);
    });

    const employees = await api('GET', '/api/enterprise/employees');
    const hasChoice = new Set(choices.map(c => c.userId));
    const without   = employees.filter(e => !hasChoice.has(e.id));

    let html = `<h3>📅 ${fmtDate(todayStr())}</h3>`;

    if (!choices.length) {
      html += '<p class="empty">Aucun choix enregistré pour aujourd\'hui.</p>';
    } else {
      Object.values(byResto).forEach(g => {
        const total = g.choices.reduce((s,c) => s + (c.foodItem?.price||0) + (c.drinkItem?.price||0), 0);
        html += `<div class="resto-group">
          <div class="group-header">
            <h4>🍴 ${esc(g.name)}</h4>
            <span>Total: ${fmtPrice(total)}</span>
            ${orderedToday.has(g.choices[0].restaurantId)
              ? '<span class="badge success">✓ Commandé</span>'
              : `<button class="btn primary sm" onclick="launchOrder('${g.choices[0].restaurantId}')">🚀 Lancer la commande</button>`}
          </div>
          <table class="choice-table">
            <thead><tr><th>Employé</th><th>Plat</th><th>Boisson</th><th>Montant</th></tr></thead>
            <tbody>${g.choices.map(c => `<tr>
              <td>${esc(c.userName)}</td>
              <td>${c.foodItem ? esc(c.foodItem.name) : '—'}</td>
              <td>${c.drinkItem ? esc(c.drinkItem.name) : '—'}</td>
              <td>${fmtPrice((c.foodItem?.price||0)+(c.drinkItem?.price||0))}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>`;
      });
    }

    if (without.length) {
      html += `<div class="warn-box">⚠️ Sans choix: ${without.map(e => esc(e.fullName)).join(', ')}</div>`;
    }

    el('ent-today-content').innerHTML = html;
  } catch (e) { toast(e.message, 'error'); }
}

async function downloadOrdersPDF() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await fetch('/api/stats/pdf/orders', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!res.ok) { toast('Erreur lors de la génération du PDF', 'error'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `commandes-${today}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { toast(e.message, 'error'); }
}

async function launchOrder(restaurantId) {
  try {
    await api('POST', '/api/orders', { restaurantId });
    toast('Commande lancée ! Le restaurant a été notifié.', 'success');
    loadEntToday();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE — Restaurants
// ═══════════════════════════════════════════════════════════════════════════

let _restoTabMode = 'all';

async function loadEntRestaurants() {
  switchRestoTab(_restoTabMode);
}

async function switchRestoTab(mode) {
  _restoTabMode = mode;
  el('seg-all').classList.toggle('active', mode === 'all');
  el('seg-aff').classList.toggle('active', mode === 'affiliated');
  try {
    const [all, affiliated, mySubs] = await Promise.all([
      api('GET', '/api/restaurants'),
      api('GET', '/api/enterprise/restaurants'),
      api('GET', '/api/subscriptions'),
    ]);
    const affIds = new Set(affiliated.map(r => r.id));
    const list   = mode === 'all' ? all : affiliated;

    // Indexer les abonnements par restaurantId
    const subByResto = {};
    mySubs.forEach(s => { subByResto[s.restaurantId] = s; });

    const subStatusLabel = { pending: '⏳ Abonnement en attente', accepted: '✅ Abonnement actif', declined: '❌ Abonnement refusé' };
    const subStatusClass = { pending: 'warning', accepted: 'success', declined: 'danger' };

    el('ent-restaurants-list').innerHTML = list.length
      ? list.map(r => {
          const sub = subByResto[r.id];
          return `
          <div class="resto-card">
            ${r.photo ? `<img src="${esc(r.photo)}" class="resto-thumb"/>` : '<div class="resto-thumb-ph">🍴</div>'}
            <div class="resto-info">
              <h4>${esc(r.restaurantName)}</h4>
              ${r.specialty?.length ? `<p>${esc(Array.isArray(r.specialty)?r.specialty.join(', '):r.specialty)}</p>` : ''}
              ${r.address   ? `<p>📍 ${esc(r.address)}</p>` : ''}
              ${r.phone     ? `<p>📞 ${esc(r.phone)}</p>` : ''}
              ${affIds.has(r.id) && r.dailyMenu
                ? `<p class="daily-preview">Menu du jour : ${[...r.dailyMenu.foods, ...r.dailyMenu.drinks].map(i => esc(i.name)).join(', ') || 'Non défini'}</p>`
                : ''}
              ${sub ? `<p><span class="badge ${subStatusClass[sub.status]||''}">${subStatusLabel[sub.status]||sub.status}</span> <em>(${sub.frequency})</em></p>` : ''}
            </div>
            <div class="resto-actions">
              ${affIds.has(r.id)
                ? `<span class="badge success">Affilié</span>
                   <button class="btn ghost sm" onclick="disaffiliate('${r.id}')">Se désaffilier</button>
                   ${!sub || sub.status === 'declined'
                     ? `<button class="btn primary sm" onclick="openSubModal('${r.id}','${esc(r.restaurantName)}')">📅 Abonnement</button>`
                     : ''}`
                : `<button class="btn primary sm" onclick="affiliate('${r.id}')">+ S'affilier</button>`}
            </div>
          </div>`;
        }).join('')
      : '<p class="empty">Aucun restaurant.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function affiliate(restaurantId) {
  try {
    await api('POST', `/api/enterprise/restaurants/${restaurantId}/affiliate`);
    toast('Affilié !', 'success');
    loadEntRestaurants();
  } catch (e) { toast(e.message, 'error'); }
}

async function disaffiliate(restaurantId) {
  try {
    await api('DELETE', `/api/enterprise/restaurants/${restaurantId}/affiliate`);
    toast('Désaffilié', 'success');
    loadEntRestaurants();
  } catch (e) { toast(e.message, 'error'); }
}

function openSubModal(restaurantId, name) {
  _subRestaurantId = restaurantId;
  el('sub-rname').textContent = name;
  el('sub-rid').value = restaurantId;
  openModal('modal-sub');
}

async function submitSub() {
  const freq = el('sub-freq').value;
  try {
    await api('POST', '/api/subscriptions', { restaurantId: _subRestaurantId, frequency: freq });
    closeModal('modal-sub');
    toast('Demande d\'abonnement envoyée', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE — Menus des restaurants affiliés
// ═══════════════════════════════════════════════════════════════════════════

async function loadEntMenus() {
  try {
    const restaurants = await api('GET', '/api/enterprise/restaurants');
    if (!restaurants.length) {
      el('ent-menus-content').innerHTML = '<p class="empty">Aucun restaurant affilié. Affiliez-vous dans l\'onglet Restaurants.</p>';
      return;
    }
    el('ent-menus-content').innerHTML = restaurants.map(r => {
      const foods  = (r.menu || []).filter(i => i.category === 'food');
      const drinks = (r.menu || []).filter(i => i.category === 'drink');
      const dayFoods  = r.dailyMenu?.foods  || [];
      const dayDrinks = r.dailyMenu?.drinks || [];
      return `<div class="menu-resto-card">
        <div class="pane-header" style="margin-bottom:8px">
          <h4>🍴 ${esc(r.restaurantName)}</h4>
          ${r.specialty ? `<span class="badge">${esc(r.specialty)}</span>` : ''}
        </div>
        <p class="hint" style="margin-bottom:8px">Menu du jour : ${dayFoods.length + dayDrinks.length ? [...dayFoods,...dayDrinks].map(i=>esc(i.name)).join(', ') : 'Non défini'}</p>
        ${foods.length ? `<div class="menu-section"><h5>🍽️ Plats complets (${foods.length})</h5>
          <table class="choice-table" style="min-width:0">
            <thead><tr><th>Nom</th><th>Prix</th><th>Dispo aujourd'hui</th></tr></thead>
            <tbody>${foods.map(f => {
              const inDay = (r.dailyMenu?.foods||[]).some(d=>d.id===f.id);
              return `<tr><td>${esc(f.name)}</td><td>${fmtPrice(f.price)}</td>
                <td>${inDay ? '<span class="badge success">✓ Oui</span>' : '<span class="badge">Non</span>'}</td></tr>`;
            }).join('')}</tbody>
          </table></div>` : ''}
        ${drinks.length ? `<div class="menu-section" style="margin-top:10px"><h5>🥤 Boissons (${drinks.length})</h5>
          <table class="choice-table" style="min-width:0">
            <thead><tr><th>Nom</th><th>Prix</th><th>Dispo aujourd'hui</th></tr></thead>
            <tbody>${drinks.map(d => {
              const inDay = (r.dailyMenu?.drinks||[]).some(x=>x.id===d.id);
              return `<tr><td>${esc(d.name)}</td><td>${fmtPrice(d.price)}</td>
                <td>${inDay ? '<span class="badge success">✓ Oui</span>' : '<span class="badge">Non</span>'}</td></tr>`;
            }).join('')}</tbody>
          </table></div>` : ''}
        ${!foods.length && !drinks.length ? '<p class="empty">Ce restaurant n\'a pas encore publié de menu.</p>' : ''}
      </div>`;
    }).join('');
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE — Employés, Commandes, Stats
// ═══════════════════════════════════════════════════════════════════════════

async function loadEntEmployees() {
  try {
    const employees = await api('GET', '/api/enterprise/employees');
    el('ent-emp-list').innerHTML = employees.length
      ? employees.map(e => {
          _empCache[e.id] = e;
          return `<div class="emp-row">
            <span>${e.gender === 'female' ? '👩' : '👨'} ${esc(e.fullName)}</span>
            <div>
              <button class="btn ghost sm" onclick="openEmpModal('${e.id}')">✏️</button>
              <button class="btn danger sm" onclick="deleteEmployee('${e.id}')">🗑️</button>
            </div>
          </div>`;
        }).join('')
      : '<p class="empty">Aucun employé. Ajoutez-en avec le bouton +</p>';
  } catch (e) { toast(e.message, 'error'); }
}

function openEmpModal(empIdOrNull) {
  const emp = empIdOrNull ? _empCache[empIdOrNull] : null;
  el('modal-emp-title').textContent = emp ? 'Modifier l\'employé' : 'Nouvel employé';
  el('emp-id').value     = emp?.id || '';
  el('emp-name').value   = emp?.fullName || '';
  el('emp-gender').value = emp?.gender || '';
  el('emp-pwd').value    = '';
  el('emp-pwd-lbl').textContent = emp ? 'Nouveau mot de passe (laisser vide = inchangé)' : 'Mot de passe *';
  openModal('modal-emp');
}

async function saveEmployee() {
  const id     = el('emp-id').value;
  const name   = el('emp-name').value.trim();
  const gender = el('emp-gender').value;
  const pwd    = el('emp-pwd').value;
  if (!name || !gender) { toast('Nom et genre requis', 'error'); return; }
  if (!id && !pwd) { toast('Mot de passe requis pour un nouvel employé', 'error'); return; }
  const body = { fullName: name, gender };
  if (pwd) body.password = pwd;
  try {
    if (id) await api('PUT', `/api/enterprise/employees/${id}`, body);
    else    await api('POST', '/api/enterprise/employees', body);
    closeModal('modal-emp');
    toast('Employé enregistré', 'success');
    loadEntEmployees();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteEmployee(id) {
  try {
    await api('DELETE', `/api/enterprise/employees/${id}`);
    toast('Employé supprimé', 'success');
    loadEntEmployees();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadEntOrders() {
  try {
    const orders = await api('GET', '/api/orders');
    el('ent-orders-list').innerHTML = orders.length
      ? orders.map(o => `
          <div class="order-card">
            <div><strong>${esc(o.restaurantName)}</strong> — ${fmtDateTime(o.createdAt)}
              <span class="badge ${o.status}">${o.status}</span>
            </div>
            <div>${fmtPrice(o.totalAmount)} · ${o.items?.length || 0} repas</div>
          </div>`).join('')
      : '<p class="empty">Aucune commande.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadEntInvoices() {
  try {
    const invoices = await api('GET', '/api/invoices');
    el('ent-invoices-list').innerHTML = invoices.length
      ? invoices.map(inv => `
          <div class="order-card invoice-card">
            <div>
              <strong>${esc(inv.restaurantName)}</strong> — ${fmtDateTime(inv.createdAt)}
              <span class="badge ${inv.status}">${inv.status === 'sent' ? '📨 Reçue' : inv.status === 'confirmed' ? '✅ Confirmée' : inv.status}</span>
            </div>
            <div>${inv.number} · ${fmtPrice(inv.totalAmount)} · ${inv.items?.length||0} article(s)</div>
            <div class="order-btns">
              <button class="btn ghost sm" onclick="downloadInvoice('${inv.id}')">⬇ PDF</button>
              ${inv.status === 'sent' ? `<button class="btn primary sm" onclick="confirmInvoice('${inv.id}')">✅ Confirmer réception</button>` : ''}
            </div>
          </div>`).join('')
      : '<p class="empty">Aucune facture.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function confirmInvoice(invoiceId) {
  try {
    await api('PUT', `/api/invoices/${invoiceId}/confirm`);
    toast('Réception confirmée !', 'success');
    loadEntInvoices();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadEntStats() {
  const freq = el('ent-freq')?.value || 'monthly';
  try {
    const s = await api('GET', `/api/stats/enterprise?frequency=${freq}`);
    const topFoods  = Object.entries(s.foodCounts  || {}).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topDrinks = Object.entries(s.drinkCounts || {}).sort((a,b)=>b[1]-a[1]).slice(0,5);
    el('ent-stats-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${s.totalChoices}</div><div class="stat-lbl">Choix</div></div>
        <div class="stat-card"><div class="stat-num">${fmtPrice(s.totalBudget)}</div><div class="stat-lbl">Budget dépensé</div></div>
      </div>
      ${topFoods.length ? `<h4>Plats populaires</h4><ul class="item-list">${topFoods.map(([n,c])=>`<li>${esc(n)} <span class="badge">${c}</span></li>`).join('')}</ul>` : ''}
      ${topDrinks.length ? `<h4>Boissons populaires</h4><ul class="item-list">${topDrinks.map(([n,c])=>`<li>${esc(n)} <span class="badge">${c}</span></li>`).join('')}</ul>` : ''}
      ${s.employeeStats?.length ? `<h4>Consommation par employé</h4><table class="choice-table">
        <thead><tr><th>Nom</th><th>Choix</th></tr></thead>
        <tbody>${s.employeeStats.map(e=>`<tr><td>${esc(e.fullName)}</td><td>${e.choicesCount}</td></tr>`).join('')}</tbody>
      </table>` : ''}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function pdfEntStats() {
  // ── Données ──────────────────────────────────────────────────────────────
  const freq = el('ent-freq')?.value || 'monthly';
  const freqLabels = { daily: "Aujourd'hui", weekly: '7 derniers jours', monthly: 'Ce mois', quarterly: 'Ce trimestre' };
  let s;
  try { s = await api('GET', `/api/stats/enterprise?frequency=${freq}`); }
  catch(e) { toast('Impossible de charger les données', 'error'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 14, CW = W - 2 * M;
  const navy=[15,23,42], blue=[14,165,233], orange=[249,115,22], green=[34,197,94];
  const light=[241,245,249], border=[226,232,240], dark=[30,41,59], gray=[100,116,139], white=[255,255,255];
  const fmtN = n => Number(n||0).toLocaleString('fr-FR');
  const fmtP = n => Number(n||0).toLocaleString('fr-FR') + ' FCFA';

  function footer() {
    const t = doc.getNumberOfPages();
    for (let p = 1; p <= t; p++) {
      doc.setPage(p);
      doc.setFillColor(...navy); doc.rect(0, 285, W, 12, 'F');
      doc.setFillColor(...blue); doc.rect(0, 285, 5, 12, 'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text('LunchApp — Rapport de consommation entreprise', M+5, 292);
      doc.text(`Page ${p} / ${t}`, W-M, 292, { align:'right' });
    }
  }

  const cName = (me && me.companyName) || 'Entreprise';
  const dateStr = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
  const empStats = (s.employeeStats || []).sort((a,b) => b.choicesCount - a.choicesCount);
  const totalEmp = empStats.length;
  const actifs   = empStats.filter(e => e.choicesCount > 0).length;
  const tauxPart = totalEmp ? Math.round(actifs / totalEmp * 100) : 0;

  // ── HEADER ──────────────────────────────────────────────────────────────
  doc.setFillColor(...navy); doc.rect(0, 0, W, 50, 'F');
  doc.setFillColor(...blue); doc.rect(0, 0, 5, 50, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...blue);
  doc.text('LUNCHAPP — RAPPORT DE CONSOMMATION', M+5, 11);
  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(...white);
  doc.text(cName, M+5, 26);
  doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(148,163,184);
  doc.text(`Periode : ${freqLabels[freq]||freq}   |   Genere le : ${dateStr}`, M+5, 39);
  // Badge taux participation
  doc.setFillColor(...blue); doc.roundedRect(W-M-26, 11, 26, 16, 3, 3, 'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(...white);
  doc.text(`${tauxPart}%`, W-M-13, 22, { align:'center' });
  doc.setFont('helvetica','normal'); doc.setFontSize(6.5); doc.setTextColor(180,220,255);
  doc.text('participation', W-M-13, 27, { align:'center' });

  let y = 60;

  // ── 4 KPI CARDS ──────────────────────────────────────────────────────────
  const cw4 = (CW - 3*5) / 4;
  [
    [fmtN(totalEmp),        'Employes',     blue],
    [fmtN(actifs),          'Actifs',       green],
    [fmtN(s.totalChoices),  'Total choix',  orange],
    [fmtP(s.totalBudget),   'Budget total', navy],
  ].forEach(([val, lbl, col], i) => {
    const cx = M + i*(cw4+5);
    doc.setFillColor(...light); doc.roundedRect(cx, y, cw4, 22, 2, 2, 'F');
    doc.setFillColor(...col); doc.roundedRect(cx, y, cw4, 3.5, 2, 2, 'F'); doc.rect(cx, y+1.5, cw4, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(i===3?7:13); doc.setTextColor(...col);
    doc.text(val, cx+cw4/2, y+14, { align:'center', maxWidth: cw4-2 });
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...gray);
    doc.text(lbl, cx+cw4/2, y+19, { align:'center' });
  });
  y += 30;

  // ── TABLEAU EMPLOYES ─────────────────────────────────────────────────────
  if (empStats.length) {
    doc.setFillColor(...blue); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Detail de consommation par employe', M+5, y+7.5);
    y += 14;

    // En-têtes colonnes
    const colX = [M+4, M+62, M+84, M+110, M+140];
    const colHeaders = ['NOM', 'GENRE', 'CHOIX', 'PARTICIPATION', 'STATUT'];
    doc.setFillColor(...border); doc.rect(M, y, CW, 7, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7); doc.setTextColor(...gray);
    colHeaders.forEach((h, i) => doc.text(h, colX[i], y+5));
    y += 9;

    const maxChoix = empStats.length ? Math.max(...empStats.map(e => e.choicesCount), 1) : 1;
    empStats.forEach((emp, idx) => {
      if (y > 272) { doc.addPage(); y = 20; }
      if (idx%2===0) { doc.setFillColor(248,251,255); doc.rect(M, y-1, CW, 9, 'F'); }
      doc.setDrawColor(...border); doc.setLineWidth(0.15); doc.line(M, y+7.5, W-M, y+7.5);

      const pct = totalEmp ? Math.round(emp.choicesCount / (s.totalChoices||1) * 100) : 0;
      const actif = emp.choicesCount > 0;

      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...dark);
      const n = emp.fullName||''; doc.text(n.length>22?n.slice(0,22)+'…':n, colX[0], y+5.5);
      doc.text(emp.gender==='male'?'Homme':'Femme', colX[1], y+5.5);
      doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
      doc.text(fmtN(emp.choicesCount)+'x', colX[2], y+5.5);
      // Mini barre participation
      const bw = Math.max(1, (emp.choicesCount/maxChoix)*22);
      doc.setFillColor(...border); doc.roundedRect(colX[3], y+2, 22, 4, 0.5, 0.5, 'F');
      doc.setFillColor(...blue); doc.roundedRect(colX[3], y+2, bw, 4, 0.5, 0.5, 'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text(`${pct}%`, colX[3]+24, y+5.5);
      // Statut badge
      doc.setFont('helvetica','bold'); doc.setFontSize(7.5);
      doc.setTextColor(...(actif ? [34,197,94] : [239,68,68]));
      doc.text(actif?'Actif':'Inactif', colX[4], y+5.5);
      y += 9;
    });
    y += 10;
  }

  // ── PREFERENCES ALIMENTAIRES ──────────────────────────────────────────────
  const topFoods  = Object.entries(s.foodCounts ||{}).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const topDrinks = Object.entries(s.drinkCounts||{}).sort((a,b)=>b[1]-a[1]).slice(0,6);

  if (topFoods.length || topDrinks.length) {
    if (y + 60 > 272) { doc.addPage(); y = 20; }
    const halfW = (CW - 6) / 2;

    // Titre section
    doc.setFillColor(...orange); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Preferences alimentaires', M+5, y+7.5);
    y += 15;

    // Plats (gauche) & Boissons (droite)
    [[topFoods,'Plats populaires',blue],[topDrinks,'Boissons populaires',green]].forEach(([items, title, col], col_i) => {
      const cx = M + col_i*(halfW+6);
      doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...col);
      doc.text(title, cx, y+5);
      let ly = y + 10;
      if (!items.length) {
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...gray);
        doc.text('Aucune donnee', cx, ly+4);
      }
      items.forEach(([name, cnt]) => {
        doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...dark);
        const n = String(name); doc.text((n.length>20?n.slice(0,20)+'…':n), cx, ly+4);
        doc.setFont('helvetica','bold'); doc.setTextColor(...col);
        doc.text(`${fmtN(cnt)}x`, cx+halfW-2, ly+4, { align:'right' });
        doc.setDrawColor(...border); doc.setLineWidth(0.1); doc.line(cx, ly+6, cx+halfW-2, ly+6);
        ly += 9;
      });
    });
    y += 10 + Math.max(topFoods.length, topDrinks.length) * 9 + 6;
  }

  footer();
  doc.save(`rapport-entreprise-${freq}-${new Date().toISOString().slice(0,10)}.pdf`);
}

// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYEE — Menu du jour
// ═══════════════════════════════════════════════════════════════════════════

async function loadEmpMenu() {
  try {
    const [menus, myChoice] = await Promise.all([
      api('GET', '/api/employee/menus'),
      api('GET', '/api/choices/mine'),
    ]);

    _myChoiceCache = myChoice || null;

    if (!menus.length) {
      el('emp-menu-content').innerHTML = '<p class="empty">Aucun menu disponible aujourd\'hui.</p>';
      return;
    }

    // Pre-populate pending selection from existing choice (enables editing)
    if (myChoice) {
      _pendingRestaurantId = myChoice.restaurantId;
      _pendingFoodId    = myChoice.foodItem?.id    || null;
      _pendingFoodName  = myChoice.foodItem?.name  || '';
      _pendingFoodPrice = myChoice.foodItem?.price || 0;
      _pendingDrinkId    = myChoice.drinkItem?.id    || null;
      _pendingDrinkName  = myChoice.drinkItem?.name  || '';
      _pendingDrinkPrice = myChoice.drinkItem?.price || 0;
    } else {
      _pendingRestaurantId = null;
      _pendingFoodId = _pendingDrinkId = null;
      _pendingFoodName = _pendingDrinkName = '';
      _pendingFoodPrice = _pendingDrinkPrice = 0;
    }

    // Build item lookup cache
    menus.forEach(m => {
      [...m.foods, ...m.drinks].forEach(i => { _empItemLookup[i.id] = i; });
    });

    const elapsed = myChoice ? (Date.now() - new Date(myChoice.createdAt).getTime()) / 60000 : Infinity;
    const locked  = myChoice && elapsed >= 5;

    const menuHtml = locked ? '' : menus.map(m => `
      <div class="menu-resto-card">
        <h4>🍴 ${esc(m.restaurant.restaurantName)}</h4>
        ${m.foods.length ? `<div class="menu-section"><h5>🍽️ Plats</h5>
          ${m.foods.map(f => `<div class="menu-item${_pendingFoodId === f.id ? ' selected' : ''}" data-cat="food"
            onclick="selectItem(this,'food','${f.id}','${m.restaurant.id}')">
            <span>${esc(f.name)}</span><span class="item-price">${fmtPrice(f.price)}</span>
          </div>`).join('')}</div>` : ''}
        ${m.drinks.length ? `<div class="menu-section"><h5>🥤 Boissons</h5>
          ${m.drinks.map(d => `<div class="menu-item${_pendingDrinkId === d.id ? ' selected' : ''}" data-cat="drink"
            onclick="selectItem(this,'drink','${d.id}','${m.restaurant.id}')">
            <span>${esc(d.name)}</span><span class="item-price">${fmtPrice(d.price)}</span>
          </div>`).join('')}</div>` : ''}
      </div>`).join('');

    el('emp-menu-content').innerHTML = `<div id="emp-choice-summary"></div>` + menuHtml;
    renderChoiceSummary();
  } catch (e) { toast(e.message, 'error'); }
}

// Choice state
let _pendingRestaurantId = null, _pendingFoodId = null, _pendingDrinkId = null;
let _pendingFoodName = '', _pendingDrinkName = '', _pendingFoodPrice = 0, _pendingDrinkPrice = 0;
let _myChoiceCache = null;
const _empItemLookup = {}; // itemId → { name, price, category }

function selectItem(elem, cat, itemId, restaurantId) {
  if (cat === 'food') {
    _pendingFoodId = itemId;
    const info = _empItemLookup[itemId];
    _pendingFoodName  = info?.name  || '';
    _pendingFoodPrice = info?.price || 0;
  } else {
    _pendingDrinkId = itemId;
    const info = _empItemLookup[itemId];
    _pendingDrinkName  = info?.name  || '';
    _pendingDrinkPrice = info?.price || 0;
  }
  _pendingRestaurantId = restaurantId;
  // Highlight selected within same category
  document.querySelectorAll('.menu-item').forEach(i => {
    if (i.dataset.cat === cat) i.classList.remove('selected');
  });
  elem.classList.add('selected');
  renderChoiceSummary();
}

function renderChoiceSummary() {
  const box = el('emp-choice-summary');
  if (!box) return;

  const mc = _myChoiceCache;
  const elapsed = mc ? (Date.now() - new Date(mc.createdAt).getTime()) / 60000 : Infinity;
  const canEdit = mc && elapsed < 5;
  const locked  = mc && elapsed >= 5;

  if (locked) {
    box.innerHTML = `<div class="my-choice-card">
      <h3>Mon choix du jour</h3>
      ${mc.foodItem  ? `<p>🍽️ <strong>${esc(mc.foodItem.name)}</strong> — ${fmtPrice(mc.foodItem.price)}</p>` : ''}
      ${mc.drinkItem ? `<p>🥤 <strong>${esc(mc.drinkItem.name)}</strong> — ${fmtPrice(mc.drinkItem.price)}</p>` : ''}
      <div class="warn-box locked">🔒 Choix verrouillé — modification impossible</div>
      ${!mc.rating ? `<button class="btn ghost sm" onclick="openRateModal('${mc.id}')">⭐ Évaluer</button>` : `<p>${stars(mc.rating)} (${mc.rating}/5)</p>`}
    </div>`;
    return;
  }

  if (!_pendingFoodId && !_pendingDrinkId && !canEdit) {
    box.innerHTML = `<div class="hint" style="padding:10px 0">👆 Cliquez sur un plat et/ou une boisson pour faire votre choix.</div>`;
    return;
  }

  const total = _pendingFoodPrice + _pendingDrinkPrice;
  box.innerHTML = `<div class="my-choice-card">
    <h3>${canEdit ? '✏️ Modifier mon choix' : '📝 Ma sélection'}</h3>
    <div style="margin:8px 0;display:flex;flex-direction:column;gap:4px">
      ${_pendingFoodId  ? `<p>🍽️ <strong>${esc(_pendingFoodName)}</strong> — ${fmtPrice(_pendingFoodPrice)}</p>` : '<p class="hint">Aucun plat sélectionné</p>'}
      ${_pendingDrinkId ? `<p>🥤 <strong>${esc(_pendingDrinkName)}</strong> — ${fmtPrice(_pendingDrinkPrice)}</p>` : '<p class="hint">Aucune boisson sélectionnée</p>'}
      ${total ? `<p style="font-weight:700;color:var(--orange)">Total : ${fmtPrice(total)}</p>` : ''}
    </div>
    ${canEdit ? `<div class="warn-box">⏱️ Modification possible pendant encore ${(5 - elapsed).toFixed(1)} min</div>` : ''}
    <div class="dialog-btns" style="margin-top:10px">
      ${canEdit && mc ? `<button class="btn danger sm" onclick="deleteMyChoice('${mc.id}')">🗑️ Supprimer</button>` : ''}
      <button class="btn primary" onclick="confirmChoice()">✅ Confirmer</button>
    </div>
  </div>`;
}

async function confirmChoice() {
  if (!_pendingFoodId && !_pendingDrinkId) { toast('Sélectionnez au moins un plat ou une boisson', 'error'); return; }
  const mc = _myChoiceCache;
  const elapsed = mc ? (Date.now() - new Date(mc.createdAt).getTime()) / 60000 : Infinity;
  try {
    if (mc && elapsed < 5) {
      await api('PUT', `/api/choices/${mc.id}`, {
        foodItemId:  _pendingFoodId  || null,
        drinkItemId: _pendingDrinkId || null,
      });
      toast('Choix modifié !', 'success');
    } else {
      await api('POST', '/api/choices', {
        restaurantId: _pendingRestaurantId,
        foodItemId:  _pendingFoodId  || undefined,
        drinkItemId: _pendingDrinkId || undefined,
      });
      toast('Choix enregistré !', 'success');
    }
    loadEmpMenu();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteMyChoice(choiceId) {
  try {
    await api('DELETE', `/api/choices/${choiceId}`);
    toast('Choix supprimé', 'success');
    loadEmpMenu();
  } catch (e) { toast(e.message, 'error'); }
}

// Rating
function openRateModal(choiceId) {
  _ratingChoiceId = choiceId;
  _ratingStars = 0;
  const row = el('stars-row');
  row.innerHTML = [1,2,3,4,5].map(n =>
    `<span class="star" data-n="${n}" onclick="selectStar(${n})">☆</span>`
  ).join('');
  el('rate-hint').textContent = 'Sélectionnez une note';
  openModal('modal-rate');
}

function selectStar(n) {
  _ratingStars = n;
  el('rate-hint').textContent = `${n} étoile${n > 1 ? 's' : ''}`;
  document.querySelectorAll('.star').forEach(s => {
    s.textContent = Number(s.dataset.n) <= n ? '⭐' : '☆';
  });
}

async function submitRating() {
  if (!_ratingStars) { toast('Sélectionnez une note', 'error'); return; }
  try {
    await api('POST', `/api/choices/${_ratingChoiceId}/rate`, { stars: _ratingStars });
    closeModal('modal-rate');
    toast('Évaluation envoyée', 'success');
    loadEmpMenu();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYEE — Historique
// ═══════════════════════════════════════════════════════════════════════════

async function loadEmpHistory() {
  try {
    const choices = await api('GET', '/api/choices/history');
    el('emp-history-list').innerHTML = choices.length
      ? choices.map(c => `
          <div class="history-row">
            <div>
              <strong>${fmtDate(c.date)}</strong> — ${esc(c.restaurantName)}
              ${c.foodItem  ? `<br>🍽️ ${esc(c.foodItem.name)} — ${fmtPrice(c.foodItem.price)}` : ''}
              ${c.drinkItem ? `<br>🥤 ${esc(c.drinkItem.name)} — ${fmtPrice(c.drinkItem.price)}` : ''}
            </div>
            <div>
              ${c.rating ? stars(c.rating) : `<button class="btn ghost sm" onclick="openRateModal('${c.id}')">⭐ Noter</button>`}
            </div>
          </div>`).join('')
      : '<p class="empty">Aucun historique.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function clearHistory() {
  try {
    await api('DELETE', '/api/choices/history');
    toast('Historique vidé', 'success');
    loadEmpHistory();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN
// ═══════════════════════════════════════════════════════════════════════════

async function loadAdminStats() {
  _adminTab = _adminTab || 'ov';
  document.querySelectorAll('.atab').forEach((b,i) => {
    b.classList.toggle('active', ['ov','ent','rst','emp','del'][i] === _adminTab);
  });
  const freq = el('adm-freq')?.value || 'monthly';
  try {
    switch (_adminTab) {
      case 'ov': {
        const s = await api('GET', `/api/admin/stats?frequency=${freq}`);
        el('admin-content').innerHTML = `
          <div class="kpi-grid">
            <div class="kpi-card blue">
              <div class="kpi-icon">🏢</div>
              <div class="kpi-body"><div class="kpi-num">${s.counts.enterprises}</div><div class="kpi-lbl">Entreprises</div></div>
            </div>
            <div class="kpi-card green">
              <div class="kpi-icon">🍴</div>
              <div class="kpi-body"><div class="kpi-num">${s.counts.restaurants}</div><div class="kpi-lbl">Restaurants</div></div>
            </div>
            <div class="kpi-card yellow">
              <div class="kpi-icon">👤</div>
              <div class="kpi-body"><div class="kpi-num">${s.counts.employees}</div><div class="kpi-lbl">Employés</div></div>
            </div>
            <div class="kpi-card purple">
              <div class="kpi-icon">💎</div>
              <div class="kpi-body"><div class="kpi-num">${fmtPrice(s.totalMobilized)}</div><div class="kpi-lbl">Total mobilisé</div></div>
            </div>
          </div>
          <p style="color:var(--gray);font-size:13px;margin-bottom:16px">👨 ${s.gender.male} hommes · 👩 ${s.gender.female} femmes</p>
          ${Object.keys(s.restaurantRevenue||{}).length ? `
          <div class="section-header">
            <div class="section-icon">🍴</div><h3>Recettes par restaurant</h3>
          </div>
          <ul class="item-list">${Object.entries(s.restaurantRevenue).map(([n,v])=>`<li>${esc(n)}<span class="badge green">${fmtPrice(v)}</span></li>`).join('')}</ul>` : ''}
          ${Object.keys(s.enterpriseBudget||{}).length ? `
          <div class="section-header" style="margin-top:16px">
            <div class="section-icon">🏢</div><h3>Budget par entreprise</h3>
          </div>
          <ul class="item-list">${Object.entries(s.enterpriseBudget).map(([n,v])=>`<li>${esc(n)}<span class="badge blue">${fmtPrice(v)}</span></li>`).join('')}</ul>` : ''}`;
        break;
      }
      case 'ent': {
        const data = await api('GET', '/api/admin/enterprises');
        el('admin-content').innerHTML = data.length ? `
          <table class="choice-table">
            <thead><tr>
              <th>Entreprise</th><th>Email</th><th>Téléphone</th>
              <th>Localisation</th><th>Inscrit le</th><th></th>
            </tr></thead>
            <tbody>${data.map(e => `<tr>
              <td><strong>${esc(e.companyName)}</strong></td>
              <td>${esc(e.email)}</td>
              <td>${esc(e.phone || '—')}</td>
              <td>${e.location
                ? `<a href="${esc(e.location)}" target="_blank" class="map-link">📍 Maps</a>`
                : '—'}</td>
              <td>${fmtDateTime(e.createdAt)}</td>
              <td><button class="btn danger sm" onclick="adminDelete('enterprise','${e.id}')">🗑️</button></td>
            </tr>`).join('')}</tbody>
          </table>` : '<p class="empty">Aucune entreprise.</p>';
        break;
      }
      case 'rst': {
        const data = await api('GET', '/api/admin/restaurants');
        el('admin-content').innerHTML = data.length ? `
          <table class="choice-table">
            <thead><tr>
              <th>Restaurant</th><th>Gérant</th><th>Email</th>
              <th>Téléphone</th><th>Spécialité</th><th>Adresse</th>
              <th>Paiements</th><th>Inscrit le</th><th></th>
            </tr></thead>
            <tbody>${data.map(r => `<tr>
              <td><strong>${esc(r.restaurantName)}</strong></td>
              <td>${esc(r.fullName)}</td>
              <td>${esc(r.email)}</td>
              <td>${esc(r.phone || '—')}</td>
              <td>${esc(r.specialty || '—')}</td>
              <td>${esc(r.address || '—')}</td>
              <td>${r.paymentInfo?.length
                ? r.paymentInfo.map(p => `<span class="badge">${esc(p.type)}: ${esc(p.number)}</span>`).join(' ')
                : '—'}</td>
              <td>${fmtDateTime(r.createdAt)}</td>
              <td><button class="btn danger sm" onclick="adminDelete('restaurant','${r.id}')">🗑️</button></td>
            </tr>`).join('')}</tbody>
          </table>` : '<p class="empty">Aucun restaurant.</p>';
        break;
      }
      case 'emp': {
        const data = await api('GET', '/api/admin/employees');
        el('admin-content').innerHTML = data.length ? `
          <table class="choice-table">
            <thead><tr>
              <th>Employé</th><th>Genre</th><th>Entreprise</th>
              <th>Inscrit le</th><th></th>
            </tr></thead>
            <tbody>${data.map(e => `<tr>
              <td><strong>${esc(e.fullName)}</strong></td>
              <td>${e.gender === 'female' ? '👩 Femme' : '👨 Homme'}</td>
              <td>${esc(e.enterpriseName)}</td>
              <td>${fmtDateTime(e.createdAt)}</td>
              <td><button class="btn danger sm" onclick="adminDelete('employee','${e.id}')">🗑️</button></td>
            </tr>`).join('')}</tbody>
          </table>` : '<p class="empty">Aucun employé.</p>';
        break;
      }
      case 'del': {
        const data = await api('GET', '/api/admin/deletion-requests');
        el('admin-content').innerHTML = data.length
          ? `<table class="choice-table"><thead><tr><th>Nom</th><th>Type</th><th>Email</th><th>Date</th><th>Raison</th></tr></thead><tbody>${
              data.map(d => `<tr>
                <td>${esc(d.userName)}</td><td>${esc(d.userType)}</td><td>${esc(d.email)}</td>
                <td>${fmtDateTime(d.deletedAt)}</td><td>${esc(d.reason)}</td>
              </tr>`).join('')}</tbody></table>`
          : '<p class="empty">Aucune suppression.</p>';
        break;
      }
    }
  } catch (e) { toast(e.message, 'error'); }
}

function adminTab(tab, btn) {
  _adminTab = tab;
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadAdminStats();
}

async function adminDelete(type, id) {
  try {
    await api('DELETE', `/api/admin/users/${type}/${id}`);
    toast('Supprimé', 'success');
      loadAdminStats();
  } catch (e) { toast(e.message, 'error'); }
}

async function pdfAdminStats() {
  const freq = el('adm-freq')?.value || 'monthly';
  const tab  = _adminTab || 'ov';
  const freqLabels = { daily:"Aujourd'hui", weekly:'7 derniers jours', monthly:'Ce mois', quarterly:'Ce trimestre' };
  const tabTitles  = { ov:'Tableau de bord', ent:'Liste des entreprises', rst:'Liste des restaurants', emp:'Liste des employes', del:'Demandes de suppression' };
  const dateStr = new Date().toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const W=210, M=14, CW=W-2*M;
  const navy=[15,23,42], blue=[14,165,233], orange=[249,115,22], green=[34,197,94], purple=[139,92,246];
  const light=[241,245,249], border=[226,232,240], dark=[30,41,59], gray=[100,116,139], white=[255,255,255];
  const fmtN = n => Number(n||0).toLocaleString('fr-FR');
  const fmtP = n => Number(n||0).toLocaleString('fr-FR') + ' FCFA';
  const fmtD = iso => iso ? new Date(iso).toLocaleDateString('fr-FR') : '—';
  const clip = (s, n) => { const t=String(s||''); return t.length>n?t.slice(0,n)+'…':t; };

  function drawHeader(accentColor) {
    doc.setFillColor(...navy); doc.rect(0, 0, W, 50, 'F');
    doc.setFillColor(...accentColor); doc.rect(0, 0, 5, 50, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...accentColor);
    doc.text('LUNCHAPP — ADMINISTRATION', M+5, 11);
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(...white);
    doc.text(tabTitles[tab]||'Rapport', M+5, 26);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(148,163,184);
    const periodPart = tab==='ov' ? `Periode : ${freqLabels[freq]||freq}   |   ` : '';
    doc.text(`${periodPart}Genere le : ${dateStr}`, M+5, 39);
  }

  function drawFooter(accentColor) {
    const t = doc.getNumberOfPages();
    for (let p=1; p<=t; p++) {
      doc.setPage(p);
      doc.setFillColor(...navy); doc.rect(0, 285, W, 12, 'F');
      doc.setFillColor(...accentColor); doc.rect(0, 285, 5, 12, 'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text(`LunchApp — ${tabTitles[tab]||'Rapport admin'}`, M+5, 292);
      doc.text(`Page ${p} / ${t}`, W-M, 292, { align:'right' });
    }
  }

  function drawMoneyTable(title, entries, hdrColor) {
    if (!entries.length) return;
    if (y + 25 + entries.length*9 > 272) { doc.addPage(); y=20; }
    doc.setFillColor(...hdrColor); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text(title, M+5, y+7.5); y+=14;
    doc.setFillColor(...border); doc.rect(M, y, CW, 7, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    doc.text('NOM', M+4, y+5); doc.text('MONTANT', W-M-4, y+5, { align:'right' }); y+=9;
    entries.forEach(([name, val], idx) => {
      if (y>272) { doc.addPage(); y=20; }
      if (idx%2===0) { doc.setFillColor(250,252,255); doc.rect(M, y-1, CW, 9, 'F'); }
      doc.setDrawColor(...border); doc.setLineWidth(0.15); doc.line(M, y+7.5, W-M, y+7.5);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...dark);
      doc.text(clip(name,40), M+4, y+5.5);
      doc.setFont('helvetica','bold'); doc.setTextColor(...hdrColor);
      doc.text(fmtP(val), W-M-4, y+5.5, { align:'right' }); y+=9;
    }); y+=10;
  }

  function drawListTable(columns, rows, hdrColor) {
    // columns = [{label, x, w, key}]
    if (!rows.length) {
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...gray);
      doc.text('Aucune donnee disponible.', M, y+8); return;
    }
    // Header
    doc.setFillColor(...border); doc.rect(M, y, CW, 8, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...gray);
    columns.forEach(c => doc.text(c.label, c.x, y+5.5));
    y += 10;
    rows.forEach((row, idx) => {
      if (y > 272) { doc.addPage(); y = 20; }
      if (idx%2===0) { doc.setFillColor(250,252,255); doc.rect(M, y-1, CW, 9, 'F'); }
      doc.setDrawColor(...border); doc.setLineWidth(0.12); doc.line(M, y+7.5, W-M, y+7.5);
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(...dark);
      columns.forEach(c => {
        const val = clip(row[c.key]||'—', Math.floor(c.w/2.2));
        doc.text(val, c.x, y+5.5);
      }); y+=9;
    }); y+=8;
  }

  let y = 60;

  // ════════════════════════════════════════════════════════════════════════
  if (tab === 'ov') {
    // ── VUE D'ENSEMBLE ────────────────────────────────────────────────────
    let s;
    try { s = await api('GET', `/api/admin/stats?frequency=${freq}`); }
    catch(e) { toast('Erreur chargement données', 'error'); return; }

    drawHeader(blue);

    // 4 KPI cards
    const cardW = (CW - 3*5) / 4, cardH = 26;
    [
      [fmtN(s.counts.enterprises), 'Entreprises',    blue],
      [fmtN(s.counts.restaurants), 'Restaurants',    orange],
      [fmtN(s.counts.employees),   'Employes',       green],
      [fmtP(s.totalMobilized),     'Total mobilise', purple],
    ].forEach(([val, lbl, col], i) => {
      const cx = M + i*(cardW+5);
      doc.setFillColor(...light); doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'F');
      doc.setFillColor(...col); doc.roundedRect(cx, y, cardW, 4, 2, 2, 'F'); doc.rect(cx, y+2, cardW, 2, 'F');
      doc.setFont('helvetica','bold'); doc.setFontSize(i===3?7.5:15); doc.setTextColor(...col);
      doc.text(val, cx+cardW/2, y+(i===3?15:16), { align:'center', maxWidth:cardW-4 });
      doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...gray);
      doc.text(lbl, cx+cardW/2, y+22, { align:'center' });
    });
    y += cardH + 8;

    // Genre
    doc.setFillColor(236,254,255); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFillColor(...blue); doc.roundedRect(M, y, 3, 11, 1, 1, 'F'); doc.rect(M+1, y, 2, 11, 'F');
    doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(...dark);
    doc.text('Repartition genre :', M+6, y+7);
    doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
    doc.text(`${fmtN(s.gender?.male||0)} hommes`, M+44, y+7);
    doc.setTextColor(...gray); doc.text('/', M+68, y+7);
    doc.setTextColor(...orange); doc.text(`${fmtN(s.gender?.female||0)} femmes`, M+73, y+7);
    y += 20;

    drawMoneyTable('Recettes par restaurant', Object.entries(s.restaurantRevenue||{}), blue);
    drawMoneyTable('Budget par entreprise',   Object.entries(s.enterpriseBudget  ||{}), orange);

    drawFooter(blue);
    doc.save(`rapport-admin-global-${freq}-${new Date().toISOString().slice(0,10)}.pdf`);

  } else if (tab === 'ent') {
    // ── LISTE ENTREPRISES ────────────────────────────────────────────────
    let data;
    try { data = await api('GET', '/api/admin/enterprises'); }
    catch(e) { toast('Erreur chargement données', 'error'); return; }

    drawHeader(blue);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...blue);
    doc.text(`${fmtN(data.length)} entreprise(s) enregistree(s)`, M, y); y+=10;
    doc.setFillColor(...blue); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Annuaire des entreprises', M+5, y+7.5); y+=14;

    const cols = [
      { label:'NOM',       x:M+2,   w:52, key:'companyName' },
      { label:'EMAIL',     x:M+56,  w:52, key:'email' },
      { label:'TELEPHONE', x:M+110, w:32, key:'phone' },
      { label:'INSCRIPTION',x:M+144,w:38, key:'createdAt' },
    ];
    const rows = data.map(e => ({ ...e, createdAt: fmtD(e.createdAt) }));
    drawListTable(cols, rows, blue);

    drawFooter(blue);
    doc.save(`rapport-admin-entreprises-${new Date().toISOString().slice(0,10)}.pdf`);

  } else if (tab === 'rst') {
    // ── LISTE RESTAURANTS ────────────────────────────────────────────────
    let data;
    try { data = await api('GET', '/api/admin/restaurants'); }
    catch(e) { toast('Erreur chargement données', 'error'); return; }

    drawHeader(orange);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...orange);
    doc.text(`${fmtN(data.length)} restaurant(s) enregistre(s)`, M, y); y+=10;
    doc.setFillColor(...orange); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Annuaire des restaurants', M+5, y+7.5); y+=14;

    const cols = [
      { label:'RESTAURANT',  x:M+2,   w:46, key:'restaurantName' },
      { label:'GERANT',      x:M+50,  w:36, key:'ownerName' },
      { label:'EMAIL',       x:M+88,  w:44, key:'email' },
      { label:'TELEPHONE',   x:M+134, w:28, key:'phone' },
      { label:'INSCRIPTION', x:M+164, w:28, key:'createdAt' },
    ];
    const rows = data.map(r => ({ ...r, createdAt: fmtD(r.createdAt) }));
    drawListTable(cols, rows, orange);

    drawFooter(orange);
    doc.save(`rapport-admin-restaurants-${new Date().toISOString().slice(0,10)}.pdf`);

  } else if (tab === 'emp') {
    // ── LISTE EMPLOYES ───────────────────────────────────────────────────
    let data;
    try { data = await api('GET', '/api/admin/employees'); }
    catch(e) { toast('Erreur chargement données', 'error'); return; }

    drawHeader(green);
    const males   = data.filter(e => e.gender==='male').length;
    const females = data.filter(e => e.gender==='female').length;
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...green);
    doc.text(`${fmtN(data.length)} employe(s)  —  ${fmtN(males)} hommes  /  ${fmtN(females)} femmes`, M, y); y+=10;
    doc.setFillColor(...green); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Liste des employes', M+5, y+7.5); y+=14;

    const cols = [
      { label:'NOM COMPLET', x:M+2,   w:52, key:'fullName' },
      { label:'GENRE',       x:M+56,  w:22, key:'gender' },
      { label:'ENTREPRISE',  x:M+80,  w:60, key:'enterpriseName' },
      { label:'INSCRIPTION', x:M+142, w:40, key:'createdAt' },
    ];
    const rows = data.map(e => ({ ...e, gender: e.gender==='male'?'Homme':'Femme', createdAt: fmtD(e.createdAt) }));
    drawListTable(cols, rows, green);

    drawFooter(green);
    doc.save(`rapport-admin-employes-${new Date().toISOString().slice(0,10)}.pdf`);

  } else if (tab === 'del') {
    // ── DEMANDES DE SUPPRESSION ───────────────────────────────────────────
    let data;
    try { data = await api('GET', '/api/admin/deletion-requests'); }
    catch(e) { toast('Erreur chargement données', 'error'); return; }

    drawHeader(purple);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...purple);
    doc.text(`${fmtN(data.length)} demande(s) en attente`, M, y); y+=10;
    doc.setFillColor(...purple); doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(...white);
    doc.text('Demandes de suppression de compte', M+5, y+7.5); y+=14;

    const cols = [
      { label:'NOM',    x:M+2,   w:44, key:'userName' },
      { label:'TYPE',   x:M+48,  w:26, key:'userType' },
      { label:'EMAIL',  x:M+76,  w:52, key:'email' },
      { label:'DATE',   x:M+130, w:28, key:'createdAt' },
      { label:'RAISON', x:M+160, w:32, key:'reason' },
    ];
    const rows = data.map(d => ({ ...d, createdAt: fmtD(d.createdAt) }));
    drawListTable(cols, rows, purple);

    drawFooter(purple);
    doc.save(`rapport-admin-suppressions-${new Date().toISOString().slice(0,10)}.pdf`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function loadNotifs() {
  try {
    const notifs = await api('GET', '/api/notifications');
    const unread = notifs.filter(n => !n.read).length;
    const badge = el('notif-count');
    badge.textContent = unread;
    badge.classList.toggle('hidden', unread === 0);

    el('notif-list').innerHTML = notifs.length
      ? notifs.map(n => `
          <div class="notif-row ${n.read ? '' : 'unread'}">
            <div class="notif-body">
              <strong>${esc(n.title)}</strong>
              <p>${esc(n.message)}</p>
              <small>${fmtDateTime(n.createdAt)}</small>
            </div>
            <div class="notif-actions">
              ${!n.read ? `<button class="btn ghost sm" onclick="readNotif('${n.id}')">✓</button>` : ''}
              <button class="btn danger sm" onclick="deleteNotif('${n.id}')">🗑️</button>
            </div>
          </div>`).join('')
      : '<p class="empty">Aucune notification.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function readNotif(id) {
  try { await api('PUT', `/api/notifications/${id}/read`); loadNotifs(); } catch {}
}

async function readAllNotifs() {
  try { await api('PUT', '/api/notifications/read-all'); loadNotifs(); } catch {}
}

async function deleteNotif(id) {
  try { await api('DELETE', `/api/notifications/${id}`); loadNotifs(); } catch {}
}

async function clearAllNotifs() {
  try { await api('DELETE', '/api/notifications'); loadNotifs(); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGERIE
// ═══════════════════════════════════════════════════════════════════════════

// suffix = '' pour restaurant, 'ent' pour entreprise
async function loadConversations(suffix) {
  _chatPartnerSuffix = suffix;
  const listId   = suffix ? 'chat-conversations-ent' : 'chat-conversations';
  const windowId = suffix ? 'chat-window-ent' : 'chat-window';
  el(windowId).classList.add('hidden');
  el(listId).classList.remove('hidden');

  try {
    const isEnterprise = (suffix === 'ent');

    // Charger simultanément les conversations existantes ET les partenaires affiliés
    const [convs, partners] = await Promise.all([
      api('GET', '/api/messages/conversations'),
      isEnterprise
        ? api('GET', '/api/enterprise/restaurants')   // restaurants affiliés à l'entreprise
        : api('GET', '/api/restaurant/clientele'),    // entreprises affiliées au restaurant
    ]);

    // Indexer les conversations existantes par ID partenaire
    const convMap = {};
    convs.forEach(c => { convMap[c.id] = c; });

    // Construire la liste : partenaires affiliés en premier, enrichis si déjà en conversation
    const seen = new Set();
    const list  = [];

    partners.forEach(p => {
      const pid  = p.id;
      const name = isEnterprise ? p.restaurantName : p.companyName;
      seen.add(pid);
      if (convMap[pid]) {
        list.push(convMap[pid]); // conversation existante avec données de lecture
      } else {
        list.push({ id: pid, name, unread: 0, lastMessage: null, isNew: true });
      }
    });

    // Ajouter les éventuelles conversations avec des partenaires plus affiliés
    convs.forEach(c => { if (!seen.has(c.id)) list.push(c); });

    el(listId).innerHTML = list.length
      ? `<div class="conv-list">${list.map(c => `
          <div class="conv-row" onclick="openChat('${c.id}','${esc(c.name)}','${suffix}')">
            <div class="conv-row-top">
              <span class="conv-name">${esc(c.name)}</span>
              ${c.unread ? `<span class="nbadge">${c.unread}</span>` : ''}
            </div>
            <span class="conv-preview">${c.lastMessage ? esc(c.lastMessage) : '<em style="color:var(--gray)">Démarrer une conversation…</em>'}</span>
          </div>`).join('')}</div>`
      : '<p class="empty">Aucun partenaire affilié. Affiliez-vous à un restaurant pour démarrer une discussion.</p>';
  } catch (e) { toast(e.message, 'error'); }
}

async function openChat(partnerId, partnerName, suffix) {
  _chatPartnerId     = partnerId;
  _chatPartnerSuffix = suffix || '';
  const suf = _chatPartnerSuffix;

  el(suf ? 'chat-conversations-ent' : 'chat-conversations').classList.add('hidden');
  const win = el(suf ? 'chat-window-ent' : 'chat-window');
  win.classList.remove('hidden');
  el(suf ? 'chat-partner-ent' : 'chat-partner').textContent = partnerName;

  await refreshChat(suf);
  // Marquer comme lus
  try { await api('POST', '/api/messages/read', { withId: partnerId }); } catch {}
}

async function refreshChat(suf) {
  const msgsEl = el(suf ? 'chat-msgs-ent' : 'chat-msgs');
  try {
    const msgs = await api('GET', `/api/messages?withId=${_chatPartnerId}`);
    msgsEl.innerHTML = msgs.map(m => {
      const mine = m.senderId === me.id;
      if (m.type === 'audio') {
        // Pas de src initial — chargé à la demande via loadAudio()
        return `<div class="chat-bubble ${mine ? 'bubble-mine' : 'bubble-theirs'}">
          <div class="audio-wrap">
            <button class="btn ghost sm play-btn" onclick="loadAndPlay(this,'${m.id}')">▶ Écouter</button>
            <audio controls data-mid="${m.id}" class="audio-player hidden"></audio>
            ${m.audioDuration ? `<span class="audio-dur">${Math.floor(m.audioDuration/60)}:${String(m.audioDuration%60).padStart(2,'0')}</span>` : ''}
          </div>
          <small>${fmtDateTime(m.timestamp)}</small>
        </div>`;
      }
      return `<div class="chat-bubble ${mine ? 'bubble-mine' : 'bubble-theirs'}">
        <p>${esc(m.content)}</p>
        <small>${fmtDateTime(m.timestamp)}</small>
      </div>`;
    }).join('');
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch (e) { toast(e.message, 'error'); }
}

async function loadAndPlay(btn, mid) {
  const wrap     = btn.parentElement;
  const audioEl  = wrap.querySelector('audio');
  // Si déjà chargé, juste jouer/pauser
  if (audioEl.src && (audioEl.src.startsWith('data:') || audioEl.src.startsWith('blob:'))) {
    audioEl.classList.remove('hidden');
    btn.classList.add('hidden');
    audioEl.play().catch(() => {});
    return;
  }
  btn.textContent = '⏳';
  btn.disabled = true;
  try {
    const { audioData } = await api('GET', `/api/messages/${mid}/audio`);
    audioEl.src = audioData;
    audioEl.classList.remove('hidden');
    btn.classList.add('hidden');
    audioEl.play().catch(() => {});
  } catch (e) {
    btn.textContent = '▶ Écouter';
    btn.disabled = false;
    toast('Impossible de charger l\'audio', 'error');
  }
}


async function sendText(suf) {
  suf = suf || _chatPartnerSuffix;
  const inputId = suf ? 'chat-input-ent' : 'chat-input';
  const content = el(inputId).value.trim();
  if (!content) return;
  try {
    await api('POST', '/api/messages', { recipientId: _chatPartnerId, type: 'text', content });
    el(inputId).value = '';
    await refreshChat(suf);
  } catch (e) { toast(e.message, 'error'); }
}

function chatKey(event, suf) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendText(suf || _chatPartnerSuffix);
  }
}

function autoH(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function closeChat(suf) {
  suf = suf || _chatPartnerSuffix;
  el(suf ? 'chat-window-ent' : 'chat-window').classList.add('hidden');
  el(suf ? 'chat-conversations-ent' : 'chat-conversations').classList.remove('hidden');
  _chatPartnerId = null;
}

// ── Enregistrement audio ──────────────────────────────────────────────────────
let _recStream  = null;
let _recMime    = 'audio/webm';

// Libère les pistes micro
function _stopStream() {
  if (_recStream) { _recStream.getTracks().forEach(t => t.stop()); _recStream = null; }
}

// Arrête le recorder et retourne une Promise qui se résout quand les données sont prêtes
function _stopRecorder() {
  return new Promise(resolve => {
    if (!_mediaRecorder || _mediaRecorder.state === 'inactive') { resolve(); return; }
    _mediaRecorder.addEventListener('stop', resolve, { once: true });
    _mediaRecorder.stop();
  });
}

async function toggleRec(suf) {
  suf = suf || _chatPartnerSuffix;
  // Si en cours d'enregistrement → stopper
  if (_mediaRecorder && _mediaRecorder.state === 'recording') {
    clearInterval(_recTimerInterval);
    await _stopRecorder();
    _stopStream();
    el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '🎙️';
    return;
  }
  // Démarrer un nouvel enregistrement
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _recStream   = stream;
    _audioChunks = [];
    _recMime     = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    _mediaRecorder = new MediaRecorder(stream, _recMime ? { mimeType: _recMime } : {});
    _recMime       = _mediaRecorder.mimeType || 'audio/webm';
    _mediaRecorder.ondataavailable = e => { if (e.data.size) _audioChunks.push(e.data); };
    _mediaRecorder.start();
    _recSeconds = 0;
    el(suf ? 'rec-time-ent' : 'rec-time').textContent = '0:00';
    el(suf ? 'rec-ui-ent' : 'rec-ui').classList.remove('hidden');
    el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '⏹️';
    _recTimerInterval = setInterval(() => {
      _recSeconds++;
      const m = Math.floor(_recSeconds / 60), s = _recSeconds % 60;
      el(suf ? 'rec-time-ent' : 'rec-time').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
  } catch { toast('Microphone non accessible', 'error'); }
}

function cancelRec(suf) {
  suf = suf || _chatPartnerSuffix;
  clearInterval(_recTimerInterval);
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') _mediaRecorder.stop();
  _mediaRecorder = null;
  _stopStream();
  _audioChunks = [];
  el(suf ? 'rec-ui-ent' : 'rec-ui').classList.add('hidden');
  el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '🎙️';
}

async function sendAudio(suf) {
  suf = suf || _chatPartnerSuffix;

  const recUi  = el(suf ? 'rec-ui-ent' : 'rec-ui');
  const recBtn = el(suf ? 'rec-btn-ent' : 'rec-btn');
  const sendBtn = recUi.querySelector('button.btn.primary');

  // Stopper l'enregistrement si encore actif et attendre les données
  if (_mediaRecorder && _mediaRecorder.state === 'recording') {
    clearInterval(_recTimerInterval);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳'; }
    await _stopRecorder();
    _stopStream();
    recBtn.textContent = '🎙️';
  }

  if (!_audioChunks.length) {
    toast('Aucun audio enregistré', 'error');
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤'; }
    return;
  }

  const blob     = new Blob(_audioChunks, { type: _recMime || 'audio/webm' });
  const duration = _recSeconds;

  // Vider immédiatement pour éviter un double envoi
  _mediaRecorder = null;
  _audioChunks   = [];

  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳'; }

  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

    await api('POST', '/api/messages', {
      recipientId:   _chatPartnerId,
      type:          'audio',
      audioData:     base64,
      audioDuration: duration,
    });

    recUi.classList.add('hidden');
    recBtn.textContent = '🎙️';
    // Remettre le bouton d'envoi à son état initial pour le prochain enregistrement
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤'; }
    await refreshChat(suf);
  } catch (err) {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤'; }
    toast(err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPPRESSION DE COMPTE
// ═══════════════════════════════════════════════════════════════════════════

async function doDeleteAccount() {
  const reason      = el('da-reason').value.trim();
  const feedback    = el('da-feedback').value.trim();
  const bad         = el('da-bad').value.trim();
  const pwd         = el('da-pwd').value;
  const confirmed   = el('da-check').checked;
  if (!reason || !pwd) { toast('Raison et mot de passe requis', 'error'); return; }
  if (!confirmed) { toast('Veuillez cocher la case de confirmation', 'error'); return; }
  try {
    await api('DELETE', '/api/account', { reason, feedback, badExperience: bad, password: pwd });
    closeModal('modal-delete-acct');
    toast('Compte supprimé', 'info');
    doLogout();
  } catch (e) { toast(e.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {

  // Lien de réinitialisation (?reset=TOKEN)
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken) {
    el('auth-modal').classList.remove('hidden');
    el('pane-login').classList.add('hidden');
    el('pane-forgot').classList.add('hidden');
    el('pane-register').classList.add('hidden');
    el('reset-token').value = resetToken;
    el('pane-reset').classList.remove('hidden');
  } else if (token && me) {
    startApp();
  } else {
    showLanding();
  }

  // Init notification badge
  if (token) updateNotifBadge();
});
