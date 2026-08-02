const test = require('node:test');
const assert = require('node:assert/strict');

const utils = require('../mixed-mailbox-utils');

test('parses mixed Outlook and iCloud URL lines in original order', () => {
  const result = utils.parseMixedMailboxImport([
    'outlook@example.com----password----client-id----refresh-token',
    'alias@icloud.com----https://icloud-api.top/show/token/alias@icloud.com',
  ].join('\n'));

  assert.deepEqual(result.records.map((item) => item.type), ['outlook', 'icloud-url']);
  assert.deepEqual(result.records.map((item) => item.email), ['outlook@example.com', 'alias@icloud.com']);
  assert.equal(result.errors.length, 0);
});

test('rejects non-HTTPS and mismatched iCloud URL email', () => {
  const result = utils.parseMixedMailboxImport([
    'alias@icloud.com----http://icloud-api.top/show/token/alias@icloud.com',
    'alias@icloud.com----https://icloud-api.top/show/token/other@icloud.com',
  ].join('\n'));

  assert.equal(result.records.length, 0);
  assert.deepEqual(result.errors.map((item) => item.lineNumber), [1, 2]);
});

test('updates duplicate credentials without moving the queue item', () => {
  const existing = [
    {
      id: 'one',
      type: 'icloud-url',
      email: 'a@icloud.com',
      credential: 'a@icloud.com----https://icloud-api.top/show/old/a@icloud.com',
      enabled: true,
      used: false,
    },
    {
      id: 'two',
      type: 'outlook',
      email: 'b@outlook.com',
      hotmailAccountId: 'hotmail-two',
      enabled: true,
      used: false,
    },
  ];
  const imported = [
    {
      type: 'icloud-url',
      email: 'a@icloud.com',
      credential: 'a@icloud.com----https://icloud-api.top/show/new/a@icloud.com',
      url: 'https://icloud-api.top/show/new/a@icloud.com',
    },
  ];

  const result = utils.mergeMixedMailboxQueueEntries(existing, imported);

  assert.deepEqual(result.entries.map((item) => item.id), ['one', 'two']);
  assert.equal(result.entries[0].credential, imported[0].credential);
  assert.equal(result.addedCount, 0);
  assert.equal(result.updatedCount, 1);
});

test('selects the first enabled unused queue item', () => {
  const selected = utils.getNextMixedMailboxQueueEntry([
    { id: 'disabled', type: 'outlook', email: 'a@outlook.com', enabled: false, used: false },
    {
      id: 'used',
      type: 'icloud-url',
      email: 'b@icloud.com',
      credential: 'b@icloud.com----https://icloud-api.top/show/token/b@icloud.com',
      enabled: true,
      used: true,
    },
    {
      id: 'next',
      type: 'icloud-url',
      email: 'c@icloud.com',
      credential: 'c@icloud.com----https://icloud-api.top/show/token/c@icloud.com',
      enabled: true,
      used: false,
    },
    { id: 'later', type: 'outlook', email: 'd@outlook.com', enabled: true, used: false },
  ]);

  assert.equal(selected.id, 'next');
});

test('redacts mailbox secrets and resolves runtime providers', () => {
  const secret = 'a@icloud.com----https://icloud-api.top/show/sensitive-token/a@icloud.com';

  assert.equal(utils.redactMixedMailboxSecret(secret).includes('sensitive-token'), false);
  assert.equal(utils.resolveMixedMailboxProvider({ type: 'outlook' }), 'hotmail-api');
  assert.equal(utils.resolveMixedMailboxProvider({ type: 'icloud-url' }), 'icloud-url');
});
