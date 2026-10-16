import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flumeDateTime,
  safeTimeZone,
  USAGE_PERIODS,
  usageQuery,
  volumeOf,
  wallClock,
} from '../src/flume/time.js';

// Thursday 2026-10-15, 23:30:45 UTC = Friday 01:30:45 in Paris (UTC+2).
const NOW = new Date('2026-10-15T23:30:45Z');

test('dates are written in the wall clock of the meter', () => {
  assert.equal(flumeDateTime(NOW, 'Europe/Paris'), '2026-10-16 01:30:45');
  assert.equal(flumeDateTime(NOW, 'America/Los_Angeles'), '2026-10-15 16:30:45');
  assert.equal(wallClock(NOW, 'Europe/Paris').weekday, 4); // Friday
});

test('an unknown time zone falls back to UTC', () => {
  assert.equal(safeTimeZone('Mars/Olympus'), 'UTC');
  assert.equal(safeTimeZone(undefined), 'UTC');
  assert.equal(flumeDateTime(NOW, 'Mars/Olympus'), '2026-10-15 23:30:45');
});

test('each period starts where the meter says it starts', () => {
  const since = (period) => usageQuery(period, NOW, 'Europe/Paris').since_datetime;
  assert.equal(since(USAGE_PERIODS.LAST_MINUTE), '2026-10-16 01:29:00');
  assert.equal(since(USAGE_PERIODS.LAST_HOUR), '2026-10-16 00:30:45');
  assert.equal(since(USAGE_PERIODS.TODAY), '2026-10-16 00:00:00');
  assert.equal(since(USAGE_PERIODS.LAST_24_HOURS), '2026-10-15 02:00:00');
  assert.equal(since(USAGE_PERIODS.THIS_WEEK), '2026-10-12 00:00:00'); // Monday
  assert.equal(since(USAGE_PERIODS.THIS_MONTH), '2026-10-01 00:00:00');
});

test('the queries ask litres, summed, up to now', () => {
  const query = usageQuery(USAGE_PERIODS.TODAY, NOW, 'Europe/Paris');
  assert.deepEqual(query, {
    request_id: 'today',
    operation: 'SUM',
    units: 'LITERS',
    bucket: 'DAY',
    since_datetime: '2026-10-16 00:00:00',
    until_datetime: '2026-10-16 01:30:45',
  });
  assert.throws(() => usageQuery('yesterday', NOW, 'UTC'), /Unknown usage period/);
});

test('the week starts on Monday even on a Sunday', () => {
  const sunday = new Date('2026-10-18T10:00:00Z');
  assert.equal(
    usageQuery(USAGE_PERIODS.THIS_WEEK, sunday, 'UTC').since_datetime,
    '2026-10-12 00:00:00',
  );
});

test('volumes: the complete minute for the flow, the sum of buckets otherwise', () => {
  const points = [
    { datetime: 'a', value: 1.234 },
    { datetime: 'b', value: 0.5 },
  ];
  assert.equal(volumeOf(USAGE_PERIODS.LAST_MINUTE, points), 1.23);
  assert.equal(volumeOf(USAGE_PERIODS.TODAY, points), 1.73);
  assert.equal(volumeOf(USAGE_PERIODS.TODAY, []), null);
  assert.equal(volumeOf(USAGE_PERIODS.TODAY, undefined), null);
  assert.equal(volumeOf(USAGE_PERIODS.TODAY, [{ value: -3 }, { value: 'x' }]), 0);
});
