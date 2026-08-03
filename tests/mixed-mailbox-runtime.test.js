const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../mixed-mailbox-runtime');

const OUTLOOK_ENTRY = {
  id: 'outlook-one',
  type: 'outlook',
  email: 'one@outlook.com',
  hotmailAccountId: 'hotmail-one',
  enabled: true,
  used: false,
  lastError: '',
  lastUsedAt: 0,
};

const ICLOUD_ENTRY = {
  id: 'icloud-one',
  type: 'icloud-url',
  email: 'one@icloud.com',
  credential: 'one@icloud.com----https://icloud-api.top/show/token/one@icloud.com',
  enabled: true,
  used: false,
  lastError: '',
  lastUsedAt: 0,
};

test('prepares Outlook and iCloud queue entries with different runtime providers', () => {
  const outlook = runtime.prepareMixedMailboxRun({
    emailGenerator: 'mixed-pool',
    mixedMailboxQueueEntries: [OUTLOOK_ENTRY],
  });
  const icloud = runtime.prepareMixedMailboxRun({
    emailGenerator: 'mixed-pool',
    mixedMailboxQueueEntries: [ICLOUD_ENTRY],
  });

  assert.equal(outlook.provider, 'hotmail-api');
  assert.equal(outlook.statePatch.currentHotmailAccountId, 'hotmail-one');
  assert.equal(icloud.provider, 'icloud-url');
  assert.equal(icloud.statePatch.currentHotmailAccountId, null);
});

test('marks success used and failure unused without changing queue order', () => {
  const entries = [OUTLOOK_ENTRY, ICLOUD_ENTRY];
  const success = runtime.markMixedMailboxEntryUsed(entries, 'outlook-one', 1234);
  const failure = runtime.markMixedMailboxEntryError(entries, 'icloud-one', new Error('HTTP 403'));

  assert.deepEqual(success.map((item) => item.id), ['outlook-one', 'icloud-one']);
  assert.equal(success[0].used, true);
  assert.equal(success[0].lastUsedAt, 1234);
  assert.equal(failure[1].used, false);
  assert.equal(failure[1].lastError, 'HTTP 403');
});

test('separates the persisted queue from active runtime selection state', () => {
  const defaults = runtime.buildMixedMailboxStateDefaults();
  const importReset = runtime.buildMixedMailboxImportRuntimeResetPatch();

  assert.deepEqual(defaults.persisted, { mixedMailboxQueueEntries: [] });
  assert.deepEqual(defaults.runtime, { activeMixedMailboxEntryId: null });
  assert.deepEqual(importReset, {
    activeMixedMailboxEntryId: null,
    currentHotmailAccountId: null,
  });
  assert.equal(Object.hasOwn(importReset, 'mixedMailboxQueueEntries'), false);
});
