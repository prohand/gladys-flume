import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { normalizeConfig } from '../src/config.js';
import { FlumeMonitor } from '../src/flume/monitor.js';
import { testConnection } from '../src/flume/connection.js';
import { LANGUAGES } from '../src/i18n.js';
import { CONFIGURED, createFakeClient, networkError, notification } from './helpers/fakeFlume.js';

function monitorWith(client, config = CONFIGURED) {
  const monitor = new FlumeMonitor({
    gladys: createFakeGladys(),
    client,
    setTimer: () => null,
    clearTimer: () => {},
  });
  monitor.configure(normalizeConfig(config));
  return monitor;
}

test('the report lists each sensor, in the four languages', async () => {
  const client = createFakeClient({ notifications: [notification(1, 'Flume Smart Leak Alert')] });
  const report = await testConnection(monitorWith(client));
  assert.deepEqual(Object.keys(report), LANGUAGES);
  assert.equal(
    report.en,
    'Connected to Flume (user 12345), 1 sensor(s). Flume Home: today 120 L, LEAK, online',
  );
  assert.match(report.fr, /^Connecté à Flume .* aujourd’hui 120 L, FUITE, en ligne$/);
  assert.match(report.de, /heute 120 L, LECK, online$/);
  assert.match(report.es, /hoy 120 L, FUGA, en línea$/);
});

test('an account without sensor says so', async () => {
  const report = await testConnection(monitorWith(createFakeClient({ devices: [] })));
  assert.match(report.en, /no sensor on this account/);
});

test('a failure is answered in the four languages, never thrown', async () => {
  const client = createFakeClient();
  client.failure = networkError();
  const report = await testConnection(monitorWith(client));
  assert.match(report.en, /^Connection failed\. Flume cloud unreachable/);
  assert.match(report.es, /^Conexión fallida\./);
});

test('missing credentials: what to fill in, no request', async () => {
  const client = createFakeClient();
  const report = await testConnection(monitorWith(client, {}));
  assert.match(report.de, /Fülle die vier Flume-Felder aus/);
  assert.equal(client.calls.length, 0);
});
