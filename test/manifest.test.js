// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there knows which
// handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { ALERT_KINDS } from '../src/flume/alerts.js';
import { SCENE_TRIGGERS } from '../src/flume/monitor.js';
import { SCENE_ACTIONS, SCENE_PERIODS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

// Every list of form fields the manifest declares (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionsOf = (field) => field.options.map((option) => option.value);

// Every multi-language object of the manifest, with where it sits.
function texts(value, path = '', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => texts(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['label', 'description', 'placeholder'].includes(key) && typeof item === 'object') {
        found.push([`${path}.${key}`, item]);
      } else {
        texts(item, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

test('every text of the manifest is written in English, French, German and Spanish', () => {
  const found = texts(manifest);
  assert.ok(found.length > 50);
  for (const [path, text] of found) {
    assert.deepEqual(Object.keys(text), LANGUAGES, `${path} must be { en, fr, de, es }`);
    for (const language of LANGUAGES) {
      assert.ok(text[language]?.trim(), `${path}.${language} is empty`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('Flume is a cloud integration', () => {
  // The transport tag of the store and of the device badges: Flume has no
  // local API, everything goes through its cloud.
  assert.deepEqual(manifest.transports, ['cloud']);
});

// The store vocabulary of catalog shelves (Gladys 5.3 added the last four).
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

/** The floor of a ">=x.y.z" range, as numbers. */
function versionFloor() {
  const match = manifest.gladys_version.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  assert.ok(match, 'gladys_version must be a ">=x.y.z" range');
  return match.slice(1).map(Number);
}

function floorAtLeast(major, minor) {
  const [floorMajor, floorMinor] = versionFloor();
  return floorMajor > major || (floorMajor === major && floorMinor >= minor);
}

test('the capability fields and the categories require Gladys >= 5.1.0', () => {
  assert.ok(floorAtLeast(5, 1), manifest.gladys_version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('keywords and countries require Gladys >= 5.3.0', () => {
  // An older core rejects any manifest field it does not know.
  if (manifest.keywords || manifest.countries || manifest.music) {
    assert.ok(floorAtLeast(5, 3), manifest.gladys_version);
  }
});

test('the search keywords are 1 to 10 unique strings of 2 to 30 characters', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}"`);
  }
});

test('Flume is only sold in the United States', () => {
  // Flume's own help center: the product only works in the United States.
  assert.deepEqual(manifest.countries, ['US']);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('every manifest action is registered in index.js', () => {
  for (const key of keysOf(manifest.actions)) {
    assert.ok(indexSource.includes(`gladys.onAction('${key}'`), `action "${key}" has no handler`);
  }
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  assert.ok(manifest.widgets.length <= 5);
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
});

test('the select options match the values the code produces and reads', () => {
  const trigger = (key) => manifest.scene_triggers.find((item) => item.key === key);
  const alertField = trigger(SCENE_TRIGGERS.ALERT).fields.find((f) => f.key === 'alert');
  assert.deepEqual(optionsOf(alertField).sort(), Object.values(ALERT_KINDS).sort());
  const flowField = trigger(SCENE_TRIGGERS.WATER_FLOW).fields.find((f) => f.key === 'state');
  assert.deepEqual(optionsOf(flowField), ['started', 'stopped']);
  const getUsage = manifest.scene_actions.find((item) => item.key === 'get_usage');
  const period = getUsage.fields.find((f) => f.key === 'period');
  assert.deepEqual(optionsOf(period), SCENE_PERIODS);
  assert.ok(SCENE_PERIODS.includes(period.default));
});

test('the outputs declared are the ones the handlers return', () => {
  const outputs = Object.fromEntries(
    manifest.scene_actions.map((action) => [action.key, keysOf(action.outputs).sort()]),
  );
  assert.deepEqual(outputs, {
    get_usage: ['cubic_meters', 'liters'],
    refresh_now: ['leak', 'liters_last_minute', 'liters_today', 'water_running'],
  });
});

test('config_schema defaults stay equal to DEFAULT_CONFIG, and no key is unknown', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.default, undefined);
      assert.equal(field.required, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing from DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

test('the secrets are secret fields', () => {
  const type = (key) => manifest.config_schema.find((field) => field.key === key).type;
  assert.equal(type('password'), 'secret');
  assert.equal(type('client_secret'), 'secret');
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-flume:${manifest.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/prohand/gladys-flume/main/cover.png',
  );
});

test('the user documentation exists in the four languages', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});
