import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlumeClient, FlumeError, userIdFromToken } from '../src/flume/client.js';

const CREDENTIALS = {
  username: 'me@example.com',
  password: 'hunter2',
  clientId: 'client-id',
  clientSecret: 'client-secret',
};

function jwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(claims)}.signature`;
}

const json = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const tokenAnswer = (token = jwt({ user_id: 12345 }), expiresIn = 604800) =>
  json(200, {
    success: true,
    data: [{ access_token: token, refresh_token: 'refresh-1', expires_in: expiresIn }],
  });

// A fake fetch answering from a list of handlers, recording the requests.
function fakeFetch(answers) {
  const requests = [];
  const fetch = async (url, init) => {
    const request = {
      url: String(url),
      method: init.method,
      headers: init.headers,
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    requests.push(request);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected request ${request.method} ${request.url}`);
    return typeof answer === 'function' ? answer(request) : answer;
  };
  return { fetch, requests };
}

test('userIdFromToken reads the user_id claim of the JWT', () => {
  assert.equal(userIdFromToken(jwt({ user_id: 42 })), '42');
  assert.throws(() => userIdFromToken('not-a-jwt'), FlumeError);
  assert.throws(() => userIdFromToken(jwt({ sub: 'x' })), /without a user id/);
});

test('logs in with the password grant, then reads the devices of the user', async () => {
  const { fetch, requests } = fakeFetch([
    tokenAnswer(),
    json(200, { success: true, data: [{ id: '1', type: 2 }] }),
  ]);
  const client = new FlumeClient({ fetch });
  client.setCredentials(CREDENTIALS);

  const devices = await client.getDevices();

  assert.deepEqual(devices, [{ id: '1', type: 2 }]);
  assert.equal(requests[0].url, 'https://api.flumewater.com/oauth/token');
  assert.deepEqual(requests[0].body, {
    grant_type: 'password',
    client_id: 'client-id',
    client_secret: 'client-secret',
    username: 'me@example.com',
    password: 'hunter2',
  });
  assert.match(requests[1].url, /\/users\/12345\/devices\?user=false&location=true/);
  assert.match(requests[1].headers.Authorization, /^Bearer /);
  assert.equal(client.userId, '12345');
});

test('one login is shared and reused until the token nears its expiry', async () => {
  let now = 0;
  const { fetch, requests } = fakeFetch([
    tokenAnswer(jwt({ user_id: 1 }), 3600),
    json(200, { success: true, data: [] }),
    json(200, { success: true, data: [] }),
    // One hour later: renewed with the refresh token.
    tokenAnswer(jwt({ user_id: 1 }), 3600),
    json(200, { success: true, data: [] }),
  ]);
  const client = new FlumeClient({ fetch, now: () => now });
  client.setCredentials(CREDENTIALS);

  await client.getDevices();
  await client.getDevices();
  now = 3600 * 1000;
  await client.getDevices();

  assert.equal(requests.filter((r) => r.url.endsWith('/oauth/token')).length, 2);
  assert.equal(requests[3].body.grant_type, 'refresh_token');
  assert.equal(requests[3].body.refresh_token, 'refresh-1');
});

test('a token refused with a 401 is renewed and the request retried once', async () => {
  const { fetch, requests } = fakeFetch([
    tokenAnswer(),
    json(401, { success: false, message: 'Unauthorized' }),
    tokenAnswer(),
    json(200, { success: true, data: [{ id: 'n1', read: false }] }),
  ]);
  const client = new FlumeClient({ fetch });
  client.setCredentials(CREDENTIALS);

  const notifications = await client.getUnreadNotifications();

  assert.deepEqual(notifications, [{ id: 'n1', read: false }]);
  assert.equal(requests.length, 4);
  assert.equal(requests[2].body.grant_type, 'password');
});

test('bad credentials are an auth error that never echoes a secret', async () => {
  const { fetch } = fakeFetch([
    json(400, { success: false, message: 'Invalid username or password' }),
  ]);
  const client = new FlumeClient({ fetch });
  client.setCredentials(CREDENTIALS);

  await assert.rejects(client.getDevices(), (err) => {
    assert.ok(err instanceof FlumeError);
    assert.equal(err.kind, 'auth');
    assert.equal(err.message, 'Invalid username or password');
    assert.ok(!err.message.includes('hunter2') && !err.message.includes('client-secret'));
    return true;
  });
});

test('a 429 is a rate-limit error, a network failure a network error', async () => {
  const client = new FlumeClient({
    fetch: fakeFetch([tokenAnswer(), json(429, { success: false })]).fetch,
  });
  client.setCredentials(CREDENTIALS);
  await assert.rejects(client.getDevices(), (err) => err.kind === 'rate_limit');

  const offline = new FlumeClient({
    fetch: async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    },
  });
  offline.setCredentials(CREDENTIALS);
  await assert.rejects(offline.getDevices(), (err) => {
    assert.equal(err.kind, 'network');
    assert.match(err.message, /ENOTFOUND/);
    return true;
  });
});

test('queryUsage posts the queries and returns the points by request id', async () => {
  const { fetch, requests } = fakeFetch([
    tokenAnswer(),
    json(200, { success: true, data: [{ today: [{ datetime: 'x', value: 12.5 }] }] }),
  ]);
  const client = new FlumeClient({ fetch });
  client.setCredentials(CREDENTIALS);

  const result = await client.queryUsage('987', [{ request_id: 'today', bucket: 'DAY' }]);

  assert.deepEqual(result, { today: [{ datetime: 'x', value: 12.5 }] });
  assert.equal(requests[1].method, 'POST');
  assert.match(requests[1].url, /\/users\/12345\/devices\/987\/query$/);
  assert.deepEqual(requests[1].body, { queries: [{ request_id: 'today', bucket: 'DAY' }] });
});

test('new credentials drop the session; unchanged ones keep it', async () => {
  const { fetch, requests } = fakeFetch([
    tokenAnswer(),
    json(200, { success: true, data: [] }),
    json(200, { success: true, data: [] }),
    tokenAnswer(),
    json(200, { success: true, data: [] }),
  ]);
  const client = new FlumeClient({ fetch });
  client.setCredentials(CREDENTIALS);
  await client.getDevices();
  client.setCredentials({ ...CREDENTIALS });
  await client.getDevices();
  client.setCredentials({ ...CREDENTIALS, password: 'new' });
  await client.getDevices();

  const logins = requests.filter((r) => r.url.endsWith('/oauth/token'));
  assert.equal(logins.length, 2);
  assert.equal(logins[1].body.password, 'new');
});

test('no credentials, no request', async () => {
  const client = new FlumeClient({ fetch: fakeFetch([]).fetch });
  await assert.rejects(client.getDevices(), (err) => err.kind === 'auth');
});
