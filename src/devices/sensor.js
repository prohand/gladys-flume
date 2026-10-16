// -----------------------------------------------------------------------------
// Gladys device: one Flume water sensor.
//
// The sensor strapped on the water meter is the device; its bridge only
// relays it, so the bridge is not a Gladys device of its own: its state shows
// as the transport badge of the sensor (cloud, or unreachable when the bridge
// or the sensor is offline).
//
// Gladys has no flow-rate category: the flow is published as the litres used
// during the last complete minute, which reads as litres per minute.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Namespace of the external ids: `ext:<selector>:sensor:<flume id>`.
const DEVICE_TYPE = 'sensor';

// Feature keys: part of the external ids, never rename them.
export const FEATURES = {
  LAST_MINUTE: 'last-minute',
  TODAY: 'today',
  MONTH: 'month',
  LEAK: 'leak',
  BATTERY_LOW: 'battery-low',
};

export function sensorIds(gladys, flumeId) {
  return gladys.externalIds(DEVICE_TYPE, String(flumeId));
}

/** The Flume id of a sensor device external id, or null for any other id. */
export function flumeIdOf(gladys, externalId) {
  const prefix = `${gladys.externalId(DEVICE_TYPE)}:`;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** The name Gladys proposes; the user can rename the device when creating it. */
export function sensorName(sensor) {
  const location = sensor.location?.name;
  return typeof location === 'string' && location.trim()
    ? `Flume ${location.trim()}`
    : `Flume ${sensor.id}`;
}

/**
 * The discovery payload of one sensor.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} sensor a Flume device of type SENSOR
 */
export function buildSensorDevice(gladys, sensor) {
  const ids = sensorIds(gladys, sensor.id);
  const volume = (key, name, max) => ({
    name,
    external_id: ids.feature(key),
    category: DEVICE_FEATURE_CATEGORIES.VOLUME_SENSOR,
    type: DEVICE_FEATURE_TYPES.VOLUME_SENSOR.DECIMAL,
    unit: DEVICE_FEATURE_UNITS.LITER,
    min: 0,
    max,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  const binary = (key, name, category) => ({
    name,
    external_id: ids.feature(key),
    category,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  return {
    name: sensorName(sensor),
    external_id: ids.device,
    // Readings arrive on the integration's own timer (Flume limits the
    // requests per hour), never on a Gladys poll.
    should_poll: false,
    features: [
      volume(FEATURES.LAST_MINUTE, 'Water flow (last minute)', 1000),
      volume(FEATURES.TODAY, 'Water used today', 100000),
      volume(FEATURES.MONTH, 'Water used this month', 10000000),
      binary(FEATURES.LEAK, 'Leak', DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR),
      binary(FEATURES.BATTERY_LOW, 'Low battery', DEVICE_FEATURE_CATEGORIES.BATTERY_LOW),
    ],
  };
}
