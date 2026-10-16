// -----------------------------------------------------------------------------
// "Test the connection" (manifest action `test_connection`).
//
// Logs in, reads the devices, the alerts and the usage right away, and answers
// what was found, sensor by sensor, in the reader's language.
// -----------------------------------------------------------------------------

import { isConfigured } from '../config.js';
import { sensorName } from '../devices/sensor.js';
import { localize, pick } from '../i18n.js';
import { errorMessage, FlumeMonitor } from './monitor.js';
import { USAGE_PERIODS } from './time.js';

const T = {
  unconfigured: {
    en: 'Fill in the four Flume fields (e-mail, password, client ID, client secret), save, then test again.',
    fr: 'Renseignez les quatre champs Flume (e-mail, mot de passe, client ID, client secret), enregistrez, puis testez à nouveau.',
    de: 'Fülle die vier Flume-Felder aus (E-Mail, Passwort, Client-ID, Client-Secret), speichere und teste dann erneut.',
    es: 'Rellene los cuatro campos de Flume (correo, contraseña, client ID, client secret), guarde y vuelva a probar.',
  },
  connected: {
    en: 'Connected to Flume',
    fr: 'Connecté à Flume',
    de: 'Mit Flume verbunden',
    es: 'Conectado a Flume',
  },
  noSensor: {
    en: 'no sensor on this account: finish its setup in the Flume app.',
    fr: 'aucun capteur sur ce compte : terminez son installation dans l’application Flume.',
    de: 'kein Sensor in diesem Konto: Schließe seine Einrichtung in der Flume-App ab.',
    es: 'ningún sensor en esta cuenta: termine su instalación en la app Flume.',
  },
  sensors: { en: 'sensor(s)', fr: 'capteur(s)', de: 'Sensor(en)', es: 'sensor(es)' },
  today: { en: 'today', fr: 'aujourd’hui', de: 'heute', es: 'hoy' },
  leak: { en: 'LEAK', fr: 'FUITE', de: 'LECK', es: 'FUGA' },
  noLeak: { en: 'no leak', fr: 'pas de fuite', de: 'kein Leck', es: 'sin fugas' },
  batteryLow: { en: 'battery low', fr: 'pile faible', de: 'Batterie schwach', es: 'pilas bajas' },
  online: { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' },
  offline: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'desconectado' },
  failed: {
    en: 'Connection failed',
    fr: 'Échec de la connexion',
    de: 'Verbindung fehlgeschlagen',
    es: 'Conexión fallida',
  },
};

function formatLiters(liters, language) {
  const locale = { en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-US';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(liters ?? 0)} L`;
}

function sensorLine(monitor, state, language) {
  const parts = [
    `${pick(language, T.today)} ${formatLiters(state.usage[USAGE_PERIODS.TODAY], language)}`,
    FlumeMonitor.isLeaking(state) ? pick(language, T.leak) : pick(language, T.noLeak),
  ];
  if (FlumeMonitor.isBatteryLow(state)) {
    parts.push(pick(language, T.batteryLow));
  }
  parts.push(monitor.offlineReason(state) ? pick(language, T.offline) : pick(language, T.online));
  return `${sensorName(state.sensor)}: ${parts.join(', ')}`;
}

/**
 * Run the connection test. A failure is answered too, in the reader's
 * language, rather than thrown: Gladys would show a thrown message as is,
 * in one language only.
 * @param {import('./monitor.js').FlumeMonitor} monitor
 * @returns {Promise<Record<string, string>>} the report, one text per language
 */
export async function testConnection(monitor) {
  if (!isConfigured(monitor.config ?? {})) {
    return T.unconfigured;
  }
  try {
    await monitor.refresh({ inventory: true });
  } catch (err) {
    const reason = errorMessage(err);
    return localize((language) => `${pick(language, T.failed)}. ${pick(language, reason)}`);
  }
  const states = [...monitor.sensors.values()];
  return localize((language) => {
    const head = `${pick(language, T.connected)} (user ${monitor.client.userId})`;
    if (states.length === 0) {
      return `${head}: ${pick(language, T.noSensor)}`;
    }
    const lines = states.map((state) => sensorLine(monitor, state, language));
    return `${head}, ${states.length} ${pick(language, T.sensors)}. ${lines.join(' — ')}`;
  });
}
