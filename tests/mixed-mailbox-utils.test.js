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

test('rejects unsupported show URL variants and mismatched iCloud URL email', () => {
  const result = utils.parseMixedMailboxImport([
    'alias@icloud.com----http://icloud-api.top/show/token/alias@icloud.com',
    'alias@icloud.com----https://icloud-api.top/show/token/other@icloud.com',
  ].join('\n'));

  assert.equal(result.records.length, 0);
  assert.deepEqual(result.errors.map((item) => item.lineNumber), [1, 2]);
});

test('parses arbitrary HTTPS and HTTP messages mailbox URLs', () => {
  const result = utils.parseMixedMailboxImport([
    'one@icloud.com----https://mailbox.example/messages/token-one/one@icloud.com',
    'two@icloud.com----http://mailbox.example/messages/token-two/two@icloud.com',
  ].join('\n'));

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.records.map((item) => item.url), [
    'https://mailbox.example/messages/token-one/one@icloud.com',
    'http://mailbox.example/messages/token-two/two@icloud.com',
  ]);
});

test('rejects iCloud URLs without a mailbox token segment', () => {
  const result = utils.parseMixedMailboxImport(
    'alias@icloud.com----https://icloud-api.top/show//alias@icloud.com'
  );

  assert.equal(result.records.length, 0);
  assert.equal(result.errors[0].lineNumber, 1);
});

test('parses yangyang single-line and continuation records in original order', () => {
  const result = utils.parseMixedMailboxImport([
    'first@outlook.com----password----client-id----refresh-token',
    'second@icloud.com----http://yangyang.website/messages/token-a/second@icloud.com',
    'third@icloud.com----http://yangyang.website/messages/',
    '',
    '  token-b/third@icloud.com  ',
    'fourth@icloud.com----https://icloud-api.top/show/token-c/fourth@icloud.com',
  ].join('\n'));

  assert.deepEqual(result.records.map(({ type, email }) => ({ type, email })), [
    { type: 'outlook', email: 'first@outlook.com' },
    { type: 'icloud-url', email: 'second@icloud.com' },
    { type: 'icloud-url', email: 'third@icloud.com' },
    { type: 'icloud-url', email: 'fourth@icloud.com' },
  ]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.records[2].url, 'http://yangyang.website/messages/token-b/third@icloud.com');
});

test('rejects unsupported mailbox URL path shapes', () => {
  const cases = [
    'a@icloud.com----http://icloud-api.top/show/token/a@icloud.com',
    'a@icloud.com----https://mailbox.example/show/token/a@icloud.com',
    'a@icloud.com----http://mailbox.example/messages-extra/token/a@icloud.com',
    'a@icloud.com----ftp://mailbox.example/messages/token/a@icloud.com',
  ];

  for (const value of cases) {
    const result = utils.parseMixedMailboxImport(value);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors[0].lineNumber, 1);
  }
});

test('rejects local mailbox URL hosts before importing credentials', () => {
  const cases = [
    'a@icloud.com----http://localhost/messages/token/a@icloud.com',
    'a@icloud.com----https://mailbox.localhost/messages/token/a@icloud.com',
    'a@icloud.com----http://127.0.0.1/messages/token/a@icloud.com',
    'a@icloud.com----http://10.0.0.1/messages/token/a@icloud.com',
    'a@icloud.com----http://192.168.1.1/messages/token/a@icloud.com',
    'a@icloud.com----http://[::1]/messages/token/a@icloud.com',
  ];

  for (const value of cases) {
    const result = utils.parseMixedMailboxImport(value);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors[0].lineNumber, 1);
  }
});

test('rejects mailbox URLs with credentials ports queries or fragments', () => {
  const cases = [
    'a@icloud.com----https://user:pass@icloud-api.top/show/token/a@icloud.com',
    'a@icloud.com----https://icloud-api.top:444/show/token/a@icloud.com',
    'a@icloud.com----https://icloud-api.top/show/token/a@icloud.com?view=1',
    'a@icloud.com----https://icloud-api.top/show/token/a@icloud.com#latest',
  ];

  for (const value of cases) {
    const result = utils.parseMixedMailboxImport(value);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors[0].lineNumber, 1);
  }
});

test('rejects invalid yangyang tokens and mismatched mailbox paths', () => {
  const cases = [
    'a@icloud.com----http://yangyang.website/messages//a@icloud.com',
    'a@icloud.com----http://yangyang.website/messages/token/extra/a@icloud.com',
    'a@icloud.com----http://yangyang.website/messages/token/b@icloud.com',
  ];

  for (const value of cases) {
    const result = utils.parseMixedMailboxImport(value);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors[0].lineNumber, 1);
  }
});

test('reports malformed yangyang continuations against the record start line', () => {
  const continuations = [
    'https://yangyang.website/messages/token/a@icloud.com',
    'token----a@icloud.com',
    'token/extra/a@icloud.com',
    'token/b@icloud.com',
  ];

  for (const continuation of continuations) {
    const result = utils.parseMixedMailboxImport([
      'valid@outlook.com----password----client-id----refresh-token',
      'a@icloud.com----http://yangyang.website/messages/',
      '',
      continuation,
    ].join('\n'));
    assert.equal(result.records[0].email, 'valid@outlook.com');
    assert.equal(result.records.some((record) => record.email === 'a@icloud.com'), false);
    assert.equal(result.errors[0].lineNumber, 2);
  }
});

test('rejects a missing or isolated yangyang continuation', () => {
  const missing = utils.parseMixedMailboxImport(
    'a@icloud.com----http://yangyang.website/messages/'
  );
  assert.equal(missing.records.length, 0);
  assert.equal(missing.errors[0].lineNumber, 1);

  const isolated = utils.parseMixedMailboxImport('token/a@icloud.com');
  assert.equal(isolated.records.length, 0);
  assert.equal(isolated.errors[0].lineNumber, 1);
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

test('sanitizes mixed mailbox state before it reaches diagnostic logs', () => {
  const safePayload = utils.sanitizeMixedMailboxStateForLog({
    emailGenerator: 'mixed-pool',
    hotmailAccounts: [{
      id: 'outlook-one',
      email: 'a@outlook.com',
      password: 'outlook-password',
      clientId: 'outlook-client-id',
      refreshToken: 'outlook-refresh-token',
      used: false,
    }],
    mixedMailboxQueueEntries: [{
      id: 'icloud-one',
      type: 'icloud-url',
      email: 'a@icloud.com',
      credential: 'a@icloud.com----https://icloud-api.top/show/icloud-token/a@icloud.com',
      url: 'https://icloud-api.top/show/icloud-token/a@icloud.com',
      enabled: true,
      used: false,
    }],
  });
  const serialized = JSON.stringify(safePayload);

  assert.equal(safePayload.emailGenerator, 'mixed-pool');
  assert.equal(safePayload.hotmailAccounts[0].email, 'a@outlook.com');
  assert.equal(safePayload.mixedMailboxQueueEntries[0].email, 'a@icloud.com');
  for (const secret of [
    'outlook-password',
    'outlook-client-id',
    'outlook-refresh-token',
    'icloud-token',
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});
