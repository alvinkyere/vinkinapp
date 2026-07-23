import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAppVersionSupported, parseAppVersion } from './app-version.ts';

test('ENG3: parseAppVersion', async (t) => {
  await t.test('parses a plain major.minor.patch string', () => {
    assert.deepEqual(parseAppVersion('1.2.3'), [1, 2, 3]);
  });

  await t.test('tolerates surrounding whitespace', () => {
    assert.deepEqual(parseAppVersion('  1.2.3 '), [1, 2, 3]);
  });

  for (const malformed of ['1.2', '1.2.3.4', 'v1.2.3', '1.2.3+1', '', 'not-a-version']) {
    await t.test(`rejects "${malformed}"`, () => {
      assert.equal(parseAppVersion(malformed), null);
    });
  }
});

test('ENG3: isAppVersionSupported', async (t) => {
  await t.test('a client at exactly the minimum is supported', () => {
    assert.equal(isAppVersionSupported('1.2.3', '1.2.3'), true);
  });

  await t.test('a client above the minimum (patch) is supported', () => {
    assert.equal(isAppVersionSupported('1.2.4', '1.2.3'), true);
  });

  await t.test('a client above the minimum (minor) is supported', () => {
    assert.equal(isAppVersionSupported('1.3.0', '1.2.9'), true);
  });

  await t.test('a client above the minimum (major) is supported', () => {
    assert.equal(isAppVersionSupported('2.0.0', '1.9.9'), true);
  });

  await t.test('a client below the minimum (patch) is unsupported', () => {
    assert.equal(isAppVersionSupported('1.2.2', '1.2.3'), false);
  });

  await t.test(
    'a client below the minimum (minor) is unsupported, even with a higher patch',
    () => {
      assert.equal(isAppVersionSupported('1.1.9', '1.2.0'), false);
    },
  );

  await t.test(
    'a client below the minimum (major) is unsupported, even with higher minor/patch',
    () => {
      assert.equal(isAppVersionSupported('1.9.9', '2.0.0'), false);
    },
  );

  await t.test('fails open (supported) when the client version is malformed', () => {
    assert.equal(isAppVersionSupported('not-a-version', '1.2.3'), true);
  });

  await t.test('fails open (supported) when the configured minimum is malformed', () => {
    assert.equal(isAppVersionSupported('1.0.0', 'not-a-version'), true);
  });
});
