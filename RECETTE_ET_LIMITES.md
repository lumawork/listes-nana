> Document historique de la version précédente. Pour cette livraison, lire CHANGEMENTS.md et ECRAN_FULLY.md.

# Recette et limites — Notre Maison 1.2 / Mes Missions 11.1

Livraison de code du 26 octobre 2026. Aucun déploiement, aucune modification de la base réelle et aucune reprise de liste familiale réalisés pendant cette livraison.

## Livré

| Domaine | Comportement livré |
|---|---|
| Deux projets | Mes Missions autonome à la racine du dépôt existant ; Notre Maison autonome dans un second dépôt. Les fichiers construits sont fournis. |
| Base commune | Supabase existant, comptes existants et RPC communs ; une seule occurrence serveur par tâche. |
| Récurrences | Fixes, ponctuelles ou après dernière validation ; minutes, heures, jours civils et semaines. Une mission « poules tous les sept jours » repart de la validation serveur. |
| Apparition | J−5 au-delà de 24 h, H−2 jusqu’à 24 h, H−4 avant une période. Les retards restent affichés en tête. |
| Exactement 24 h | Règle de la V11 conservée : apparition H−2 et ponctualité jusqu’à la fin du jour civil à Paris. Il s’agit de l’arbitrage proposé dans le cahier des charges, pas d’une nouvelle validation explicite de Laurie. |
| Ponctualité | Fenêtres semi-ouvertes : une réalisation à la borne finale compte en retard. Pour une fréquence de moins d’une heure à dates fixes, la fenêtre est bornée par l’occurrence suivante. |
| Actions | Validation, report, tour sauté, annulation et correction tracés ; un report ne change pas l’échéance initiale servant aux statistiques. |
| Partage | Identifiant + code temporaire à usage unique, association révocable ; administration réservée aux comptes autorisés. Caméra/raccourcis distincts du simple accès aux listes. |
| Reprise V10 | Choix d’une liste autorisée, aperçu, sauvegarde filtrée et confirmation ; clés de source uniques, anciennes coches archivées et protection des anciens resets/rappels. |
| Notre Maison | Deux listes visibles en paysage, accès horizontal à la troisième, défilement vertical individuel, règles et rituels, raccourcis par icônes, statistiques globales et individuelles. |
| Avatars | Six portraits, photo importée et retour au défaut ; synchronisation avec la configuration commune. |
| Son / notifications | Activation du son par geste utilisateur, horaires et relances par mission, silence configurable ; utilisation du worker Push existant pour les comptes abonnés. |
| PWA / chemins | Ressources, manifeste et service worker adaptés aux sous-chemins GitHub Pages ; icônes PNG 192/512 et ressources servies localement. |
| Hors connexion | Notre Maison conserve un instantané par identité pendant 24 h maximum ; aucune validation différée. Mes Missions garde l’affichage courant dans l’onglet ouvert ; les listes V10 gardent leur fonctionnement local existant. |

Les statistiques des trois personnes excluent Jonathan. Elles distinguent réalisations à temps, en retard, non faites, à venir et tours sautés. Les reports restent des événements, sans être comptés comme des réalisations. Le bandeau quotidien se renouvelle sans effacer l’historique.

## Vérifications réalisées pour cette livraison

