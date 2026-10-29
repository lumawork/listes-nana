# Base commune : état et sources SQL

## Projet existant de Laurie

Le projet `rfytfypsbasxauekaxba` (`listesnana`, région eu-west-1) contient déjà les RPC V10 et le moteur Notre Maison/V11. L’inventaire et l’historique des migrations ont été lus le 26 octobre 2026. La dernière migration du moteur est `20261025135819_mes_missions_v11_shared_engine`.

**Pour installer les deux clients livrés, ne lancer aucun SQL d’installation.** Cette livraison ne modifie pas la base, les comptes, les listes réelles, les notifications serveur ni leur planificateur.

Le fichier `VERIFIER_BASE_EXISTANTE.sql` permet de lire l’état des composants, sans mutation ni extraction du contenu des tâches. Si une installation différente est utilisée, effectuer cette vérification avant toute bascule et adapter la configuration. Ne pas créer une deuxième base pour les deux interfaces.

## Fichiers conservés

| Fichier | Usage |
|---|---|
| `schema.sql` | Description complète du moteur actuel sur un schéma de prérequis Mes Missions ; utilisé dans les tests locaux. Non réexécutable sur un schéma existant. |
| `002-schedule-edit.sql` | Source historique de l’évolution du calendrier. Déjà installée dans le projet existant. |
| `integration/` | Sources de construction de l’intégration V11 et de la reprise des listes. |
| `../supabase/migrations/20261025135819_mes_missions_v11_shared_engine.sql` | Migration historique de V1 vers V11, déjà installée. Ne pas l’appliquer une seconde fois. |
| `reminders.ts` | Source du worker de rappels existant. Aucune réinstallation requise ici. Ses secrets appartiennent à l’environnement Supabase, jamais à GitHub Pages. |
| `../tests/fixtures/schema-v1.sql` | Ancienne base fictive utilisée seulement par la recette de migration PGlite. |

Les prérequis `mm_private`, profils, comptes et RPC V10 proviennent de l’installation Mes Missions existante ; ces fichiers ne constituent pas un installateur d’une nouvelle base vierge.

## Reprise des données

La migration des **listes** est une opération utilisateur distincte de l’installation du code. Elle se fait dans Mes Missions, après aperçu, téléchargement d’une sauvegarde et confirmation de la visibilité dans le foyer. Les listes non choisies restent intactes.

Après une reprise réelle, remettre l’ancien code V10 ne suffit pas à annuler la migration : les protections serveur restent actives. Restaurer une base entière ferait aussi perdre des évolutions récentes d’autres listes. En cas de difficulté, garder la liste originale protégée, désactiver les rappels nouveaux, exporter le moteur et analyser la liste concernée avant toute restauration. Aucun bouton de retour arrière automatique n’est annoncé.

## Notifications et URLs

Le worker existant continue à utiliser les abonnements Push enregistrés dans la même base. Sur un nouveau domaine/chemin, activer les notifications depuis le site concerné. Associer chaque personne à son compte destinataire dans les paramètres Notre Maison. Les accès par code n’activent pas les notifications Push de compte ; les rappels sonores fonctionnent écran ouvert après activation du son.

La connexion par mot de passe utilise les comptes existants. Si tu utilises les liens de récupération/confirmation depuis une nouvelle adresse, celle-ci doit être autorisée dans Supabase → Authentication → URL Configuration → Redirect URLs. Ne pas remplacer l’adresse existante de Mes Missions ; ajouter seulement les adresses réellement publiées et nécessaires.
