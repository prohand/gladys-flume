# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- Flume smart water monitor integration, through the Flume cloud API (cloud transport).
- One Gladys device per Flume sensor: water flow (litres in the last minute), water used
  today and this month, leak, low battery.
- Transport badge per sensor: `cloud`, or `unreachable` when the sensor, its bridge or the
  Flume cloud is offline.
- Connection status on the Configuration screen and a "Test the connection" button.
- Scene triggers: "A Flume alert is raised" (leak, high flow, low battery, bridge offline)
  and "Water starts or stops running".
- Scene actions: "Read the Flume water usage" (last hour, today, last 24 hours, this week,
  this month) and "Refresh Flume now".
- "Flume water" dashboard widget: live usage tiles, flow of the last 24 hours, status and a
  Refresh button.
- English, French, German and Spanish texts and documentation.
- Respect of the Flume request budget (about 120 per hour): configurable refresh, device
  list and alerts every 5 minutes, 10-minute pause on a 429.

[Unreleased]: https://github.com/prohand/gladys-flume/commits/main
