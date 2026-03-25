// ── Liste des plats disponibles ──────────────────────────────────────────────
const FOODS = [
  { id: 'riz_gras_soumbala', label: 'Riz gras au soumbala',           emoji: '🍚' },
  { id: 'riz_gras_simple',   label: 'Riz gras simple',                emoji: '🍛' },
  { id: 'riz_blanc_tomate',  label: 'Riz blanc sauce tomate',         emoji: '🍅' },
  { id: 'riz_blanc_arachide',label: "Riz blanc sauce pâte d'arachide",emoji: '🥜' },
  { id: 'couscous',          label: 'Couscous',                       emoji: '🫙' },
  { id: 'dankounou',         label: 'Dankounou',                      emoji: '🥘' },
  { id: 'placali',           label: 'Placali',                        emoji: '🫕' },
  { id: 'to_sauce_feuille',  label: 'Tô sauce feuille',               emoji: '🌿' },
  { id: 'Autres',            label: 'Autres (préciser)',               emoji: '✏️' },
];

// ── Constante de verrouillage (identique à server.js) ────────────────────────
const LOCK_MS = 5 * 60 * 1000; // 5 minutes en millisecondes

// ── État global de l'application ─────────────────────────────────────────────
let token            = localStorage.getItem('la_token');           // Token JWT de session
let me               = JSON.parse(localStorage.getItem('la_user') || 'null'); // Utilisateur connecté
let selectedFood     = null;       // Plat sélectionné dans le modal
let isEditMode       = false;      // true = modification, false = nouveau choix
let currentLoginType = 'employee'; // Type de connexion actif
let intervals        = [];         // Intervalles de rafraîchissement automatique
let choiceTimer      = null;       // Intervalle du compte à rebours de 5 min
let toastTimer;                    // Timer de disparition du toast


document.addEventListener('DOMContentLoaded', () => {
  buildFoodGrid();   // Construit la grille des plats dans le modal
  setNavDate();      // Affiche la date dans la navbar

  // Initialise le sélecteur de login sur "Employé" par défaut
  const defaultBtn = document.querySelector('.lts-btn[data-type="employee"]');
  setLoginType('employee', defaultBtn);

  // Démarre l'app si une session existe, sinon affiche la landing
  if (token && me) bootApp();
  else showScreen('landing-screen');
});


// Affiche un écran (landing | auth | app) et masque les autres
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Navigue vers la connexion depuis la landing
function goToLogin() {
  showScreen('auth-screen');
  showAuthPanel('panel-login');
}

// Navigue vers l'inscription entreprise depuis la landing
function goToRegisterEnterprise() {
  showScreen('auth-screen');
  showAuthPanel('panel-register-enterprise');
}

// Affiche un panneau auth et masque les autres
function showAuthPanel(panelId) {
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
}

// Affiche une section de l'app et charge ses données
function showSection(name) {
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');

  // Synchronise la navigation mobile
  document.querySelectorAll('.bnav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.section === name)
  );

  // Charge les données de la section
  if (name === 'today')     loadToday();
  if (name === 'employees') loadEmployees();
  if (name === 'history')   loadHistory();
  if (name === 'messages')  loadMessages();
  if (name === 'admin')     loadAdminDashboard();
}


