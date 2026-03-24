// Liste complète des plats disponibles avec identifiant, libellé et emoji
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
  // Note : l'id 'Autres' correspond exactement à la valeur envoyée au serveur
];

// ── Constante de verrouillage (doit être identique à server.js) ──────────────
// Durée maximale en millisecondes pendant laquelle l'utilisateur peut modifier son choix
const LOCK_MS = 3 * 60 * 1000; // 3 minutes × 60 s × 1000 ms = 180 000 ms

// ── Variables d'état globales ─────────────────────────────────────────────────

// Token JWT de la session courante (chargé depuis localStorage au démarrage)
let token = localStorage.getItem('la_token');

// Objet utilisateur connecté (id, fullName, email, role)
let me = JSON.parse(localStorage.getItem('la_user') || 'null');

// Identifiant du plat actuellement sélectionné dans le modal
let selectedFood = null;

// Booléen : true si on est en mode modification, false si c'est un nouveau choix
let isEditMode = false;

// Tableau des identifiants d'intervalles pour pouvoir les arrêter lors de la déconnexion
let intervals = [];

// Identifiant de l'intervalle du compte à rebours (null si aucun timer en cours)
let choiceTimer = null;

// ── Initialisation au chargement de la page ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Construit la grille des plats dans le modal dès le chargement du DOM
  buildFoodGrid();

  // Attache les écouteurs d'événements aux formulaires d'authentification
  setupAuth();

  // Affiche la date du jour dans la barre de navigation
  setNavDate();

  // Si un token et un utilisateur sont sauvegardés, démarre l'app directement
  if (token && me) bootApp();
  // Sinon affiche l'écran d'authentification
  else showScreen('auth-screen');
});

// ── Configuration des formulaires d'authentification ─────────────────────────
function setupAuth() {
  // Sélectionne tous les boutons d'onglets et leur attache un écouteur de clic
  document.querySelectorAll('.tab-pill').forEach(btn =>
    btn.addEventListener('click', () => {
      // Retire la classe "active" de tous les onglets
      document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
      // Ajoute "active" à l'onglet cliqué
      btn.classList.add('active');
      // Masque tous les formulaires
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      // Affiche le formulaire correspondant à l'onglet cliqué (login ou register)
      document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
    })
  );

  // Attache la soumission du formulaire de connexion
  document.getElementById('login-form').addEventListener('submit', async e => {
    // Empêche le rechargement de la page (comportement par défaut du formulaire HTML)
    e.preventDefault();
    // Appelle la fonction de connexion avec les valeurs des champs
    await doLogin(
      document.getElementById('login-email').value.trim(), // Email nettoyé des espaces
      document.getElementById('login-password').value      // Mot de passe (pas de trim pour respecter les espaces intentionnels)
    );
  });

  // Attache la soumission du formulaire d'inscription
  document.getElementById('register-form').addEventListener('submit', async e => {
    // Empêche le rechargement de la page
    e.preventDefault();
    // Appelle la fonction d'inscription avec toutes les valeurs des champs
    await doRegister(
      document.getElementById('reg-name').value.trim(),    // Nom complet
      document.getElementById('reg-phone').value.trim(),   // Téléphone
      document.getElementById('reg-email').value.trim(),   // Email
      document.getElementById('reg-password').value,       // Mot de passe
      document.getElementById('reg-role').value            // Rôle sélectionné (user ou restauratrice)
    );
  });
}

// Fonction appelée quand l'utilisateur clique sur un rôle dans le sélecteur d'inscription
function selectRole(role, el) {
  // Retire la classe "active" de toutes les options de rôle
  document.querySelectorAll('.role-option').forEach(o => o.classList.remove('active'));
  // Ajoute "active" à l'option cliquée (affiche la coche ✓ via CSS)
  el.classList.add('active');
  // Met à jour le champ caché avec le rôle sélectionné (sera envoyé au serveur)
  document.getElementById('reg-role').value = role;
}

// Fonction asynchrone gérant la connexion d'un utilisateur existant
async function doLogin(email, password) {
  // Efface les éventuelles erreurs précédentes affichées
  clearErr('login-error');

  // Récupère le bouton de soumission pour le désactiver pendant la requête
  const btn = document.querySelector('#login-form .btn-submit');
  // Désactive le bouton pour éviter les double-clics
  btn.disabled = true;
  // Change le texte pour indiquer le chargement
  btn.textContent = 'Connexion...';

  try {
    // Envoie la requête POST /api/login avec email et mot de passe
    const d = await api('/api/login', 'POST', { email, password });
    // Sauvegarde le token et l'utilisateur dans le localStorage
    persist(d);
    // Démarre l'application principale
    bootApp();
  } catch (e) {
    // En cas d'erreur, affiche le message d'erreur dans la zone dédiée
    showErr('login-error', e.message);
  } finally {
    // Réactive le bouton dans tous les cas (succès ou échec)
    btn.disabled = false;
    // Restaure le contenu HTML original du bouton (avec l'icône SVG)
    btn.innerHTML = 'Se connecter <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';
  }
}

