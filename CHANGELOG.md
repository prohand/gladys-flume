# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [1.1.0] - 2026-10-25

### Added

- Store search keywords (Flume 2, water meter, leak detector…) and the country the
  integration is offered in (United States, the only market Flume serves).

### Changed

- Gladys 5.3.0 or later is now required.
- Gladys integration SDK 0.16.

## [1.0.2] - 2026-10-23

- Maintenance release, no functional change.

## [1.0.1] - 2026-10-16

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

[Unreleased]: https://github.com/prohand/gladys-flume/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/prohand/gladys-flume/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/prohand/gladys-flume/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-flume/releases/tag/v1.0.1