// Met à jour le formulaire de login selon le type sélectionné
function setLoginType(type, btn) {
  currentLoginType = type;

  // Mise à jour visuelle des boutons
  document.querySelectorAll('.lts-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const label = document.getElementById('login-identifier-label');
  const input = document.getElementById('login-identifier');
  const hint  = document.getElementById('login-type-hint');

  const config = {
    employee:      { label: 'Votre nom complet',    placeholder: 'Prénom Nom (ou Nom Prénom)',   hint: 'Connectez-vous avec votre nom et mot de passe' },
    enterprise:    { label: "Nom de l'entreprise",  placeholder: 'Ex: Tech Solutions SARL',       hint: "Connectez-vous avec le nom exact de votre entreprise" },
    restauratrice: { label: 'Votre nom complet',    placeholder: 'Prénom Nom',                    hint: 'Connectez-vous avec votre nom et mot de passe' },
    superadmin:    { label: 'Email administrateur', placeholder: 'admin@example.com',             hint: 'Accès réservé aux super-administrateurs système' },
  };

  const c = config[type];
  if (label) label.textContent = c.label;
  if (input) input.placeholder = c.placeholder;
  if (hint)  hint.textContent  = c.hint;

  // ⚠️ CORRECTION BUG : on garde TOUJOURS type="text"
  // Mettre type="email" déclenchait la validation HTML5 du navigateur
  // qui bloquait la soumission AVANT handleLogin, envoyant un champ vide au serveur
  // → Résultat : "Email et mot de passe requis" même avec des valeurs saisies
  if (input) input.type = 'text';
}

// Gère la soumission du formulaire de connexion
async function handleLogin(e) {
  e.preventDefault();
  clearErr('login-error');

  const identifier = document.getElementById('login-identifier').value.trim();
  const password   = document.getElementById('login-password').value;

  // ── Validation JS côté client (remplace la validation HTML5 native) ──
  if (!identifier) {
    const labels = {
      employee:      'votre nom complet',
      enterprise:    "le nom de l'entreprise",
      restauratrice: 'votre nom complet',
      superadmin:    "l'email administrateur",
    };
    showErr('login-error', `Veuillez saisir ${labels[currentLoginType] || 'votre identifiant'}.`);
    return;
  }

  if (!password) {
    showErr('login-error', 'Veuillez saisir votre mot de passe.');
    return;
  }

  // Validation format email uniquement pour superadmin (faite en JS, pas via input.type)
  if (currentLoginType === 'superadmin') {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    if (!emailOk) {
      showErr('login-error', 'Veuillez saisir une adresse email valide.');
      return;
    }
  }

  const btn = document.querySelector('#login-form .btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Connexion...';

  try {
    const d = await api('/api/login', 'POST', { identifier, password, loginType: currentLoginType });
    persist(d);
    bootApp();
  } catch (err) {
    showErr('login-error', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Se connecter <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';
  }
}

// Gère l'inscription d'une entreprise
async function handleRegisterEnterprise(e) {
  e.preventDefault();
  clearErr('register-ent-error');

  const companyName = document.getElementById('ent-name').value.trim();
  const domain      = document.getElementById('ent-domain').value.trim();
  const password    = document.getElementById('ent-password').value;

  const btn = document.querySelector('#register-enterprise-form .btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Création...';

  try {
    const d = await api('/api/enterprise/register', 'POST', { companyName, domain, password });
    persist(d);
    bootApp();
  } catch (err) {
    showErr('register-ent-error', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Créer mon compte entreprise <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}

// Gère l'inscription d'une restauratrice
async function handleRegisterRestauratrice(e) {
  e.preventDefault();
  clearErr('register-resto-error');

  const fullName = document.getElementById('resto-name').value.trim();
  const password = document.getElementById('resto-password').value;

  const btn = document.querySelector('#register-resto-form .btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Création...';

  try {
    const d = await api('/api/restauratrice/register', 'POST', { fullName, password });
    persist(d);
    bootApp();
  } catch (err) {
    showErr('register-resto-error', err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Créer mon compte <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}

// Sauvegarde la session dans les variables globales et localStorage
function persist(d) {
  token = d.token;
  me    = d.user;
  localStorage.setItem('la_token', token);
  localStorage.setItem('la_user', JSON.stringify(me));
}

// Déconnecte et réinitialise l'état complet
function logout() {
  token = null; me = null;
  localStorage.removeItem('la_token');
  localStorage.removeItem('la_user');
  intervals.forEach(clearInterval); intervals = [];
  stopChoiceTimer();
  showScreen('landing-screen');
}


function bootApp() {
  // Configuration des badges de rôle
  const roleConfig = {
    employee:      { badge: '👤 Employé(e)',         color: 'var(--o1)' },
    enterprise:    { badge: ' Chargé de commande', color: 'var(--s1)' },
    restauratrice: { badge: '👩 Restauratrice',      color: 'var(--green)' },
    superadmin:    { badge: ' Super Admin',         color: 'var(--red)' },
  };
  const rc = roleConfig[me.role] || { badge: me.role, color: 'var(--ink4)' };

  // Renseigne la navbar
  document.getElementById('nav-avatar').textContent     = me.fullName.charAt(0).toUpperCase();
  document.getElementById('nav-user-name').textContent  = me.fullName.split(' ')[0];
  document.getElementById('nav-role-badge').textContent = rc.badge;
  document.getElementById('nav-role-badge').style.color = rc.color;

  // Navigation mobile
  setupBottomNav();

  // Panneaux spécifiques aux rôles
  document.getElementById('enterprise-panel').classList.toggle('hidden', me.role !== 'enterprise');
  document.getElementById('resto-panel').classList.toggle('hidden', me.role !== 'restauratrice');
  document.getElementById('card-my-choice').classList.toggle('hidden', me.role !== 'employee');

  // Boutons de la navbar selon le rôle
  document.getElementById('nav-msg-btn').classList.toggle('hidden', !['enterprise', 'restauratrice'].includes(me.role));
  document.getElementById('nav-history-btn').classList.toggle('hidden', me.role !== 'employee');

  showScreen('app-screen');

  // Section de départ selon le rôle
  if (me.role === 'superadmin') showSection('admin');
  else showSection('today');

  // Rafraîchissement automatique toutes les 20s
  intervals.push(setInterval(loadToday, 20000));

  // Polling des messages non lus toutes les 8s
  if (['enterprise', 'restauratrice'].includes(me.role)) {
    intervals.push(setInterval(pollUnread, 8000));
  }
}

// Configure la navigation mobile selon le rôle
function setupBottomNav() {
  const nav = document.getElementById('bottom-nav');

  const tabs = {
    employee:      [
      { icon: '🍽️', label: "Aujourd'hui", section: 'today' },
      { icon: '📋', label: 'Historique',   section: 'history' },
    ],
    enterprise:    [
      { icon: '🍽️', label: "Aujourd'hui", section: 'today' },
      { icon: '👥', label: 'Employés',     section: 'employees' },
      { icon: '💬', label: 'Messages',     section: 'messages', badge: true },
    ],
    restauratrice: [
      { icon: '🍽️', label: 'Commandes',   section: 'today' },
      { icon: '💬', label: 'Messages',     section: 'messages', badge: true },
    ],
    superadmin:    [
      { icon: '', label: 'Dashboard',    section: 'admin' },
    ],
  };

  const roleTabs = tabs[me.role] || [];

  nav.innerHTML = roleTabs.map(t => `
    <button
      class="bnav-btn ${(t.section === 'today' || t.section === 'admin') ? 'active' : ''}"
      onclick="showSection('${t.section}')"
      data-section="${t.section}">
      <span class="bnav-icon">${t.icon}</span>
      <span class="bnav-label">${t.label}</span>
      ${t.badge ? `<span class="bnav-badge hidden" id="msg-badge-mob"></span>` : ''}
    </button>`).join('') +
    // Bouton déconnexion toujours présent dans la nav mobile
    `<button class="bnav-btn bnav-logout" onclick="logout()">
      <span class="bnav-icon">⎋</span>
      <span class="bnav-label">Sortir</span>
    </button>`;
}

// Affiche la date du jour dans la navbar
function setNavDate() {
  const s = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const el = document.getElementById('nav-date');
  if (el) el.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}


async function loadToday() {
  if (me?.role === 'superadmin') return;

  try {
    const [all, mine] = await Promise.all([
      api('/api/choices/today'),
      me.role === 'employee' ? api('/api/choices/mine') : Promise.resolve(null),
    ]);

    if (me.role === 'employee')      renderMyChoice(mine);
    renderTeamGrid(all);
    if (me.role === 'enterprise')    renderEnterprisePanel(all);
    if (me.role === 'restauratrice') renderRestoPanel(all);

  } catch (err) {
    if (err.status === 401) logout();
  }
}

// ── Carte "Mon repas du jour" ────────────────────────────────────────────────

function renderMyChoice(c) {
  stopChoiceTimer();

  const filled    = document.getElementById('my-choice-filled');
  const empty     = document.getElementById('my-choice-empty');
  const badge     = document.getElementById('order-badge');
  const actions   = document.getElementById('mc-actions');
  const timerWrap = document.getElementById('mc-timer-wrap');

  if (c) {
    const f = findFood(c.food);
    document.getElementById('mc-emoji').textContent = f.emoji;
    document.getElementById('mc-name').textContent  =
      c.food === 'Autres' ? (c.customFood || 'Autre plat') : f.label;
    document.getElementById('mc-time').textContent  =
      'Choisi à ' + new Date(c.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    if (c.orderLaunched) {
      badge.innerHTML       = '<span class="badge-launched">✅ Commande lancée</span>';
      actions.style.display = 'none';
      timerWrap.innerHTML   = renderTimerLocked('Commande transmise à la restauratrice.');
    } else {
      badge.innerHTML = '<span class="badge-pending">⏳ En attente</span>';
      startChoiceTimer(c.updatedAt, actions, timerWrap);
    }

    filled.classList.remove('hidden');
    empty.classList.add('hidden');
  } else {
    filled.classList.add('hidden');
    empty.classList.remove('hidden');
    badge.innerHTML = '';
  }
}

// ── Timer 5 minutes ──────────────────────────────────────────────────────────

function startChoiceTimer(updatedAt, actionsEl, wrapEl) {
  const updatedMs = new Date(updatedAt).getTime();

  function tick() {
    const elapsed   = Date.now() - updatedMs;
    const remaining = LOCK_MS - elapsed;

    if (remaining <= 0) {
      stopChoiceTimer();
      actionsEl.style.display = 'none';
      wrapEl.innerHTML = renderTimerLocked('Le délai de 5 minutes est expiré. Votre choix est définitivement enregistré.');
      return;
    }

    actionsEl.style.display = 'flex';

    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const pct  = (remaining / LOCK_MS) * 100;

    let color = 'green';
    if (remaining < 60000)       color = 'red';
    else if (remaining < 120000) color = 'orange';

    wrapEl.innerHTML = `
      <div class="timer-bar-row">
        <span class="timer-icon">${color === 'red' ? '⚠️' : '⏱️'}</span>
        <div class="timer-bar-outer">
          <div class="timer-bar-inner ${color}" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="timer-label ${color}">${mins}:${secs.toString().padStart(2, '0')}</span>
      </div>
      <div class="timer-hint">
        ${color === 'red'
          ? "⚠️ Moins d'une minute ! Modifiez ou supprimez rapidement."
          : `Vous pouvez modifier ou supprimer pendant encore ${mins} min ${secs} s.`}
      </div>`;
  }

  tick();
  choiceTimer = setInterval(tick, 1000);
}

function stopChoiceTimer() {
  if (choiceTimer) { clearInterval(choiceTimer); choiceTimer = null; }
}

function renderTimerLocked(reason) {
  return `<div class="timer-locked-row">
    <span class="tl-icon">🔒</span>
    <div class="tl-text"><strong>Choix verrouillé</strong>${esc(reason)}</div>
  </div>`;
}

// ── Grille des choix ─────────────────────────────────────────────────────────

function renderTeamGrid(all) {
  const grid = document.getElementById('choices-grid');
  document.getElementById('team-count').textContent = `${all.length} choix`;

  if (!all.length) {
    grid.innerHTML = `<div class="empty-grid">
      <div class="eg-icon">🍽️</div>
      <p>Aucun choix pour aujourd'hui</p>
      <small>Soyez le premier à choisir !</small>
    </div>`;
    return;
  }

  grid.innerHTML = all.map((c, i) => {
    const f    = findFood(c.food);
    const isMe = me.role === 'employee' && c.userId === me.id;
    const ini  = initials(c.userName);

    return `
      <div class="choice-card ${isMe ? 'mine' : ''}" style="animation-delay:${i * 0.04}s">
        <div class="cc-head">
          <div class="cc-av">${ini}</div>
          <div>
            <div class="cc-nm">${esc(c.userName)}</div>
            ${isMe ? '<div class="cc-me">👈 Vous</div>' : ''}
          </div>
        </div>
        <div class="cc-food">${f.emoji} ${esc(f.label)}</div>
        ${c.food === 'Autres' && c.customFood ? `<div class="cc-custom">${esc(c.customFood)}</div>` : ''}
      </div>`;
  }).join('');
}

// ── Panneaux Entreprise et Restauratrice ─────────────────────────────────────

function renderEnterprisePanel(all) {
  const launched = all.some(c => c.orderLaunched);

  document.getElementById('enterprise-panel-title').textContent = ` ${me.companyName}`;
  document.getElementById('enterprise-subtitle').textContent = launched
    ? `✅ Commande lancée — ${all.length} repas commandés`
    : `${all.length} employé(s) ont fait leur choix`;

  const btn = document.getElementById('launch-btn');
  btn.disabled = launched || all.length === 0;
  btn.innerHTML = launched
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Commande lancée`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Lancer la commande`;

  renderDishCounts('dish-counts', all, true);
}

function renderRestoPanel(all) {
  const launched = all.some(c => c.orderLaunched);

  document.getElementById('resto-subtitle').textContent = launched
    ? `✅ ${all.length} commandes reçues`
    : `⏳ ${all.length} choix — commande en attente`;

  document.getElementById('resto-status-badge').innerHTML = launched
    ? '<span class="badge-launched">✅ Commande confirmée</span>'
    : '<span class="badge-pending">⏳ En attente</span>';

  renderDishCounts('dish-counts-resto', all, false);
}

function renderDishCounts(containerId, all, darkTheme) {
  const container = document.getElementById(containerId);
  const counts    = {};

  all.forEach(c => {
    const key = c.food === 'Autres' ? (c.customFood || 'Autre') : c.food;
    counts[key] = (counts[key] || 0) + 1;
  });

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    container.innerHTML = `<span style="color:${darkTheme ? 'rgba(255,255,255,.4)' : 'var(--ink5)'}; font-size:.85rem;">Aucun choix pour l'instant</span>`;
    return;
  }

  container.innerHTML = entries.map(([name, count]) => {
    const food  = FOODS.find(f => f.id === name) || { emoji: '🍽️', label: name };
    const label = food.label === 'Autres (préciser)' ? name : food.label;
    return `<div class="dish-count-chip">
      <span>${food.emoji}</span>
      <span>${esc(label)}</span>
      <span class="dc-badge">${count}</span>
    </div>`;
  }).join('');
}

// ── Actions sur les choix ────────────────────────────────────────────────────

async function launchOrder() {
  if (!confirm('Lancer la commande pour tous les repas du jour ?')) return;
  try {
    const r = await api('/api/choices/launch', 'POST');
    toast(`🚀 Commande lancée — ${r.count} repas commandés !`, 'ok');
    loadToday();
  } catch (err) { toast(err.message, 'err'); }
}

async function deleteMyChoice() {
  if (!confirm('Supprimer votre choix du jour ?')) return;
  try {
    await api('/api/choices/mine', 'DELETE');
    toast('🗑️ Choix supprimé', 'info');
    loadToday();
  } catch (err) {
    toast(err.message, 'err');
    loadToday();
  }
}


function buildFoodGrid() {
  document.getElementById('food-grid').innerHTML = FOODS.map(f => `
    <div class="food-opt ${f.id === 'Autres' ? 'autres-opt' : ''}"
         data-id="${f.id}" onclick="pickFood('${f.id}')">
      <span class="fo-em">${f.emoji}</span>
      <span>${f.label}</span>
    </div>`).join('');
}

function openChoiceModal() {
  isEditMode = false; selectedFood = null;
  document.getElementById('modal-title').textContent = 'Choisir mon repas';
  document.getElementById('custom-input').value      = '';
  document.getElementById('custom-field').classList.add('hidden');
  document.getElementById('modal-error').classList.add('hidden');
  document.querySelectorAll('.food-opt').forEach(o => o.classList.remove('sel'));
  document.getElementById('food-modal').classList.remove('hidden');
}

async function openEditModal() {
  isEditMode = true;
  document.getElementById('modal-title').textContent = 'Modifier mon repas';
  document.getElementById('modal-error').classList.add('hidden');

  try {
    const c = await api('/api/choices/mine');
    selectedFood = c?.food || null;
    document.querySelectorAll('.food-opt').forEach(o => o.classList.remove('sel'));

    if (selectedFood) {
      document.querySelector(`.food-opt[data-id="${selectedFood}"]`)?.classList.add('sel');
      if (selectedFood === 'Autres') {
        document.getElementById('custom-field').classList.remove('hidden');
        document.getElementById('custom-input').value = c.customFood || '';
      } else {
        document.getElementById('custom-field').classList.add('hidden');
      }
    }
  } catch { selectedFood = null; }

  document.getElementById('food-modal').classList.remove('hidden');
}

function closeFoodModal() { document.getElementById('food-modal').classList.add('hidden'); }

function backdropClose(e, modalId) {
  if (e.target.id === modalId) document.getElementById(modalId).classList.add('hidden');
}

function pickFood(id) {
  selectedFood = id;
  document.querySelectorAll('.food-opt').forEach(o => o.classList.toggle('sel', o.dataset.id === id));
  if (id === 'Autres') {
    document.getElementById('custom-field').classList.remove('hidden');
    document.getElementById('custom-input').focus();
  } else {
    document.getElementById('custom-field').classList.add('hidden');
  }
}

async function submitChoice() {
  if (!selectedFood) { setModalErr('Veuillez sélectionner un repas.'); return; }

  const customFood = document.getElementById('custom-input').value.trim();
  if (selectedFood === 'Autres' && !customFood) { setModalErr('Veuillez préciser votre plat.'); return; }

  const btn = document.querySelector('#food-modal .btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Enregistrement...';

  try {
    await api('/api/choices', 'POST', { food: selectedFood, customFood });
    closeFoodModal();
    toast(isEditMode ? '✏️ Choix modifié !' : '✅ Choix enregistré !', 'ok');
    loadToday();
  } catch (err) {
    setModalErr(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Confirmer mon choix <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}


async function loadEmployees() {
  if (me.role !== 'enterprise') return;

  const el = document.getElementById('employees-list');
  el.innerHTML = '<div class="skeleton-state">Chargement...</div>';

  try {
    const employees = await api('/api/enterprise/employees');

    if (!employees.length) {
      el.innerHTML = `<div class="empty-hist">
        <div class="eh-icon">👥</div>
        <p>Aucun employé encore créé</p>
        <small>Cliquez sur "Ajouter un employé" pour commencer</small>
      </div>`;
      return;
    }

    el.innerHTML = employees.map((emp, i) => `
      <div class="employee-item" style="animation-delay:${i * 0.04}s">
        <div class="ei-av">${initials(emp.fullName)}</div>
        <div class="ei-info">
          <div class="ei-name">${esc(emp.fullName)}</div>
          <div class="ei-meta">Créé le ${new Date(emp.createdAt).toLocaleDateString('fr-FR')}</div>
        </div>
        <button class="ei-del" onclick="deleteEmployee('${emp.id}')" title="Supprimer">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>`).join('');

  } catch {
    el.innerHTML = '<div class="empty-hist"><p>Erreur de chargement</p></div>';
  }
}

function openAddEmployeeModal() {
  document.getElementById('emp-name').value     = '';
  document.getElementById('emp-password').value = '';
  document.getElementById('emp-modal-error').classList.add('hidden');
  document.getElementById('employee-modal').classList.remove('hidden');
}

function closeEmployeeModal() { document.getElementById('employee-modal').classList.add('hidden'); }

async function submitAddEmployee() {
  const fullName = document.getElementById('emp-name').value.trim();
  const password = document.getElementById('emp-password').value;

  if (!fullName || !password) { setEmpModalErr('Veuillez remplir le nom et le mot de passe.'); return; }
  if (password.length < 6)   { setEmpModalErr('Le mot de passe doit contenir au moins 6 caractères.'); return; }

  const btn = document.querySelector('#employee-modal .btn-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Création...';

  try {
    await api('/api/enterprise/employees', 'POST', { fullName, password });
    closeEmployeeModal();
    toast(`✅ Compte créé pour ${fullName} !`, 'ok');
    loadEmployees();
  } catch (err) {
    setEmpModalErr(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Créer le compte employé <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}

async function deleteEmployee(id) {
  if (!confirm('Supprimer définitivement cet employé ?')) return;
  try {
    await api(`/api/enterprise/employees/${id}`, 'DELETE');
    toast('🗑️ Employé supprimé', 'info');
    loadEmployees();
  } catch (err) { toast(err.message, 'err'); }
}


async function loadHistory() {
  const el = document.getElementById('history-list');
  el.innerHTML = '<div class="skeleton-state">Chargement...</div>';

  try {
    const h = await api('/api/history');

    if (!h.length) {
      el.innerHTML = `<div class="empty-hist">
        <div class="eh-icon"></div>
        <p>Aucun historique</p>
        <small>Vos choix passés apparaîtront ici</small>
      </div>`;
      return;
    }

    el.innerHTML = h.map((c, i) => {
      const f = findFood(c.food);
      const d = new Date(c.date);
      return `
        <div class="history-item" style="animation-delay:${i * 0.04}s">
          <div class="hi-date-block">
            <span class="hi-day">${d.getDate().toString().padStart(2, '0')}</span>
            <span class="hi-month">${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
          </div>
          <div>
            <div class="hi-food-name">${f.emoji} ${esc(f.label)}</div>
            ${c.food === 'Autres' && c.customFood ? `<div class="hi-custom-txt">${esc(c.customFood)}</div>` : ''}
          </div>
          <span class="hi-st ${c.orderLaunched ? 'ok' : 'wait'}">
            ${c.orderLaunched ? '✅ Commandé' : '⏳ En attente'}
          </span>
        </div>`;
    }).join('');

  } catch { el.innerHTML = '<div class="empty-hist"><p>Erreur de chargement</p></div>'; }
}


async function loadMessages() {
  const box = document.getElementById('chat-messages');

  try {
    const msgs = await api('/api/messages');
    await api('/api/messages/read', 'POST');
    updateNotifBadge(0);

    if (!msgs.length) {
      box.innerHTML = `<div class="chat-empty">
        <div class="ce-icon">💬</div>
        <p>Aucun message pour l'instant</p>
        <small>Démarrez la conversation !</small>
      </div>`;
      return;
    }

    box.innerHTML = '';
    let lastDate = '';

    msgs.forEach(m => {
      const dateKey = m.timestamp.split('T')[0];

      if (dateKey !== lastDate) {
        lastDate = dateKey;
        const sep = document.createElement('div');
        sep.className   = 'chat-date-sep';
        sep.textContent = new Date(m.timestamp).toLocaleDateString('fr-FR', {
          weekday: 'long', day: 'numeric', month: 'long',
        });
        box.appendChild(sep);
      }

      const isMine = m.senderId === me.id;
      const wrap   = document.createElement('div');
      wrap.className = `msg-wrap ${isMine ? 'sent' : 'recv'}`;
      wrap.innerHTML = `
        <div class="msg-meta">${isMine ? 'Vous' : esc(m.senderName)}</div>
        <div class="msg-bubble">${esc(m.content)}</div>
        <div class="msg-time">${new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>`;
      box.appendChild(wrap);
    });

    box.scrollTop = box.scrollHeight;

  } catch { box.innerHTML = '<div class="chat-empty"><p>Erreur de chargement</p></div>'; }
}

async function sendMessage() {
  const inp     = document.getElementById('chat-input');
  const content = inp.value.trim();
  if (!content) return;
  inp.value = ''; inp.style.height = 'auto';

  try {
    await api('/api/messages', 'POST', { content });
    await loadMessages();
  } catch (err) { toast(err.message, 'err'); }
}

function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  const inp = e.target;
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
}

async function pollUnread() {
  try {
    const { count } = await api('/api/messages/unread');
    updateNotifBadge(count);
  } catch {}
}

function updateNotifBadge(count) {
  const dot = document.getElementById('msg-notif-dot');
  const mob = document.getElementById('msg-badge-mob');
  if (count > 0) {
    if (dot) dot.classList.remove('hidden');
    if (mob) { mob.classList.remove('hidden'); mob.textContent = count > 9 ? '9+' : count; }
  } else {
    if (dot) dot.classList.add('hidden');
    if (mob) mob.classList.add('hidden');
  }
}


async function loadAdminDashboard() {
  if (me.role !== 'superadmin') return;

  try {
    const [enterprises, employees, restos, todayChoices, history] = await Promise.all([
      api('/api/admin/enterprises'),
      api('/api/admin/employees'),
      api('/api/admin/restauratrices'),
      api('/api/admin/choices/today'),
      api('/api/admin/history'),
    ]);

    // Stats
    document.getElementById('admin-stats-grid').innerHTML = `
      <div class="admin-stat-card"><div class="asc-icon orange"></div><div><div class="asc-num">${enterprises.length}</div><div class="asc-label">Entreprises</div></div></div>
      <div class="admin-stat-card"><div class="asc-icon blue"></div><div><div class="asc-num">${employees.length}</div><div class="asc-label">Employés</div></div></div>
      <div class="admin-stat-card"><div class="asc-icon green"></div><div><div class="asc-num">${todayChoices.length}</div><div class="asc-label">Commandes aujourd'hui</div></div></div>
      <div class="admin-stat-card"><div class="asc-icon orange"></div><div><div class="asc-num">${restos.length}</div><div class="asc-label">Restauratrices</div></div></div>`;

    // Entreprises
    document.getElementById('admin-ent-count').textContent = enterprises.length;
    document.getElementById('admin-enterprises-list').innerHTML = enterprises.length
      ? enterprises.map((ent, i) => {
          const entEmps = employees.filter(e => e.enterpriseId === ent.id);
          return `<div class="admin-ent-item" style="animation-delay:${i * 0.05}s">
            <div class="aei-header">
              <div class="aei-icon"></div>
              <div>
                <div class="aei-name">${esc(ent.companyName)}</div>
                <div class="aei-domain">${esc(ent.domain)} — ${entEmps.length} employé(s) — Créée le ${new Date(ent.createdAt).toLocaleDateString('fr-FR')}</div>
              </div>
            </div>
            <div class="aei-employees">
              ${entEmps.length
                ? entEmps.map(e => `<span class="aei-emp-chip">👤 ${esc(e.fullName)}</span>`).join('')
                : '<span style="font-size:.78rem;color:var(--ink5)">Aucun employé</span>'}
            </div>
          </div>`;
        }).join('')
      : '<div class="empty-hist"><p>Aucune entreprise inscrite</p></div>';

    // Commandes du jour
    document.getElementById('admin-choices-count').textContent = todayChoices.length;
    document.getElementById('admin-choices-list').innerHTML = todayChoices.length
      ? todayChoices.map((c, i) => {
          const f       = findFood(c.food);
          const entName = enterprises.find(e => e.id === c.enterpriseId)?.companyName || '';
          return `<div class="choice-card" style="animation-delay:${i * 0.04}s">
            <div class="cc-head">
              <div class="cc-av">${initials(c.userName)}</div>
              <div>
                <div class="cc-nm">${esc(c.userName)}</div>
                <div style="font-size:.72rem;color:var(--s1);font-weight:600"> ${esc(entName)}</div>
              </div>
            </div>
            <div class="cc-food">${f.emoji} ${esc(f.label)}</div>
            ${c.food === 'Autres' && c.customFood ? `<div class="cc-custom">${esc(c.customFood)}</div>` : ''}
          </div>`;
        }).join('')
      : '<div class="empty-grid"><div class="eg-icon">🍽️</div><p>Aucune commande aujourd\'hui</p></div>';

    // Historique global
    document.getElementById('admin-history-list').innerHTML = history.length
      ? history.slice(0, 50).map((c, i) => {
          const f       = findFood(c.food);
          const d       = new Date(c.date);
          const entName = enterprises.find(e => e.id === c.enterpriseId)?.companyName || '';
          return `<div class="history-item" style="animation-delay:${i * 0.02}s">
            <div class="hi-date-block">
              <span class="hi-day">${d.getDate().toString().padStart(2, '0')}</span>
              <span class="hi-month">${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
            </div>
            <div>
              <div class="hi-food-name">${f.emoji} ${esc(f.label)}</div>
              <div style="font-size:.78rem;color:var(--ink4);margin-top:2px">
                👤 ${esc(c.userName)} ${entName ? `—  ${esc(entName)}` : ''}
              </div>
            </div>
            <span class="hi-st ${c.orderLaunched ? 'ok' : 'wait'}">${c.orderLaunched ? '✅' : '⏳'}</span>
          </div>`;
        }).join('')
      : '<div class="empty-hist"><p>Aucun historique</p></div>';

  } catch (err) { console.error('Admin dashboard error:', err); }
}


async function downloadPDF() {
  try {
    const all      = await api('/api/choices/today');
    const { jsPDF } = window.jspdf;
    const doc      = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const today    = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const todayStr = new Date().toISOString().split('T')[0];

    doc.setFillColor(249, 115, 22); doc.rect(0, 0, 210, 38, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.setFont('helvetica', 'bold');
    doc.text('LunchApp', 15, 16);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text(`Commandes — ${me.companyName || ''}`, 15, 25);
    doc.setFontSize(10); doc.text(today.charAt(0).toUpperCase() + today.slice(1), 15, 33);

    const counts = {};
    all.forEach(c => { const k = c.food === 'Autres' ? (c.customFood || 'Autre') : c.food; counts[k] = (counts[k] || 0) + 1; });
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    let y = 48;
    doc.setTextColor(30, 41, 59); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('RÉSUMÉ DES COMMANDES', 15, y); y += 2;
    doc.setDrawColor(249, 115, 22); doc.setLineWidth(0.8); doc.line(15, y + 1, 100, y + 1); y += 8;

    doc.setFontSize(10);
    entries.forEach(([name, count], i) => {
      const food = FOODS.find(f => f.id === name) || { label: name };
      const lbl  = food.label === 'Autres (préciser)' ? name : food.label;
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(13, y - 5, 184, 8, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 41, 59); doc.text(lbl, 18, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(249, 115, 22); doc.text(`× ${count}`, 175, y, { align: 'right' });
      y += 10;
    });

    y += 4; doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(15, y, 195, y); y += 8;
    doc.setFillColor(249, 115, 22); doc.rect(13, y - 6, 184, 10, 'F');
    doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255); doc.setFontSize(11);
    doc.text('TOTAL', 18, y); doc.text(`${all.length} repas`, 175, y, { align: 'right' }); y += 18;

    doc.setTextColor(30, 41, 59); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text('DÉTAIL PAR EMPLOYÉ', 15, y); y += 2;
    doc.setDrawColor(56, 189, 248); doc.setLineWidth(0.8); doc.line(15, y + 1, 120, y + 1); y += 8;

    doc.setFillColor(14, 165, 233); doc.rect(13, y - 5, 184, 8, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('N°', 18, y); doc.text('Employé', 30, y); doc.text('Repas', 100, y); doc.text('Heure', 175, y, { align: 'right' }); y += 10;

    all.forEach((c, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      const food  = findFood(c.food);
      const label = c.food === 'Autres' ? (c.customFood || 'Autre') : food.label;
      const heure = new Date(c.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(13, y - 5, 184, 8, 'F'); }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.setTextColor(100, 116, 139); doc.text(`${i + 1}`, 18, y);
      doc.setTextColor(30, 41, 59); doc.text(c.userName.slice(0, 25), 30, y); doc.text(label.slice(0, 35), 100, y);
      doc.setTextColor(100, 116, 139); doc.text(heure, 175, y, { align: 'right' }); y += 9;
    });

    const pH = doc.internal.pageSize.getHeight();
    doc.setFillColor(249, 115, 22); doc.rect(0, pH - 14, 210, 14, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(`LunchApp — Généré le ${new Date().toLocaleString('fr-FR')}`, 15, pH - 5);
    doc.text(`${all.length} repas`, 195, pH - 5, { align: 'right' });

    doc.save(`commande_${(me.companyName || 'lunchapp').replace(/\s+/g, '_')}_${todayStr}.pdf`);
    toast('📄 PDF téléchargé !', 'ok');

  } catch (err) { console.error(err); toast('Erreur PDF', 'err'); }
}


function checkPwdStrength(val) {
  const bar   = document.getElementById('pwd-strength-bar');
  const fill  = document.getElementById('pwd-strength-fill');
  const label = document.getElementById('pwd-strength-label');
  const rules = {
    len:     /^.{8,}$/,
    upper:   /[A-Z]/,
    lower:   /[a-z]/,
    num:     /[0-9]/,
    special: /[!@#$%^&*()\-_=+[\]{};:'",.<>?/\\|`~]/,
  };

  if (!val) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');

  let score = 0;
  Object.entries(rules).forEach(([key, regex]) => {
    const ok = regex.test(val);
    if (ok) score++;
    const el = document.getElementById(`rule-${key}`);
    if (el) {
      el.classList.toggle('ok', ok);
      const text = el.textContent.replace(/^[○✓]\s/, '');
      el.textContent = (ok ? '✓' : '○') + ' ' + text;
    }
  });

  const pct = (score / 5) * 100;
  fill.style.width = pct + '%';

  const levels = [
    { max: 2, bg: 'var(--red)',   txt: 'Faible',  color: 'var(--red)' },
    { max: 3, bg: 'var(--o1)',    txt: 'Moyen',   color: 'var(--o1)' },
    { max: 4, bg: 'var(--s1)',    txt: 'Bien',    color: 'var(--s1)' },
    { max: 5, bg: 'var(--green)', txt: 'Fort ✓', color: 'var(--green)' },
  ];
  const lv = levels.find(l => score <= l.max) || levels[3];
  fill.style.background = lv.bg;
  label.textContent     = lv.txt;
  label.style.color     = lv.color;
}


// Requête HTTP centralisée
async function api(url, method = 'GET', body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) { const e = new Error(data.error || 'Erreur serveur'); e.status = res.status; throw e; }
  return data;
}

// Trouve un plat par son id
function findFood(id) { return FOODS.find(f => f.id === id) || { emoji: '🍽️', label: id }; }

// Génère les initiales d'un nom (ex: "Jean Dupont" → "JD")
function initials(name) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

// Échappe les caractères HTML (protection XSS)
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showErr(id, msg)  { const e = document.getElementById(id); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }
function clearErr(id)      { const e = document.getElementById(id); if (e) e.classList.add('hidden'); }
function setModalErr(msg)  { const e = document.getElementById('modal-error');     e.textContent = msg; e.classList.remove('hidden'); }
function setEmpModalErr(m) { const e = document.getElementById('emp-modal-error'); e.textContent = m;   e.classList.remove('hidden'); }

// Affiche une notification toast (ok=vert | err=rouge | info=bleu)
function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast t-${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3500);
}

// Toggle visibilité du mot de passe
function togglePwd(id, btn) {
  const inp = document.getElementById(id);
  inp.type  = inp.type === 'password' ? 'text' : 'password';
  btn.innerHTML = inp.type === 'password'
    ? '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>'
    : '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>';
}