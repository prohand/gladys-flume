// -----------------------------------------------------------------------------
// Entry point of the Flume integration for Gladys Assistant.
//
// This file only wires the SDK: it holds no Flume logic.
//   1. instantiates the SDK (connection, auth, reconnection: handled by it);
//   2. registers the handlers BEFORE connect();
//   3. connects, then starts the refresh loop (src/flume/monitor.js).
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './src/config.js';
import { FlumeClient } from './src/flume/client.js';
import { FlumeMonitor } from './src/flume/monitor.js';
import { testConnection } from './src/flume/connection.js';
import { SCENE_ACTIONS } from './src/capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './src/capabilities/widget.js';

const gladys = new GladysIntegration();

let config = normalizeConfig();

const monitor = new FlumeMonitor({
  gladys,
  client: new FlumeClient(),
  // The widget's status rows (alerts, connectivity, water running) changed:
  // nudge open dashboards instead of waiting for the content TTL.
  onChange: () => refreshWidgets(gladys),
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing the Flume sensors');
  if (isConfigured(config)) {
    await monitor.refresh({ inventory: true }).catch(() => {});
  }
  await gladys.publishDiscoveredDevices(monitor.discoveredDevices());
});

// --- Manifest actions: buttons in the Configuration screen -------------------
gladys.onAction('test_connection', () => testConnection(monitor));

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// The scene triggers need no handler: the monitor fires them.
for (const [actionKey, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(actionKey, (fields) => handler(monitor, fields));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const [widgetKey, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(widgetKey, (request) => widget.get(monitor, request));
  gladys.onWidgetAction(widgetKey, (actionKey, params, { settings }) =>
    widget.action(monitor, { actionKey, params, settings }),
  );
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  await monitor.start(config);
  refreshWidgets(gladys);
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name).
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    // The first refresh runs right away and publishes the sensors, their
    // states, their badges and the connection status.
    await monitor.start(config);
    // The nudges sent while the socket was down were dropped.
    refreshWidgets(gladys);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, sieh dir die Protokolle der Integration an.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  // Nothing read from Flume could reach Gladys anyway: save the request
  // budget until the socket is back.
  monitor.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  monitor.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Flume integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
