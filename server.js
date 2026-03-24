
// Importation du framework Express pour créer le serveur HTTP
const express = require('express');

// Importation de bcryptjs pour hasher et comparer les mots de passe
const bcrypt = require('bcryptjs');

// Importation de jsonwebtoken pour créer et vérifier les tokens JWT
const jwt = require('jsonwebtoken');

// Importation de cors pour autoriser les requêtes cross-origin
const cors = require('cors');

// Importation du module natif Node.js pour lire/écrire des fichiers
const fs = require('fs');

// Importation du module natif Node.js pour construire des chemins de fichiers
const path = require('path');

// Création de l'instance principale de l'application Express
const app = express();

// Définition du port d'écoute : utilise la variable d'environnement PORT ou 3000 par défaut
const PORT = process.env.PORT || 3000;

// Clé secrète pour signer les tokens JWT (à changer en production)
const JWT_SECRET = process.env.JWT_SECRET || 'lunchapp_secret_key_2024';

// ── Constante de verrouillage des choix ──────────────────────────────────────

// Durée maximale (en millisecondes) pendant laquelle un employé peut modifier/supprimer son choix
const LOCK_MS = 3 * 60 * 1000; // 3 minutes × 60 secondes × 1000 ms = 180 000 ms

// ── Middlewares globaux ───────────────────────────────────────────────────────

// Active CORS : permet aux clients (navigateurs) d'accéder à l'API depuis n'importe quelle origine
app.use(cors());

// Active le parsing automatique du corps des requêtes en JSON
app.use(express.json());

// Sert les fichiers statiques (HTML, CSS, JS) depuis le dossier "public"
app.use(express.static(path.join(__dirname, 'public')));

// ── Stockage des données (fichiers JSON) ──────────────────────────────────────

// Construit le chemin absolu vers le dossier "data" qui stocke les fichiers JSON
const DB_DIR = path.join(__dirname, 'data');

// Crée le dossier "data" s'il n'existe pas encore (au premier lancement)
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

// Objet centralisant les chemins vers chaque fichier de données
const FILES = {
  // Fichier stockant tous les utilisateurs enregistrés
  users:    path.join(DB_DIR, 'users.json'),
  // Fichier stockant tous les choix de repas
  choices:  path.join(DB_DIR, 'choices.json'),
  // Fichier stockant tous les messages de la messagerie
  messages: path.join(DB_DIR, 'messages.json'),
};

