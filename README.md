# Flume for Gladys Assistant

External integration connecting [Gladys Assistant](https://gladysassistant.com) to
**Flume** smart water monitors, built with the JavaScript SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
from the official
[integration template](https://github.com/GladysAssistant/integration-template-js).

**Transport: cloud.** Flume has no local API: the integration reads the Flume cloud
(`api.flumewater.com`) with the user's Flume account and personal API client.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## What it brings to Gladys

| Surface              | What                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Devices              | One per Flume sensor: water flow (litres in the last minute), used today, used this month, leak, low battery.      |
| Transport badge      | `cloud`, or `unreachable` when the sensor, its bridge or the Flume cloud is offline.                               |
| Configuration screen | Account + API client, refresh interval, running water threshold, connection status, **Test the connection**.       |
| Scene triggers       | `alert_received` (leak, high flow, low battery, bridge offline, other) and `water_flow_changed` (started/stopped). |
| Scene actions        | `get_usage` (litres over a period) and `refresh_now` (leak, water running, litres).                                |
| Dashboard widget     | `water`: live tiles, flow of the last 24 hours, leak / water / battery / connection status, Refresh button.        |
| Languages            | English, French, German, Spanish (manifest, messages, widget, documentation).                                      |

Requires **Gladys 5.3.0 or later** (catalog keywords and countries; scene triggers, scene actions
and widgets need 5.1.0).

## How it reads Flume

- **Authentication**: OAuth2 password grant (`POST /oauth/token`) with the e-mail and
  password of the Flume account and the client ID / secret generated on
  [portal.flumewater.com](https://portal.flumewater.com) (Settings, API Access). The
  token is renewed with its refresh token, kept in memory only.
- **Budget**: Flume allows about 120 requests per hour and per account. One timer of the
  integration's own reads the usage every `poll_frequency` seconds (default 120, minimum
  60; one request per sensor for the last minute, today and this month), and the device
  list and the unread notifications every 5 minutes. A `429` pauses everything for 10
  minutes.
- **Time zone**: the query bounds are the wall clock of the sensor's location, as Flume
  expects them, so "today" starts at midnight at the meter.
- **Alerts**: the unread Flume notifications; the leak feature is 1 while a smart leak
  alert is unread. Each new alert fires `alert_received` once; the ones standing when
  the integration starts are not replayed.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + wiring (no Flume logic)
├─ src/
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ flume/
│  │  ├─ client.js                   # Flume API client (auth, requests, errors)
│  │  ├─ time.js                     # usage queries in the meter's time zone
│  │  ├─ alerts.js                   # notifications → alerts, new-alert tracker
│  │  ├─ monitor.js                  # refresh loop: devices, states, badges, triggers
│  │  └─ connection.js               # "Test the connection" report
│  ├─ devices/sensor.js              # the Gladys device of a Flume sensor
│  └─ capabilities/
│     ├─ scenes.js                   # scene actions
│     └─ widget.js                   # dashboard widget
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, no network
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for coding assistants & contributors
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/
   ├─ workflows/ci.yml               # format, lint, tests (Node 22 + 24); PRs: store checks + Docker build
   ├─ workflows/release.yml          # UI-driven release: bump + changelog + tag + build + GitHub Release
   ├─ workflows/build.yml            # multi-arch image (amd64 + arm64) to ghcr.io
   ├─ workflows/github-release.yml   # GitHub Release of every version tag
   ├─ scripts/changelog-release.mjs  # moves [Unreleased] under the released version
   └─ dependabot.yml                 # npm weekly, GitHub Actions and Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="flume" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs in its container; the SDK reads them.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test, against the SDK's fake Gladys and a fake Flume
npx github:GladysAssistant/integration-store .   # the store's admission checks
```

The same checks run on every push and pull request (Node 22 and 24); pull requests also
run the store admission checks and build the Docker image.

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json`, the manifest `version` and `docker_image`, moves the
changelog section under the new version, pushes the `vX.Y.Z` tag, builds the
`linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-flume` (`:X.Y.Z` and
`:latest`) and publishes the GitHub Release with that changelog section as notes. The
decentralized store indexer then offers the update in Gladys.

To be listed in the store, the repository must be public and carry the GitHub topic
`gladys-assistant-integration`. Turn on **Private vulnerability reporting** in the
repository's security settings: [`SECURITY.md`](SECURITY.md) sends reporters there.

## License

Apache-2.0
