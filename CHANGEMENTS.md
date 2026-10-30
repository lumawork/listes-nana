# V12.2 / V1.4.2 — valider une mission sans cocher chaque étape

- La coche d’une mission (téléphone et tablette) coche d’un coup toutes ses étapes restantes, ce qui termine la mission. Remplace la règle V12 « pas de bouton qui valide toutes les étapes », à la demande de Laurie (30/10/2026).
- Toucher le texte de la mission ouvre ses étapes.
- Dans la fenêtre des étapes : « Tout cocher et terminer » et, pour les comptes autorisés, Reporter / Je passe mon tour / Annuler l’occurrence, sans avoir terminé les étapes.
- Aucun changement SQL : chaque étape restante est validée par le moteur existant, la dernière termine la mission.

# V12.1 / V1.4.1 — corrections Mes missions

- Aujourd’hui : nouvelle section « 🔔 Mes missions » en haut de l’écran. Toute mission avec « Me rappeler cette mission » y apparaît dès le début de sa journée (et les retards), sans attendre la fenêtre H−2 / J−5. Ses étapes se cochent directement depuis la section ; avant l’ouverture serveur de l’occurrence, les coches restent grisées avec l’heure d’ouverture.
- Gérer : la section « Mes missions, y compris sans date » passe en haut de l’écran, missions avec rappel en premier, heure de rappel visible et étapes dépliables.
- Rappel = heure de la mission : le champ séparé « À quelle heure ? » est supprimé (téléphone et tablette). Cocher le rappel rend l’heure obligatoire. Pour une ancienne mission « journée entière » avec heure de rappel, cette heure préremplit l’heure de la mission à la prochaine modification.
- Affichage : une mission « journée entière » n’affiche plus 00:00 mais sa date et son heure de rappel, ou « dans la journée ».
- Aucun changement SQL.

# V12 / V1.4 — simplification et missions avec étapes

## Interface
- Mes Missions : navigation Aujourd’hui / Gérer / Réglages. L’accueil se concentre sur les missions actives et la progression. Les outils de gestion, thèmes et sauvegardes sont secondaires.
- Plus de bouton Reprendre mes listes V10 dans l’usage normal. Plus de bouton Synchroniser maintenant permanent. Les envois sont automatiques pour les données du compte ; les missions communes sont validées directement dans le moteur et les autres appareils actualisent leur révision automatiquement. En cas d’erreur un Réessayer contextuel apparaît. Les validations de missions hors connexion sont refusées explicitement, pas mises silencieusement dans une file locale.
- Création guidée dans les deux interfaces : Quoi, Pour qui, Quand, rappel facultatif. Les champs sans utilité pour le choix actuel disparaissent. Étapes et options supplémentaires sont repliables.
- Quand : Sans date, Une fois, Certains jours, Après chaque réalisation. Une mission sans date est une définition, sans occurrence ni rappel ; elle reste dans Gérer.
- Une étape par ligne ; un horaire facultatif peut précéder le texte, exemple « 15:00 Préparer le sac ». Ces horaires sont des repères visuels dans la checklist, pas des rappels indépendants. Pour un vrai rappel/fréquence distinct, utiliser une mission distincte.
- Checklist détaillée et mode Une étape à la fois sur téléphone et tablette. Cocher la dernière étape termine la mission ; les étapes ne sont pas des réalisations statistiques séparées. Pas de bouton qui valide toutes les étapes sans les traiter.
- Une étape ne peut être décochée sur une mission déjà terminée ; une correction passe par la réouverture de l’occurrence, réservée aux droits existants et tracée. Chaque occurrence conserve sa propre version des étapes.
- Modifier les détails d’un modèle conserve ses identifiants d’étapes ; modifier le calendrier remplace le futur selon les protections existantes. Les réalisations et échéances passées ne sont pas réécrites. Les changements de modèle ne modifient pas rétroactivement une occurrence déjà échue.

## Reprise unique, sans dates inventées
- Un compte connecté ne reprend que ses propres listes personnelles. La tablette associée par code ne lance jamais de reprise.
- Pour une ancienne liste quotidienne/hebdomadaire simple : une définition de mission au nom de la liste, ses anciens items deviennent des étapes et son ancienne catégorie devient le groupe. Les jours autorisés, pauses, notes et paramètres de rappel disponibles sont repris. La fréquence hebdomadaire conserve l’intervalle de sept jours du moteur précédent ; aucun calendrier n’est déduit du titre d’une liste.
- Pour une ancienne liste manuelle : une mission Sans date, même si certains items avaient une heure de texte. Aucune échéance n’est inventée. Les détails restent dans Gérer.
- Les coches déjà faites dans la journée source sont reprises comme observations de progression, sans heure de validation inventée. Une liste déjà entièrement cochée aujourd’hui commence son prochain cycle admissible ; les anciennes coches restent dans la sauvegarde, pas transformées en réalisations datées.
- Si une ancienne liste a déjà été reprise ET possède des réalisations, des retards échus ou un calendrier modifié : ses missions existantes sont conservées. Leur détail est replié sur le tableau de bord. Cette prudence évite d’altérer les statistiques passées et les obligations en retard. Le bilan indique « calendrier existant conservé ». Les historiques antérieurs gardent leur granularité d’origine ; ils ne sont pas artificiellement recalculés comme de nouvelles missions à étapes.
- Les originaux et leur historique filtré sont copiés dans legacy_snapshots. Les nouvelles reprises sont suivies par upgrades_v12 et les événements d’audit. Les liens existants empêchent les anciennes interfaces de remettre à zéro ou modifier les listes désormais communes.
- La reprise est transactionnelle, verrouillée par compte et par foyer, et idempotente par liste. Une nouvelle connexion ne duplique pas les données. En cas d’erreur, l’opération non confirmée peut être réessayée.

## Moteur et sécurité
- Complément backend/003-missions-etapes.sql, testé localement sur le schéma V11 fourni. Aucune exécution en production pendant la fabrication des archives.
- L’action step vérifie l’accès au foyer/personne via l’API existante, l’état visible de l’occurrence et sa version. Deux appareils ne peuvent pas écraser des coches concurrentes. Les retries ont une clé stable ; la dernière étape déclenche la validation normale et les récurrences relatives existantes.
- Les coches sont des données d’occurrence gérées par le serveur ; un formulaire ne peut pas injecter un stepDone dans une définition de mission.
- Les étapes sont bornées et validées. Une mission compte comme une occurrence statistique, quel que soit son nombre d’étapes. Les anciennes statistiques conservées ne sont pas modifiées.
- Tables privées, RLS et permissions de fonctions explicites. Aucune clé secrète dans les sites, seulement la configuration publique Supabase déjà utilisée.

## Vérifications
Les tests SQL locaux couvrent : droits enfant/parent/appareil et foyers étrangers, sauvegarde et original intact, reprise unique, missions manuelles sans date, refus d’une validation globale prématurée, progression multi-appareils/version, idempotence, récurrence suivante avec étapes remises à zéro, impossibilité d’injecter des coches dans un modèle. Les suites historiques V11 restent exécutées séparément.
Les tests DOM JSDOM simulent les comptes, la connexion et les services : navigation, formulaire contextuel, reprise automatique appelée une fois, détails repliés, mode guidé et validation depuis chaque interface. Les tests de politique écran Fully restent ceux de V1.3 avec commandes simulées.
Aucun rendu graphique sur la Lenovo, essai de notification réelle ou réveil matériel n’a été effectué ici. Ils restent à réaliser sur vos appareils.
