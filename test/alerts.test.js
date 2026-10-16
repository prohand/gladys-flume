import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AlertTracker, ALERT_KINDS, alertKind, alertsByDevice } from '../src/flume/alerts.js';
import { notification } from './helpers/fakeFlume.js';

test('the Flume rule names map to alert kinds', () => {
  const kind = (rule) => alertKind({ extra: { event_rule_name: rule } });
  assert.equal(kind('Flume Smart Leak Alert'), ALERT_KINDS.LEAK);
  assert.equal(kind('High Flow Alert'), ALERT_KINDS.HIGH_FLOW);
  assert.equal(kind('High Flow Leak'), ALERT_KINDS.HIGH_FLOW);
  assert.equal(kind('Low Battery'), ALERT_KINDS.LOW_BATTERY);
  assert.equal(kind('Bridge Disconnection'), ALERT_KINDS.BRIDGE_OFFLINE);
  assert.equal(kind('Usage Alert'), ALERT_KINDS.OTHER);
  // No rule name: the title decides.
  assert.equal(alertKind({ title: 'Leak detected' }), ALERT_KINDS.LEAK);
  assert.equal(alertKind({}), ALERT_KINDS.OTHER);
});

test('the standing alerts are grouped by sensor', () => {
  const byDevice = alertsByDevice([
    notification(1, 'Flume Smart Leak Alert'),
    notification(2, 'Low Battery', { deviceId: 'other' }),
    { id: 3, title: 'Account news' }, // no device: ignored
  ]);
  assert.deepEqual([...byDevice.keys()], ['6248148189204194987', 'other']);
  assert.equal(byDevice.get('6248148189204194987')[0].kind, ALERT_KINDS.LEAK);
});

test('the tracker returns each alert once, and never the ones standing at start', () => {
  const tracker = new AlertTracker();
  assert.deepEqual(tracker.takeNew([notification(1, 'Low Battery')]), []);
  const fresh = tracker.takeNew([
    notification(3, 'High Flow Alert'),
    notification(2, 'Flume Smart Leak Alert'),
    notification(1, 'Low Battery'),
  ]);
  // Oldest first.
  assert.deepEqual(
    fresh.map((alert) => alert.id),
    ['2', '3'],
  );
  assert.deepEqual(tracker.takeNew([notification(3, 'High Flow Alert')]), []);
  tracker.reset();
  assert.deepEqual(tracker.takeNew([notification(4, 'Low Battery')]), []);
});
