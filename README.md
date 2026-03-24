# 🍽️ LunchApp — Application de commande de repas

Application web permettant aux employés de choisir leur repas du midi.

## 📋 Fonctionnalités

- ✅ Création de compte (Nom, Téléphone, Email, Mot de passe)
- ✅ Connexion sécurisée (JWT)
- ✅ Liste de 9 plats dont "Autres" personnalisable
- ✅ Choix visibles par toute l'équipe en temps réel
- ✅ Modification / Suppression de son propre choix
- ✅ Historique des repas datés par utilisateur
- ✅ Lancement de commande journalière (Admin)
- ✅ Palette orange 🟠 + bleu ciel 🔵

## 🚀 Installation & Démarrage

### Prérequis
- Node.js v16+ installé

### Étapes

```bash
# 1. Entrer dans le dossier
cd lunchapp

# 2. Installer les dépendances
npm install

# 3. Lancer le serveur
npm start

# Pour le développement (rechargement auto)
npm run dev
```

### Accès
Ouvrez votre navigateur sur : **http://localhost:3000**

## 👨‍💼 Rôle Admin

Le **premier compte créé** obtient automatiquement le rôle **Admin (Chargé de commande)**.
Il peut voir le bouton "Lancer la commande" et valider les commandes du jour.

## 📁 Structure du projet

```
lunchapp/
├── server.js          # Backend Node.js/Express
├── package.json
├── data/              # Base de données JSON (créée automatiquement)
│   ├── users.json
│   └── choices.json
└── public/
    ├── index.html     # Interface
    ├── style.css      # Styles (orange + bleu)
    └── app.js         # Logique frontend
```

## 🔒 Sécurité

- Mots de passe hashés avec bcrypt
- Authentification par JWT (expire après 7 jours)
- Les données sont stockées dans `data/` (fichiers JSON locaux)

## ⚙️ Configuration

Variables d'environnement optionnelles :
- `PORT` : Port du serveur (défaut: 3000)
- `JWT_SECRET` : Clé secrète JWT (changez-la en production !)