// Fonction asynchrone gérant la création d'un nouveau compte
async function doRegister(fullName, phone, email, password, role) {
  // Efface les erreurs précédentes
  clearErr('register-error');

  // Récupère et désactive le bouton de soumission
  const btn = document.querySelector('#register-form .btn-submit');
  btn.disabled = true;
  btn.textContent = 'Création...';

  try {
    // Envoie la requête POST /api/register avec toutes les informations
    const d = await api('/api/register', 'POST', { fullName, phone, email, password, role });
    // Sauvegarde la session
    persist(d);
    // Démarre l'application (le compte vient d'être créé et l'utilisateur est connecté)
    bootApp();
  } catch (e) {
    // Affiche le message d'erreur retourné par le serveur
    showErr('register-error', e.message);
  } finally {
    // Réactive le bouton et restaure son HTML original
    btn.disabled = false;
    btn.innerHTML = 'Créer mon compte <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}

// Sauvegarde le token et l'utilisateur dans le localStorage et les variables globales
function persist(d) {
  // Stocke le token JWT reçu du serveur
  token = d.token;
  // Stocke les informations de l'utilisateur
  me = d.user;
  // Persiste le token dans localStorage (survit aux rechargements de page)
  localStorage.setItem('la_token', token);
  // Persiste l'utilisateur en JSON dans localStorage
  localStorage.setItem('la_user', JSON.stringify(me));
}

// Déconnecte l'utilisateur et réinitialise l'état de l'application
function logout() {
  // Efface les variables d'état
  token = null;
  me = null;
  // Supprime les données de session du localStorage
  localStorage.removeItem('la_token');
  localStorage.removeItem('la_user');
  // Arrête tous les intervalles de rafraîchissement
  intervals.forEach(clearInterval);
  // Vide le tableau des intervalles
  intervals = [];
  // Arrête le timer du compte à rebours s'il est en cours
  stopChoiceTimer();
  // Retourne à l'écran d'authentification
  showScreen('auth-screen');
}

// ── Démarrage de l'application après authentification ────────────────────────
function bootApp() {
  // Affiche l'initiale de l'utilisateur dans l'avatar de la navbar
  document.getElementById('nav-avatar').textContent = me.fullName.charAt(0).toUpperCase();
  // Affiche le prénom de l'utilisateur dans la navbar
  document.getElementById('nav-user-name').textContent = me.fullName.split(' ')[0];

  // Mapping des rôles vers leurs libellés affichés dans la navbar
  const roleLabels = {
    admin: '👨‍💼 Chargé de commande',
    restauratrice: '👩‍🍳 Restauratrice',
    user: '👤 Employé(e)'
  };
  // Affiche le badge de rôle correspondant
  document.getElementById('nav-role-badge').textContent = roleLabels[me.role] || '';

  // Affiche le panneau admin uniquement si l'utilisateur est admin
  if (me.role === 'admin') document.getElementById('admin-panel').classList.remove('hidden');
  // Affiche le panneau restauratrice uniquement si c'est la restauratrice
  if (me.role === 'restauratrice') document.getElementById('resto-panel').classList.remove('hidden');

  // Cache le bouton messagerie pour les employés simples (accès réservé)
  if (!['admin', 'restauratrice'].includes(me.role)) {
    // Cache le bouton messagerie dans la navbar desktop
    document.getElementById('nav-msg-btn').classList.add('hidden');
    // Cache le bouton messagerie dans la navigation mobile
    const mobMsg = document.querySelector('.bnav-btn[data-section="messages"]');
    if (mobMsg) mobMsg.classList.add('hidden');
  }

  // Affiche l'écran principal de l'application
  showScreen('app-screen');
  // Affiche la section "Aujourd'hui" par défaut
  showSection('today');

  // Lance le rafraîchissement automatique des données toutes les 20 secondes
  // et stocke l'identifiant pour pouvoir l'arrêter à la déconnexion
  intervals.push(setInterval(loadToday, 20000));

  // Lance le polling des messages non lus toutes les 8 secondes (admin et restauratrice seulement)
  if (['admin', 'restauratrice'].includes(me.role)) {
    intervals.push(setInterval(pollUnread, 8000));
  }
}

// ── Navigation entre écrans et sections ──────────────────────────────────────

// Affiche l'écran identifié par "id" et masque tous les autres
function showScreen(id) {
  // Retire la classe "active" de tous les écrans
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  // Ajoute "active" à l'écran cible (le rend visible via CSS)
  document.getElementById(id).classList.add('active');
}

// Affiche la section identifiée par "name" et met à jour la navigation
function showSection(name) {
  // Masque toutes les sections
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  // Affiche la section cible
  document.getElementById(`section-${name}`).classList.add('active');

  // Met à jour l'état actif dans la navigation mobile (bottom nav)
  document.querySelectorAll('.bnav-btn').forEach(b => {
    // Active le bouton correspondant à la section, désactive les autres
    b.classList.toggle('active', b.dataset.section === name);
  });

  // Charge les données spécifiques à chaque section lors de la navigation
  if (name === 'today')    loadToday();     // Charge les choix du jour
  if (name === 'history')  loadHistory();   // Charge l'historique
  if (name === 'messages') loadMessages();  // Charge les messages
}

// Affiche la date du jour formatée dans la navbar
function setNavDate() {
  const d = new Date();
  // Formate la date en français avec le jour de la semaine complet (ex: "Lundi 15 décembre 2024")
  const s = d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const el = document.getElementById('nav-date');
  // Met la première lettre en majuscule (toLocaleDateString retourne en minuscules)
  if (el) el.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Chargement des données du jour ────────────────────────────────────────────
async function loadToday() {
  try {
    // Lance simultanément deux requêtes en parallèle pour optimiser les performances
    const [all, mine] = await Promise.all([
      api('/api/choices/today'), // Tous les choix de l'équipe pour aujourd'hui
      api('/api/choices/mine'),  // Le choix personnel de l'utilisateur connecté
    ]);

    // Met à jour l'affichage du choix personnel avec le timer
    renderMyChoice(mine);
    // Met à jour la grille des choix de l'équipe
    renderTeamGrid(all, mine);
    // Met à jour le panneau admin si l'utilisateur est admin
    if (me.role === 'admin')         renderAdminPanel(all);
    // Met à jour le panneau restauratrice si c'est la restauratrice
    if (me.role === 'restauratrice') renderRestoPanel(all);

  } catch (e) {
    // Si le token est expiré (erreur 401), déconnecte automatiquement l'utilisateur
    if (e.status === 401) logout();
  }
}

// ── Affichage du choix personnel + démarrage/arrêt du timer ──────────────────
function renderMyChoice(c) {
  // Arrête toujours le timer précédent avant de recalculer (évite les fuites mémoire)
  stopChoiceTimer();

  // Références aux éléments DOM à manipuler
  const filled    = document.getElementById('my-choice-filled');   // Bloc "choix rempli"
  const empty     = document.getElementById('my-choice-empty');    // Bloc "aucun choix"
  const badge     = document.getElementById('order-badge');        // Badge de statut
  const actions   = document.getElementById('mc-actions');         // Boutons Modifier/Supprimer
  const timerWrap = document.getElementById('mc-timer-wrap');      // Conteneur du timer

  if (c) {
    // Un choix existe : on affiche les détails

    // Trouve les infos du plat (emoji, libellé) dans la liste FOODS
    const f = findFood(c.food);

    // Affiche l'emoji du plat
    document.getElementById('mc-emoji').textContent = f.emoji;

    // Affiche le nom du plat (libellé custom si "Autres", sinon le libellé standard)
    document.getElementById('mc-name').textContent =
      c.food === 'Autres' ? (c.customFood || 'Autre plat') : f.label;

    // Affiche l'heure du dernier choix/modification au format HH:MM
    document.getElementById('mc-time').textContent =
      'Choisi à ' + new Date(c.updatedAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      });

    if (c.orderLaunched) {
      // La commande a été lancée : verrouillage définitif

      // Affiche le badge vert "Commande lancée"
      badge.innerHTML = '<span class="badge-launched">✅ Commande lancée</span>';
      // Cache les boutons Modifier/Supprimer (action impossible après lancement)
      actions.style.display = 'none';
      // Affiche le bloc "verrouillé" avec un message dédié
      timerWrap.innerHTML = renderTimerLocked('Commande transmise à la restauratrice.');

    } else {
      // La commande n'a pas encore été lancée

      // Affiche le badge "En attente"
      badge.innerHTML = '<span class="badge-pending">⏳ En attente</span>';
      // Démarre le compte à rebours de 3 minutes en passant les références nécessaires
      startChoiceTimer(c.updatedAt, actions, timerWrap);
    }

    // Affiche le bloc "choix rempli" et cache le bloc "aucun choix"
    filled.classList.remove('hidden');
    empty.classList.add('hidden');

  } else {
    // Aucun choix pour aujourd'hui

    // Arrête tout timer résiduel
    stopChoiceTimer();
    // Affiche le bloc "aucun choix" et cache le bloc "choix rempli"
    filled.classList.add('hidden');
    empty.classList.remove('hidden');
    // Vide le badge de statut
    badge.innerHTML = '';
  }
}

// ── Logique du compte à rebours ───────────────────────────────────────────────

// Démarre le timer visuel de 3 minutes pour un choix donné
function startChoiceTimer(updatedAt, actionsEl, wrapEl) {
  // Convertit la date de dernière mise à jour en millisecondes depuis l'époque Unix
  const updatedMs = new Date(updatedAt).getTime();

  // Fonction exécutée à chaque "tick" (toutes les secondes)
  function tick() {
    // Calcule le temps écoulé depuis la dernière mise à jour
    const elapsed   = Date.now() - updatedMs;
    // Calcule le temps restant avant verrouillage
    const remaining = LOCK_MS - elapsed;

    if (remaining <= 0) {
      // Le délai de 3 minutes est expiré

      // Arrête l'intervalle pour ne plus appeler tick()
      stopChoiceTimer();
      // Cache les boutons Modifier et Supprimer
      actionsEl.style.display = 'none';
      // Affiche le message de verrouillage définitif
      wrapEl.innerHTML = renderTimerLocked(
        'Le délai de 3 minutes est expiré. Votre choix est définitivement enregistré.'
      );
      return; // Sortie anticipée pour ne pas continuer les calculs
    }

    // Le délai n'est pas encore expiré : on affiche les boutons
    actionsEl.style.display = 'flex';

    // Calcule les minutes et secondes restantes pour l'affichage
    const mins = Math.floor(remaining / 60000);                    // Partie entière des minutes
    const secs = Math.floor((remaining % 60000) / 1000);           // Secondes restantes après les minutes
    // Calcule le pourcentage de temps restant (100% = 3 min, 0% = expiré)
    const pct  = (remaining / LOCK_MS) * 100;

    // Détermine la couleur selon l'urgence du temps restant
    let color = 'green';                         // Par défaut : vert (>2 minutes)
    if (remaining < 60000)  color = 'red';       // Rouge si moins d'1 minute
    else if (remaining < 120000) color = 'orange'; // Orange si moins de 2 minutes

    // Injecte le HTML de la barre de progression dans le conteneur
    wrapEl.innerHTML = `
      <div class="timer-bar-row">
        <!-- Icône d'urgence ou de timer selon le temps restant -->
        <span class="timer-icon">${color === 'red' ? '⚠️' : '⏱️'}</span>

        <!-- Conteneur de la barre de progression -->
        <div class="timer-bar-outer">
          <!-- Barre colorée dont la largeur reflète le pourcentage de temps restant -->
          <div class="timer-bar-inner ${color}" style="width:${pct.toFixed(1)}%"></div>
        </div>

        <!-- Affichage numérique du temps restant (MM:SS) -->
        <!-- padStart(2,'0') formate les secondes avec un zéro devant si nécessaire (ex: "2:05") -->
        <span class="timer-label ${color}">${mins}:${secs.toString().padStart(2, '0')}</span>
      </div>

      <!-- Message d'aide contextuel sous la barre -->
      <div class="timer-hint">
        ${color === 'red'
          // Message d'urgence si moins d'1 minute
          ? "⚠️ Moins d'une minute ! Modifiez ou supprimez rapidement."
          // Message informatif sinon
          : 'Vous pouvez modifier ou supprimer votre choix pendant encore ' + mins + ' min ' + secs + ' s.'
        }
      </div>`;
  }

  // Exécute tick() immédiatement pour l'affichage instantané (sans attendre 1 seconde)
  tick();
  // Démarre l'intervalle : tick() sera appelé toutes les 1000 ms (1 seconde)
  choiceTimer = setInterval(tick, 1000);
}

// Arrête le timer en cours et nettoie la référence
function stopChoiceTimer() {
  // Si un timer est en cours, l'arrête
  if (choiceTimer) {
    clearInterval(choiceTimer);  // Annule l'intervalle
    choiceTimer = null;          // Remet la référence à null
  }
}

// Génère le HTML du bloc "Choix verrouillé" avec un message personnalisé
function renderTimerLocked(reason) {
  return `
    <div class="timer-locked-row">
      <span class="tl-icon">🔒</span>  <!-- Icône cadenas -->
      <div class="tl-text">
        <strong>Choix verrouillé</strong>   <!-- Titre en gras -->
        ${esc(reason)}  <!-- Message d'explication (échappé pour la sécurité XSS) -->
      </div>
    </div>`;
}

// ── Rendu de la grille des choix de l'équipe ─────────────────────────────────
function renderTeamGrid(all, mine) {
  // Récupère le conteneur de la grille
  const grid = document.getElementById('choices-grid');

  // Met à jour le compteur affiché dans le badge de l'en-tête de carte
  document.getElementById('team-count').textContent = `${all.length} choix`;

  if (all.length === 0) {
    // Aucun choix : affiche un état vide avec invitation à choisir
    grid.innerHTML = `
      <div class="empty-grid">
        <div class="eg-icon">🍽️</div>
        <p>Aucun choix pour aujourd'hui</p>
        <small>Soyez le premier à choisir !</small>
      </div>`;
    return; // Sortie anticipée
  }

  // Génère une carte HTML pour chaque choix de l'équipe
  grid.innerHTML = all.map((c, i) => {
    // Trouve les infos du plat dans la liste FOODS
    const f    = findFood(c.food);
    // Vérifie si cette carte appartient à l'utilisateur connecté
    const isMe = c.userId === me.id;
    // Génère les initiales du nom (ex: "Jean Dupont" → "JD")
    const ini  = initials(c.userName);

    return `
      <!-- Carte avec classe "mine" si c'est le choix de l'utilisateur connecté -->
      <div class="choice-card ${isMe ? 'mine' : ''}" style="animation-delay:${i * 0.04}s">
        <!-- En-tête : avatar initiales + nom + indicateur "Vous" -->
        <div class="cc-head">
          <div class="cc-av">${ini}</div>  <!-- Avatar avec initiales -->
          <div class="cc-name-wrap">
            <div class="cc-nm">${esc(c.userName)}</div>  <!-- Nom complet échappé -->
            ${isMe ? '<div class="cc-me">👈 Vous</div>' : ''}  <!-- Indicateur si c'est l'utilisateur -->
          </div>
        </div>
        <!-- Nom du plat avec son emoji -->
        <div class="cc-food">${f.emoji} ${esc(f.label)}</div>
        <!-- Texte personnalisé affiché uniquement pour les choix "Autres" -->
        ${c.food === 'Autres' && c.customFood
          ? `<div class="cc-custom">${esc(c.customFood)}</div>`
          : ''
        }
      </div>`;
  }).join(''); // Concatène toutes les cartes en une seule chaîne HTML
}

// Met à jour le panneau admin avec les statistiques du jour
function renderAdminPanel(all) {
  // Vérifie si la commande a déjà été lancée (au moins un choix avec orderLaunched=true)
  const launched = all.some(c => c.orderLaunched);

  // Met à jour le sous-titre du panneau selon l'état
  document.getElementById('admin-subtitle').textContent = launched
    ? `✅ Commande lancée — ${all.length} repas`  // Commande déjà lancée
    : `${all.length} employé(s) ont choisi`;       // En attente de lancement

  // Récupère le bouton de lancement
  const btn = document.getElementById('launch-btn');

  // Désactive le bouton si la commande est déjà lancée OU si personne n'a encore choisi
  btn.disabled = launched || all.length === 0;

  // Change l'apparence du bouton selon l'état
  btn.innerHTML = launched
    // Bouton "Commande lancée" avec icône de validation
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Commande lancée'
    // Bouton "Lancer la commande" avec icône d'éclair
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Lancer la commande';

  // Affiche les chips de comptage par plat dans le panneau admin (fond sombre)
  renderDishCounts('dish-counts', all, true);
}

// Met à jour le panneau restauratrice avec les statistiques du jour
function renderRestoPanel(all) {
  // Vérifie si la commande a été lancée
  const launched = all.some(c => c.orderLaunched);

  // Met à jour le sous-titre selon le statut
  document.getElementById('resto-subtitle').textContent = launched
    ? `✅ ${all.length} commandes reçues`            // Commande confirmée
    : `⏳ ${all.length} choix — commande en attente`; // Pas encore lancée

  // Récupère le badge de statut de la restauratrice
  const sb = document.getElementById('resto-status-badge');

  // Affiche un badge vert ou orange selon le statut
  sb.innerHTML = launched
    ? '<span class="badge-launched">✅ Commande confirmée</span>'  // Vert
    : '<span class="badge-pending">⏳ En attente</span>';           // Orange

  // Affiche les chips de comptage par plat (fond clair pour la restauratrice)
  renderDishCounts('dish-counts-resto', all, false);
}

// Calcule et affiche le nombre de commandes par plat
function renderDishCounts(containerId, all, darkTheme) {
  // Récupère le conteneur cible
  const container = document.getElementById(containerId);

  // Objet compteur : { "riz_gras_simple": 3, "couscous": 2, ... }
  const counts = {};
  all.forEach(c => {
    // Pour les "Autres", utilise le texte personnalisé comme clé ; sinon l'id du plat
    const key = c.food === 'Autres' ? (c.customFood || 'Autre') : c.food;
    // Incrémente le compteur (initialise à 0 si première occurrence)
    counts[key] = (counts[key] || 0) + 1;
  });

  // Trie les entrées par ordre décroissant de quantité
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    // Aucun choix : affiche un message approprié selon le thème
    container.innerHTML = `<span style="color:${darkTheme ? 'rgba(255,255,255,.4)' : 'var(--ink5)'}; font-size:.85rem;">Aucun choix pour l'instant</span>`;
    return;
  }

  // Génère une chip pour chaque plat avec son nombre de commandes
  container.innerHTML = entries.map(([name, count]) => {
    // Trouve les infos du plat dans FOODS (utilise un défaut si non trouvé)
    const food  = FOODS.find(f => f.id === name) || { emoji: '🍽️', label: name };
    // Pour les choix "Autres", affiche le texte personnalisé plutôt que "Autres (préciser)"
    const label = food.label === 'Autres (préciser)' ? name : food.label;

    return `
      <div class="dish-count-chip">
        <span>${food.emoji}</span>         <!-- Emoji du plat -->
        <span>${esc(label)}</span>          <!-- Nom du plat (échappé) -->
        <span class="dc-badge">${count}</span>  <!-- Badge orange avec le nombre de commandes -->
      </div>`;
  }).join(''); // Concatène toutes les chips
}

// ── Chargement et affichage de l'historique ───────────────────────────────────
async function loadHistory() {
  // Récupère le conteneur de la liste d'historique
  const el = document.getElementById('history-list');
  // Affiche un indicateur de chargement pendant la requête
  el.innerHTML = '<div class="skeleton-state">Chargement...</div>';

  try {
    // Requête GET pour récupérer l'historique complet de l'utilisateur connecté
    const h = await api('/api/history');

    if (!h.length) {
      // Aucun historique : affiche un état vide
      el.innerHTML = `
        <div class="empty-hist">
          <div class="eh-icon">📋</div>
          <p>Aucun historique</p>
          <small>Vos choix passés apparaîtront ici</small>
        </div>`;
      return;
    }

    // Génère un élément de liste pour chaque entrée d'historique
    el.innerHTML = h.map((c, i) => {
      // Trouve les infos du plat
      const f = findFood(c.food);
      // Crée un objet Date à partir de la chaîne de date (YYYY-MM-DD)
      const d = new Date(c.date);

      return `
        <!-- Animation avec délai croissant pour un effet cascade -->
        <div class="history-item" style="animation-delay:${i * 0.04}s">

          <!-- Bloc date affiché à gauche (jour + mois abrégé) -->
          <div class="hi-date-block">
            <!-- Numéro du jour avec zéro devant si nécessaire (ex: "05") -->
            <span class="hi-day">${d.getDate().toString().padStart(2, '0')}</span>
            <!-- Mois abrégé en français (ex: "déc.") -->
            <span class="hi-month">${d.toLocaleDateString('fr-FR', { month: 'short' })}</span>
          </div>

          <!-- Bloc informations du plat -->
          <div>
            <div class="hi-food-name">${f.emoji} ${esc(f.label)}</div>
            <!-- Texte personnalisé si c'était un choix "Autres" -->
            ${c.food === 'Autres' && c.customFood
              ? `<div class="hi-custom-txt">${esc(c.customFood)}</div>`
              : ''
            }
          </div>

          <!-- Badge de statut : vert si commandé, bleu si en attente -->
          <span class="hi-st ${c.orderLaunched ? 'ok' : 'wait'}">
            ${c.orderLaunched ? '✅ Commandé' : '⏳ En attente'}
          </span>
        </div>`;
    }).join('');

  } catch {
    // En cas d'erreur réseau ou serveur, affiche un message d'erreur
    el.innerHTML = '<div class="empty-hist"><p>Erreur de chargement</p></div>';
  }
}

// ── Messagerie ────────────────────────────────────────────────────────────────

// Charge et affiche tous les messages de la messagerie
async function loadMessages() {
  // Références aux éléments du chat
  const denied  = document.getElementById('chat-access-denied');  // Message "accès refusé"
  const wrapper = document.getElementById('chat-wrapper');         // Interface de chat

  if (!['admin', 'restauratrice'].includes(me.role)) {
    // L'utilisateur n'a pas accès : affiche le message d'accès refusé et cache le chat
    denied.classList.remove('hidden');
    wrapper.classList.add('hidden');
    return;
  }

  // L'utilisateur a accès : cache le message d'erreur et affiche le chat
  denied.classList.add('hidden');
  wrapper.classList.remove('hidden');

  // Conteneur des bulles de messages
  const box = document.getElementById('chat-messages');

  try {
    // Charge tous les messages triés chronologiquement
    const msgs = await api('/api/messages');
    // Marque tous les messages comme lus pour cet utilisateur
    await api('/api/messages/read', 'POST');
    // Remet le compteur de notifications à 0
    updateNotifBadge(0);

    if (!msgs.length) {
      // Aucun message : affiche un état vide avec invitation à démarrer
      box.innerHTML = `
        <div class="chat-empty">
          <div class="ce-icon">💬</div>
          <p>Aucun message pour l'instant</p>
          <small>Démarrez la conversation !</small>
        </div>`;
      return;
    }

    // Vide le conteneur avant d'injecter les nouveaux messages
    box.innerHTML = '';

    // Variable pour le suivi de la date et l'affichage des séparateurs
    let lastDate = '';

    msgs.forEach(m => {
      // Extrait la date (YYYY-MM-DD) du timestamp complet
      const d = m.timestamp.split('T')[0];

      if (d !== lastDate) {
        // Nouvelle date : insère un séparateur avec la date formatée
        lastDate = d;
        const sep = document.createElement('div');
        sep.className = 'chat-date-sep'; // Style de ligne avec date au milieu
        // Formate la date (ex: "lundi 15 décembre")
        sep.textContent = new Date(m.timestamp).toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        });
        box.appendChild(sep);
      }

      // Détermine si ce message a été envoyé par l'utilisateur connecté
      const isMine = m.senderId === me.id;

      // Crée le conteneur de la bulle de message
      const wrap = document.createElement('div');
      // "sent" pour les messages envoyés (alignés à droite), "recv" pour les reçus (à gauche)
      wrap.className = `msg-wrap ${isMine ? 'sent' : 'recv'}`;

      // Injecte le HTML de la bulle
      wrap.innerHTML = `
        <!-- Nom de l'expéditeur au-dessus de la bulle -->
        <div class="msg-meta">${isMine ? 'Vous' : esc(m.senderName)}</div>
        <!-- Bulle de message avec le contenu (échappé pour éviter les injections XSS) -->
        <div class="msg-bubble">${esc(m.content)}</div>
        <!-- Heure d'envoi sous la bulle -->
        <div class="msg-time">
          ${new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </div>`;

      // Ajoute la bulle au conteneur
      box.appendChild(wrap);
    });

    // Fait défiler automatiquement vers le bas pour voir le dernier message
    box.scrollTop = box.scrollHeight;

  } catch {
    // En cas d'erreur, affiche un message d'erreur dans le chat
    box.innerHTML = '<div class="chat-empty"><p>Erreur de chargement</p></div>';
  }
}

