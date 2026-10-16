// -----------------------------------------------------------------------------
// Flume cloud API client (https://api.flumewater.com).
//
// Flume has no local API: the sensor talks to its bridge over radio, the
// bridge to the Flume cloud over Wi-Fi, and every reading goes through the
// cloud. Authentication is the OAuth2 "password" grant, with the personal
// client every Flume account can generate on portal.flumewater.com. The
// access token is a JWT whose payload carries the `user_id` every other path
// is built on.
//
// Every answer is wrapped the same way:
//   { success, code, message, http_code, detailed, data: [...], count }
//
// Secrets (password, client secret, tokens) are never logged and never put in
// an error message.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'flume-client' });

export const FLUME_API_URL = 'https://api.flumewater.com';

// Flume answers in a few hundred milliseconds; a request still pending after
// this is a stalled connection, and the next refresh will try again.
const REQUEST_TIMEOUT_MS = 15_000;

// Renew the access token this long before it expires, so a request never
// leaves with a token that dies on the way.
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

// Flume device types (`type` of GET /users/{id}/devices).
export const FLUME_DEVICE_TYPES = { BRIDGE: 1, SENSOR: 2 };

/** An error answered by Flume, or the network failing to reach it. */
export class FlumeError extends Error {
  /**
   * @param {string} message safe to log and to show (no secret in it)
   * @param {{ status?: number, kind?: 'auth' | 'rate_limit' | 'network' | 'api' }} [details]
   */
  constructor(message, { status = 0, kind = 'api' } = {}) {
    super(message);
    this.name = 'FlumeError';
    this.status = status;
    this.kind = kind;
  }
}

/**
 * Read the `user_id` claim of a Flume access token (a JWT). The signature is
 * not checked: the token comes straight from Flume over HTTPS, and Flume
 * checks it on every request anyway.
 */
export function userIdFromToken(token) {
  const payload = String(token ?? '').split('.')[1];
  if (!payload) {
    throw new FlumeError('Flume returned an access token without a user id.', { kind: 'auth' });
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new FlumeError('Flume returned an unreadable access token.', { kind: 'auth' });
  }
  if (claims.user_id === undefined || claims.user_id === null) {
    throw new FlumeError('Flume returned an access token without a user id.', { kind: 'auth' });
  }
  return String(claims.user_id);
}

function sameCredentials(a, b) {
  return (
    a?.username === b?.username &&
    a?.password === b?.password &&
    a?.clientId === b?.clientId &&
    a?.clientSecret === b?.clientSecret
  );
}

// The most precise message Flume gives, without echoing anything we sent.
function flumeMessage(body, fallback) {
  const detailed = Array.isArray(body?.detailed) ? body.detailed.filter(Boolean)[0] : undefined;
  const message = body?.message || body?.error_description || detailed;
  return typeof message === 'string' && message.trim() ? message.trim().slice(0, 200) : fallback;
}