| Vérification | Résultat et portée |
|---|---|
| Source existante | Reprise du commit Notre Maison `e3d57f043947ea090d1e82bdcd364a0a7d06b7e5`. Les six fichiers centraux contrôlés du dépôt GitHub existant correspondent à la V10 archivée ; la nouvelle interface V11 y était absente. |
| Base existante | Lecture des migrations et des signatures RPC. Moteur, comptes, reprise V10 et rappels présents ; onze tables privées avec RLS ; aucune permission directe de lecture/écriture des tables pour `anon` ou `authenticated`. |
| Moteur SQL local | Suite `tests/database.cjs` passée : foyers, rôles, idempotence, récurrence relative, association/révocation, reports, seuils temporels et changement d’heure. |
| Migration locale | Suite `tests/migration.cjs` passée : aperçu, source privée, sauvegarde filtrée, répétition sans doublon, source périmée, originaux, gardiens et protections V10. |
| Client métier | Suites `dynamic-core.cjs` et `legacy-client.cjs` passées : dates Paris, catégories statistiques, silence, tri, coches des listes reprises et messages existants. |
| Changement de compte | Test VM passé : une réponse tardive de l’ancien compte est écartée, le nouveau compte est rechargé, la déconnexion efface l’instantané actif. |
| Adaptateur Notre Maison | Dix tests Node passés : chemins de projet, RPC, association refusée/réussie, cache par identité et expiration, refus des écritures hors ligne, déconnexion, clé secrète rejetée, service worker. Les RPC de cette suite sont simulées. |
| Notifications locales | Tests des deux service workers passés : identité exacte, refus après déconnexion, ouverture dans le bon projet et absence de cache des appels Supabase. Il s’agit de tests simulés, sans émission Push réelle. |
| Construction | Bundle Notre Maison reconstruit ; dépendances verrouillées ; scripts statiques analysés ; ressources HTML, manifeste et icônes vérifiés. |
| Navigateur | Aperçus locaux sous deux sous-chemins ; avatar, statistiques et formulaire de récurrences vérifiés. Rendu Notre Maison inspecté dans des cadres de 1024 × 600 et 390 × 844, ainsi que sur grand écran. Ce ne sont pas des essais sur les appareils physiques. |

Les 73 scénarios du cahier des charges constituent toujours le catalogue de recette cible. Ils ne sont pas tous déclarés exécutés par ces suites.

## Recette familiale après installation volontaire

1. Se connecter avec un compte parent et vérifier les anciennes listes avant toute reprise. Résoudre d’abord les modifications V10 locales non synchronisées.
2. Reprendre **une seule liste** après téléchargement de la sauvegarde et contrôle des premières échéances. Vérifier sa destination familiale.
3. Ouvrir cette même liste sur téléphone et tablette. Valider une occurrence sur l’un, vérifier la mise à jour sur l’autre et une seule réalisation dans l’historique.
4. Tester une récurrence relative, un report, un tour sauté et une pause. Contrôler la date suivante et l’échéance initiale des statistiques.
5. Activer les notifications sur le compte/appareil choisi. Programmer un rappel proche, vérifier son arrivée, les heures de silence et l’absence d’ancien rappel V10 pour la liste reprise.
6. Créer puis révoquer un accès d’essai. Vérifier qu’une nouvelle action est refusée par le serveur après révocation.
7. Sur la tablette, tester le défilement tactile, le retour après inactivité, le maintien caméra et chaque raccourci Android réellement configuré.

## Limites explicites

- La caméra nécessite une URL vidéo HTTPS directement compatible avec le navigateur. La PWA ne convertit pas un flux RTSP ; aucun flux réel n’est inclus ou testé.
- Le maintien de la caméra bloque le retour interne de la PWA. Il ne verrouille pas Android. Le retour imposé depuis une application externe et le démarrage automatique nécessitent un mode kiosque ou une configuration Android appropriée.
- Les notifications dépendent du navigateur, des permissions, du volume et des restrictions Android. Un accès par code ne dispose pas d’un abonnement Push de compte ; le son écran ouvert demande une activation manuelle.
- Les rituels ont des rappels sonores pendant l’ouverture de Notre Maison ; les rappels de rituels en arrière-plan restent à réaliser.
- Agenda, courses, localisation consentie, volets et Home Assistant restent des raccourcis configurables. Aucune API, synchronisation de calendrier ou collecte de localisation n’a été inventée.
- La matrice très fine des permissions, la restauration automatisée d’un export du nouveau moteur, le journal des anciennes phrases et le recadrage manuel des photos restent des compléments à la cible documentaire.
- La bascule d’une liste réelle reste une opération choisie par l’utilisateur, distincte de l’installation du code. Un retour au code V10 ne défait pas les protections de migration déjà installées côté base.
- Les versions statiques utilisent le stockage du navigateur pour leur session, sans cookies serveur HttpOnly. La politique CSP et les contrôles de la base restent actifs ; utiliser des accès limités sur la tablette partagée.

Aucune écriture dans Nexus, Atlas, Harmonie ou Tempo.