// Envoie un nouveau message dans la messagerie
async function sendMessage() {
  // Récupère la zone de saisie
  const inp = document.getElementById('chat-input');
  // Nettoie les espaces en début et fin
  const content = inp.value.trim();
  // Ne fait rien si le message est vide
  if (!content) return;

  // Vide immédiatement la zone de saisie (pour une meilleure réactivité)
  inp.value = '';
  // Remet la hauteur de la textarea à sa taille minimale
  inp.style.height = 'auto';

  try {
    // Envoie le message au serveur
    await api('/api/messages', 'POST', { content });
    // Recharge les messages pour afficher le nouveau message
    await loadMessages();
  } catch (e) {
    // En cas d'erreur, affiche une notification d'erreur
    toast(e.message, 'err');
  }
}

// Gère les événements clavier dans la zone de saisie du chat
function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    // Entrée seule (sans Shift) : envoie le message
    e.preventDefault();  // Empêche le saut de ligne par défaut
    sendMessage();
  }
  // Auto-redimensionnement de la textarea selon son contenu
  const inp = e.target;
  inp.style.height = 'auto';                                          // Remet à taille auto
  inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';         // Limite à 120px max
}

// Interroge le serveur pour connaître le nombre de messages non lus (polling)
async function pollUnread() {
  try {
    // Requête légère pour récupérer seulement le compteur
    const { count } = await api('/api/messages/unread');
    // Met à jour les badges de notification
    updateNotifBadge(count);
  } catch {
    // Ignore les erreurs de polling (réseau instable, etc.)
  }
}

