const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractLastFunctionSource(source, signature) {
  const start = source.lastIndexOf(signature);
  if (start < 0) {
    throw new Error(`Signature not found: ${signature}`);
  }
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Function not terminated: ${signature}`);
}

function loadHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const extracted = [
    extractLastFunctionSource(source, 'async function patchHotmailAccount'),
    extractLastFunctionSource(source, 'async function markCurrentRegistrationAccountUnavailable'),
  ].join('\n\n');
  const sandbox = {
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('marking current Hotmail registration account unavailable clears current selection', async () => {
  const sandbox = loadHelpers();
  const state = {
    email: 'broken@outlook.com',
    mailProvider: 'hotmail',
    currentHotmailAccountId: 'hotmail-1',
    hotmailAccounts: [
      {
        id: 'hotmail-1',
        email: 'broken@outlook.com',
        used: false,
      },
    ],
  };
  const patchCalls = [];
  const setStateCalls = [];
  const emailStateCalls = [];
  const originalPatchHotmailAccount = sandbox.patchHotmailAccount;

  sandbox.getState = async () => state;
  sandbox.isHotmailProvider = () => true;
  sandbox.isLuckmailProvider = () => false;
  sandbox.normalizeEmailGenerator = () => '';
  sandbox.getManualAliasUsageMap = () => ({});
  sandbox.getPreservedAliasMap = () => ({});
  sandbox.isOutlookPlusAliasForAccount = () => false;
  sandbox.isHotmailAliasUsed = () => false;
  sandbox.setHotmailAliasUsageEntry = async () => {};
  sandbox.countHotmailUsedAliases = () => 0;
  sandbox.normalizeOutlookAliasMaxPerAccount = () => 1;
  sandbox.addLog = async () => {};
  sandbox.getCurrentLuckmailPurchase = () => null;
  sandbox.setLuckmailPurchaseUsedState = async () => {};
  sandbox.clearLuckmailRuntimeState = async () => {};
  sandbox.setIcloudAliasUsedState = async () => {};
  sandbox.markCurrentCustomEmailPoolEntryUsed = async () => ({ updated: false });
  sandbox.patchHotmailAccount = async (...args) => {
    patchCalls.push(args);
    return originalPatchHotmailAccount(...args);
  };
  sandbox.syncHotmailAccounts = async (accounts) => {
    state.hotmailAccounts = accounts;
  };
  sandbox.normalizeHotmailAccounts = (accounts = []) => accounts.map((account) => ({ ...account }));
  sandbox.findHotmailAccount = (accounts = [], accountId) => accounts.find((account) => account.id === accountId) || null;
  sandbox.normalizeHotmailAccount = (account = {}) => ({ ...account });
  sandbox.shouldClearHotmailCurrentSelection = (account = {}) => Boolean(account.used);
  sandbox.setState = async (updates) => {
    setStateCalls.push(updates);
    Object.assign(state, updates);
  };
  sandbox.broadcastDataUpdate = () => {};
  sandbox.setEmailState = async (value) => {
    emailStateCalls.push(value);
    state.email = value || '';
  };

  await sandbox.markCurrentRegistrationAccountUnavailable(state, {
    logPrefix: '自动运行检测到当前注册邮箱命中身份验证方式冲突',
    reason: 'identity_provider_mismatch',
    reasonLabel: '身份验证方式冲突',
  });

  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0][0], 'hotmail-1');
  assert.equal(patchCalls[0][1].used, true);
  assert.ok(setStateCalls.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'currentHotmailAccountId') && entry.currentHotmailAccountId === null));
  assert.deepEqual(emailStateCalls, [null]);
});
