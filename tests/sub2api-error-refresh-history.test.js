const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadHistoryModule() {
  const filePath = path.join(__dirname, '..', 'background', 'sub2api-error-refresh-history.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        filePath: '/tmp/sub2api-error-refresh-history.json',
      }),
    }),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundSub2ApiErrorRefreshHistory;
}

test('history helper appends run, builds categorized lists, and returns synced file path', async () => {
  const module = loadHistoryModule();
  const storage = {};
  const helper = module.createSub2ApiErrorRefreshHistoryHelpers({
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] || [] }),
          set: async (payload) => {
            Object.assign(storage, payload);
          },
        },
      },
    },
    addLog: async () => {},
    buildLocalHelperEndpoint: (baseUrl, endpointPath) => `${baseUrl}${endpointPath}`,
    getState: async () => ({
      accountRunHistoryHelperBaseUrl: 'http://127.0.0.1:17373',
    }),
    normalizeAccountRunHistoryHelperBaseUrl: (value) => String(value || '').trim(),
  });

  const result = await helper.appendSub2ApiErrorRefreshHistoryRun({
    runId: 'run_1',
    startedAt: '2026-05-28T10:00:00.000Z',
    finishedAt: '2026-05-28T10:10:00.000Z',
    totalRemoteErrors: 3,
    processedCount: 3,
    revivedSuccessCount: 1,
    deletedAfterReauthFailedCount: 1,
    notFoundLocallyCount: 1,
    details: [
      {
        email: 'ok@example.com',
        remoteAccountId: 1,
        localAccountId: 'hm_ok',
        category: 'synced_success',
        reason: '',
        planType: 'plus',
        processedAt: '2026-05-28T10:01:00.000Z',
      },
      {
        email: 'delete@example.com',
        remoteAccountId: 2,
        localAccountId: 'hm_delete',
        category: 'deleted_after_reauth_failed',
        reason: 'oauth failed',
        planType: '',
        processedAt: '2026-05-28T10:02:00.000Z',
      },
      {
        email: 'missing@example.com',
        remoteAccountId: 3,
        localAccountId: '',
        category: 'not_found_locally',
        reason: '本地邮箱池未找到对应账号',
        planType: '',
        processedAt: '2026-05-28T10:03:00.000Z',
      },
    ],
  });

  assert.equal(result.filePath, '/tmp/sub2api-error-refresh-history.json');
  assert.equal(result.revivedEntries.length, 1);
  assert.equal(result.revivedEntries[0].email, 'ok@example.com');
  assert.equal(result.deletedEntries.length, 1);
  assert.equal(result.deletedEntries[0].email, 'delete@example.com');
  assert.equal(result.notFoundEntries.length, 1);
  assert.equal(result.notFoundEntries[0].email, 'missing@example.com');
  assert.equal(result.allEntries.length, 3);
  assert.equal(result.allEntries[0].status, 'not_found_locally');

  const savedRuns = storage.sub2apiErrorRefreshHistory;
  assert.equal(savedRuns.length, 1);
  assert.equal(savedRuns[0].revivedEntries.length, 1);
  assert.equal(savedRuns[0].deletedEntries.length, 1);
  assert.equal(savedRuns[0].notFoundEntries.length, 1);
  assert.equal(savedRuns[0].allEntries.length, 3);
});

