import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { FEATURES, sensorIds } from '../src/devices/sensor.js';
import { FlumeMonitor } from '../src/flume/monitor.js';
import { SCENE_ACTION_KEYS, SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { buildWaterContent, WATER_WIDGET, WIDGETS } from '../src/capabilities/widget.js';
import {
  CONFIGURED,
  createFakeClient,
  flumeDevices,
  networkError,
  notification,
  SENSOR_ID,
} from './helpers/fakeFlume.js';
import { LANGUAGES } from '../src/i18n.js';

function setup({ client = createFakeClient(), config = CONFIGURED } = {}) {
  const gladys = createFakeGladys();
  const monitor = new FlumeMonitor({ gladys, client, setTimer: () => null, clearTimer: () => {} });
  monitor.configure(normalizeConfig(config));
  return { gladys, client, monitor, ids: sensorIds(gladys, SENSOR_ID) };
}

// Every text of a content, to check each one speaks the four languages.
function texts(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => texts(item, found));
  } else if (value && typeof value === 'object') {
    if (typeof value.en === 'string') {
      found.push(value);
    } else {
      Object.values(value).forEach((item) => texts(item, found));
    }
  }
  return found;
}

test('the water widget is rendered exactly as sent, in every language', async () => {
  const client = createFakeClient({ notifications: [] });
  const { monitor, client: flume } = setup({ client });
  await monitor.refresh();
  flume.notifications = [notification(9, 'Flume Smart Leak Alert', { title: 'Leak detected' })];
  await monitor.refresh({ inventory: true });
  for (const language of LANGUAGES) {
    const content = buildWaterContent(monitor, { settings: {}, language });
    assert.deepEqual(validateWidgetContent(content), []);
  }
  for (const text of texts(buildWaterContent(monitor, {}))) {
    assert.deepEqual(Object.keys(text), LANGUAGES, `"${text.en}" is not in every language`);
  }
});

test('the tiles and the chart follow the features of the chosen sensor', async () => {
  const { monitor, ids } = setup();
  await monitor.refresh();
  const content = buildWaterContent(monitor, { settings: { device: ids.device } });
  const bound = content.components
    .flatMap((c) => c.device_features ?? [c.device_feature ?? []])
    .flat();
  assert.deepEqual(
    [...new Set(bound)],
    [ids.feature(FEATURES.LAST_MINUTE), ids.feature(FEATURES.TODAY), ids.feature(FEATURES.MONTH)],
  );
  const status = content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].value.en, 'None');
});

test('the widget says what is missing when there is no sensor to show', async () => {
  const unconfigured = setup({ config: {} });
  await unconfigured.monitor.start(normalizeConfig({}));
  const content = buildWaterContent(unconfigured.monitor, { settings: {} });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.match(content.components[0].text.en, /Fill in your Flume account/);

  const failing = setup();
  failing.client.failure = networkError();
  await failing.monitor.refresh().catch(() => {});
  const error = buildWaterContent(failing.monitor, { settings: {} });
  assert.deepEqual(validateWidgetContent(error), []);
  assert.match(error.components[0].text.fr, /Cloud Flume injoignable/);
});

test('an offline bridge shows on the widget', async () => {
  const { monitor } = setup({
    client: createFakeClient({ devices: flumeDevices({ bridgeConnected: false }) }),
  });
  await monitor.refresh();
  const content = buildWaterContent(monitor, { language: 'de' });
  assert.deepEqual(validateWidgetContent(content), []);
  const caption = content.components.find((c) => c.type === 'text');
  assert.match(caption.text.de, /Bridge ist offline/);
});

test('the Refresh button reads Flume again and answers a toast', async () => {
  const { monitor, client } = setup();
  await monitor.refresh();
  const before = client.calls.filter((call) => call === 'devices').length;
  const toast = await WIDGETS[WATER_WIDGET].action(monitor, { actionKey: 'refresh' });
  assert.equal(client.calls.filter((call) => call === 'devices').length, before + 1);
  assert.deepEqual(Object.keys(toast), LANGUAGES);
  await assert.rejects(WIDGETS[WATER_WIDGET].action(monitor, { actionKey: 'nope' }), /Unknown/);
});

test('get_usage reads the period asked, today by default', async () => {
  const client = createFakeClient({ usage: { today: 245.5, this_month: 1234.567 } });
  const { monitor, ids } = setup({ client });
  await monitor.refresh();
  const getUsage = SCENE_ACTIONS[SCENE_ACTION_KEYS.GET_USAGE];
  assert.deepEqual(await getUsage(monitor, { device: ids.device }), {
    liters: 245.5,
    cubic_meters: 0.246,
  });
  assert.deepEqual(await getUsage(monitor, { device: ids.device, period: 'this_month' }), {
    liters: 1234.57,
    cubic_meters: 1.235,
  });
});

test('refresh_now refreshes and reports leak, running water and litres', async () => {
  const client = createFakeClient({
    usage: { last_minute: 6, today: 300, this_month: 900 },
    notifications: [notification(1, 'Flume Smart Leak Alert')],
  });
  const { monitor, ids } = setup({ client });
  await monitor.refresh();
  const refreshNow = SCENE_ACTIONS[SCENE_ACTION_KEYS.REFRESH];
  const outputs = await refreshNow(monitor, {});
  assert.deepEqual(outputs, {
    leak: true,
    // 6 L in the last minute: running, even on the first reading (only the
    // trigger waits for a change).
    water_running: true,
    liters_last_minute: 6,
    liters_today: 300,
  });
  assert.equal((await refreshNow(monitor, { device: ids.device })).leak, true);
  await assert.rejects(refreshNow(monitor, { device: 'ext:test-integration:sensor:x' }), /Unknown/);
});
