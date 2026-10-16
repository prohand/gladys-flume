// -----------------------------------------------------------------------------
// Dashboard widget "Flume water" (manifest `widgets`, Gladys 5.1+).
//
// Live tiles bound to the sensor features (they follow the published states,
// nothing to refresh), the flow of the last 24 hours, the status the features
// cannot carry (alerts, connectivity, last reading) and a "Refresh" button.
// The content is declarative: the core renders it with its own theme, dark
// mode and translations.
// -----------------------------------------------------------------------------

import {
  createLogger,
  WIDGET_CHART_INTERVALS,
  WIDGET_CHART_TYPES,
  WIDGET_COLORS,
} from '@gladysassistant/integration-sdk';
import { sensorIds, FEATURES } from '../devices/sensor.js';
import { FlumeMonitor, LINK_STATES, errorMessage } from '../flume/monitor.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

// Widget key, as declared in the manifest: never rename it.
export const WATER_WIDGET = 'water';

// Keys of the `button` actions the content declares.
const ACTIONS = { REFRESH: 'refresh' };

const T = {
  lastMinute: {
    en: 'Last minute',
    fr: 'Dernière minute',
    de: 'Letzte Minute',
    es: 'Último minuto',
  },
  today: { en: 'Today', fr: 'Aujourd’hui', de: 'Heute', es: 'Hoy' },
  month: { en: 'This month', fr: 'Ce mois-ci', de: 'Diesen Monat', es: 'Este mes' },
  chart: {
    en: 'Water flow, last 24 h',
    fr: 'Débit d’eau, dernières 24 h',
    de: 'Wasserdurchfluss, letzte 24 h',
    es: 'Caudal de agua, últimas 24 h',
  },
  leak: { en: 'Leak', fr: 'Fuite', de: 'Leck', es: 'Fuga' },
  noLeak: { en: 'None', fr: 'Aucune', de: 'Keines', es: 'Ninguna' },
  leakDetected: {
    en: 'Leak detected',
    fr: 'Fuite détectée',
    de: 'Leck erkannt',
    es: 'Fuga detectada',
  },
  water: { en: 'Water', fr: 'Eau', de: 'Wasser', es: 'Agua' },
  running: { en: 'Running', fr: 'Coule', de: 'Läuft', es: 'Corriendo' },
  stopped: { en: 'Not running', fr: 'Ne coule pas', de: 'Läuft nicht', es: 'No corre' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  battery: { en: 'Battery', fr: 'Pile', de: 'Batterie', es: 'Pilas' },
  batteryOk: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  batteryLow: { en: 'Low', fr: 'Faible', de: 'Schwach', es: 'Baja' },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  online: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
  offline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Desconectado' },
  lastAlert: {
    en: 'Latest alert',
    fr: 'Dernière alerte',
    de: 'Letzter Alarm',
    es: 'Última alerta',
  },
  none: { en: 'None', fr: 'Aucune', de: 'Keiner', es: 'Ninguna' },
  lastReading: {
    en: 'Last reading',
    fr: 'Dernière lecture',
    de: 'Letzte Messung',
    es: 'Última lectura',
  },
  never: { en: 'Not yet', fr: 'Pas encore', de: 'Noch nicht', es: 'Aún no' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Flume readings refreshed.',
    fr: 'Relevés Flume actualisés.',
    de: 'Flume-Messwerte aktualisiert.',
    es: 'Lecturas de Flume actualizadas.',
  },
  unconfigured: {
    en: 'Fill in your Flume account and API client in the integration configuration.',
    fr: 'Renseignez votre compte Flume et votre client API dans la configuration de l’intégration.',
    de: 'Trage dein Flume-Konto und deinen API-Client in der Konfiguration der Integration ein.',
    es: 'Indique su cuenta de Flume y su cliente API en la configuración de la integración.',
  },
  noSensor: {
    en: 'No Flume sensor found yet on this account.',
    fr: 'Aucun capteur Flume trouvé pour l’instant sur ce compte.',
    de: 'Auf diesem Konto wurde noch kein Flume-Sensor gefunden.',
    es: 'Todavía no se ha encontrado ningún sensor Flume en esta cuenta.',
  },
};

const truncate = (value, max) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

// The hour of the last reading, in the viewer's language and the meter's time
// zone (the one the Flume app shows).
function formatTime(date, language, timeZone) {
  try {
    return new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function statusItems(monitor, state) {
  const leaking = FlumeMonitor.isLeaking(state);
  const batteryLow = FlumeMonitor.isBatteryLow(state);
  const offline = monitor.offlineReason(state);
  const latest = state.alerts[0];
  return [
    {
      label: T.leak,
      icon: 'droplet',
      value: leaking ? T.leakDetected : T.noLeak,
      color: leaking ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: T.water,
      icon: 'activity',
      value: state.flowing === null ? T.unknown : state.flowing ? T.running : T.stopped,
      color: state.flowing ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
    {
      label: T.battery,
      icon: 'battery',
      value: batteryLow ? T.batteryLow : T.batteryOk,
      color: batteryLow ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
    {
      label: T.connection,
      icon: 'wifi',
      value: offline ? T.offline : T.online,
      color: offline ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
    {
      label: T.lastAlert,
      icon: 'bell',
      value: latest?.title ? truncate(latest.title, 40) : T.none,
      color: latest ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];
}

/** The widget content for the sensor the widget instance chose (or the first one). */
export function buildWaterContent(monitor, { settings = {}, language = 'en' } = {}) {
  const state = monitor.sensorState(settings.device);
  if (!state) {
    const reason =
      monitor.link.state === LINK_STATES.UNCONFIGURED
        ? T.unconfigured
        : monitor.link.state === LINK_STATES.ERROR
          ? localize((lang) => truncate(pick(lang, errorMessage(monitor.link.error)), 300))
          : T.noSensor;
    return {
      ttl_seconds: 60,
      components: [{ type: 'text', variant: 'body', text: reason }],
    };
  }

  const ids = sensorIds(monitor.gladys, state.id);
  const offline = monitor.offlineReason(state);
  const components = [
    {
      type: 'value',
      label: T.lastMinute,
      icon: 'activity',
      device_feature: ids.feature(FEATURES.LAST_MINUTE),
    },
    { type: 'value', label: T.today, icon: 'droplet', device_feature: ids.feature(FEATURES.TODAY) },
    {
      type: 'value',
      label: T.month,
      icon: 'calendar',
      device_feature: ids.feature(FEATURES.MONTH),
    },
    {
      type: 'chart',
      title: T.chart,
      chart_type: WIDGET_CHART_TYPES.AREA,
      interval: WIDGET_CHART_INTERVALS.LAST_DAY,
      device_features: [ids.feature(FEATURES.LAST_MINUTE)],
    },
    { type: 'status', items: statusItems(monitor, state) },
  ];
  if (offline) {
    components.push({ type: 'text', variant: 'caption', text: offline });
  } else if (state.updatedAt) {
    const time = formatTime(state.updatedAt, language, state.timeZone);
    components.push({
      type: 'text',
      variant: 'caption',
      text: localize((lang) => `${pick(lang, T.lastReading)}: ${time}`),
    });
  } else {
    components.push({
      type: 'text',
      variant: 'caption',
      text: localize((lang) => `${pick(lang, T.lastReading)}: ${pick(lang, T.never)}`),
    });
  }
  components.push({
    type: 'button',
    label: T.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  return {
    // The tiles and the chart are live; the status rows change with the
    // readings, and the monitor nudges the widget when they do.
    ttl_seconds: 300,
    components,
  };
}

export const WIDGETS = {
  [WATER_WIDGET]: {
    async get(monitor, request) {
      logger.debug(`onWidgetGet <- ${WATER_WIDGET}`);
      return buildWaterContent(monitor, request);
    },

    // After a successful action the core drops the cached content and every
    // open dashboard refetches it: no nudge needed.
    async action(monitor, { actionKey }) {
      logger.info(`onWidgetAction <- ${WATER_WIDGET}.${actionKey}`);
      if (actionKey === ACTIONS.REFRESH) {
        await monitor.refresh({ inventory: true });
        return T.refreshed;
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Ask the core to re-pull every widget now (rate-limited core-side to 1 per
 * 10 s per widget, dropped while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