export class FlumeClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] the HTTP function (tests pass a fake)
   * @param {string} [options.baseUrl]
   * @param {() => number} [options.now]
   */
  constructor({ fetch = globalThis.fetch, baseUrl = FLUME_API_URL, now = Date.now } = {}) {
    this.fetch = fetch;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.now = now;
    this.credentials = null;
    this.session = null; // { accessToken, refreshToken, expiresAt, userId }
    this.loginPromise = null;
  }

  /** Use these credentials from now on; a change drops the current session. */
  setCredentials(credentials) {
    if (!sameCredentials(this.credentials, credentials)) {
      this.credentials = { ...credentials };
      this.session = null;
    }
  }

  get userId() {
    return this.session?.userId ?? null;
  }

  async getDevices() {
    const userId = await this.ensureSession();
    return this.request('GET', `/users/${userId}/devices`, {
      query: { user: 'false', location: 'true', limit: '50' },
    });
  }

  /** The unread notifications, newest first: the alerts still standing. */
  async getUnreadNotifications() {
    const userId = await this.ensureSession();
    const notifications = await this.request('GET', `/users/${userId}/notifications`, {
      query: {
        limit: '50',
        offset: '0',
        sort_field: 'created_datetime',
        sort_direction: 'DESC',
        read: 'false',
      },
    });
    return notifications.filter((notification) => notification && notification.read !== true);
  }

  /**
   * Run usage queries on one sensor (POST /users/{id}/devices/{id}/query).
   * @param {string} deviceId Flume sensor id
   * @param {object[]} queries built by src/flume/time.js
   * @returns {Promise<Record<string, {datetime: string, value: number}[]>>}
   *   the points of each query, keyed by its `request_id`
   */
  async queryUsage(deviceId, queries) {
    const userId = await this.ensureSession();
    const data = await this.request(
      'POST',
      `/users/${userId}/devices/${encodeURIComponent(deviceId)}/query`,
      { body: { queries } },
    );
    return data[0] ?? {};
  }

  /** A valid session, logging in or renewing the token when needed. */
  async ensureSession() {
    if (this.session && this.session.expiresAt - TOKEN_MARGIN_MS > this.now()) {
      return this.session.userId;
    }
    // Several sensors refreshed at once share one login.
    if (!this.loginPromise) {
      this.loginPromise = this.openSession().finally(() => {
        this.loginPromise = null;
      });
    }
    await this.loginPromise;
    return this.session.userId;
  }

  async openSession() {
    if (!this.credentials) {
      throw new FlumeError('The Flume credentials are not configured.', { kind: 'auth' });
    }
    const { username, password, clientId, clientSecret } = this.credentials;
    if (this.session?.refreshToken) {
      try {
        await this.requestToken({
          grant_type: 'refresh_token',
          refresh_token: this.session.refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        });
        return;
      } catch (err) {
        // A refresh token can be revoked (password changed in the app): the
        // password grant below is the way back.
        logger.info(`Flume token renewal refused (${err.message}), logging in again`);
        this.session = null;
      }
    }
    await this.requestToken({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username,
      password,
    });
  }

  async requestToken(body) {
    const data = await this.send('POST', '/oauth/token', { body, auth: false });
    const token = data[0];
    if (!token?.access_token) {
      throw new FlumeError('Flume did not return an access token.', { kind: 'auth' });
    }
    const userId = userIdFromToken(token.access_token);
    const expiresIn = Number(token.expires_in);
    this.session = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      // Flume tokens last a week; an answer without a lifetime is renewed
      // within the hour rather than trusted forever.
      expiresAt: this.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 60 * 60 * 1000),
      userId,
    };
    logger.debug(`Flume session opened for user ${userId}`);
  }

  /** An authenticated request; a token refused once is renewed and retried. */
  async request(method, path, options = {}) {
    try {
      return await this.send(method, path, options);
    } catch (err) {
      if (err instanceof FlumeError && err.status === 401) {
        this.session = null;
        await this.ensureSession();
        return this.send(method, path, options);
      }
      throw err;
    }
  }

  async send(method, path, { query, body, auth = true } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      headers.Authorization = `Bearer ${this.session?.accessToken ?? ''}`;
    }

    let response;
    try {
      response = await this.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || err?.message;
      throw new FlumeError(`Flume cloud unreachable (${reason}).`, { kind: 'network' });
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // An HTML error page from a proxy: the status says enough.
    }

    if (response.status === 429) {
      throw new FlumeError('Flume request limit reached, the integration slows down.', {
        status: 429,
        kind: 'rate_limit',
      });
    }
    if (!response.ok || payload?.success === false) {
      const status = response.ok ? Number(payload?.http_code) || 400 : response.status;
      // The token endpoint answers a bad password or a bad client with a 400
      // or a 401: both mean "fix the credentials".
      const isAuth = status === 401 || status === 403 || (!auth && status === 400);
      throw new FlumeError(flumeMessage(payload, `Flume answered HTTP ${status}.`), {
        status,
        kind: isAuth ? 'auth' : 'api',
      });
    }
    return Array.isArray(payload?.data) ? payload.data : [];
  }
}
