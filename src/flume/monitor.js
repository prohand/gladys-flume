// -----------------------------------------------------------------------------
// The refresh loop: Flume → Gladys.
//
// Flume pushes nothing to third parties, and answers about 120 requests per
// hour and per account. So the integration runs ONE timer of its own (never a
// Gladys poll per device) and spends its budget this way:
//   - every `poll_frequency` seconds, one usage query per sensor (last
//     minute, today and this month in a single request);
//   - every INVENTORY_SECONDS, the device list (connectivity, battery) and
//     the unread notifications (the standing alerts).
//
// What it publishes:
//   - the discovered sensors, when the list changes;
//   - the feature states, through publishChangedStates (unchanged values are
//     not re-sent, except a heartbeat every 30 minutes);
//   - the transport badge of each sensor: `cloud`, or `unreachable` when the
//     sensor, its bridge or the Flume cloud is out of reach;
//   - the scene triggers: a new Flume alert, water starting or stopping;
//   - the connection status shown on the Configuration screen.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { credentialsOf, isConfigured } from '../config.js';
import { localize, pick } from '../i18n.js';
import { buildSensorDevice, FEATURES, flumeIdOf, sensorIds } from '../devices/sensor.js';
import { AlertTracker, ALERT_KINDS, alertsByDevice } from './alerts.js';
import { FLUME_DEVICE_TYPES, FlumeError } from './client.js';
import { safeTimeZone, USAGE_PERIODS, usageQuery, volumeOf } from './time.js';

const logger = createLogger({ name: 'flume' });

// Scene trigger keys, as declared in the manifest `scene_triggers`. Users
// store them in their scenes: never rename them.
export const SCENE_TRIGGERS = {
  ALERT: 'alert_received',
  WATER_FLOW: 'water_flow_changed',
};

// Device list and alerts: every five minutes, or at the usage pace when the
// user asked for a slower one.
export const INVENTORY_SECONDS = 300;

// After a 429, wait this long: Flume counts the requests over an hour.
const RATE_LIMIT_PAUSE_SECONDS = 600;

// An unchanged value is re-sent this often, so it stays recently dated in
// Gladys (the "last seen" of the device).
const HEARTBEAT_MS = 30 * 60 * 1000;

// The periods every refresh publishes, with the feature each one feeds.
const PUBLISHED_PERIODS = [
  [USAGE_PERIODS.LAST_MINUTE, FEATURES.LAST_MINUTE],
  [USAGE_PERIODS.TODAY, FEATURES.TODAY],
  [USAGE_PERIODS.THIS_MONTH, FEATURES.MONTH],
];