// Met à jour les badges de notification des messages non lus
function updateNotifBadge(count) {
  // Référence au point rouge dans la navbar desktop
  const dot = document.getElementById('msg-notif-dot');
  // Référence au badge numérique dans la nav mobile
  const mob = document.getElementById('msg-badge-mob');

  if (count > 0) {
    // Des messages non lus existent : affiche les deux indicateurs
    dot.classList.remove('hidden');                         // Affiche le point rouge
    mob.classList.remove('hidden');                         // Affiche le badge mobile
    mob.textContent = count > 9 ? '9+' : count;            // "9+" si plus de 9 messages
  } else {
    // Aucun message non lu : cache les indicateurs
    dot.classList.add('hidden');
    mob.classList.add('hidden');
  }
}

// ── Modal de sélection du plat ────────────────────────────────────────────────

// Construit la grille de sélection des plats dans le modal
function buildFoodGrid() {
  // Génère le HTML de chaque option de plat et l'injecte dans la grille
  document.getElementById('food-grid').innerHTML = FOODS.map(f => `
    <!-- Option avec classe "autres-opt" pour le choix "Autres" (pleine largeur via CSS) -->
    <div class="food-opt ${f.id === 'Autres' ? 'autres-opt' : ''}"
         data-id="${f.id}"           <!-- Identifiant pour récupérer le plat sélectionné -->
         onclick="pickFood('${f.id}')">  <!-- Appelle pickFood() au clic -->
      <span class="fo-em">${f.emoji}</span>  <!-- Emoji du plat -->
      <span>${f.label}</span>               <!-- Nom du plat -->
    </div>`).join('');
}

