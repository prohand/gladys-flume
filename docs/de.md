# Flume

Diese Integration verbindet Gladys mit einem intelligenten **Flume**-Wasserzähler: dem
Sensor an deinem Wasserzähler und der Bridge, die ihn an die Flume-Cloud weiterleitet.
Gladys erhält deinen Wasserverbrauch, den aktuellen Durchfluss, Leckalarme und den
Batteriezustand des Sensors und kann sie in Szenen und auf dem Dashboard verwenden.

## Bevor du beginnst

- **Gladys 5.3.0 oder neuer** ist erforderlich.
- Flume wird nur in den **Vereinigten Staaten** verkauft: Die Integration wird für dieses Land angeboten.
- Dein Flume-Sensor und deine Bridge müssen in der **Flume-App** eingerichtet sein und
  funktionieren.
- Flume hat **keine lokale API**: Alles läuft über die Flume-Cloud. Gladys braucht
  Internetzugang, und die Messwerte kommen mit der Verzögerung der Flume-Cloud an (etwa
  eine Minute).

### Deinen API-Client holen

Jedes Flume-Konto kann einen persönlichen API-Client erstellen. Mit ihm spricht Gladys
in deinem Namen mit der Flume-Cloud.

1. Melde dich mit deinem Flume-Konto auf
   [portal.flumewater.com](https://portal.flumewater.com) an.
2. Öffne **Settings** und dann **API Access**.
3. Erstelle einen Client, falls noch keiner existiert, und kopiere seine **Client ID**
   und sein **Client Secret**.

## Konfiguration

Öffne in Gladys **Integrationen**, dann **Flume**, dann den Reiter **Konfiguration**.

| Feld                                   | Was eintragen                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Flume-E-Mail                           | Die E-Mail, mit der du dich in der Flume-App anmeldest.                            |
| Flume-Passwort                         | Das Passwort dieses Kontos. Es wird nur an Flume gesendet.                         |
| Client-ID                              | Die Client ID deines API-Clients.                                                  |
| Client-Secret                          | Das Client Secret desselben API-Clients.                                           |
| Aktualisierungsintervall (s)           | Wie oft der Verbrauch gelesen wird, 60 bis 3600 Sekunden. Standard: 120.           |
| Schwelle für fließendes Wasser (L/min) | Liter in der letzten Minute, ab denen das Wasser als fließend gilt. Standard: 0,5. |

Speichere und klicke dann auf **Verbindung testen**: Die Antwort listet jeden Sensor
mit seinem Tagesverbrauch, seinem Leckzustand und seiner Verbindung auf.

### Warum nicht jede Sekunde aktualisieren?

Flume erlaubt etwa **120 Anfragen pro Stunde** und Konto. Jede Aktualisierung kostet
eine Anfrage pro Sensor; die Geräteliste und die Alarme werden zusätzlich alle 5
Minuten gelesen. Mit den standardmäßigen 120 Sekunden braucht ein Haushalt mit einem
Sensor etwa 54 Anfragen pro Stunde. Meldet Flume, dass das Limit erreicht ist, pausiert
die Integration von selbst 10 Minuten und zeigt das im Konfigurationsbildschirm an.

## Geräte

Öffne den Reiter **Entdecken** der Integration: Jeder Flume-Sensor erscheint dort,
benannt nach seinem Flume-Standort. Füge ihn zu Gladys hinzu. Er hat:

| Funktion                 | Einheit | Bedeutung                                                                         |
| ------------------------ | ------- | --------------------------------------------------------------------------------- |
| Water flow (last minute) | L       | Liter in der letzten vollständigen Minute, also L/min.                            |
| Water used today         | L       | Seit Mitternacht, in der Zeitzone des Zählers.                                    |
| Water used this month    | L       | Seit dem 1. des Monats.                                                           |
| Leak                     | 0/1     | 1, solange ein Flume-Leckalarm ungelesen ist.                                     |
| Low battery              | 0/1     | 1, wenn Flume eine schwache Batterie meldet oder ein Batteriealarm ungelesen ist. |

Die Namen der Funktionen werden auf Englisch vorgeschlagen: Benenne sie in Gladys nach
Belieben um. Alle Mengen sind in **Litern**.

Das **Badge** des Geräts zeigt `cloud`, wenn alles funktioniert, und `unreachable`
(nicht erreichbar), wenn der Sensor, seine Bridge oder die Flume-Cloud offline ist.

### Wie das Leck wieder auf 0 geht

Flume behält einen Alarm, solange er **ungelesen** ist. Öffne ihn in der Flume-App (oder
markiere ihn als gelesen): Bei der nächsten Prüfung, spätestens 5 Minuten später, geht
die Funktion Leak wieder auf 0.

## Szenen

### Auslöser

- **Ein Flume-Alarm wird ausgelöst**: ein neuer Alarm von Flume — Leck, hoher
  Durchfluss, schwache Batterie, Bridge offline oder ein anderer. Filtere nach Sensor
  und Alarmart. Die folgenden Aktionen können `alert`, `title` und `message` lesen. Ein
  Alarm, der beim Start der Integration schon bestand, löst ihn nicht erneut aus.
- **Wasser beginnt oder hört auf zu fließen**: Die Liter der letzten Minute haben die
  Schwelle für fließendes Wasser aus der Konfiguration überschritten. Filtere nach
  Sensor und nach beginnt / hört auf; die folgenden Aktionen können `state` und
  `liters` lesen.

Für eine Schwelle auf einem Wert (zum Beispiel mehr als 500 L heute) verwende den
Standardauslöser von Gladys auf den Gerätefunktionen: Es sind normale Sensoren.

### Aktionen

- **Flume-Wasserverbrauch lesen**: liest bei Flume die über einen Zeitraum verbrauchten
  Liter (letzte Stunde, heute, letzte 24 Stunden, diese Woche, diesen Monat).
  Ausgaben: `liters` und `cubic_meters`.
- **Flume jetzt aktualisieren**: liest Flume sofort, statt auf die nächste
  Aktualisierung zu warten. Ausgaben: `leak`, `water_running`, `liters_last_minute`,
  `liters_today` — für einen Sensor oder für alle, wenn keiner gewählt ist.

Beispiel: „Jeden Tag um 22:00 Uhr den Tagesverbrauch lesen und mir eine Nachricht
schicken, wenn er über 800 Liter liegt.“

## Dashboard-Widget

Füge das Widget **Flume-Wasser** zu einem Dashboard hinzu. Es zeigt die letzte Minute,
den Tag und den Monat als Live-Kacheln, den Durchfluss der letzten 24 Stunden, den
Leck-, Wasser-, Batterie- und Verbindungsstatus, den letzten Alarm und eine
Schaltfläche **Aktualisieren**. Wähle in seinen Einstellungen einen Sensor oder lass
das Feld leer für den ersten Sensor des Kontos.

## Fehlerbehebung

- **„Flume hat die Anmeldung abgelehnt“**: Prüfe E-Mail und Passwort in der Flume-App,
  dann Client ID und Client Secret auf portal.flumewater.com. Ein in der Flume-App
  geändertes Passwort muss auch hier geändert werden.
- **Kein Sensor im Reiter Entdecken**: Klicke auf **Verbindung testen**. Meldet er „kein
  Sensor in diesem Konto“, schließe die Einrichtung in der Flume-App ab.
- **Badge nicht erreichbar**: Die Flume-App zeigt denselben Zustand; prüfe die Bridge
  (Strom, WLAN) und die Batterien des Sensors.
- **Werte eine oder zwei Minuten zu spät**: Das ist die Verzögerung der Flume-Cloud
  selbst.

Die Protokolle der Integration (Gladys, **Integrationen**, Flume, Protokolle) enthalten
nie dein Passwort, dein Client Secret oder deine Tokens.
