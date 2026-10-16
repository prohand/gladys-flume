// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// `gladys.onSceneAction(key, cb)` receives the RESOLVED fields and returns the
// declared scalar `outputs`, which the following actions of the scene read as
// variables. A scene action is never a condition: the scene author gates on
// the outputs.
//
// The two triggers (`alert_received`, `water_flow_changed`) need no handler:
// src/flume/monitor.js fires them with publishSceneEvent.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { FlumeMonitor } from '../flume/monitor.js';
import { USAGE_PERIODS } from '../flume/time.js';

const logger = createLogger({ name: 'scenes' });

// Scene action keys, as declared in the manifest. Users store them in their
// scenes: never rename them.
export const SCENE_ACTION_KEYS = {
  GET_USAGE: 'get_usage',
  REFRESH: 'refresh_now',
};

// The periods `get_usage` offers (the manifest `period` options).
export const SCENE_PERIODS = [
  USAGE_PERIODS.LAST_HOUR,
  USAGE_PERIODS.TODAY,
  USAGE_PERIODS.LAST_24_HOURS,
  USAGE_PERIODS.THIS_WEEK,
  USAGE_PERIODS.THIS_MONTH,
];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Scene action handlers, keyed by manifest key.
 * Each one: (monitor, fields) => Promise<outputs>.
 */
export const SCENE_ACTIONS = {
  // The volume used over a period, read from Flume at that moment.
  async [SCENE_ACTION_KEYS.GET_USAGE](monitor, fields) {
    const period = SCENE_PERIODS.includes(fields.period) ? fields.period : USAGE_PERIODS.TODAY;
    logger.info(`Scene action get_usage <- ${fields.device} (${period})`);
    const liters = await monitor.usageOf(fields.device, period);
    return { liters: round(liters, 2), cubic_meters: round(liters / 1000, 3) };
  },

  // Read Flume now instead of waiting for the next refresh, and tell the
  // scene where things stand (one sensor, or all of them).
  async [SCENE_ACTION_KEYS.REFRESH](monitor, fields) {
    logger.info(`Scene action refresh_now <- ${fields.device ?? 'all sensors'}`);
    await monitor.refresh({ inventory: true });
    const states = fields.device
      ? [monitor.sensorState(fields.device)].filter(Boolean)
      : [...monitor.sensors.values()];
    if (fields.device && states.length === 0) {
      throw new Error(`Unknown Flume sensor: ${fields.device}`);
    }
    const sum = (period) =>
      round(
        states.reduce((total, state) => total + (state.usage[period] ?? 0), 0),
        2,
      );
    return {
      leak: states.some((state) => FlumeMonitor.isLeaking(state)),
      water_running: states.some((state) => state.flowing === true),
      liters_last_minute: sum(USAGE_PERIODS.LAST_MINUTE),
      liters_today: sum(USAGE_PERIODS.TODAY),
    };
  },
};