// Ouvre le modal pour un nouveau choix de repas
function openChoiceModal(prefill) {
  // On est en mode création (pas modification)
  isEditMode   = false;
  // Initialise le plat sélectionné (null ou une valeur pré-remplie)
  selectedFood = prefill || null;
  // Change le titre du modal
  document.getElementById('modal-title').textContent = 'Choisir mon repas';
  // Vide le champ texte personnalisé
  document.getElementById('custom-input').value = '';
  // Cache le champ personnalisé
  document.getElementById('custom-field').classList.add('hidden');
  // Cache les erreurs précédentes
  document.getElementById('modal-error').classList.add('hidden');
  // Désélectionne toutes les options visuelles
  document.querySelectorAll('.food-opt').forEach(o => o.classList.remove('sel'));
  // Si une valeur est pré-remplie, la sélectionne visuellement
  if (prefill) pickFood(prefill);
  // Affiche le modal
  document.getElementById('food-modal').classList.remove('hidden');
}

// Ouvre le modal en mode modification (pré-remplit le choix actuel)
async function openEditModal() {
  // On est en mode modification
  isEditMode = true;
  // Change le titre du modal
  document.getElementById('modal-title').textContent = 'Modifier mon repas';
  // Cache les erreurs précédentes
  document.getElementById('modal-error').classList.add('hidden');

  try {
    // Récupère le choix actuel depuis le serveur pour pré-remplir le modal
    const c = await api('/api/choices/mine');
    // Stocke le plat actuellement sélectionné
    selectedFood = c?.food || null;

    // Désélectionne toutes les options
    document.querySelectorAll('.food-opt').forEach(o => o.classList.remove('sel'));

    if (selectedFood) {
      // Sélectionne visuellement l'option correspondant au choix actuel
      document.querySelector(`.food-opt[data-id="${selectedFood}"]`)?.classList.add('sel');

      if (selectedFood === 'Autres') {
        // Affiche le champ personnalisé et le pré-remplit avec le texte existant
        document.getElementById('custom-field').classList.remove('hidden');
        document.getElementById('custom-input').value = c.customFood || '';
      } else {
        // Cache le champ personnalisé pour les plats standards
        document.getElementById('custom-field').classList.add('hidden');
      }
    }
  } catch {
    // En cas d'erreur de chargement, réinitialise la sélection
    selectedFood = null;
  }

  // Affiche le modal
  document.getElementById('food-modal').classList.remove('hidden');
}