const TEXTS = {
  unconfigured: {
    en: 'Fill in your Flume e-mail, password, client ID and client secret.',
    fr: 'Renseignez votre e-mail Flume, votre mot de passe, le client ID et le client secret.',
    de: 'Trage deine Flume-E-Mail, dein Passwort, die Client-ID und das Client-Secret ein.',
    es: 'Indique su correo de Flume, su contraseña, el client ID y el client secret.',
  },
  auth: {
    en: 'Flume refused the login: check the e-mail, the password and the API client',
    fr: 'Flume a refusé la connexion : vérifiez l’e-mail, le mot de passe et le client API',
    de: 'Flume hat die Anmeldung abgelehnt: Prüfe E-Mail, Passwort und API-Client',
    es: 'Flume rechazó el inicio de sesión: compruebe el correo, la contraseña y el cliente API',
  },
  rateLimit: {
    en: 'Flume request limit reached: the integration pauses for 10 minutes. Raise the refresh interval if it happens again.',
    fr: 'Limite de requêtes Flume atteinte : l’intégration fait une pause de 10 minutes. Augmentez l’intervalle de rafraîchissement si cela se reproduit.',
    de: 'Flume-Anfragelimit erreicht: Die Integration pausiert 10 Minuten. Erhöhe das Aktualisierungsintervall, wenn das wieder passiert.',
    es: 'Límite de peticiones de Flume alcanzado: la integración se detiene 10 minutos. Aumente el intervalo de actualización si vuelve a ocurrir.',
  },
  network: {
    en: 'Flume cloud unreachable, new try at the next refresh',
    fr: 'Cloud Flume injoignable, nouvel essai au prochain rafraîchissement',
    de: 'Flume-Cloud nicht erreichbar, neuer Versuch bei der nächsten Aktualisierung',
    es: 'Nube de Flume inaccesible, nuevo intento en la próxima actualización',
  },
  api: {
    en: 'Flume error',
    fr: 'Erreur Flume',
    de: 'Flume-Fehler',
    es: 'Error de Flume',
  },
  sensorOffline: {
    en: 'The Flume sensor is offline (battery or radio range).',
    fr: 'Le capteur Flume est hors ligne (pile ou portée radio).',
    de: 'Der Flume-Sensor ist offline (Batterie oder Funkreichweite).',
    es: 'El sensor Flume está desconectado (pilas o alcance de radio).',
  },
  bridgeOffline: {
    en: 'The Flume bridge is offline (power or Wi-Fi).',
    fr: 'Le pont Flume est hors ligne (alimentation ou Wi-Fi).',
    de: 'Die Flume-Bridge ist offline (Strom oder WLAN).',
    es: 'El puente Flume está desconectado (alimentación o Wi-Fi).',
  },
  cloudOffline: {
    en: 'The Flume cloud cannot be reached.',
    fr: 'Le cloud Flume est injoignable.',
    de: 'Die Flume-Cloud ist nicht erreichbar.',
    es: 'No se puede acceder a la nube de Flume.',
  },
};

/** The multi-language message of an error, for the Configuration screen. */
export function errorMessage(err) {
  if (err instanceof FlumeError) {
    if (err.kind === 'auth') {
      return localize((lang) => `${pick(lang, TEXTS.auth)} (${err.message})`);
    }
    if (err.kind === 'rate_limit') {
      return TEXTS.rateLimit;
    }
    if (err.kind === 'network') {
      return localize((lang) => `${pick(lang, TEXTS.network)} (${err.message})`);
    }
  }
  return localize((lang) => `${pick(lang, TEXTS.api)}: ${err?.message ?? err}`);
}

/** The status of the Flume link, as the widget and the test action read it. */
export const LINK_STATES = {
  UNCONFIGURED: 'unconfigured',
  CONNECTING: 'connecting',
  OK: 'ok',
  ERROR: 'error',
};

