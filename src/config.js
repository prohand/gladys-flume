// -----------------------------------------------------------------------------
// Integration configuration.
//
// The user fills it in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. The SDK fetches it (`getConfig()`) and
// notifies every change (`onConfigUpdated()`). This module only provides the
// defaults and normalizes the received object, so the rest of the code never
// deals with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

// The defaults MUST stay equal to the `default` values of the manifest
// `config_schema` (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // Flume account (the e-mail and password of the Flume app).
  username: '',
  password: '',
  // Personal API client, generated on portal.flumewater.com (Settings → API
  // Access). Flume gives one to every account; it is not shared with Gladys.
  client_id: '',
  client_secret: '',
  // Seconds between two reads of the water usage. Flume answers about 120
  // requests per hour and per account: see MIN_POLL_SECONDS.
  poll_frequency: 120,
  // Litres in the last minute from which the water is "running" (the
  // `water_flow_changed` trigger). Below it, a dripping tap is not a flow.
  flow_threshold: 0.5,
};

// Flume's documented budget is about 120 requests per hour and per account.
// A refresh costs one request per sensor, plus the device list and the
// alerts every INVENTORY_SECONDS: a minute is the fastest pace that keeps a
// two-sensor home under the budget.
export const MIN_POLL_SECONDS = 60;
export const MAX_POLL_SECONDS = 3600;

const MAX_FLOW_THRESHOLD = 100;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    username: text(raw.username),
    // A password may legitimately start or end with a space: kept as typed.
    password: typeof raw.password === 'string' ? raw.password : '',
    client_id: text(raw.client_id),
    client_secret: text(raw.client_secret),
    poll_frequency: boundedNumber(
      raw.poll_frequency,
      DEFAULT_CONFIG.poll_frequency,
      MIN_POLL_SECONDS,
      MAX_POLL_SECONDS,
    ),
    flow_threshold: boundedNumber(
      raw.flow_threshold,
      DEFAULT_CONFIG.flow_threshold,
      0,
      MAX_FLOW_THRESHOLD,
    ),
  };
}

/** The four credentials Flume needs, without which nothing can be read. */
export function isConfigured(config) {
  return Boolean(config.username && config.password && config.client_id && config.client_secret);
}

/** The credentials, as the Flume client takes them. */
export function credentialsOf(config) {
  return {
    username: config.username,
    password: config.password,
    clientId: config.client_id,
    clientSecret: config.client_secret,
  };
}
