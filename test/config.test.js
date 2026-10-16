import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialsOf, DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';
import { CONFIGURED } from './helpers/fakeFlume.js';

test('an empty configuration takes the defaults and is not configured', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.equal(isConfigured(config), false);
});

test('numbers typed as text are read, and kept in their bounds', () => {
  assert.equal(normalizeConfig({ poll_frequency: '300' }).poll_frequency, 300);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 99999 }).poll_frequency, 3600);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 120);
  assert.equal(normalizeConfig({ flow_threshold: 'abc' }).flow_threshold, 0.5);
  assert.equal(normalizeConfig({ flow_threshold: 0 }).flow_threshold, 0);
});

test('identifiers are trimmed, the password is kept as typed', () => {
  const config = normalizeConfig({
    ...CONFIGURED,
    username: '  me@example.com ',
    password: ' pass ',
    client_id: ' id\n',
  });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' pass ');
  assert.equal(config.client_id, 'id');
  assert.equal(isConfigured(config), true);
  assert.deepEqual(credentialsOf(config), {
    username: 'me@example.com',
    password: ' pass ',
    clientId: 'id',
    clientSecret: 'secret',
  });
});
