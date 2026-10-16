// A stand-in for FlumeClient: the same methods, answering from plain data the
// test edits, and recording the calls. No network.

import { FlumeError } from '../../src/flume/client.js';

export const SENSOR_ID = '6248148189204194987';
export const BRIDGE_ID = '6248148189204155555';

export function flumeDevices({
  sensorConnected = true,
  bridgeConnected = true,
  battery = 'high',
} = {}) {
  return [
    { id: BRIDGE_ID, type: 1, connected: bridgeConnected, product: 'flume2' },
    {
      id: SENSOR_ID,
      type: 2,
      bridge_id: BRIDGE_ID,
      connected: sensorConnected,
      battery_level: battery,
      location: { name: 'Home', tz: 'Europe/Paris' },
    },
  ];
}

export function notification(id, rule, { deviceId = SENSOR_ID, title = rule } = {}) {
  return {
    id,
    device_id: deviceId,
    title,
    message: `${rule} on your meter`,
    read: false,
    created_datetime: '2026-10-16 08:00:00',
    extra: { event_rule_name: rule },
  };
}

export function createFakeClient({
  devices = flumeDevices(),
  notifications = [],
  usage = { last_minute: 0, today: 120, this_month: 3400 },
} = {}) {
  const client = {
    devices,
    notifications,
    usage,
    // Set to a FlumeError to make the next calls fail.
    failure: null,
    calls: [],
    userId: '12345',
    credentials: null,
    setCredentials(credentials) {
      client.credentials = credentials;
    },
    async getDevices() {
      client.calls.push('devices');
      if (client.failure) throw client.failure;
      return client.devices;
    },
    async getUnreadNotifications() {
      client.calls.push('notifications');
      if (client.failure) throw client.failure;
      return client.notifications;
    },
    async queryUsage(deviceId, queries) {
      client.calls.push(`query:${deviceId}:${queries.map((q) => q.request_id).join(',')}`);
      if (client.failure) throw client.failure;
      return Object.fromEntries(
        queries
          .filter((query) => client.usage[query.request_id] !== undefined)
          .map((query) => [
            query.request_id,
            [{ datetime: query.since_datetime, value: client.usage[query.request_id] }],
          ]),
      );
    },
  };
  return client;
}

export const networkError = () =>
  new FlumeError('Flume cloud unreachable (ECONNREFUSED).', { kind: 'network' });
export const rateLimitError = () =>
  new FlumeError('Flume request limit reached.', { status: 429, kind: 'rate_limit' });

// A configuration with the four credentials filled in.
export const CONFIGURED = {
  username: 'me@example.com',
  password: 'hunter2',
  client_id: 'client',
  client_secret: 'secret',
};