test('history helper backfills all error entries from legacy details so processed accounts stay visible', async () => {
  const module = loadHistoryModule();
  const storage = {
    sub2apiErrorRefreshHistory: [
      {
        runId: 'legacy_run',
        startedAt: '2026-05-27T10:00:00.000Z',
        finishedAt: '2026-05-27T10:05:00.000Z',
        totalRemoteErrors: 4,
        details: [
          {
            email: 'revived@example.com',
            remoteAccountId: 11,
            localAccountId: 'hm_revived',
            category: 'synced_success',
            reason: '',
            planType: 'plus',
            processedAt: '2026-05-27T10:01:00.000Z',
          },
          {
            email: 'dead@example.com',
            remoteAccountId: 12,
            localAccountId: 'hm_dead',
            category: 'deleted_non_plus',
            reason: '当前会话未检测到 Plus',
            planType: 'free',
            processedAt: '2026-05-27T10:02:00.000Z',
          },
          {
            email: 'missing@example.com',
            remoteAccountId: 13,
            localAccountId: '',
            category: 'not_found_locally',
            reason: '本地邮箱池未找到对应账号',
            planType: '',
            processedAt: '2026-05-27T10:03:00.000Z',
          },
        ],
      },
    ],
  };
  const helper = module.createSub2ApiErrorRefreshHistoryHelpers({
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] || [] }),
          set: async (payload) => {
            Object.assign(storage, payload);
          },
        },
      },
    },
    addLog: async () => {},
    normalizeAccountRunHistoryHelperBaseUrl: (value) => String(value || '').trim(),
  });

  const history = await helper.getPersistedSub2ApiErrorRefreshHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].allEntries.length, 3);
  assert.equal(history[0].allEntries[0].email, 'missing@example.com');
  assert.equal(history[0].allEntries[0].status, 'not_found_locally');
  assert.equal(history[0].allEntries[1].email, 'dead@example.com');
  assert.equal(history[0].allEntries[1].status, 'dead_non_plus');
  assert.equal(history[0].allEntries[2].email, 'revived@example.com');
  assert.equal(history[0].allEntries[2].status, 'revived_success');
});

test('history helper merges partial allEntries with details instead of dropping missing remote errors', async () => {
  const module = loadHistoryModule();
  const storage = {
    sub2apiErrorRefreshHistory: [
      {
        runId: 'partial_run',
        startedAt: '2026-05-27T11:00:00.000Z',
        finishedAt: '2026-05-27T11:05:00.000Z',
        totalRemoteErrors: 3,
        allEntries: [
          {
            email: 'revived@example.com',
            remoteAccountId: 21,
            localAccountId: 'hm_revived',
            category: 'synced_success',
            status: 'revived_success',
            statusLabel: '已复活',
            reason: '',
            planType: 'plus',
            processedAt: '2026-05-27T11:01:00.000Z',
          },
        ],
        details: [
          {
            email: 'revived@example.com',
            remoteAccountId: 21,
            localAccountId: 'hm_revived',
            category: 'synced_success',
            reason: '',
            planType: 'plus',
            processedAt: '2026-05-27T11:01:00.000Z',
          },
          {
            email: 'dead@example.com',
            remoteAccountId: 22,
            localAccountId: 'hm_dead',
            category: 'deleted_after_reauth_failed',
            reason: 'oauth failed',
            planType: '',
            processedAt: '2026-05-27T11:02:00.000Z',
          },
          {
            email: 'missing@example.com',
            remoteAccountId: 23,
            localAccountId: '',
            category: 'not_found_locally',
            reason: '本地邮箱池未找到对应账号',
            planType: '',
            processedAt: '2026-05-27T11:03:00.000Z',
          },
        ],
      },
    ],
  };
  const helper = module.createSub2ApiErrorRefreshHistoryHelpers({
    chrome: {
      storage: {
        local: {
          get: async (key) => ({ [key]: storage[key] || [] }),
          set: async (payload) => {
            Object.assign(storage, payload);
          },
        },
      },
    },
    addLog: async () => {},
    normalizeAccountRunHistoryHelperBaseUrl: (value) => String(value || '').trim(),
  });

  const history = await helper.getPersistedSub2ApiErrorRefreshHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].allEntries.length, 3);
  assert.equal(history[0].allEntries[0].email, 'missing@example.com');
  assert.equal(history[0].allEntries[0].status, 'not_found_locally');
  assert.equal(history[0].allEntries[1].email, 'dead@example.com');
  assert.equal(history[0].allEntries[1].status, 'dead_reauth_failed');
  assert.equal(history[0].allEntries[2].email, 'revived@example.com');
  assert.equal(history[0].allEntries[2].status, 'revived_success');
  assert.equal(history[0].allEntries[2].planType, 'plus');
});