// Fonction utilitaire pour lire un fichier JSON et retourner son contenu
function readDB(file) {
  // Si le fichier n'existe pas encore, retourne un tableau vide
  if (!fs.existsSync(file)) return [];
  // Tente de lire et parser le fichier JSON ; en cas d'erreur retourne un tableau vide
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

// Fonction utilitaire pour écrire des données dans un fichier JSON
function writeDB(file, data) {
  // Sérialise les données en JSON formaté (indentation de 2 espaces) et écrit dans le fichier
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Middleware d'authentification JWT ─────────────────────────────────────────

// Middleware vérifiant que la requête contient un token JWT valide
function auth(req, res, next) {
  // Récupère l'en-tête Authorization de la requête
  const header = req.headers.authorization;

  // Si l'en-tête est absent ou ne commence pas par "Bearer ", refuse l'accès
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Non autorisé' });

  // Tente de vérifier et décoder le token JWT
  try {
    // Décode le token (en retirant "Bearer ") et attache les données décodées à req.user
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    // Passe au middleware ou à la route suivante
    next();
  }
  // Si la vérification échoue (token expiré, invalide, etc.)
  catch {
    // Retourne une erreur 401 avec un message explicite
    res.status(401).json({ error: 'Token invalide' });
  }
}

// ── Routes d'authentification ─────────────────────────────────────────────────

// Route POST pour l'inscription d'un nouvel utilisateur
app.post('/api/register', async (req, res) => {
  // Destructure les champs envoyés dans le corps de la requête
  const { fullName, phone, email, password, role: requestedRole } = req.body;

  // Vérifie que tous les champs obligatoires sont présents
  if (!fullName || !phone || !email || !password)
    // Retourne une erreur 400 (mauvaise requête) si un champ manque
    return res.status(400).json({ error: 'Tous les champs sont obligatoires' });

  // Charge la liste des utilisateurs existants depuis le fichier JSON
  const users = readDB(FILES.users);

  // Vérifie si un utilisateur avec cet email existe déjà (comparaison en minuscules)
  if (users.find(u => u.email === email.toLowerCase()))
    // Retourne une erreur 409 (conflit) si l'email est déjà utilisé
    return res.status(409).json({ error: 'Email déjà utilisé' });

  // Hashe le mot de passe avec bcrypt (facteur de coût = 10)
  const hashedPwd = await bcrypt.hash(password, 10);

  // Détermine le rôle : si "restauratrice" demandé, on l'attribue ; sinon "user" par défaut
  let role = requestedRole === 'restauratrice' ? 'restauratrice' : 'user';

  // Si aucun admin n'existe encore, le premier utilisateur non-restauratrice devient admin
  if (role === 'user' && !users.find(u => u.role === 'admin')) role = 'admin';

  // Construit l'objet du nouvel utilisateur
  const newUser = {
    // Identifiant unique basé sur le timestamp actuel
    id: Date.now().toString(),
    // Nom complet fourni par l'utilisateur
    fullName,
    // Numéro de téléphone fourni par l'utilisateur
    phone,
    // Email normalisé en minuscules pour éviter les doublons
    email: email.toLowerCase(),
    // Mot de passe hashé (jamais stocké en clair)
    password: hashedPwd,
    // Rôle calculé ci-dessus
    role,
    // Date de création au format ISO 8601
    createdAt: new Date().toISOString(),
  };

  // Ajoute le nouvel utilisateur au tableau en mémoire
  users.push(newUser);

  // Persiste le tableau mis à jour dans le fichier JSON
  writeDB(FILES.users, users);

  // Crée un token JWT signé avec les informations essentielles de l'utilisateur
  const token = jwt.sign(
    // Payload du token : données accessibles après décodage
    { id: newUser.id, email: newUser.email, fullName: newUser.fullName, role: newUser.role },
    // Clé secrète de signature
    JWT_SECRET,
    // Options : expiration du token après 7 jours
    { expiresIn: '7d' }
  );

  // Retourne le token et les infos publiques de l'utilisateur (sans le mot de passe)
  res.status(201).json({
    token,
    user: { id: newUser.id, fullName: newUser.fullName, email: newUser.email, role: newUser.role }
  });
});

// Route POST pour la connexion d'un utilisateur existant
app.post('/api/login', async (req, res) => {
  // Récupère l'email et le mot de passe depuis le corps de la requête
  const { email, password } = req.body;

  // Vérifie que les deux champs sont bien fournis
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  // Charge tous les utilisateurs depuis le fichier JSON
  const users = readDB(FILES.users);

  // Recherche l'utilisateur par son email (en minuscules)
  const user = users.find(u => u.email === email.toLowerCase());

  // Si l'utilisateur n'existe pas OU si le mot de passe ne correspond pas
  if (!user || !(await bcrypt.compare(password, user.password)))
    // Retourne une erreur 401 générique (ne précise pas lequel est incorrect, pour la sécurité)
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  // Crée un nouveau token JWT pour la session
  const token = jwt.sign(
    // Données encodées dans le token
    { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    // Clé secrète
    JWT_SECRET,
    // Durée de validité : 7 jours
    { expiresIn: '7d' }
  );

  // Retourne le token et les informations publiques de l'utilisateur
  res.json({
    token,
    user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role }
  });
});

// ── Routes des choix de repas ─────────────────────────────────────────────────

// Fonction utilitaire retournant la date du jour au format "YYYY-MM-DD"
function todayStr() {
  // Prend l'ISO string (ex: "2024-12-15T10:30:00.000Z") et garde la partie date
  return new Date().toISOString().split('T')[0];
}

// Route GET : récupère tous les choix du jour (tous les employés)
app.get('/api/choices/today', auth, (req, res) => {
  // Lit tous les choix et filtre uniquement ceux d'aujourd'hui
  const choices = readDB(FILES.choices).filter(c => c.date === todayStr());
  // Retourne le tableau des choix du jour
  res.json(choices);
});

// Route GET : récupère le choix du jour de l'utilisateur connecté uniquement
app.get('/api/choices/mine', auth, (req, res) => {
  // Recherche le choix correspondant à l'utilisateur connecté et à la date du jour
  const mine = readDB(FILES.choices).find(c => c.userId === req.user.id && c.date === todayStr());
  // Retourne le choix trouvé ou null si aucun choix n'a été fait aujourd'hui
  res.json(mine || null);
});

// Route POST : crée ou met à jour le choix de repas de l'utilisateur connecté
app.post('/api/choices', auth, (req, res) => {
  // Récupère l'identifiant du plat choisi et le texte libre optionnel
  const { food, customFood } = req.body;

  // Vérifie que le champ "food" est bien fourni
  if (!food) return res.status(400).json({ error: 'Choix requis' });

  // Charge tous les choix existants depuis le fichier JSON
  const choices = readDB(FILES.choices);

  // Récupère la date du jour pour les comparaisons
  const today = todayStr();

  // Filtre les choix du jour pour vérifier l'état de la commande
  const todayChoices = choices.filter(c => c.date === today);

  // Si la commande a déjà été lancée aujourd'hui, bloque toute modification
  if (todayChoices.some(c => c.orderLaunched))
    return res.status(403).json({ error: "La commande a déjà été lancée aujourd'hui" });

  // Cherche si l'utilisateur a déjà un choix pour aujourd'hui (pour savoir si c'est un ajout ou une mise à jour)
  const existing = choices.findIndex(c => c.userId === req.user.id && c.date === today);

  // ── Vérification du délai de 3 minutes (uniquement pour les MODIFICATIONS) ──
  if (existing >= 0) {
    // Calcule le temps écoulé en millisecondes depuis la dernière mise à jour du choix
    const elapsed = Date.now() - new Date(choices[existing].updatedAt).getTime();

    // Si le délai de 3 minutes est dépassé, refuse la modification
    if (elapsed > LOCK_MS) {
      return res.status(403).json({
        // Message d'erreur affiché à l'utilisateur
        error: 'Le délai de modification de 3 minutes est expiré. Votre choix est verrouillé.',
        // Indicateur booléen pour que le frontend sache que c'est un verrou (pas une autre erreur)
        locked: true,
      });
    }
  }

  // Capture le timestamp actuel pour la date de mise à jour
  const now = new Date().toISOString();

  // Construit l'objet de choix (création ou mise à jour)
  const choiceData = {
    // Conserve l'id existant si c'est une mise à jour, sinon génère un nouvel id
    id: existing >= 0 ? choices[existing].id : Date.now().toString(),
    // Identifiant de l'utilisateur connecté
    userId: req.user.id,
    // Nom complet de l'utilisateur (pour l'affichage dans la grille)
    userName: req.user.fullName,
    // Identifiant du plat sélectionné
    food,
    // Texte libre uniquement si le plat est "Autres", sinon null
    customFood: food === 'Autres' ? customFood : null,
    // Date du jour au format YYYY-MM-DD
    date: today,
    // Statut de la commande : false tant que l'admin n'a pas lancé la commande
    orderLaunched: false,
    // Date de création : conservée si mise à jour, sinon timestamp actuel
    createdAt: existing >= 0 ? choices[existing].createdAt : now,
    // Date de mise à jour : toujours le timestamp actuel (réinitialise le délai de 3 min)
    updatedAt: now,
  };

  // Si un choix existait, on le remplace ; sinon on l'ajoute au tableau
  if (existing >= 0) choices[existing] = choiceData;
  else choices.push(choiceData);

  // Persiste le tableau mis à jour dans le fichier JSON
  writeDB(FILES.choices, choices);

  // Retourne le choix créé ou mis à jour
  res.json(choiceData);
});

// Route DELETE : supprime le choix du jour de l'utilisateur connecté
app.delete('/api/choices/mine', auth, (req, res) => {
  // Charge tous les choix existants
  let choices = readDB(FILES.choices);

  // Récupère la date du jour
  const today = todayStr();

  // Cherche l'index du choix de l'utilisateur connecté pour aujourd'hui
  const idx = choices.findIndex(c => c.userId === req.user.id && c.date === today);

  // Si aucun choix trouvé, retourne une erreur 404
  if (idx === -1) return res.status(404).json({ error: 'Aucun choix trouvé' });

  // Si la commande a déjà été lancée, la suppression est impossible
  if (choices[idx].orderLaunched)
    return res.status(403).json({ error: 'La commande a déjà été lancée' });

  // ── Vérification du délai de 3 minutes pour la SUPPRESSION ──
  // Calcule le temps écoulé depuis la dernière mise à jour
  const elapsed = Date.now() - new Date(choices[idx].updatedAt).getTime();

  // Si le délai de 3 minutes est dépassé, refuse la suppression
  if (elapsed > LOCK_MS) {
    return res.status(403).json({
      // Message explicite affiché à l'utilisateur
      error: 'Le délai de suppression de 3 minutes est expiré. Votre choix est verrouillé.',
      // Indicateur de verrou pour le frontend
      locked: true,
    });
  }

  // Supprime l'élément trouvé du tableau (splice modifie le tableau en place)
  choices.splice(idx, 1);

  // Persiste le tableau modifié dans le fichier JSON
  writeDB(FILES.choices, choices);

  // Retourne une confirmation de succès
  res.json({ success: true });
});

// Route POST : lance la commande du jour (réservée à l'admin uniquement)
app.post('/api/choices/launch', auth, (req, res) => {
  // Vérifie que l'utilisateur connecté est bien un administrateur
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Accès refusé' });

  // Charge tous les choix existants
  let choices = readDB(FILES.choices);

  // Récupère la date du jour
  const today = todayStr();

  // Compteur pour savoir combien de choix ont été marqués comme lancés
  let count = 0;

  // Parcourt tous les choix et marque ceux d'aujourd'hui comme "orderLaunched = true"
  choices = choices.map(c => {
    // Si le choix est d'aujourd'hui, on incrémente le compteur et on le marque
    if (c.date === today) { count++; return { ...c, orderLaunched: true }; }
    // Sinon on retourne le choix inchangé
    return c;
  });

  // Si aucun choix n'existe pour aujourd'hui, retourne une erreur
  if (count === 0)
    return res.status(400).json({ error: "Aucun choix pour aujourd'hui" });

  // Persiste les choix mis à jour dans le fichier JSON
  writeDB(FILES.choices, choices);

  // Retourne le succès et le nombre de repas commandés
  res.json({ success: true, count });
});

// Route GET : récupère l'historique complet des choix de l'utilisateur connecté
app.get('/api/history', auth, (req, res) => {
  // Filtre les choix appartenant à l'utilisateur connecté et les trie du plus récent au plus ancien
  const history = readDB(FILES.choices)
    .filter(c => c.userId === req.user.id)  // Garde uniquement les choix de cet utilisateur
    .sort((a, b) => b.date.localeCompare(a.date)); // Trie par date décroissante
  // Retourne l'historique trié
  res.json(history);
});

// Route GET : récupère un résumé des commandes du jour (admin + restauratrice seulement)
app.get('/api/choices/summary', auth, (req, res) => {
  // Vérifie que l'utilisateur est admin ou restauratrice
  if (!['admin', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  // Filtre et retourne tous les choix du jour
  const choices = readDB(FILES.choices).filter(c => c.date === todayStr());
  res.json(choices);
});

// ── Routes de messagerie ──────────────────────────────────────────────────────

// Route GET : récupère tous les messages triés par ordre chronologique
app.get('/api/messages', auth, (req, res) => {
  // Seuls l'admin et la restauratrice peuvent accéder à la messagerie
  if (!['admin', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  // Charge les messages et les trie du plus ancien au plus récent
  const messages = readDB(FILES.messages).sort((a, b) =>
    // Compare les timestamps pour trier chronologiquement
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  // Retourne la liste triée
  res.json(messages);
});

// Route POST : envoie un nouveau message
app.post('/api/messages', auth, (req, res) => {
  // Seuls l'admin et la restauratrice peuvent envoyer des messages
  if (!['admin', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  // Récupère le contenu du message depuis le corps de la requête
  const { content } = req.body;

  // Refuse les messages vides ou ne contenant que des espaces
  if (!content?.trim()) return res.status(400).json({ error: 'Message vide' });

  // Charge les messages existants
  const messages = readDB(FILES.messages);

  // Construit l'objet du nouveau message
  const msg = {
    // Identifiant unique basé sur le timestamp
    id: Date.now().toString(),
    // Identifiant de l'expéditeur
    senderId: req.user.id,
    // Nom complet de l'expéditeur (pour l'affichage)
    senderName: req.user.fullName,
    // Rôle de l'expéditeur (admin ou restauratrice)
    senderRole: req.user.role,
    // Contenu nettoyé des espaces superflus
    content: content.trim(),
    // Horodatage de l'envoi au format ISO 8601
    timestamp: new Date().toISOString(),
    // Tableau des IDs ayant lu ce message (l'expéditeur l'a déjà "lu")
    readBy: [req.user.id],
  };

  // Ajoute le message au tableau
  messages.push(msg);

  // Persiste la liste mise à jour
  writeDB(FILES.messages, messages);

  // Retourne le message créé avec un statut 201 (créé)
  res.status(201).json(msg);
});

// Route POST : marque tous les messages comme lus pour l'utilisateur connecté
app.post('/api/messages/read', auth, (req, res) => {
  // Seuls l'admin et la restauratrice ont accès
  if (!['admin', 'restauratrice'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  // Charge tous les messages
  let messages = readDB(FILES.messages);

  // Pour chaque message, ajoute l'ID de l'utilisateur dans "readBy" s'il n'y est pas déjà
  messages = messages.map(m => ({
    ...m, // Copie toutes les propriétés existantes
    // Si l'utilisateur a déjà lu ce message, garde readBy tel quel ; sinon l'ajoute
    readBy: m.readBy.includes(req.user.id) ? m.readBy : [...m.readBy, req.user.id],
  }));

  // Persiste les messages mis à jour
  writeDB(FILES.messages, messages);

  // Confirme le succès
  res.json({ success: true });
});

// Route GET : retourne le nombre de messages non lus pour l'utilisateur connecté
app.get('/api/messages/unread', auth, (req, res) => {
  // Si l'utilisateur n'est pas admin ou restauratrice, retourne 0 (pas d'accès à la messagerie)
  if (!['admin', 'restauratrice'].includes(req.user.role))
    return res.json({ count: 0 });

  // Compte les messages non envoyés par l'utilisateur et non lus par lui
  const count = readDB(FILES.messages)
    .filter(m =>
      // Le message n'a pas été lu par cet utilisateur
      !m.readBy.includes(req.user.id) &&
      // Et ce n'est pas l'utilisateur lui-même qui l'a envoyé
      m.senderId !== req.user.id
    ).length; // Retourne le nombre d'éléments filtrés

  // Retourne le compteur
  res.json({ count });
});

// ── Démarrage du serveur ──────────────────────────────────────────────────────

// Lance le serveur sur le port défini et affiche un message de confirmation dans la console
app.listen(PORT, () => console.log(`\n LunchApp → http://localhost:${PORT}\n`));