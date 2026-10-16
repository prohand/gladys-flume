import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Something new.

## [1.0.0] - 2026-10-16

- First release.

[Unreleased]: https://github.com/prohand/gladys-flume/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/prohand/gladys-flume/releases/tag/v1.0.0
`;

test('the Unreleased section moves under the released version', () => {
  const rolled = rollChangelog(CHANGELOG, '1.1.0', '2026-11-01');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-11-01\n\n### Added\n\n- Something new\.\n/,
  );
  assert.match(
    rolled,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-flume\/compare\/v1\.1\.0\.\.\.HEAD\n\[1\.1\.0\]: https:\/\/github\.com\/prohand\/gladys-flume\/compare\/v1\.0\.0\.\.\.v1\.1\.0/,
  );
});

test('an empty Unreleased section still gets a version heading, once', () => {
  const empty = CHANGELOG.replace('### Added\n\n- Something new.\n\n', '');
  const rolled = rollChangelog(empty, '1.0.1', '2026-11-02');
  assert.match(rolled, /## \[1\.0\.1\] - 2026-11-02\n\n- Maintenance release/);
  assert.equal(rollChangelog(rolled, '1.0.1', '2026-11-03'), rolled);
});