// Ferme le modal de sélection du plat
function closeFoodModal() {
  document.getElementById('food-modal').classList.add('hidden');
}

// Ferme le modal si l'utilisateur clique sur le fond semi-transparent (pas sur la carte)
function backdropClose(e) {
  // Vérifie que le clic est bien sur le backdrop (id="food-modal") et non sur un enfant
  if (e.target.id === 'food-modal') closeFoodModal();
}

// Sélectionne visuellement un plat et gère l'affichage du champ personnalisé
function pickFood(id) {
  // Mémorise le plat sélectionné
  selectedFood = id;
  // Met à jour l'apparence des options : ajoute "sel" uniquement à l'option cliquée
  document.querySelectorAll('.food-opt').forEach(o =>
    o.classList.toggle('sel', o.dataset.id === id)
  );

  if (id === 'Autres') {
    // Affiche le champ de texte libre pour préciser le plat
    document.getElementById('custom-field').classList.remove('hidden');
    // Met le focus sur le champ pour améliorer l'ergonomie
    document.getElementById('custom-input').focus();
  } else {
    // Cache le champ personnalisé pour les plats de la liste standard
    document.getElementById('custom-field').classList.add('hidden');
  }
}

// Valide et soumet le choix de repas au serveur
async function submitChoice() {
  // Vérifie qu'un plat a été sélectionné
  if (!selectedFood) {
    setModalErr('Veuillez sélectionner un repas.');
    return;
  }

  // Récupère le texte personnalisé (pour le choix "Autres")
  const customFood = document.getElementById('custom-input').value.trim();

  // Vérifie que le texte personnalisé est rempli si "Autres" est sélectionné
  if (selectedFood === 'Autres' && !customFood) {
    setModalErr('Veuillez préciser votre plat.');
    return;
  }

  // Désactive le bouton pendant la requête
  const btn = document.querySelector('#food-modal .btn-submit');
  btn.disabled = true;
  btn.textContent = 'Enregistrement...';

  try {
    // Envoie le choix au serveur (création ou mise à jour selon le contexte)
    await api('/api/choices', 'POST', { food: selectedFood, customFood });
    // Ferme le modal après succès
    closeFoodModal();
    // Affiche une notification de succès différenciée selon le mode
    toast(isEditMode ? '✏️ Choix modifié !' : '✅ Choix enregistré !', 'ok');
    // Recharge les données du jour pour mettre à jour l'affichage + démarrer le timer
    loadToday();

  } catch (e) {
    // Affiche le message d'erreur retourné par le serveur dans le modal
    setModalErr(e.message);
  } finally {
    // Réactive le bouton dans tous les cas
    btn.disabled = false;
    // Restaure le HTML original du bouton avec l'icône
    btn.innerHTML = 'Confirmer mon choix <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
  }
}

