// -----------------------------------------------------------------------------
// Flume alerts.
//
// Flume reports its alerts as notifications (GET /users/{id}/notifications):
// a smart leak, a high flow, a low battery, a bridge gone offline. An alert
// stands while its notification is unread — the user clears it by opening it
// in the Flume app — which is how the leak feature goes back to 0. The kind
// of alert is the name of the Flume rule that raised it
// (`extra.event_rule_name`), with the title as a fallback.
// -----------------------------------------------------------------------------

export const ALERT_KINDS = {
  LEAK: 'leak',
  HIGH_FLOW: 'high_flow',
  LOW_BATTERY: 'low_battery',
  BRIDGE_OFFLINE: 'bridge_offline',
  OTHER: 'other',
};

// Checked in this order: "High Flow Leak" is a high flow before being a leak.
const KIND_PATTERNS = [
  [ALERT_KINDS.HIGH_FLOW, /high\s*flow/i],
  [ALERT_KINDS.LEAK, /leak/i],
  [ALERT_KINDS.LOW_BATTERY, /battery/i],
  [ALERT_KINDS.BRIDGE_OFFLINE, /bridge|disconnect|offline/i],
];

/** The kind of one Flume notification, one of ALERT_KINDS. */
export function alertKind(notification) {
  const rule = notification?.extra?.event_rule_name;
  const label = [rule, notification?.title].filter((part) => typeof part === 'string').join(' ');
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(label)) {
      return kind;
    }
  }
  return ALERT_KINDS.OTHER;
}

/** A notification reduced to what Gladys shows and fires. */
export function describeAlert(notification) {
  return {
    id: String(notification.id),
    deviceId: notification.device_id === undefined ? null : String(notification.device_id),
    kind: alertKind(notification),
    title: String(notification.title ?? notification.extra?.event_rule_name ?? '').slice(0, 200),
    message: String(notification.message ?? '').slice(0, 1000),
    createdAt: notification.created_datetime ?? null,
  };
}

/**
 * The standing alerts of each sensor.
 * @param {object[]} notifications the unread notifications
 * @returns {Map<string, ReturnType<typeof describeAlert>[]>} by Flume device id, newest first
 */
export function alertsByDevice(notifications) {
  const byDevice = new Map();
  for (const notification of notifications) {
    const alert = describeAlert(notification);
    if (alert.deviceId === null) {
      continue;
    }
    if (!byDevice.has(alert.deviceId)) {
      byDevice.set(alert.deviceId, []);
    }
    byDevice.get(alert.deviceId).push(alert);
  }
  return byDevice;
}

// Enough to cover the 50 notifications a fetch returns many times over.
const MAX_REMEMBERED = 500;

/**
 * Tells which notifications are new since the last fetch, so each alert
 * fires its scene trigger once. The first fetch only learns what already
 * stands: a restart of the integration must not replay last week's leak.
 */
export class AlertTracker {
  constructor() {
    this.seen = new Set();
    this.primed = false;
  }

  /** @returns {ReturnType<typeof describeAlert>[]} the alerts never seen before, oldest first */
  takeNew(notifications) {
    const alerts = notifications.map(describeAlert);
    const fresh = this.primed ? alerts.filter((alert) => !this.seen.has(alert.id)) : [];
    for (const alert of alerts) {
      this.seen.add(alert.id);
    }
    // A Set iterates in insertion order: drop the oldest ids first.
    for (const id of this.seen) {
      if (this.seen.size <= MAX_REMEMBERED) {
        break;
      }
      this.seen.delete(id);
    }
    this.primed = true;
    return fresh.reverse();
  }

  reset() {
    this.seen.clear();
    this.primed = false;
  }
}