function sameMessage(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export class FlumeMonitor {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./client.js').FlumeClient} options.client
   * @param {() => void} [options.onChange] called when what the widget shows changed
   * @param {() => Date} [options.now]
   * @param {typeof setTimeout} [options.setTimer]
   * @param {typeof clearTimeout} [options.clearTimer]
   */
  constructor({
    gladys,
    client,
    onChange = () => {},
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.gladys = gladys;
    this.client = client;
    this.onChange = onChange;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.config = null;
    this.timer = null;
    this.running = false;
    this.inFlight = null;
    this.alertTracker = new AlertTracker();
    this.reset();
  }

  /** Forget everything learnt from the account (another account was configured). */
  reset() {
    // Flume sensor id → what is known of it.
    this.sensors = new Map();
    this.publishedIds = null;
    this.inventoryAt = 0;
    this.pausedUntil = 0;
    this.link = { state: LINK_STATES.UNCONFIGURED, error: null, refreshedAt: null };
    this.reportedStatus = null;
    this.alertTracker.reset();
  }

  /** Apply a configuration: credentials, refresh pace, flow threshold. */
  configure(config) {
    const previous = this.config;
    this.config = config;
    if (!isConfigured(config)) {
      return;
    }
    const credentials = credentialsOf(config);
    if (previous && JSON.stringify(credentialsOf(previous)) !== JSON.stringify(credentials)) {
      this.reset();
    }
    this.client.setCredentials(credentials);
  }

  /** (Re)start the timer with this configuration; the first refresh runs now. */
  async start(config) {
    this.stop();
    this.configure(config);
    this.running = true;
    if (!isConfigured(config)) {
      this.link = { state: LINK_STATES.UNCONFIGURED, error: null, refreshedAt: null };
      await this.reportStatus(false, TEXTS.unconfigured);
      this.onChange();
      return;
    }
    if (this.link.state === LINK_STATES.UNCONFIGURED) {
      this.link = { ...this.link, state: LINK_STATES.CONNECTING };
    }
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  schedule(delayMs) {
    if (!this.running) {
      return;
    }
    if (this.timer) {
      this.clearTimer(this.timer);
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.tick();
    }, delayMs);
  }

  /** One timer round: refresh, then plan the next one. Never throws. */
  async tick() {
    try {
      await this.refresh();
    } catch {
      // Already logged and reported by refresh().
    }
    const pausedFor = this.pausedUntil - this.now().getTime();
    const pace = this.config.poll_frequency * 1000;
    this.schedule(Math.max(pace, pausedFor));
  }

  /**
   * Read Flume and publish to Gladys. Concurrent calls (timer, widget button,
   * scene action) share the same round instead of doubling the requests.
   * @param {{ inventory?: boolean }} [options] inventory: also re-read the
   *   device list and the alerts, even when not due
   */
  refresh({ inventory = false } = {}) {
    if (!this.inFlight) {
      this.inFlight = this.runRefresh({ inventory }).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  async runRefresh({ inventory }) {
    if (!isConfigured(this.config ?? {})) {
      throw new FlumeError(pick('en', TEXTS.unconfigured), { kind: 'auth' });
    }
    const nowMs = this.now().getTime();
    if (this.pausedUntil > nowMs) {
      throw new FlumeError('Flume request limit reached, the integration slows down.', {
        status: 429,
        kind: 'rate_limit',
      });
    }
    const inventoryPace = Math.max(INVENTORY_SECONDS, this.config.poll_frequency) * 1000;
    try {
      if (inventory || this.sensors.size === 0 || nowMs - this.inventoryAt >= inventoryPace) {
        await this.refreshInventory();
      }
      await this.refreshUsage();
      this.link = { state: LINK_STATES.OK, error: null, refreshedAt: this.now() };
      await this.reportStatus(true);
    } catch (err) {
      await this.handleFailure(err);
      throw err;
    }
  }

  async handleFailure(err) {
    logger.warn(`Flume refresh failed: ${err.message}`);
    const wasOk = this.link.state === LINK_STATES.OK;
    this.link = { ...this.link, state: LINK_STATES.ERROR, error: err };
    if (err instanceof FlumeError && err.kind === 'rate_limit') {
      this.pausedUntil = this.now().getTime() + RATE_LIMIT_PAUSE_SECONDS * 1000;
    }
    // Without the cloud nothing is known of the sensors: say so on their
    // badges rather than leaving them looking fine.
    if (err instanceof FlumeError && (err.kind === 'network' || err.kind === 'auth')) {
      await this.publishTransports(() => DEVICE_TRANSPORTS.UNREACHABLE);
    }
    await this.reportStatus(false, errorMessage(err));
    if (wasOk) {
      this.onChange();
    }
  }

  /** Device list + unread notifications. */
  async refreshInventory() {
    const devices = await this.client.getDevices();
    const bridges = new Map(
      devices
        .filter((device) => Number(device.type) === FLUME_DEVICE_TYPES.BRIDGE)
        .map((bridge) => [String(bridge.id), bridge]),
    );
    const sensors = devices.filter((device) => Number(device.type) === FLUME_DEVICE_TYPES.SENSOR);

    let notifications = null;
    try {
      notifications = await this.client.getUnreadNotifications();
    } catch (err) {
      // The alerts are a bonus on top of the readings: keep the ones known.
      if (err instanceof FlumeError && err.kind !== 'api') {
        throw err;
      }
      logger.warn(`Flume alerts not read: ${err.message}`);
    }
    const alerts = notifications ? alertsByDevice(notifications) : null;

    const next = new Map();
    for (const sensor of sensors) {
      const id = String(sensor.id);
      const known = this.sensors.get(id);
      const standing = alerts ? (alerts.get(id) ?? []) : (known?.alerts ?? []);
      next.set(id, {
        id,
        sensor,
        bridge: bridges.get(String(sensor.bridge_id)) ?? null,
        timeZone: safeTimeZone(sensor.location?.tz),
        alerts: standing,
        usage: known?.usage ?? {},
        flowing: known?.flowing ?? null,
        updatedAt: known?.updatedAt ?? null,
      });
    }
    this.sensors = next;
    this.inventoryAt = this.now().getTime();

    await this.publishDiscovered();
    await this.publishTransports((state) => this.transportOf(state));
    await this.publishAlertStates();
    if (notifications) {
      await this.fireNewAlerts(notifications);
    }
    this.onChange();
  }

  /** Publish the discovered sensors when the list changed (or never was). */
  async publishDiscovered({ force = false } = {}) {
    const ids = [...this.sensors.keys()].sort().join(',');
    if (!force && ids === this.publishedIds) {
      return;
    }
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
    this.publishedIds = ids;
  }

  discoveredDevices() {
    return [...this.sensors.values()].map((state) => buildSensorDevice(this.gladys, state.sensor));
  }

  /**
   * Why a sensor cannot be read right now, or null when it can. The badge
   * only says `unreachable` (a message is reserved to the degraded state);
   * the widget and the test action give this reason.
   */
  offlineReason(state) {
    if (
      this.link.state === LINK_STATES.ERROR &&
      ['network', 'auth'].includes(this.link.error?.kind)
    ) {
      return TEXTS.cloudOffline;
    }
    if (state.sensor.connected === false) {
      return TEXTS.sensorOffline;
    }
    if (state.bridge?.connected === false) {
      return TEXTS.bridgeOffline;
    }
    return null;
  }

  /** The badge of one sensor: cloud, or unreachable when it is offline. */
  transportOf(state) {
    return state.sensor.connected === false || state.bridge?.connected === false
      ? DEVICE_TRANSPORTS.UNREACHABLE
      : DEVICE_TRANSPORTS.CLOUD;
  }

  async publishTransports(transportOf) {
    const entries = [...this.sensors.values()].map((state) => ({
      external_id: sensorIds(this.gladys, state.id).device,
      transport: transportOf(state),
    }));
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
    } catch (err) {
      logger.warn(`Transport badges not published: ${err.message}`);
    }
  }

  static isLeaking(state) {
    return state.alerts.some((alert) => alert.kind === ALERT_KINDS.LEAK);
  }

  static isBatteryLow(state) {
    return (
      String(state.sensor.battery_level ?? '').toLowerCase() === 'low' ||
      state.alerts.some((alert) => alert.kind === ALERT_KINDS.LOW_BATTERY)
    );
  }

  async publishAlertStates() {
    const states = [...this.sensors.values()].flatMap((state) => {
      const ids = sensorIds(this.gladys, state.id);
      return [
        {
          device_feature_external_id: ids.feature(FEATURES.LEAK),
          state: FlumeMonitor.isLeaking(state) ? 1 : 0,
        },
        {
          device_feature_external_id: ids.feature(FEATURES.BATTERY_LOW),
          state: FlumeMonitor.isBatteryLow(state) ? 1 : 0,
        },
      ];
    });
    await this.publishStates(states);
  }

  async publishStates(states) {
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT_MS });
    } catch (err) {
      // A sensor not created in Gladys yet, a 429 of the host API: the next
      // refresh publishes again, the Flume readings are not lost.
      logger.warn(`States not published: ${err.message}`);
    }
  }

  async fireNewAlerts(notifications) {
    for (const alert of this.alertTracker.takeNew(notifications)) {
      if (!this.sensors.has(alert.deviceId)) {
        continue;
      }
      logger.info(`New Flume alert on ${alert.deviceId}: ${alert.kind} (${alert.title})`);
      await this.fireTrigger(SCENE_TRIGGERS.ALERT, {
        device: sensorIds(this.gladys, alert.deviceId).device,
        alert: alert.kind,
        title: alert.title,
        message: alert.message,
      });
    }
  }

  async fireTrigger(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene trigger ${key} not fired: ${err.message}`);
    }
  }

  /** One usage request per sensor: last minute, today, this month. */
  async refreshUsage() {
    for (const state of this.sensors.values()) {
      try {
        await this.refreshSensorUsage(state);
      } catch (err) {
        // One sensor answered badly: the others still get their readings.
        if (err instanceof FlumeError && err.kind !== 'api') {
          throw err;
        }
        logger.warn(`Usage of sensor ${state.id} not read: ${err.message}`);
      }
    }
  }

  async refreshSensorUsage(state) {
    const now = this.now();
    const queries = PUBLISHED_PERIODS.map(([period]) => usageQuery(period, now, state.timeZone));
    const result = await this.client.queryUsage(state.id, queries);
    const ids = sensorIds(this.gladys, state.id);
    const states = [];
    for (const [period, feature] of PUBLISHED_PERIODS) {
      const liters = volumeOf(period, result[period]);
      if (liters === null) {
        continue;
      }
      state.usage[period] = liters;
      states.push({ device_feature_external_id: ids.feature(feature), state: liters });
    }
    state.updatedAt = now;
    await this.publishStates(states);
    await this.detectFlow(state, state.usage[USAGE_PERIODS.LAST_MINUTE]);
  }

  /** Fire `water_flow_changed` when the water starts or stops running. */
  async detectFlow(state, lastMinute) {
    if (lastMinute === undefined || lastMinute === null) {
      return;
    }
    const flowing = lastMinute > 0 && lastMinute >= this.config.flow_threshold;
    const previous = state.flowing;
    state.flowing = flowing;
    // The first reading only sets the baseline: water already running when
    // the integration starts did not just start.
    if (previous === null || previous === flowing) {
      return;
    }
    await this.fireTrigger(SCENE_TRIGGERS.WATER_FLOW, {
      device: sensorIds(this.gladys, state.id).device,
      state: flowing ? 'started' : 'stopped',
      liters: lastMinute,
    });
    this.onChange();
  }

  /** Tell the Configuration screen, only when the status changes. */
  async reportStatus(connected, message) {
    const key = { connected, message: message ?? null };
    if (
      this.reportedStatus &&
      this.reportedStatus.connected === connected &&
      sameMessage(this.reportedStatus.message, key.message)
    ) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.reportedStatus = key;
    } catch (err) {
      logger.warn(`Connection status not reported: ${err.message}`);
    }
  }

  /** The state of one sensor, from a Gladys device external id (or the first one). */
  sensorState(deviceExternalId) {
    if (deviceExternalId) {
      return this.sensors.get(flumeIdOf(this.gladys, deviceExternalId)) ?? null;
    }
    return this.sensors.values().next().value ?? null;
  }

  /**
   * The volume of one period on one sensor, read from Flume now.
   * @returns {Promise<number>} litres (0 when Flume has no reading)
   */
  async usageOf(deviceExternalId, period) {
    const state = this.sensorState(deviceExternalId);
    if (!state) {
      throw new Error(`Unknown Flume sensor: ${deviceExternalId}`);
    }
    const query = usageQuery(period, this.now(), state.timeZone);
    const result = await this.client.queryUsage(state.id, [query]);
    return volumeOf(period, result[period]) ?? 0;
  }
}
