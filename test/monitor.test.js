import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { FEATURES, sensorIds } from '../src/devices/sensor.js';
import { FlumeMonitor, LINK_STATES, SCENE_TRIGGERS } from '../src/flume/monitor.js';
import {
  CONFIGURED,
  createFakeClient,
  flumeDevices,
  networkError,
  notification,
  rateLimitError,
  SENSOR_ID,
} from './helpers/fakeFlume.js';

// A monitor on the fake Gladys of the SDK and a fake Flume, its clock in the
// test's hands and its timer recorded instead of run.
function setup({ config = {}, client = createFakeClient() } = {}) {
  const gladys = createFakeGladys();
  const clock = { now: new Date('2026-10-16T10:00:00Z') };
  const timers = [];
  let changes = 0;
  const monitor = new FlumeMonitor({
    gladys,
    client,
    onChange: () => {
      changes += 1;
    },
    now: () => clock.now,
    setTimer: (fn, delay) => {
      timers.push(delay);
      return { fn, delay };
    },
    clearTimer: () => {},
  });
  monitor.configure(normalizeConfig({ ...CONFIGURED, ...config }));
  monitor.running = true;
  const ids = sensorIds(gladys, SENSOR_ID);
  const advance = (seconds) => {
    clock.now = new Date(clock.now.getTime() + seconds * 1000);
  };
  return { gladys, client, monitor, ids, timers, advance, changes: () => changes };
}

const lastStatus = (gladys) => gladys.fake.connectionStatuses.at(-1);
const lastTransport = (gladys) => gladys.fake.transports.at(-1);

test('the first refresh publishes the sensor, its states, its badge and the status', async () => {
  const { gladys, monitor, ids } = setup();
  await monitor.refresh();

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, ids.device);
  assert.equal(device.name, 'Flume Home');
  assert.deepEqual(
    device.features.map((feature) => feature.external_id),
    Object.values(FEATURES).map((key) => ids.feature(key)),
  );
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.LAST_MINUTE)), 0);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.TODAY)), 120);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.MONTH)), 3400);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.LEAK)), 0);
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.BATTERY_LOW)), 0);
  assert.deepEqual(lastTransport(gladys), { device_external_id: ids.device, transport: 'cloud' });
  assert.equal(lastStatus(gladys).connected, true);
  assert.equal(monitor.link.state, LINK_STATES.OK);
});

test('the device list and the alerts are read every 5 minutes, the usage every refresh', async () => {
  const { client, monitor, advance } = setup();
  await monitor.refresh();
  advance(120);
  await monitor.refresh();
  advance(120);
  await monitor.refresh();
  advance(120); // 6 minutes after the first inventory
  await monitor.refresh();

  assert.equal(client.calls.filter((call) => call === 'devices').length, 2);
  assert.equal(client.calls.filter((call) => call.startsWith('query:')).length, 4);
  assert.match(
    client.calls.find((call) => call.startsWith('query:')),
    /last_minute,today,this_month/,
  );
});

test('concurrent refreshes share one round', async () => {
  const { client, monitor } = setup();
  await Promise.all([monitor.refresh(), monitor.refresh({ inventory: true })]);
  assert.equal(client.calls.filter((call) => call === 'devices').length, 1);
});

test('the sensor is discovered again only when the list changes', async () => {
  const { gladys, client, monitor } = setup();
  await monitor.refresh();
  await monitor.refresh({ inventory: true });
  const publishes = () =>
    gladys.fake.requests.filter((request) => request.path === '/discovered_device').length;
  assert.equal(publishes(), 1);
  client.devices = [...client.devices, { id: 'second', type: 2, bridge_id: 'x' }];
  await monitor.refresh({ inventory: true });
  assert.equal(publishes(), 2);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('an unread smart leak alert sets the leak feature, reading it clears it', async () => {
  const client = createFakeClient({ notifications: [notification(1, 'Flume Smart Leak Alert')] });
  const { gladys, monitor, ids } = setup({ client });
  await monitor.refresh();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.LEAK)), 1);
  // Standing before the integration started: no scene replayed.
  assert.equal(gladys.fake.sceneEvents.length, 0);

  client.notifications = [];
  await monitor.refresh({ inventory: true });
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.LEAK)), 0);
});

test('a new Flume alert fires alert_received once', async () => {
  const { gladys, client, monitor, ids } = setup();
  await monitor.refresh();
  client.notifications = [notification(7, 'High Flow Alert', { title: 'High flow' })];
  await monitor.refresh({ inventory: true });
  await monitor.refresh({ inventory: true });

  assert.equal(gladys.fake.sceneEvents.length, 1);
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, SCENE_TRIGGERS.ALERT);
  assert.deepEqual(event.data, {
    device: ids.device,
    alert: 'high_flow',
    title: 'High flow',
    message: 'High Flow Alert on your meter',
  });
  // A high flow is not a smart leak.
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.LEAK)), 0);
});

test('a low battery shows from the device list or from an alert', async () => {
  const client = createFakeClient({ devices: flumeDevices({ battery: 'low' }) });
  const { gladys, monitor, ids } = setup({ client });
  await monitor.refresh();
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.BATTERY_LOW)), 1);

  client.devices = flumeDevices({ battery: 'medium' });
  client.notifications = [notification(2, 'Low Battery')];
  await monitor.refresh({ inventory: true });
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.BATTERY_LOW)), 1);
});