// Supprime le choix du jour de l'utilisateur après confirmation
async function deleteMyChoice() {
  // Demande confirmation avant suppression (fenêtre native du navigateur)
  if (!confirm('Supprimer votre choix du jour ?')) return;

  try {
    // Envoie la requête DELETE au serveur
    await api('/api/choices/mine', 'DELETE');
    // Notification de succès
    toast('🗑️ Choix supprimé', 'info');
    // Recharge les données pour mettre à jour l'affichage
    loadToday();

  } catch (e) {
    // Affiche l'erreur (ex: délai expiré, commande déjà lancée)
    toast(e.message, 'err');
    // Recharge quand même pour mettre à jour l'état du timer et des boutons
    loadToday();
  }
}

// ── Actions Admin ─────────────────────────────────────────────────────────────

// Lance la commande du jour (accessible uniquement à l'admin)
async function launchOrder() {
  // Confirmation avant lancement (action irréversible)
  if (!confirm('Lancer la commande pour tous les repas du jour ?')) return;

  try {
    // Envoie la requête de lancement au serveur
    const r = await api('/api/choices/launch', 'POST');
    // Notification de succès avec le nombre de repas commandés
    toast(`🚀 Commande lancée — ${r.count} repas !`, 'ok');
    // Recharge pour mettre à jour le statut et verrouiller les choix
    loadToday();
  } catch (e) {
    // Affiche l'erreur (ex: aucun choix, pas les droits)
    toast(e.message, 'err');
  }
}

// ── Export PDF ────────────────────────────────────────────────────────────────

// Génère et télécharge un PDF des commandes du jour
async function downloadPDF() {
  try {
    // Récupère tous les choix du jour depuis le serveur
    const all = await api('/api/choices/today');

    // Accède à la bibliothèque jsPDF chargée depuis le CDN
    const { jsPDF } = window.jspdf;

    // Crée un nouveau document PDF au format A4, portrait, unité en millimètres
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // Formate la date du jour en français pour l'en-tête du PDF
    const today = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    // Formate la date pour le nom du fichier (YYYY-MM-DD)
    const todayStr = new Date().toISOString().split('T')[0];

    // ── En-tête du PDF ──

    // Dessine un rectangle orange plein en haut du document
    doc.setFillColor(249, 115, 22); // Couleur orange (R, G, B)
    doc.rect(0, 0, 210, 38, 'F'); // x, y, largeur, hauteur, mode 'F'=remplissage

    // Titre principal en blanc sur fond orange
    doc.setTextColor(255, 255, 255); // Texte blanc
    doc.setFontSize(22);             // Grande taille pour le titre
    doc.setFont('helvetica', 'bold'); // Police helvetica en gras
    doc.text('LunchApp', 15, 16);    // Texte à position (15mm, 16mm)

    // Sous-titre en police normale
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Liste des commandes du repas de midi', 15, 25);

    // Date du jour sous le sous-titre
    doc.setFontSize(10);
    doc.text(today.charAt(0).toUpperCase() + today.slice(1), 15, 33);

    // ── Comptage des plats pour le résumé ──

    // Objet compteur : { id_plat: nombre }
    const counts = {};
    all.forEach(c => {
      // Clé = texte custom pour "Autres", sinon l'id du plat
      const key = c.food === 'Autres' ? (c.customFood || 'Autre plat') : c.food;
      counts[key] = (counts[key] || 0) + 1;
    });

    // ── Section "Résumé des commandes" ──

    let y = 48; // Position verticale courante (débute sous l'en-tête)

    // Titre de section en bleu marine
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('RÉSUMÉ DES COMMANDES', 15, y);
    y += 2; // Descend légèrement pour le soulignement

    // Ligne de soulignement orange sous le titre de section
    doc.setDrawColor(249, 115, 22); // Couleur de la ligne
    doc.setLineWidth(0.8);          // Épaisseur de la ligne
    doc.line(15, y + 1, 100, y + 1); // Trace la ligne
    y += 8; // Espace après le soulignement

    // Trie les plats du plus commandé au moins commandé
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    doc.setFontSize(10);
    entries.forEach(([name, count], i) => {
      // Trouve les infos du plat dans FOODS
      const food  = FOODS.find(f => f.id === name) || { label: name };
      const label = food.label === 'Autres (préciser)' ? name : food.label;

      // Alterne les lignes avec un fond gris très clair pour la lisibilité
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252); // Fond gris clair pour les lignes paires
        doc.rect(13, y - 5, 184, 8, 'F');
      }

      // Nom du plat en bleu marine
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text(label, 18, y);

      // Quantité en orange alignée à droite
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(249, 115, 22);
      doc.text(`× ${count}`, 175, y, { align: 'right' });

      y += 10; // Espace entre les lignes
    });

    // Ligne séparatrice grise avant le total
    y += 4;
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(15, y, 195, y);
    y += 8;

    // Ligne de total avec fond orange plein
    doc.setFillColor(249, 115, 22);
    doc.rect(13, y - 6, 184, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text('TOTAL', 18, y);                                 // Libellé à gauche
    doc.text(`${all.length} repas`, 175, y, { align: 'right' }); // Nombre à droite
    y += 18; // Espace avant la section suivante

    // ── Section "Détail par employé" ──

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('DÉTAIL PAR EMPLOYÉ', 15, y);
    y += 2;

    // Soulignement bleu ciel sous le titre de section
    doc.setDrawColor(56, 189, 248);
    doc.setLineWidth(0.8);
    doc.line(15, y + 1, 120, y + 1);
    y += 8;

    // En-tête de tableau avec fond bleu
    doc.setFillColor(14, 165, 233);
    doc.rect(13, y - 5, 184, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('N°', 18, y);          // Colonne numéro
    doc.text('Employé', 30, y);     // Colonne nom
    doc.text('Repas choisi', 100, y); // Colonne plat
    doc.text('Heure', 175, y, { align: 'right' }); // Colonne heure
    y += 10;

    // Lignes du tableau : une par employé
    all.forEach((c, i) => {
      // Si on dépasse la fin de page, ajoute une nouvelle page
      if (y > 270) {
        doc.addPage();
        y = 20; // Repart en haut de la nouvelle page
      }

      // Infos du plat
      const food  = findFood(c.food);
      const label = c.food === 'Autres' ? (c.customFood || 'Autre plat') : food.label;
      // Heure formatée HH:MM
      const heure = new Date(c.updatedAt).toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit'
      });

      // Fond alternant pour la lisibilité
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(13, y - 5, 184, 8, 'F');
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);

      // Numéro de ligne en gris
      doc.setTextColor(100, 116, 139);
      doc.text(`${i + 1}`, 18, y);

      // Nom de l'employé (tronqué à 25 caractères)
      doc.setTextColor(30, 41, 59);
      doc.text(c.userName.slice(0, 25), 30, y);

      // Nom du plat (tronqué à 35 caractères)
      doc.text(label.slice(0, 35), 100, y);

      // Heure en gris, alignée à droite
      doc.setTextColor(100, 116, 139);
      doc.text(heure, 175, y, { align: 'right' });

      y += 9; // Espacement entre les lignes
    });

    // ── Pied de page ──

    // Hauteur de la page en millimètres
    const pageH = doc.internal.pageSize.getHeight();
    // Rectangle orange plein en bas de page
    doc.setFillColor(249, 115, 22);
    doc.rect(0, pageH - 14, 210, 14, 'F');
    // Texte de pied de page en blanc
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    // Date et heure de génération à gauche
    doc.text(`LunchApp — Généré le ${new Date().toLocaleString('fr-FR')}`, 15, pageH - 5);
    // Nombre total de repas à droite
    doc.text(`${all.length} repas`, 195, pageH - 5, { align: 'right' });

    // Déclenche le téléchargement du fichier PDF avec un nom daté
    doc.save(`commande_repas_${todayStr}.pdf`);

    // Notification de succès
    toast('📄 PDF téléchargé !', 'ok');

  } catch (e) {
    // Affiche l'erreur dans la console pour le débogage
    console.error(e);
    // Notification d'erreur pour l'utilisateur
    toast('Erreur lors de la génération du PDF', 'err');
  }
}

