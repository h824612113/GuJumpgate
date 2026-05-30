const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadRunnerModule() {
  const filePath = path.join(__dirname, '..', 'background', 'sub2api-error-refresh-runner.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundSub2ApiErrorRefreshRunner;
}

test('runner marks missing local email as not_found_locally and does not delete remote', async () => {
  const module = loadRunnerModule();
  const statePatches = [];
  const historyRuns = [];
  let deleteCount = 0;
  const state = {
    sub2apiErrorRefreshEnabled: true,
    hotmailAccounts: [],
    sub2apiErrorRefreshStats: {},
  };

  const runner = module.createSub2ApiErrorRefreshRunner({
    addLog: async () => {},
    appendSub2ApiErrorRefreshHistoryRun: async (record) => {
      historyRuns.push(record);
      return record;
    },
    broadcastDataUpdate: () => {},
    deleteSub2ApiAccount: async () => {
      deleteCount += 1;
    },
    doesNodeUseCompletionSignal: () => false,
    executeNode: async () => {},
    executeNodeViaCompletionSignal: async () => {},
    getErrorMessage: (error) => error?.message || String(error || ''),
    getNextNodeIdForState: () => '',
    getNodeIdsForState: () => [],
    getState: async () => state,
    inspectPlusActivationFromSession: () => ({ active: false, planType: '' }),
    listSub2ApiErrorOpenAiOauthAccounts: async () => [
      { id: 9, status: 'error', credentials: { email: 'missing@example.com' } },
    ],
    loginSub2Api: async () => ({ origin: 'https://sub.example.com', token: 'token' }),
    openSignupEntryTab: async () => {},
    patchHotmailAccount: async () => null,
    readCurrentChatGptSessionForExport: async () => ({ session: null, accessToken: '' }),
    setState: async (patch) => {
      statePatches.push(patch);
      Object.assign(state, patch);
    },
  });

  const result = await runner.startSub2ApiErrorRefresh({ stateOverride: state });
  assert.equal(result.ok, true);
  assert.equal(deleteCount, 0);
  assert.equal(historyRuns.length, 1);
  assert.equal(historyRuns[0].notFoundLocallyCount, 1);
  assert.equal(historyRuns[0].details[0].category, 'not_found_locally');
  assert.equal(historyRuns[0].allEntries.length, 1);
  assert.equal(historyRuns[0].allEntries[0].status, 'not_found_locally');
  assert.equal(historyRuns[0].allEntries[0].statusLabel, '本地未找到');
  assert.ok(statePatches.some((patch) => patch.sub2apiErrorRefreshStats));
});

test('runner deletes matched remote error when local account is not plus', async () => {
  const module = loadRunnerModule();
  const historyRuns = [];
  const deletedIds = [];
  const patchedAccounts = [];
  const executedNodes = [];
  const state = {
    sub2apiErrorRefreshEnabled: true,
    hotmailAccounts: [{ id: 'hm_1', email: 'plusless@example.com' }],
    sub2apiErrorRefreshStats: {},
    nodeStatuses: {},
  };

  const runner = module.createSub2ApiErrorRefreshRunner({
    addLog: async () => {},
    appendSub2ApiErrorRefreshHistoryRun: async (record) => {
      historyRuns.push(record);
      return { ...record, filePath: '/tmp/sub2api-error-refresh-history.json' };
    },
    broadcastDataUpdate: () => {},
    deleteSub2ApiAccount: async (_origin, _token, accountId) => {
      deletedIds.push(accountId);
    },
    doesNodeUseCompletionSignal: () => false,
    executeNode: async (nodeId) => {
      executedNodes.push(nodeId);
    },
    executeNodeViaCompletionSignal: async () => {},
    getErrorMessage: (error) => error?.message || String(error || ''),
    getNextNodeIdForState: (nodeId) => {
      if (nodeId === 'oauth-login') return 'confirm-oauth';
      return '';
    },
    getNodeIdsForState: () => ['open-chatgpt', 'oauth-login', 'confirm-oauth', 'platform-verify'],
    getState: async () => state,
    inspectPlusActivationFromSession: () => ({ active: false, planType: 'free' }),
    listSub2ApiErrorOpenAiOauthAccounts: async () => [
      { id: 12, status: 'error', credentials: { email: 'plusless@example.com' } },
    ],
    loginSub2Api: async () => ({ origin: 'https://sub.example.com', token: 'token' }),
    openSignupEntryTab: async () => {},
    patchHotmailAccount: async (id, patch) => {
      patchedAccounts.push({ id, patch });
    },
    readCurrentChatGptSessionForExport: async () => ({ session: {}, accessToken: '' }),
    setState: async (patch) => {
      Object.assign(state, patch);
    },
  });

  const result = await runner.startSub2ApiErrorRefresh({ stateOverride: state });
  assert.equal(result.ok, true);
  assert.deepEqual(deletedIds, [12]);
  assert.equal(historyRuns.length, 1);
  assert.equal(historyRuns[0].deletedAfterReauthFailedCount, 1);
  assert.equal(historyRuns[0].details[0].category, 'deleted_non_plus');
  assert.equal(historyRuns[0].details[0].planType, 'free');
  assert.equal(historyRuns[0].allEntries.length, 1);
  assert.equal(historyRuns[0].allEntries[0].status, 'dead_non_plus');
  assert.equal(historyRuns[0].allEntries[0].statusLabel, '已判死');
  assert.equal(patchedAccounts.length, 1);
  assert.equal(patchedAccounts[0].id, 'hm_1');
  assert.ok(executedNodes.includes('open-chatgpt'));
  assert.ok(executedNodes.includes('oauth-login'));
});

test('runner deletes matched remote error when reauth flow throws', async () => {
  const module = loadRunnerModule();
  const historyRuns = [];
  const deletedIds = [];
  const state = {
    sub2apiErrorRefreshEnabled: true,
    hotmailAccounts: [{ id: 'hm_2', email: 'broken@example.com' }],
    sub2apiErrorRefreshStats: {},
    nodeStatuses: {},
  };

  const runner = module.createSub2ApiErrorRefreshRunner({
    addLog: async () => {},
    appendSub2ApiErrorRefreshHistoryRun: async (record) => {
      historyRuns.push(record);
      return record;
    },
    broadcastDataUpdate: () => {},
    deleteSub2ApiAccount: async (_origin, _token, accountId) => {
      deletedIds.push(accountId);
    },
    doesNodeUseCompletionSignal: () => false,
    executeNode: async (nodeId) => {
      if (nodeId === 'oauth-login') {
        throw new Error('oauth login failed');
      }
    },
    executeNodeViaCompletionSignal: async () => {},
    getErrorMessage: (error) => error?.message || String(error || ''),
    getNextNodeIdForState: () => '',
    getNodeIdsForState: () => ['open-chatgpt', 'oauth-login'],
    getState: async () => state,
    inspectPlusActivationFromSession: () => ({ active: true, planType: 'plus' }),
    listSub2ApiErrorOpenAiOauthAccounts: async () => [
      { id: 18, status: 'error', credentials: { email: 'broken@example.com' } },
    ],
    loginSub2Api: async () => ({ origin: 'https://sub.example.com', token: 'token' }),
    openSignupEntryTab: async () => {},
    patchHotmailAccount: async () => null,
    readCurrentChatGptSessionForExport: async () => ({ session: {}, accessToken: '' }),
    setState: async (patch) => {
      Object.assign(state, patch);
    },
  });

  const result = await runner.startSub2ApiErrorRefresh({ stateOverride: state });
  assert.equal(result.ok, true);
  assert.deepEqual(deletedIds, [18]);
  assert.equal(historyRuns.length, 1);
  assert.equal(historyRuns[0].deletedAfterReauthFailedCount, 1);
  assert.equal(historyRuns[0].details[0].category, 'deleted_after_reauth_failed');
  assert.match(historyRuns[0].details[0].reason, /oauth login failed/);
  assert.equal(historyRuns[0].allEntries.length, 1);
  assert.equal(historyRuns[0].allEntries[0].status, 'dead_reauth_failed');
  assert.equal(historyRuns[0].allEntries[0].statusLabel, '已判死');
});

test('runner syncs matched plus account successfully', async () => {
  const module = loadRunnerModule();
  const historyRuns = [];
  const deletedIds = [];
  const executedNodes = [];
  const state = {
    sub2apiErrorRefreshEnabled: true,
    hotmailAccounts: [{ id: 'hm_3', email: 'plus@example.com' }],
    sub2apiErrorRefreshStats: {},
    nodeStatuses: {},
  };

  const runner = module.createSub2ApiErrorRefreshRunner({
    addLog: async () => {},
    appendSub2ApiErrorRefreshHistoryRun: async (record) => {
      historyRuns.push(record);
      return record;
    },
    broadcastDataUpdate: () => {},
    deleteSub2ApiAccount: async (_origin, _token, accountId) => {
      deletedIds.push(accountId);
    },
    doesNodeUseCompletionSignal: (nodeId) => nodeId === 'confirm-oauth',
    executeNode: async (nodeId) => {
      executedNodes.push(nodeId);
    },
    executeNodeViaCompletionSignal: async (nodeId) => {
      executedNodes.push(nodeId);
    },
    getErrorMessage: (error) => error?.message || String(error || ''),
    getNextNodeIdForState: (nodeId) => {
      if (nodeId === 'oauth-login') return 'confirm-oauth';
      if (nodeId === 'confirm-oauth') return 'platform-verify';
      if (nodeId === 'platform-verify') return '';
      return '';
    },
    getNodeIdsForState: () => ['open-chatgpt', 'oauth-login', 'confirm-oauth', 'platform-verify'],
    getState: async () => state,
    inspectPlusActivationFromSession: () => ({ active: true, planType: 'plus' }),
    listSub2ApiErrorOpenAiOauthAccounts: async () => [
      { id: 25, status: 'error', credentials: { email: 'plus@example.com' } },
    ],
    loginSub2Api: async () => ({ origin: 'https://sub.example.com', token: 'token' }),
    openSignupEntryTab: async () => {},
    patchHotmailAccount: async () => null,
    readCurrentChatGptSessionForExport: async () => ({ session: { plan_type: 'plus' }, accessToken: 'token' }),
    setState: async (patch) => {
      Object.assign(state, patch);
    },
  });

  const result = await runner.startSub2ApiErrorRefresh({ stateOverride: state });
  assert.equal(result.ok, true);
  assert.deepEqual(deletedIds, []);
  assert.equal(historyRuns.length, 1);
  assert.equal(historyRuns[0].revivedSuccessCount, 1);
  assert.equal(historyRuns[0].details[0].category, 'synced_success');
  assert.equal(historyRuns[0].details[0].planType, 'plus');
  assert.equal(historyRuns[0].allEntries.length, 1);
  assert.equal(historyRuns[0].allEntries[0].status, 'revived_success');
  assert.equal(historyRuns[0].allEntries[0].statusLabel, '已复活');
  assert.ok(executedNodes.includes('open-chatgpt'));
  assert.ok(executedNodes.includes('oauth-login'));
  assert.ok(executedNodes.includes('confirm-oauth'));
  assert.ok(executedNodes.includes('platform-verify'));
});
