const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractFunctionSource(source, functionName) {
  const asyncSignature = `async function ${functionName}(`;
  const syncSignature = `function ${functionName}(`;
  const asyncStart = source.indexOf(asyncSignature);
  const syncStart = source.indexOf(syncSignature);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  if (start < 0) {
    throw new Error(`Function ${functionName} not found`);
  }
  const paramsStart = source.indexOf('(', start);
  if (paramsStart < 0) {
    throw new Error(`Function ${functionName} parameters not found`);
  }
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
      continue;
    }
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  if (bodyStart < 0) {
    throw new Error(`Function ${functionName} body not found`);
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Function ${functionName} not terminated`);
}

function loadHotmailFailureHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const functionNames = [
    'normalizeHotmailAccount',
    'buildHotmailMailApiFailureAccount',
    'isHotmailAccountAuthorizationFailureMessage',
    'persistHotmailAccountAuthorizationFailure',
  ];
  const extracted = functionNames.map((name) => extractFunctionSource(source, name)).join('\n\n');
  const sandbox = {
    console,
    crypto: { randomUUID: () => 'generated-id' },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('invalid_grant from local helper marks Hotmail account as error', async () => {
  const sandbox = loadHotmailFailureHelpers();
  const savedAccounts = [];
  sandbox.upsertHotmailAccount = async (account) => {
    savedAccounts.push(account);
    return account;
  };

  const account = {
    id: 'hotmail-1',
    email: 'broken@outlook.com',
    clientId: 'client-id',
    refreshToken: 'stale-token',
    status: 'authorized',
    lastAuthAt: 123,
  };
  const errorMessage = 'Hotmail 本地助手返回失败：Message collection failed on all transports: imap: Token refresh failed on all endpoints: live(400): {"error":"invalid_grant"}';

  const persisted = await sandbox.persistHotmailAccountAuthorizationFailure(account, errorMessage);

  assert.equal(savedAccounts.length, 1);
  assert.equal(savedAccounts[0].id, 'hotmail-1');
  assert.equal(savedAccounts[0].status, 'error');
  assert.equal(savedAccounts[0].lastError, errorMessage);
  assert.equal(persisted.status, 'error');
});

test('temporary helper failure does not mark Hotmail account as error', async () => {
  const sandbox = loadHotmailFailureHelpers();
  let callCount = 0;
  sandbox.upsertHotmailAccount = async () => {
    callCount += 1;
  };

  const account = {
    id: 'hotmail-2',
    email: 'network@outlook.com',
    refreshToken: 'token',
    status: 'authorized',
  };
  const errorMessage = 'Hotmail 本地助手返回失败：无法连接 Hotmail 本地助手（http://127.0.0.1:8000/messages）。';

  const persisted = await sandbox.persistHotmailAccountAuthorizationFailure(account, errorMessage);

  assert.equal(callCount, 0);
  assert.equal(persisted, null);
});
