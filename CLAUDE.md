# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors
working on this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Flume** smart water monitors. It
runs in its own sandboxed Docker container, reads the Flume cloud API
(`https://api.flumewater.com`, OAuth2 password grant with the user's personal API
client) and publishes to Gladys: one device per Flume sensor (flow, today, month, leak,
low battery), the transport badge (`cloud` / `unreachable`), two scene triggers, two
scene actions and a dashboard widget (Gladys 5.1+). It started from the official
JavaScript template (GladysAssistant/integration-template-js).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/monitor.test.js            # one file
node --test --test-name-pattern "leak"      # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24;
pull requests also run the store checks and build the image. Run the three commands
before pushing.

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  the four languages (en, fr, de, es), pick() / localize()
src/flume/client.js          Flume HTTP client: token, refresh, 401 retry, typed FlumeError
src/flume/time.js            usage queries, bounds in the meter's time zone
src/flume/alerts.js          notifications → alert kinds, new-alert tracker
src/flume/monitor.js         the refresh loop: discovery, states, badges, triggers, status
src/flume/connection.js      "Test the connection" report
src/devices/sensor.js        the Gladys device of one Flume sensor (external ids, features)
src/capabilities/scenes.js   scene actions (manifest `scene_actions`)
src/capabilities/widget.js   dashboard widget (manifest `widgets`)
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
test/                        node --test, SDK fake Gladys + test/helpers/fakeFlume.js
.github/scripts/changelog-release.mjs   rolls CHANGELOG.md at release time
```

### Invariants worth knowing

- **Cloud only.** Flume has no local API: the manifest declares `"transports": ["cloud"]`
  and a sensor's badge is `cloud` or `unreachable`, never `local`. A badge message is
  only accepted with `degraded: true`, so the offline reason lives in the widget and the
  test report, not on the badge.
- **Request budget.** Flume allows about 120 requests per hour and per account. ONE timer
  (never a Gladys poll, `should_poll: false`): usage every `poll_frequency` seconds (60
  minimum, one request per sensor for three periods), device list + notifications every
  `INVENTORY_SECONDS` (300), a 10-minute pause after a 429. Concurrent refreshes (timer,
  widget button, scene action) share one round.
- **Time zone.** Flume takes query bounds as local wall-clock times of the sensor's
  location (`location.tz`): "today" is midnight at the meter, not in the container.
- **Litres only.** Gladys has no gallon unit; queries ask `LITERS`.
- **Alerts** are the unread Flume notifications, classified by `extra.event_rule_name`.
  Leak = a standing smart-leak alert (a high flow is not a leak). The first fetch only
  primes the tracker: a restart never replays old alerts as scene events.
- **Flow trigger**: the first reading sets the baseline, only a change fires.
- **Secrets** (password, client secret, tokens) are never logged nor put in an error
  message; tokens stay in memory.

## Rules

- **External ids are forever.** `gladys.externalIds('sensor', <flume sensor id>)` and the
  feature keys of `FEATURES` (src/devices/sensor.js). Same for every key users store:
  `config_schema`, `actions`, scene trigger / action keys, their option values and
  outputs, widget keys.
- **The container rootfs is read-only.** Write only under `/data` (nothing is written
  today).
- **Versions belong to the Release workflow** (Actions → Release). Never edit `version`
  in `package.json` or in the manifest, nor the `docker_image` tag, by hand.
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a
  version heading: the Release workflow moves the section, and it becomes the notes of
  the GitHub Release.
- **Manifest.** Every text is `{ "en", "fr", "de", "es" }` (`label`, `description`,
  `placeholder`); the catalog `description` holds 10 to 100 characters per language;
  `widgets`, `scene_triggers`, `scene_actions` need `gladys_version >=5.1.0`.
  `test/manifest.test.js` ties the manifest to the code: change both sides together.
- **User-facing text** is in four languages (English, French, German with the informal
  "du", Spanish with "usted"): action answers, connection status, widget texts (built
  with `src/i18n.js`), and `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept
  in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in
  English. Tests never touch the network.