// ── Fonctions utilitaires ─────────────────────────────────────────────────────

// Fonction centrale pour toutes les requêtes vers l'API du backend
async function api(url, method = 'GET', body) {
  // Construit les options de la requête fetch
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' } // Indique que le corps est du JSON
  };
  // Ajoute le token JWT dans l'en-tête Authorization si l'utilisateur est connecté
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  // Sérialise le corps en JSON si des données sont fournies
  if (body)  opts.body = JSON.stringify(body);

  // Exécute la requête HTTP
  const res  = await fetch(url, opts);
  // Parse la réponse JSON
  const data = await res.json();

  if (!res.ok) {
    // La requête a échoué : crée et lance une erreur avec le message du serveur
    const e = new Error(data.error || 'Erreur');
    // Attache le code HTTP à l'erreur (utile pour détecter les 401 et déconnecter)
    e.status = res.status;
    throw e;
  }

  // Retourne les données JSON si la requête a réussi
  return data;
}

// Trouve les informations d'un plat par son identifiant dans la liste FOODS
function findFood(id) {
  // Retourne le plat correspondant ou un objet par défaut si non trouvé
  return FOODS.find(f => f.id === id) || { emoji: '🍽️', label: id };
}

// Génère les initiales d'un nom complet (ex: "Jean Dupont" → "JD")
function initials(name) {
  return name
    .split(' ')                              // Divise le nom en mots
    .map(w => w[0])                          // Prend la première lettre de chaque mot
    .join('')                                // Concatène les initiales
    .toUpperCase()                           // Met en majuscules
    .slice(0, 2);                            // Limite à 2 caractères maximum
}

// Échappe les caractères HTML spéciaux pour prévenir les injections XSS
function esc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')   // & → &amp;
    .replace(/</g,  '&lt;')    // < → &lt;
    .replace(/>/g,  '&gt;')    // > → &gt;
    .replace(/"/g,  '&quot;'); // " → &quot;
}

// Affiche un message d'erreur dans la zone dédiée d'un formulaire
function showErr(id, msg) {
  const e = document.getElementById(id);
  if (e) {
    e.textContent = msg;              // Injecte le message d'erreur
    e.classList.remove('hidden');     // Rend visible la zone d'erreur
  }
}

// Cache la zone d'erreur d'un formulaire
function clearErr(id) {
  const e = document.getElementById(id);
  if (e) e.classList.add('hidden');   // Masque la zone d'erreur
}

// Affiche un message d'erreur à l'intérieur du modal de sélection du plat
function setModalErr(msg) {
  const e = document.getElementById('modal-error');
  e.textContent = msg;               // Injecte le message
  e.classList.remove('hidden');      // Rend visible la zone d'erreur du modal
}

// Variable pour éviter que plusieurs toasts se chevauchent
let toastTimer;

// Affiche une notification toast en bas de page
function toast(msg, type = 'info') {
  // Récupère l'élément toast
  const t = document.getElementById('toast');
  // Injecte le message
  t.textContent = msg;
  // Applique les classes : "toast" de base + type (t-ok, t-err, t-info) + "visible"
  t.className = `toast t-${type} visible`;
  // Annule tout timer précédent pour éviter de fermer trop tôt si plusieurs toasts se suivent
  clearTimeout(toastTimer);
  // Programme la disparition du toast après 3,5 secondes
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3500);
}

// Bascule la visibilité d'un champ mot de passe et met à jour l'icône du bouton
function togglePwd(id, btn) {
  // Récupère le champ mot de passe
  const inp = document.getElementById(id);
  // Bascule entre "password" (masqué) et "text" (visible)
  inp.type = inp.type === 'password' ? 'text' : 'password';

  // Met à jour l'icône du bouton selon le nouvel état
  btn.innerHTML = inp.type === 'password'
    // Icône "œil ouvert" si le mot de passe est masqué (cliquer pour voir)
    ? '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>'
    // Icône "œil barré" si le mot de passe est visible (cliquer pour masquer)
    : '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>';
}