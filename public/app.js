// ═══════════════════════════════════════════════════════════════════════════
// app.js — LunchApp v2 Frontend
// ═══════════════════════════════════════════════════════════════════════════

// ─── État global ─────────────────────────────────────────────────────────────
let token     = localStorage.getItem('la_token') || null;
let me        = JSON.parse(localStorage.getItem('la_user') || 'null');
let sseSource = null;

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
function showLanding() {
  el('screen-landing').classList.remove('hidden');
  el('screen-auth').classList.add('hidden');
  el('screen-app').classList.add('hidden');
}
function showAuth(tab) {
  el('screen-landing').classList.add('hidden');
  el('screen-auth').classList.remove('hidden');
  el('screen-app').classList.add('hidden');
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
    // Sidebar highlight
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.sidebar-item[data-pane="${id}"]`);
    if (btn) btn.classList.add('active');
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
    case 'ent-employees':   loadEntEmployees(); loadEntOrders(); loadEntStats(); break;
    case 'ent-messages':    loadConversations('ent'); break;
    case 'emp-menu':        loadEmpMenu(); break;
    case 'emp-history':     loadEmpHistory(); break;
    case 'admin':           loadAdminStats(); break;
    case 'notifs':          loadNotifs(); break;
  }
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function buildSidebar(role) {
  const items = {
    restauratrice: [
      { id: 'resto-home', icon: '🏠', label: 'Accueil & Stats' },
      { id: 'menus',      icon: '📝', label: 'Mes plats' },
      { id: 'clientele',  icon: '👥', label: 'Clientèle' },
      { id: 'rst-messages', icon: '💬', label: 'Messages' },
    ],
    enterprise: [
      { id: 'ent-today',       icon: '📋', label: 'Aujourd\'hui' },
      { id: 'ent-restaurants', icon: '🍴', label: 'Restaurants' },
      { id: 'ent-menus',       icon: '🗒️', label: 'Menus' },
      { id: 'ent-employees',   icon: '👥', label: 'Employés & Stats' },
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
  const nav = el('sidebar');
  nav.innerHTML = (items[role] || []).map(it =>
    `<button class="sidebar-item" data-pane="${it.id}" onclick="showPane('${it.id}')">${it.icon} ${it.label}</button>`
  ).join('');
}

// ─── Login / Register / Logout ────────────────────────────────────────────────
async function doLogin() {
  const type  = document.querySelector('input[name="ltype"]:checked')?.value;
  const email = el('l-id').value.trim();
  const pwd   = el('l-pwd').value;
  if (!email || !pwd) { toast('Remplissez tous les champs', 'error'); return; }
  try {
    const d = await api('POST', '/api/login', { email, password: pwd, type });
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
      const specialty      = el('r-spec').value.trim();
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
  if (sseSource) { sseSource.close(); sseSource = null; }
  showLanding();
}

// ─── App init ─────────────────────────────────────────────────────────────────
function startApp() {
  el('screen-landing').classList.add('hidden');
  el('screen-auth').classList.add('hidden');
  el('screen-app').classList.remove('hidden');

  el('uname').textContent = me.companyName || me.restaurantName || me.fullName || 'Admin';
  const roleLabels = { enterprise: 'Entreprise', restauratrice: 'Restaurant', employee: 'Employé', superadmin: 'Admin' };
  el('urole').textContent = roleLabels[me.role] || me.role;

  buildSidebar(me.role);
  connectSSE();

  // Show first pane per role
  const first = { restauratrice: 'resto-home', enterprise: 'ent-today', employee: 'emp-menu', superadmin: 'admin' };
  showPane(first[me.role] || 'notifs');
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  sseSource.addEventListener('notification', e => {
    const notif = JSON.parse(e.data);
    updateNotifBadge();
    toast(notif.title + ': ' + notif.message, 'info');
  });
  sseSource.onerror = () => setTimeout(connectSSE, 5000);
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
      <div class="profile-card">
        ${r.photo ? `<img src="${esc(r.photo)}" class="profile-photo"/>` : '<div class="profile-photo-placeholder">🍴</div>'}
        <div class="profile-info">
          <h2>${esc(r.restaurantName)}</h2>
          <p>${esc(r.fullName)} · ${esc(r.phone || '')}</p>
          ${r.specialty ? `<p><em>${esc(r.specialty)}</em></p>` : ''}
          ${r.address ? `<p>📍 ${esc(r.address)}</p>` : ''}
          ${r.description ? `<p>${esc(r.description)}</p>` : ''}
          ${r.paymentInfo?.length ? `<p>💳 ${r.paymentInfo.map(p => `${p.type}: ${esc(p.number)}`).join(' | ')}</p>` : ''}
        </div>
        <button class="btn ghost sm" onclick="openProfileModal()">✏️ Modifier</button>
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
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-num">${s.totalOrders}</div><div class="stat-lbl">Commandes</div></div>
        <div class="stat-card"><div class="stat-num">${fmtPrice(s.totalRevenue)}</div><div class="stat-lbl">Recettes</div></div>
        <div class="stat-card"><div class="stat-num">${s.avgRating ? s.avgRating.toFixed(1) + ' ⭐' : '—'}</div><div class="stat-lbl">Note moy. (${s.ratingCount})</div></div>
      </div>
      ${topItems.length ? `<h4>Plats les + demandés</h4><ul class="item-list">${topItems.map(([n,c]) => `<li>${esc(n)} <span class="badge">${c}</span></li>`).join('')}</ul>` : ''}`;
  } catch (e) { toast(e.message, 'error'); }
}

