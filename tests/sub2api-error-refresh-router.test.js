const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMessageRouterModule() {
  const filePath = path.join(__dirname, '..', 'background', 'message-router.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundMessageRouter;
}

test('GET_SUB2API_ERROR_REFRESH_HISTORY returns both history and restored file path', async () => {
  const module = loadMessageRouterModule();
  const history = [{ runId: 'run_1', allEntries: [{ email: 'a@example.com' }] }];
  const router = module.createMessageRouter({
    addLog: async () => {},
    getState: async () => ({
      sub2apiErrorRefreshHistoryPath: '/Users/hanhao/Documents/Gujump-author/data/sub2api-error-refresh-history.json',
    }),
    getSub2ApiErrorRefreshHistory: async () => history,
  });

  const response = await router.handleMessage({
    type: 'GET_SUB2API_ERROR_REFRESH_HISTORY',
    source: 'sidepanel',
  });

  assert.equal(response.ok, true);
  assert.deepEqual(response.history, history);
  assert.equal(
    response.filePath,
    '/Users/hanhao/Documents/Gujump-author/data/sub2api-error-refresh-history.json'
  );
});
