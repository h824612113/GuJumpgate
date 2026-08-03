const test = require('node:test');
const assert = require('node:assert/strict');

const manager = require('../sidepanel/mixed-mailbox-queue-manager');

test('builds safe display rows with provider labels and no credentials', () => {
  const row = manager.buildDisplayEntry({
    id: 'icloud-one',
    type: 'icloud-url',
    email: 'alias@icloud.com',
    credential: 'alias@icloud.com----https://icloud-api.top/show/sensitive-token/alias@icloud.com',
    enabled: true,
    used: false,
    lastError: 'HTTP 403',
  }, 'icloud-one');

  assert.equal(row.typeLabel, 'iCloud URL');
  assert.equal(row.current, true);
  assert.equal(row.hasError, true);
  assert.equal(JSON.stringify(row).includes('sensitive-token'), false);
  assert.equal(Object.hasOwn(row, 'credential'), false);
});

test('summarizes mixed queue provider and availability counts', () => {
  const summary = manager.summarizeEntries([
    { id: 'one', type: 'outlook', email: 'a@outlook.com', enabled: true, used: false },
    { id: 'two', type: 'icloud-url', email: 'b@icloud.com', enabled: true, used: true },
    { id: 'three', type: 'icloud-url', email: 'c@icloud.com', enabled: false, used: false, lastError: 'HTTP 403' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    outlook: 1,
    icloudUrl: 2,
    available: 1,
    used: 1,
    errors: 1,
  });
});

test('counts only enabled unused entries for locked auto-run rounds', () => {
  assert.equal(manager.getAvailableEntryCount([
    { id: 'one', type: 'outlook', email: 'a@outlook.com', enabled: true, used: false },
    { id: 'two', type: 'icloud-url', email: 'b@icloud.com', enabled: true, used: true },
    { id: 'three', type: 'icloud-url', email: 'c@icloud.com', enabled: false, used: false },
  ]), 1);
});

test('builds active state patches without leaking Outlook account state into iCloud runs', () => {
  assert.deepEqual(manager.buildActiveStatePatch({
    id: 'outlook-one',
    type: 'outlook',
    email: 'a@outlook.com',
    hotmailAccountId: 'hotmail-one',
  }), {
    activeMixedMailboxEntryId: 'outlook-one',
    email: 'a@outlook.com',
    currentHotmailAccountId: 'hotmail-one',
  });

  assert.deepEqual(manager.buildActiveStatePatch({
    id: 'icloud-one',
    type: 'icloud-url',
    email: 'b@icloud.com',
  }), {
    activeMixedMailboxEntryId: 'icloud-one',
    email: 'b@icloud.com',
    currentHotmailAccountId: null,
  });
});

test('keeps mixed queue selectable for provider-managed mailbox modes without forcing it on', () => {
  assert.deepEqual(manager.buildGeneratorUiPolicy('hotmail-api', 'duck'), {
    allowedGenerators: ['provider-default', 'mixed-pool'],
    selectedGenerator: 'provider-default',
    showGenerator: true,
  });
  assert.deepEqual(manager.buildGeneratorUiPolicy('hotmail-api', 'mixed-pool'), {
    allowedGenerators: ['provider-default', 'mixed-pool'],
    selectedGenerator: 'mixed-pool',
    showGenerator: true,
  });
});