function pdfRestoStats() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('Statistiques Restaurant — LunchApp', 14, 16);
  doc.text(el('rst-stats').innerText, 14, 30);
  doc.save('stats-restaurant.pdf');
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
  confirm2('Supprimer cet article ?', async () => {
    try {
      await api('DELETE', `/api/restaurant/menu/items/${id}`);
      toast('Article supprimé', 'success');
      loadMenus();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// RESTAURANT — Clientèle
// ═══════════════════════════════════════════════════════════════════════════

async function loadClientele() {
  try {
    const [clients, orders, subs, enterprises] = await Promise.all([
      api('GET', '/api/restaurant/clientele'),
      api('GET', '/api/orders'),
      api('GET', '/api/subscriptions'),
      api('GET', '/api/restaurant/enterprises'),
    ]);

    // Clientèle affiliée
    el('clientele-list').innerHTML = clients.length
      ? clients.map(c => `
          <div class="client-card">
            <div>
              <strong>${esc(c.companyName)}</strong>
              ${c.location ? `<a href="${esc(c.location)}" target="_blank" class="map-link">📍 Maps</a>` : ''}
            </div>
            <span class="badge">${c.todayChoices?.length || 0} choix aujourd'hui</span>
          </div>`).join('')
      : '<p class="empty">Aucune entreprise affiliée.</p>';

    // Commandes
    el('rst-orders-list').innerHTML = orders.length
      ? orders.map(o => `
          <div class="order-card">
            <div>
              <strong>${esc(o.enterpriseName)}</strong> — ${fmtDateTime(o.createdAt)}
              <span class="badge ${o.status}">${o.status}</span>
            </div>
            <div>${fmtPrice(o.totalAmount)} · ${o.paymentMode === 'upfront' ? '💳 Mobile' : '🚚 Livraison'}</div>
            <div class="order-btns">
              ${['confirmed','preparing','delivered'].map(s =>
                `<button class="btn ghost sm" onclick="updateOrderStatus('${o.id}','${s}')">${s}</button>`
              ).join('')}
            </div>
          </div>`).join('')
      : '<p class="empty">Aucune commande.</p>';

    // Abonnements
    el('rst-subs-list').innerHTML = subs.length
      ? subs.map(s => `
          <div class="sub-card">
            <span>${esc(s.enterpriseName)} — <em>${s.frequency}</em> — <span class="badge ${s.status}">${s.status}</span></span>
            ${s.status === 'pending' ? `
              <div>
                <button class="btn primary sm" onclick="respondSub('${s.id}','accepted')">✓ Accepter</button>
                <button class="btn danger sm"  onclick="respondSub('${s.id}','declined')">✕ Refuser</button>
              </div>` : ''}
          </div>`).join('')
      : '<p class="empty">Aucune demande.</p>';

    // Offrir services
    el('rst-enterprises-list').innerHTML = enterprises.map(e => `
      <div class="ent-row">
        <span>${esc(e.companyName)}</span>
        ${e.isAffiliated ? '<span class="badge success">Affiliée</span>' : ''}
        ${!e.hasOffer && !e.isAffiliated
          ? `<button class="btn primary sm" onclick="offerService('${e.id}')">📤 Proposer</button>`
          : e.hasOffer && !e.isAffiliated
          ? `<button class="btn ghost sm" onclick="withdrawOffer('${e.id}')">Retirer l'offre</button>`
          : ''}
      </div>`).join('') || '<p class="empty">Aucune entreprise.</p>';
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
    el('prof-spec').value  = r.specialty || '';
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
    specialty:      el('prof-spec').value.trim(),
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
    const [choices, affiliated] = await Promise.all([
      api('GET', '/api/choices/today'),
      api('GET', '/api/enterprise/restaurants'),
    ]);

    if (!affiliated.length) {
      el('ent-today-content').innerHTML = '<p class="empty">Aucun restaurant affilié. Affiliez-vous dans l\'onglet Restaurants.</p>';
      return;
    }

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
            <button class="btn primary sm" onclick="openOrderModal('${g.choices[0].restaurantId}')">📦 Commander</button>
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
      headers: { 'Authorization': 'Bearer ' + _token }
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

function openOrderModal(restaurantId) {
  _orderRestaurantId = restaurantId;
  el('modal-order-body').innerHTML = `
    <p>Mode de paiement :</p>
    <label class="radio-row"><input type="radio" name="paymode" value="delivery" checked> 🚚 Livraison (paiement à la livraison)</label>
    <label class="radio-row"><input type="radio" name="paymode" value="upfront"> 💳 Mobile Money (paiement à l'avance)</label>
    <div id="upfront-section" class="hidden" style="margin-top:12px">
      <div class="field-label">Type de paiement</div>
      <input id="dep-type" type="text" placeholder="Ex: OM, Wave…"/>
      <div class="field-label">Capture du dépôt (base64 ou URL)</div>
      <input id="dep-screenshot" type="text" placeholder="Optionnel"/>
    </div>`;
  document.querySelectorAll('input[name="paymode"]').forEach(r => {
    r.addEventListener('change', () => {
      el('upfront-section').classList.toggle('hidden', r.value !== 'upfront');
    });
  });
  openModal('modal-order');
}

async function submitOrder() {
  const paymentMode = document.querySelector('input[name="paymode"]:checked')?.value;
  const body = { restaurantId: _orderRestaurantId, paymentMode };
  if (paymentMode === 'upfront') {
    body.depositType       = el('dep-type')?.value.trim();
    body.depositScreenshot = el('dep-screenshot')?.value.trim();
  }
  try {
    await api('POST', '/api/orders', body);
    closeModal('modal-order');
    toast('Commande envoyée !', 'success');
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
    const [all, affiliated] = await Promise.all([
      api('GET', '/api/restaurants'),
      api('GET', '/api/enterprise/restaurants'),
    ]);
    const affIds = new Set(affiliated.map(r => r.id));
    const list   = mode === 'all' ? all : affiliated;

    el('ent-restaurants-list').innerHTML = list.length
      ? list.map(r => `
          <div class="resto-card">
            ${r.photo ? `<img src="${esc(r.photo)}" class="resto-thumb"/>` : '<div class="resto-thumb-ph">🍴</div>'}
            <div class="resto-info">
              <h4>${esc(r.restaurantName)}</h4>
              ${r.specialty ? `<p>${esc(r.specialty)}</p>` : ''}
              ${r.address   ? `<p>📍 ${esc(r.address)}</p>` : ''}
              ${r.phone     ? `<p>📞 ${esc(r.phone)}</p>` : ''}
              ${affIds.has(r.id) && r.dailyMenu
                ? `<p class="daily-preview">Menu du jour : ${[...r.dailyMenu.foods, ...r.dailyMenu.drinks].map(i => esc(i.name)).join(', ') || 'Non défini'}</p>`
                : ''}
            </div>
            <div class="resto-actions">
              ${affIds.has(r.id)
                ? `<span class="badge success">Affilié</span>
                   <button class="btn ghost sm" onclick="disaffiliate('${r.id}')">Se désaffilier</button>
                   <button class="btn primary sm" onclick="openSubModal('${r.id}','${esc(r.restaurantName)}')">📅 Abonnement</button>`
                : `<button class="btn primary sm" onclick="affiliate('${r.id}')">+ S'affilier</button>`}
            </div>
          </div>`).join('')
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
  confirm2('Se désaffilier de ce restaurant ?', async () => {
    try {
      await api('DELETE', `/api/enterprise/restaurants/${restaurantId}/affiliate`);
      toast('Désaffilié', 'success');
      loadEntRestaurants();
    } catch (e) { toast(e.message, 'error'); }
  });
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
  confirm2('Supprimer cet employé ?', async () => {
    try {
      await api('DELETE', `/api/enterprise/employees/${id}`);
      toast('Employé supprimé', 'success');
      loadEntEmployees();
    } catch (e) { toast(e.message, 'error'); }
  });
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

function pdfEntStats() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('Statistiques Entreprise — LunchApp', 14, 16);
  doc.text(el('ent-stats-content').innerText, 14, 30);
  doc.save('stats-entreprise.pdf');
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
  confirm2('Supprimer votre choix ?', async () => {
    try {
      await api('DELETE', `/api/choices/${choiceId}`);
      toast('Choix supprimé', 'success');
      loadEmpMenu();
    } catch (e) { toast(e.message, 'error'); }
  });
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

function clearHistory() {
  confirm2('Vider votre historique (sauf aujourd\'hui) ?', async () => {
    try {
      await api('DELETE', '/api/choices/history');
      toast('Historique vidé', 'success');
      loadEmpHistory();
    } catch (e) { toast(e.message, 'error'); }
  });
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
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-num">${s.counts.enterprises}</div><div class="stat-lbl">Entreprises</div></div>
            <div class="stat-card"><div class="stat-num">${s.counts.restaurants}</div><div class="stat-lbl">Restaurants</div></div>
            <div class="stat-card"><div class="stat-num">${s.counts.employees}</div><div class="stat-lbl">Employés</div></div>
            <div class="stat-card"><div class="stat-num">${fmtPrice(s.totalMobilized)}</div><div class="stat-lbl">Total mobilisé</div></div>
          </div>
          <p>👨 ${s.gender.male} hommes · 👩 ${s.gender.female} femmes</p>
          ${Object.keys(s.restaurantRevenue||{}).length ? `<h4>Recettes par restaurant</h4><ul class="item-list">${Object.entries(s.restaurantRevenue).map(([n,v])=>`<li>${esc(n)}: ${fmtPrice(v)}</li>`).join('')}</ul>` : ''}
          ${Object.keys(s.enterpriseBudget||{}).length ? `<h4>Budget par entreprise</h4><ul class="item-list">${Object.entries(s.enterpriseBudget).map(([n,v])=>`<li>${esc(n)}: ${fmtPrice(v)}</li>`).join('')}</ul>` : ''}`;
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
  confirm2(`Supprimer ce ${type} définitivement ?`, async () => {
    try {
      await api('DELETE', `/api/admin/users/${type}/${id}`);
      toast('Supprimé', 'success');
      loadAdminStats();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function pdfAdminStats() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.text('Statistiques Admin — LunchApp', 14, 16);
  doc.text(el('admin-content').innerText.slice(0, 2000), 14, 30);
  doc.save('stats-admin.pdf');
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
  confirm2('Effacer toutes les notifications ?', async () => {
    try { await api('DELETE', '/api/notifications'); loadNotifs(); } catch {}
  });
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
    const convs = await api('GET', '/api/messages/conversations');
    el(listId).innerHTML = convs.length
      ? `<div class="conv-list">${convs.map(c => `
          <div class="conv-row" onclick="openChat('${c.id}','${esc(c.name)}','${suffix}')">
            <span class="conv-name">${esc(c.name)}</span>
            ${c.unread ? `<span class="nbadge">${c.unread}</span>` : ''}
            <span class="conv-preview">${esc(c.lastMessage || '')}</span>
          </div>`).join('')}</div>`
      : '<p class="empty">Aucune conversation. Affiliez-vous à un restaurant pour démarrer une discussion.</p>';
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
  // Mark as read
  try { await api('POST', '/api/messages/read', { senderId: partnerId }); } catch {}
}

async function refreshChat(suf) {
  const msgsEl = el(suf ? 'chat-msgs-ent' : 'chat-msgs');
  try {
    const msgs = await api('GET', `/api/messages?withId=${_chatPartnerId}`);
    msgsEl.innerHTML = msgs.map(m => {
      const mine = m.senderId === me.id;
      if (m.type === 'audio') {
        return `<div class="chat-bubble ${mine ? 'bubble-mine' : 'bubble-theirs'}">
          <audio controls src="/api/messages/${m.id}/audio-src" data-mid="${m.id}" class="audio-player" onplay="loadAudio(this)"></audio>
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

async function loadAudio(audioEl) {
  // Lazy-load audio via /api/messages/:id/audio
  if (audioEl.src && audioEl.src.includes('blob:')) return; // Already loaded
  const mid = audioEl.dataset.mid;
  try {
    const { audioData } = await api('GET', `/api/messages/${mid}/audio`);
    audioEl.src = audioData;
    audioEl.play();
  } catch (e) { toast('Impossible de charger l\'audio', 'error'); }
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

// Audio recording
async function toggleRec(suf) {
  suf = suf || _chatPartnerSuffix;
  if (_mediaRecorder && _mediaRecorder.state === 'recording') { stopRec(suf); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _audioChunks = [];
    _mediaRecorder = new MediaRecorder(stream);
    _mediaRecorder.ondataavailable = e => { if (e.data.size) _audioChunks.push(e.data); };
    _mediaRecorder.start();
    _recSeconds = 0;
    el(suf ? 'rec-ui-ent' : 'rec-ui').classList.remove('hidden');
    el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '⏹️';
    _recTimerInterval = setInterval(() => {
      _recSeconds++;
      const m = Math.floor(_recSeconds / 60), s = _recSeconds % 60;
      el(suf ? 'rec-time-ent' : 'rec-time').textContent = `${m}:${s.toString().padStart(2,'0')}`;
    }, 1000);
  } catch { toast('Microphone non accessible', 'error'); }
}

function stopRec(suf) {
  if (!_mediaRecorder) return;
  _mediaRecorder.stop();
  clearInterval(_recTimerInterval);
  el(suf ? 'rec-ui-ent' : 'rec-ui').classList.remove('hidden');
  el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '🎙️';
}

function cancelRec(suf) {
  suf = suf || _chatPartnerSuffix;
  if (_mediaRecorder) { _mediaRecorder.stop(); _mediaRecorder = null; }
  clearInterval(_recTimerInterval);
  _audioChunks = [];
  el(suf ? 'rec-ui-ent' : 'rec-ui').classList.add('hidden');
  el(suf ? 'rec-btn-ent' : 'rec-btn').textContent = '🎙️';
}

async function sendAudio(suf) {
  suf = suf || _chatPartnerSuffix;
  if (!_audioChunks.length) { toast('Aucun audio enregistré', 'error'); return; }
  const blob = new Blob(_audioChunks, { type: 'audio/webm' });
  const reader = new FileReader();
  reader.onload = async e => {
    const audioData = e.target.result;
    try {
      await api('POST', '/api/messages', {
        recipientId: _chatPartnerId,
        type: 'audio',
        audioData,
        audioDuration: _recSeconds,
      });
      cancelRec(suf);
      await refreshChat(suf);
    } catch (err) { toast(err.message, 'error'); }
  };
  reader.readAsDataURL(blob);
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
  // Radio login — update placeholder
  document.querySelectorAll('input[name="ltype"]').forEach(r => {
    r.addEventListener('change', () => {
      el('l-id').placeholder = r.value === 'employee' ? 'Nom complet' : 'Email';
      el('login-id-label').textContent = r.value === 'employee' ? 'Nom complet' : 'Email';
    });
  });

  // Lien de réinitialisation (?reset=TOKEN)
  const resetToken = new URLSearchParams(window.location.search).get('reset');
  if (resetToken) {
    showAuth('login');
    el('pane-login').classList.add('hidden');
    el('pane-forgot').classList.add('hidden');
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
