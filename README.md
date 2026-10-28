# Mes Missions 11.1 — code pour GitHub

Livraison du 26 octobre 2026. Dépôt existant identifié : `lumawork/listes-nana`.

**Les fichiers du site sont directement à la racine, dont `index.html`. Aucun build ni serveur Node n’est nécessaire pour les publier.** Les comptes et la base Supabase existants sont réutilisés. Aucun déploiement n’a été effectué pour cette livraison.

## Mettre le code dans le dépôt existant

1. Décompresser l’archive. Ouvrir le dossier `mes-missions`.
2. Conserver une sauvegarde du dépôt et, depuis l’application actuelle, exporter les données locales non encore synchronisées.
3. Remplacer les fichiers applicatifs à la racine du dépôt `listes-nana` par le contenu de ce dossier, en conservant les répertoires `art`, `backend`, `supabase` et `tests`. Ne pas ajouter le dossier `node_modules`.
4. Dans `config.js`, vérifier `maisonUrl`. La valeur fournie suppose un **nouveau dépôt nommé exactement `notre-maison`** dans le compte `lumawork`. Cette adresse est une cible proposée, pas un site déjà publié par cette livraison.
5. Lorsque tu décideras de publier toi-même : GitHub → Settings → Pages → source « Deploy from a branch », branche choisie, dossier `/ (root)`. Si le dépôt utilise déjà un autre mécanisme de publication, conserver et adapter celui-ci au lieu d’en activer un second.

Le site actuel reste à son adresse habituelle si le dépôt et les réglages Pages sont conservés. Aucun workflow de publication automatique n’est ajouté par ce dossier. Attention : enregistrer des changements sur la branche déjà publiée peut déclencher le mécanisme Pages existant.

## Utiliser la nouvelle version

- Se connecter dans **Mon compte**, avec le compte Mes Missions habituel.
- L’onglet **Missions synchronisées** crée et paramètre les missions du moteur partagé avec Notre Maison : récurrence fixe, relative ou ponctuelle, périodes, échéances et rappels.
- **Mes listes V10** conserve les anciennes listes. Les listes non reprises gardent leur comportement V10 ; leurs coches peuvent encore se réinitialiser selon leur ancien calendrier.
- Pour faire évoluer une ancienne liste, choisir **Reprendre mes listes V10**. Lire l’aperçu, télécharger la sauvegarde filtrée et confirmer la destination avant toute reprise. Commencer par une seule liste.
- Une liste reprise utilise ensuite le moteur commun. Son original V10 devient protégé ; ses anciens rappels sont bloqués. Les nouvelles notifications restent désactivées jusqu’à ton choix.

La reprise ne se produit jamais à l’ouverture ou au chargement du site. Les coches historiques sont conservées comme observations, sans fausses heures de réalisation. Les identifiants de source et la transaction serveur évitent les doublons. Les droits sur la source sont vérifiés par Supabase.

## Connexion avec Notre Maison

Les deux sites utilisent les mêmes RPC `nm_rpc` et `nm_legacy` et les mêmes occurrences ; ils ne recopient pas les tâches entre deux bases. Une validation confirmée apparaît dans l’autre interface après contrôle de révision, environ chaque seconde lorsque l’écran est visible et connecté. Il s’agit d’une actualisation de révisions, pas de Supabase Realtime/WebSocket.

Sur le même domaine, le SDK partage la session de compte existante. Sur des domaines différents, une connexion sur chaque site est nécessaire. Les associations par code sont propres au chemin de chaque application : associer chaque application séparément si nécessaire. Les codes sont créés par un parent, temporaires, à usage unique et révocables. Ne pas associer une tablette commune en laissant ouvert un compte parent administrateur.

## Supabase : rien à réinstaller dans la base existante

Le projet existant `listesnana` et la migration `20261025135819_mes_missions_v11_shared_engine` ont été vérifiés le 26 octobre 2026. Cette livraison adapte les clients statiques ; **elle ne demande aucune nouvelle migration SQL sur ce projet**.

Voir `backend/INSTALLATION.md`. Les SQL inclus sont des sources de référence et de test, pas une invitation à réexécuter l’installation complète. Les URL et clés `sb_publishable_` dans `config.js` sont publiques par conception. Ne jamais y placer de clé `service_role`, de clé secrète ni de mot de passe.

## Tests locaux facultatifs

Node 22 ou supérieur :

```sh
npm ci
npm test
```

Les suites SQL créent une base PGlite locale et des identités fictives. Elles ne se connectent pas à tes listes. Le site se teste avec un serveur HTTP statique ou après publication HTTPS ; le mode `file://` ne permet pas la PWA ni une connexion fiable.

## Ce qui reste à vérifier sur les appareils

Faire la recette de `RECETTE_ET_LIMITES.md` : validation depuis deux appareils, notifications Android, volume sonore et reprise d’une première liste. La caméra, le kiosque Android et les intégrations secondaires dépendent de leur configuration. Les 73 scénarios documentaires restent un catalogue cible, pas 73 tests déclarés exécutés.