test('water starting and stopping fire water_flow_changed, not the first reading', async () => {
  const client = createFakeClient({ usage: { last_minute: 3, today: 10, this_month: 10 } });
  const { gladys, monitor, ids } = setup({ client });
  await monitor.refresh();
  assert.equal(gladys.fake.sceneEvents.length, 0);

  client.usage.last_minute = 0.2; // under the 0.5 L threshold
  await monitor.refresh();
  client.usage.last_minute = 4.5;
  await monitor.refresh();
  client.usage.last_minute = 5;
  await monitor.refresh();

  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.data),
    [
      { device: ids.device, state: 'stopped', liters: 0.2 },
      { device: ids.device, state: 'started', liters: 4.5 },
    ],
  );
});

test('a sensor or a bridge offline makes the badge unreachable', async () => {
  const client = createFakeClient({ devices: flumeDevices({ bridgeConnected: false }) });
  const { gladys, monitor, ids } = setup({ client });
  await monitor.refresh();
  assert.deepEqual(lastTransport(gladys), {
    device_external_id: ids.device,
    transport: 'unreachable',
  });
  assert.equal(
    monitor.offlineReason(monitor.sensorState()).en,
    'The Flume bridge is offline (power or Wi-Fi).',
  );

  client.devices = flumeDevices({ sensorConnected: false });
  await monitor.refresh({ inventory: true });
  assert.match(monitor.offlineReason(monitor.sensorState()).fr, /capteur Flume est hors ligne/);

  client.devices = flumeDevices();
  await monitor.refresh({ inventory: true });
  assert.deepEqual(lastTransport(gladys), { device_external_id: ids.device, transport: 'cloud' });
});

test('the cloud out of reach: status in four languages, badges unreachable, then back', async () => {
  const { gladys, client, monitor, ids } = setup();
  await monitor.refresh();
  client.failure = networkError();
  await assert.rejects(monitor.refresh(), /unreachable/);

  const status = lastStatus(gladys);
  assert.equal(status.connected, false);
  assert.deepEqual(Object.keys(status.message), ['en', 'fr', 'de', 'es']);
  assert.match(status.message.de, /Flume-Cloud nicht erreichbar/);
  assert.deepEqual(lastTransport(gladys), {
    device_external_id: ids.device,
    transport: 'unreachable',
  });

  client.failure = null;
  await monitor.refresh({ inventory: true });
  assert.equal(lastStatus(gladys).connected, true);
  assert.deepEqual(lastTransport(gladys), { device_external_id: ids.device, transport: 'cloud' });
});

test('the status is only reported when it changes', async () => {
  const { gladys, monitor } = setup();
  await monitor.refresh();
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(gladys.fake.connectionStatuses.length, 1);
});

test('a 429 pauses the loop for 10 minutes', async () => {
  const { client, monitor, timers, advance } = setup();
  await monitor.refresh();
  client.failure = rateLimitError();
  await monitor.tick();
  assert.equal(timers.at(-1), 600 * 1000);

  client.failure = null;
  const before = client.calls.length;
  await assert.rejects(monitor.refresh(), /limit/);
  assert.equal(client.calls.length, before, 'no request while paused');

  advance(601);
  await monitor.refresh();
  assert.equal(monitor.link.state, LINK_STATES.OK);
});

test('the timer follows the configured pace', async () => {
  const { monitor, timers } = setup({ config: { poll_frequency: 300 } });
  await monitor.tick();
  assert.equal(timers.at(-1), 300 * 1000);
});

test('without credentials: no request, and the screen says what to fill in', async () => {
  const client = createFakeClient();
  const { gladys, monitor } = setup({ client });
  await monitor.start(normalizeConfig({}));
  assert.equal(client.calls.length, 0);
  assert.equal(lastStatus(gladys).connected, false);
  assert.match(lastStatus(gladys).message.es, /client secret/);
  await assert.rejects(monitor.refresh(), /Fill in/);
});

test('another account forgets the sensors and the alerts of the previous one', async () => {
  const { monitor } = setup();
  await monitor.refresh();
  assert.equal(monitor.sensors.size, 1);
  monitor.configure(normalizeConfig({ ...CONFIGURED, username: 'other@example.com' }));
  assert.equal(monitor.sensors.size, 0);
  assert.equal(monitor.alertTracker.primed, false);
  // Only the pace changed: everything is kept.
  await monitor.refresh();
  monitor.configure(
    normalizeConfig({ ...CONFIGURED, username: 'other@example.com', poll_frequency: 600 }),
  );
  assert.equal(monitor.sensors.size, 1);
});

test('usageOf reads one period of one sensor', async () => {
  const client = createFakeClient({ usage: { this_week: 840.456 } });
  const { monitor, ids } = setup({ client });
  await monitor.refreshInventory();
  assert.equal(await monitor.usageOf(ids.device, 'this_week'), 840.46);
  assert.equal(await monitor.usageOf(ids.device, 'last_hour'), 0);
  await assert.rejects(monitor.usageOf('ext:test-integration:sensor:nope', 'today'), /Unknown/);
});
