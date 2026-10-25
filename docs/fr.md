# Flume

Cette intégration relie Gladys à un compteur d'eau connecté **Flume** : le capteur
fixé sur votre compteur d'eau, et le pont qui le relaie vers le cloud Flume. Gladys
reçoit votre consommation d'eau, le débit du moment, les alertes de fuite et l'état
de la pile du capteur, et peut s'en servir dans les scènes et sur le tableau de bord.

## Avant de commencer

- **Gladys 5.3.0 ou plus récent** est nécessaire.
- Flume n'est vendu qu'aux **États-Unis** : l'intégration est proposée pour ce pays.
- Votre capteur et votre pont Flume doivent être installés et fonctionner dans
  l'**application Flume**.
- Flume n'a **pas d'API locale** : tout passe par le cloud Flume. Gladys a besoin
  d'internet, et les relevés arrivent avec le délai du cloud Flume (environ une
  minute).

### Obtenir votre client API

Chaque compte Flume peut créer un client API personnel. C'est lui qui permet à Gladys
de parler au cloud Flume en votre nom.

1. Connectez-vous à [portal.flumewater.com](https://portal.flumewater.com) avec votre
   compte Flume.
2. Ouvrez **Settings**, puis **API Access**.
3. Générez un client s'il n'y en a pas encore, et copiez son **Client ID** et son
   **Client Secret**.

## Configuration

Dans Gladys, ouvrez **Intégrations**, puis **Flume**, puis l'onglet **Configuration**.

| Champ                              | Quoi mettre                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| E-mail Flume                       | L'e-mail avec lequel vous vous connectez à l'application Flume.                                      |
| Mot de passe Flume                 | Le mot de passe de ce compte. Il n'est envoyé qu'à Flume.                                            |
| Client ID                          | Le Client ID de votre client API.                                                                    |
| Client secret                      | Le Client Secret du même client API.                                                                 |
| Intervalle de rafraîchissement (s) | Fréquence de lecture de la consommation, de 60 à 3600 secondes. Par défaut : 120.                    |
| Seuil d'eau qui coule (L/min)      | Litres de la dernière minute à partir desquels l'eau est considérée comme coulant. Par défaut : 0,5. |

Enregistrez, puis cliquez sur **Tester la connexion** : la réponse liste chaque
capteur avec sa consommation du jour, son état de fuite et sa connexion.

### Pourquoi ne pas rafraîchir chaque seconde ?

Flume autorise environ **120 requêtes par heure** et par compte. Chaque
rafraîchissement coûte une requête par capteur ; la liste des appareils et les
alertes sont lues en plus toutes les 5 minutes. Avec les 120 secondes par défaut, une
maison avec un capteur utilise environ 54 requêtes par heure. Si Flume répond que la
limite est atteinte, l'intégration fait d'elle-même une pause de 10 minutes et
l'indique sur l'écran de configuration.

## Appareils

Ouvrez l'onglet **Découverte** de l'intégration : chaque capteur Flume y apparaît,
nommé d'après son emplacement Flume. Ajoutez-le à Gladys. Il porte :

| Fonctionnalité           | Unité | Signification                                                                         |
| ------------------------ | ----- | ------------------------------------------------------------------------------------- |
| Water flow (last minute) | L     | Litres consommés pendant la dernière minute complète, qui se lit comme des L/min.     |
| Water used today         | L     | Depuis minuit, à l'heure du compteur.                                                 |
| Water used this month    | L     | Depuis le 1er du mois.                                                                |
| Leak                     | 0/1   | 1 tant qu'une alerte de fuite Flume n'est pas lue.                                    |
| Low battery              | 0/1   | 1 quand Flume indique une pile faible, ou qu'une alerte de pile faible n'est pas lue. |

Les noms des fonctionnalités sont proposés en anglais : renommez-les à votre guise dans
Gladys. Tous les volumes sont en **litres**.

Le **badge** de l'appareil indique `cloud` quand tout fonctionne, et `unreachable`
(injoignable) quand le capteur, son pont ou le cloud Flume est hors ligne.

### Comment la fuite repasse à 0

Flume garde une alerte tant qu'elle est **non lue**. Ouvrez-la dans l'application
Flume (ou marquez-la comme lue) : à la vérification suivante, au plus 5 minutes plus
tard, la fonctionnalité Leak repasse à 0.

## Scènes

### Déclencheurs

- **Une alerte Flume est levée** : une nouvelle alerte de Flume — fuite, débit élevé,
  pile faible, pont hors ligne, ou une autre. Filtrez sur le capteur et sur le type
  d'alerte. Les actions suivantes peuvent lire `alert`, `title` et `message`. Une
  alerte déjà présente au démarrage de l'intégration ne la redéclenche pas.
- **L'eau commence ou arrête de couler** : les litres de la dernière minute ont
  franchi le seuil d'eau qui coule de la configuration. Filtrez sur le capteur et sur
  commence / arrête ; les actions suivantes peuvent lire `state` et `liters`.

Pour un seuil sur une valeur (plus de 500 L aujourd'hui, par exemple), utilisez le
déclencheur standard de Gladys sur les fonctionnalités de l'appareil : ce sont des
capteurs ordinaires.

### Actions

- **Lire la consommation d'eau Flume** : lit chez Flume les litres consommés sur une
  période (dernière heure, aujourd'hui, dernières 24 heures, cette semaine, ce mois-ci).
  Sorties : `liters` et `cubic_meters`.
- **Actualiser Flume maintenant** : lit Flume tout de suite sans attendre le prochain
  rafraîchissement. Sorties : `leak`, `water_running`, `liters_last_minute`,
  `liters_today` — pour un capteur, ou pour tous quand aucun n'est choisi.

Exemple : « Tous les jours à 22 h, lire la consommation du jour, et m'envoyer un
message si elle dépasse 800 litres. »

## Widget du tableau de bord

Ajoutez le widget **Eau Flume** à un tableau de bord. Il affiche la dernière minute,
le jour et le mois en tuiles en direct, le débit des dernières 24 heures, l'état de
fuite, de l'eau, de la pile et de la connexion, la dernière alerte, et un bouton
**Actualiser**. Choisissez un capteur dans ses paramètres, ou laissez vide pour le
premier capteur du compte.

## Dépannage

- **« Flume a refusé la connexion »** : vérifiez l'e-mail et le mot de passe dans
  l'application Flume, puis le Client ID et le Client Secret sur portal.flumewater.com.
  Un mot de passe changé dans l'application Flume doit aussi être changé ici.
- **Aucun capteur dans l'onglet Découverte** : cliquez sur **Tester la connexion**. S'il
  répond « aucun capteur sur ce compte », terminez l'installation dans l'application
  Flume.
- **Badge injoignable** : l'application Flume montre le même état ; vérifiez le pont
  (alimentation, Wi-Fi) et les piles du capteur.
- **Valeurs en retard d'une minute ou deux** : c'est le délai du cloud Flume lui-même.

Les journaux de l'intégration (Gladys, **Intégrations**, Flume, journaux) ne
contiennent jamais votre mot de passe, votre client secret ni vos jetons.
