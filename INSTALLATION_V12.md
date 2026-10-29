# Installation — Mes Missions V12 / Notre Maison V1.4

Cette livraison remplace les interfaces, sans nouveau serveur. Elle réutilise le projet Supabase existant. Un complément SQL est nécessaire pour les étapes, les missions sans date et la reprise unique. Aucun déploiement ni appel à vos comptes réels n’a été exécuté pour préparer les archives.

## 1. Avant la mise à jour
Conserver les archives et dépôts actuels. Fermer les anciennes pages pendant la bascule. Sauvegarder les données du projet Supabase selon vos moyens habituels et, si souhaité, télécharger l’export des missions. Ne pas réinitialiser les données du navigateur ni les associations.

## 2. Appliquer le complément au moteur existant, une seule fois
Dans le tableau de bord du projet Supabase déjà utilisé par Mes Missions : SQL Editor → New query. Ouvrir le fichier `backend/003-missions-etapes.sql` fourni dans l’une des deux archives, copier son contenu complet, puis Run.
Les deux archives fournissent exactement le même complément : il est inutile de le lancer deux fois. Le script est néanmoins réexécutable. Il exige le moteur V11 déjà présent et s’arrête avec V11_ENGINE_REQUIRED si ce prérequis manque. Ne pas rejouer les anciens schema.sql ou anciennes migrations pour cette mise à jour.
Le script crée la comptabilité de reprise et les nouvelles fonctions ; il ne lance pas la reprise des comptes. Il conserve l’ancienne fonction sous dispatch_v11 et redirige l’API publique nm_rpc vers une enveloppe compatible, avec les nouveaux contrôles d’étapes. Les tables restent privées, RLS activé ; aucun droit direct sur les données n’est accordé aux navigateurs.
Si SQL Editor indique une erreur, ne pas poursuivre la publication ; conserver le message exact. Le script transactionnel annule ses changements s’il échoue.

## 3. Mettre à jour les sites
- Archive Mes Missions V12 : décompresser et déposer tout le contenu à la racine du dépôt `listes-nana`.
- Archive Notre Maison V1.4 : décompresser et déposer tout le contenu à la racine du dépôt `listes-famille`.
Conserver tous les sous-dossiers, notamment assets pour Notre Maison, art pour Mes Missions, et les nouveaux fichiers mission-wizard.js. Ne pas déposer le ZIP lui-même ni ajouter de dossier englobant. Les sites statiques et le bundle sont déjà construits.
Attendre GitHub Pages. Recharger avec le cache vidé uniquement si nécessaire. Dans Fully Kiosk, vider uniquement le cache, pas les données du site. Les versions affichées doivent être 12.0 et 1.4.
URLs : https://lumawork.github.io/listes-nana/ et https://lumawork.github.io/listes-famille/.

## 4. Première ouverture de chaque compte
Ouvrir Mes Missions avec le compte personnel de chacun. Les anciennes listes PERSONNELLES de ce compte sont récupérées automatiquement, une seule fois. Si un compte adulte n’est pas associé à Papa ou Maman dans les paramètres existants, une question « À qui correspondent tes listes ? » apparaît. Aucun rôle n’est déduit du nom ou de l’adresse e-mail. Un compte enfant reste dans le périmètre Annabelle défini par le moteur existant.
Un bilan se trouve dans Gérer. Les sources originales, leurs coches et leurs observations sont sauvegardées et conservées ; elles ne sont pas supprimées. Il n’y a plus de bouton Reprendre V10 sur le parcours normal.
Les anciennes listes partagées ne sont PAS attribuées automatiquement à une personne : leurs propriétaires/destinataires peuvent être multiples. Elles restent accessibles dans Réglages → Options du compte → Anciennes listes partagées. Les tâches partagées déjà reprises dans le moteur commun restent disponibles.

## 5. Recette familiale
1. Annabelle arrive sur Aujourd’hui, avec ses missions. Gérer contient aussi les missions sans date. Réglages contient le compte et ses outils avancés.
2. Ajouter « Ranger ma chambre », choisir Certains jours et saisir deux étapes. La carte de mission reste compacte ; les étapes s’ouvrent en touchant Ouvrir.
3. Cocher une étape sur le téléphone et vérifier sa progression sur la tablette. Cocher la dernière sur la tablette : la mission est terminée une seule fois et la prochaine récurrence est indépendante, avec des étapes décochées.
4. Vérifier une mission Sans date : présente dans Gérer, absente du tableau de bord et des statistiques de réalisation.
5. Réouvrir le compte : aucun doublon de reprise. Consulter le bilan.
6. Tester une coupure réseau : les validations nouvelles exigent Internet ; aucun message ne doit prétendre qu’une validation non envoyée est enregistrée. Réessayer seulement après retour de connexion.
7. Tester le déverrouillage parent et les réglages Fully sur la Lenovo. La politique écran de V1.3 est conservée ; voir ECRAN_FULLY.md.

## Retour arrière
Avant toute première reprise, restaurer les fichiers précédents permet de revenir à l’interface antérieure ; l’extension SQL ajoutée est compatible avec les actions existantes.
Après une reprise, ne pas supprimer les nouvelles tables ni remplacer aveuglément les données par une vieille sauvegarde : cela perdrait les validations intervenues depuis. Les originaux et les images d’audit sont conservés ; une restauration doit être préparée à partir du bilan, des sauvegardes et des changements intervenus depuis. Aucun script destructeur de restauration automatique n’est fourni.
