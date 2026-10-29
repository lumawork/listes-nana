# Écran Lenovo / Fully Kiosk — réglages locaux

## Principe
Notre Maison V1.4 peut transmettre les commandes d’écran à Fully via son interface JavaScript officielle. Fully reste le seul composant qui agit sur la luminosité et l’alimentation de l’écran. Le Wake Lock du navigateur est désactivé dans ce mode. La programmation locale proposée est désactivée par défaut pour ne pas écraser votre configuration Fully.

## Mise en place sur la tablette
1. Mettre à jour le portail vers V1.4, puis ouvrir son URL https://lumawork.github.io/listes-famille/ dans Fully.
2. Dans Fully, activer l’autorisation caméra et Enable Visual Motion Detection. Activer Turn Screen On on Motion et Exit Screensaver on Motion. Le mode de détection et l’interface JavaScript sont des fonctions Fully PLUS ; vérifier la licence/version installée.
3. Dans Advanced Web Settings, activer Enable JavaScript Interface. Cette interface donne des droits étendus à la page : ne l’activer que pour le portail de confiance. Utiliser la liste blanche d’URL de Fully ; ouvrir les raccourcis vers d’autres sites dans un navigateur externe lorsque c’est nécessaire.
4. Dans Device Management, Keep Screen On activé. Pour la programmation pilotée par le portail, mettre Screen Off Timer et Screensaver Timer à 0 et désactiver Schedule Wakeup and Sleep ainsi que Turn Screen Off in Darkness. Cela évite deux programmations concurrentes. Accorder les permissions Android que Fully demande pour éteindre/rallumer l’écran.
5. Vérifier dans Android : date et heure automatiques et fuseau Europe/Paris. Autoriser le fonctionnement de Fully en arrière-plan selon les réglages de batterie de la Lenovo.
6. Dans Notre Maison : Paramètres → déverrouiller avec le compte parent → Écran de cette tablette → gestion Fully Kiosk. Vérifier que l’interface est indiquée disponible.
7. Cocher « Piloter Fully avec les horaires ci-dessous », garder 5 minutes, 06:00 et 22:00, ajuster les luminosités (échelle 1–255), puis Appliquer les réglages écran.
8. Fermer les paramètres. La tablette garde son association familiale. Les réglages d’écran sont locaux à cette installation de navigateur et ne modifient pas les téléphones.

## Comportement précis
- Chaque mouvement détecté et chaque interaction relance les cinq minutes.
- Sans activité depuis cinq minutes : luminosité faible de 6 h inclus à 22 h exclu ; écran éteint de 22 h inclus à 6 h exclu.
- À 22 h, si l’inactivité est déjà supérieure ou égale à cinq minutes, l’écran s’éteint immédiatement. Sinon il s’éteint au terme du délai restant.
- La nuit, un mouvement réveille à la luminosité normale. Une nouvelle extinction suit cinq minutes après le dernier mouvement.
- À 6 h, un écran resté éteint passe à l’état assombri si la page est toujours exécutée ; un mouvement restaure ensuite la luminosité normale.
- Le mode caméra verrouillé empêche le retour automatique à l’accueil dans l’interface ; la politique d’alimentation de l’écran reste distincte.

## Essai avant usage permanent
Mettre temporairement l’inactivité à 1 minute. Tester en journée, puis choisir temporairement une plage nocturne couvrant l’heure actuelle. Vérifier extinction, mouvement et nouvelle extinction. Revenir à 5 minutes, 06:00, 22:00.
Les tests automatisés vérifient la logique et les appels de commandes, pas le comportement matériel de la Lenovo. Si Android suspend complètement la page ou si Fully ne conserve pas son exécution écran éteint malgré turnScreenOff(true), le minuteur de page peut être suspendu : ne pas considérer ce mode validé tant que cet essai n’est pas réussi. Dans ce cas, désactiver le pilotage du portail et utiliser une programmation native Fully adaptée ou une commande externe.
Dans le noir, la caméra peut ne pas détecter le passage. Tester avec l’éclairage réel. Un écran noir dessiné et un écran physiquement éteint ne sont pas la même chose : la commande utilisée ici est turnScreenOff(true).

## Désactiver / Chrome
Décocher le pilotage et appliquer : le portail rend la luminosité par défaut, puis laisse Fully gérer seul son écran. Restaurer vos propres temporisations Fully si nécessaire.
Si le site est ouvert dans Chrome sans Fully, choisir « Navigateur seul » et activer le maintien allumé si souhaité. Cela n’ajoute ni réveil par caméra ni extinction programmée.

Référence officielle : https://www.fully-kiosk.com/docs/en/api/javascript
Méthodes vérifiées dans cette documentation : bind('onMotion', ...), turnScreenOn(), turnScreenOff(boolean keepAlive), setScreenBrightness(int). Aucune commande serveur supplémentaire ni clé secrète n’est ajoutée.
