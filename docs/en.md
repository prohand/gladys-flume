# Flume

This integration connects Gladys to a **Flume** smart water monitor: the sensor
strapped on your water meter, and the bridge that relays it to the Flume cloud.
Gladys gets your water usage, the flow of the moment, leak alerts and the battery
state of the sensor, and can use them in scenes and on the dashboard.

## Before you start

- **Gladys 5.3.0 or later** is required.
- Flume is sold in the **United States** only: the integration is listed for that country.
- Your Flume sensor and bridge must be installed and working in the **Flume app**.
- Flume has **no local API**: everything goes through the Flume cloud. Gladys needs
  internet access, and the readings arrive with the delay of the Flume cloud (about a
  minute).

### Get your API client

Every Flume account can create a personal API client. It is what lets Gladys talk to
the Flume cloud on your behalf.

1. Sign in to [portal.flumewater.com](https://portal.flumewater.com) with your Flume
   account.
2. Open **Settings**, then **API Access**.
3. Generate a client if there is none yet, and copy its **Client ID** and its
   **Client Secret**.

## Configuration

In Gladys, open **Integrations**, then **Flume**, then the **Configuration** tab.

| Field                           | What to put                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Flume e-mail                    | The e-mail you sign in to the Flume app with.                                   |
| Flume password                  | The password of that account. It is only sent to Flume.                         |
| Client ID                       | The Client ID of your API client.                                               |
| Client secret                   | The Client Secret of the same API client.                                       |
| Refresh interval (s)            | How often the usage is read, 60 to 3600 seconds. Default: 120.                  |
| Running water threshold (L/min) | Litres in the last minute from which the water counts as running. Default: 0.5. |

Save, then click **Test the connection**: the answer lists each sensor with its usage
of the day, its leak state and its connection.

### Why not refresh every second?

Flume allows about **120 requests per hour** per account. Each refresh costs one
request per sensor; the device list and the alerts are read every 5 minutes on top of
that. With the default 120 seconds, a home with one sensor uses about 54 requests per
hour. If Flume answers that the limit is reached, the integration pauses for 10
minutes by itself and says so on the configuration screen.

## Devices

Open the **Discover** tab of the integration: each Flume sensor shows up there, named
after its Flume location. Add it to Gladys. It carries:

| Feature                  | Unit | Meaning                                                                 |
| ------------------------ | ---- | ----------------------------------------------------------------------- |
| Water flow (last minute) | L    | Litres used during the last complete minute, which reads as L/min.      |
| Water used today         | L    | Since midnight, at the meter's time zone.                               |
| Water used this month    | L    | Since the 1st of the month.                                             |
| Leak                     | 0/1  | 1 while a Flume smart leak alert is unread.                             |
| Low battery              | 0/1  | 1 when Flume says the battery is low, or a low battery alert is unread. |

All volumes are in **litres**, even for a home set in gallons in the Flume app: Gladys
has no gallon unit.

The **badge** of the device says `cloud` when everything works, and `unreachable` when
the sensor, its bridge or the Flume cloud is offline.

### How the leak goes back to 0

Flume keeps an alert as long as it is **unread**. Open it in the Flume app (or mark it
as read): at the next check, at most 5 minutes later, the leak feature goes back to 0.

## Scenes

### Triggers

- **A Flume alert is raised**: a new alert from Flume — leak, high flow, low battery,
  bridge offline, or another one. Filter on the sensor and on the kind of alert. The
  following actions can read `alert`, `title` and `message`. An alert that was already
  standing when the integration started does not fire it again.
- **Water starts or stops running**: the litres of the last minute crossed the running
  water threshold of the configuration. Filter on the sensor and on started / stopped;
  the following actions can read `state` and `liters`.

For a threshold on a value (more than 500 L today, for instance), use the standard
Gladys trigger on the device features: they are ordinary sensors.

### Actions

- **Read the Flume water usage**: reads from Flume the litres used over a period (last
  hour, today, last 24 hours, this week, this month). Outputs: `liters` and
  `cubic_meters`.
- **Refresh Flume now**: reads Flume right away instead of waiting for the next
  refresh. Outputs: `leak`, `water_running`, `liters_last_minute`, `liters_today` — for
  one sensor, or for all of them when none is chosen.

Example: "Every day at 22:00, read today's usage, and send me a message if it is more
than 800 litres."

## Dashboard widget

Add the **Flume water** widget to a dashboard. It shows the last minute, today and the
month as live tiles, the flow of the last 24 hours, the leak, water, battery and
connection status, the latest alert, and a **Refresh** button. Pick a sensor in its
settings, or leave it empty for the first sensor of the account.

## Troubleshooting

- **"Flume refused the login"**: check the e-mail and the password in the Flume app,
  then the Client ID and Client Secret on portal.flumewater.com. A password changed in
  the Flume app must be changed here too.
- **No sensor in the Discover tab**: click **Test the connection**. If it says "no
  sensor on this account", finish the setup in the Flume app.
- **Unreachable badge**: the Flume app shows the same state; check the bridge (power,
  Wi-Fi) and the sensor batteries.
- **Values late by a minute or two**: that is the delay of the Flume cloud itself.

The integration logs (Gladys, **Integrations**, Flume, logs) never contain your
password, your client secret or your tokens.
