const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const STEP6_SOURCE = fs.readFileSync(
  require.resolve('../background/steps/wait-registration-success.js'),
  'utf8'
);

function createExecutorHarness(overrides = {}) {
  const events = [];
  const logs = [];
  const fetchCalls = [];
  const sentMessages = [];
  const completedNodes = [];
  const context = {
    URL,
    clearTimeout,
    console: {
      error: () => {},
      log: () => {},
      warn: () => {},
    },
    fetch: async (...args) => {
      fetchCalls.push(args);
      events.push('append-request');
      return {
        ok: true,
        status: 200,
        json: async () => {
          events.push('append-response');
          return { ok: true, filePath: '/tmp/chatgpt-session.jsonl' };
        },
      };
    },
    globalThis: null,
    self: null,
    setTimeout,
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(STEP6_SOURCE, context, {
    filename: 'background/steps/wait-registration-success.js',
  });

  const sessionResult = overrides.sessionResult || {
    session: {
      user: {
        id: 'fixture-user-id',
        email: 'fixture@example.test',
      },
      account: {
        id: 'fixture-account-id',
        planType: 'plus',
      },
      sessionToken: 'fixture-session-token',
      metadata: {
        nested: true,
        values: [1, 'two'],
      },
    },
    accessToken: 'fixture-access-token',
  };

  const executor = context.MultiPageBackgroundStep6.createStep6Executor({
    addLog: async (message) => {
      logs.push(String(message));
    },
    buildLocalHelperEndpoint: (baseUrl, path) => `${baseUrl}${path}`,
    chrome: {
      tabs: {
        remove: async (tabId) => {
          events.push(`close-tab:${tabId}`);
        },
      },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      events.push('complete');
      completedNodes.push({ nodeId, payload });
    },
    createAutomationTab: async () => ({ id: 42 }),
    ensureContentScriptReadyOnTab: async () => {},
    getTabId: async () => null,
    normalizeHotmailLocalBaseUrl: (value) => String(value || '').trim().replace(/\/+$/, ''),
    registrationSuccessWaitMs: 0,
    sendToContentScriptResilient: async (source, message, options) => {
      sentMessages.push({ source, message, options });
      return sessionResult;
    },
    sleepWithStop: async () => {},
    ...overrides,
  });

  return {
    completedNodes,
    context,
    events,
    executor,
    fetchCalls,
    logs,
    sessionResult,
    sentMessages,
  };
}

test('appends the complete ChatGPT session as one compact JSONL record before completing step 6', async () => {
  const harness = createExecutorHarness();

  await harness.executor.executeStep6({
    hotmailLocalBaseUrl: 'http://127.0.0.1:17373/',
  });

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0].source, 'plus-checkout');
  assert.equal(harness.sentMessages[0].message.payload.includeSession, true);
  assert.equal(harness.sentMessages[0].message.payload.includeAccessToken, true);

  assert.equal(harness.fetchCalls.length, 1);
  const [endpoint, request] = harness.fetchCalls[0];
  assert.equal(endpoint, 'http://127.0.0.1:17373/append-chatgpt-session');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['Content-Type'], 'application/json');
  assert.equal(
    request.body,
    JSON.stringify({
      content: `${JSON.stringify(harness.sessionResult.session)}\n`,
    })
  );
  assert.ok(harness.events.indexOf('append-response') < harness.events.indexOf('complete'));
  assert.equal(harness.completedNodes.length, 1);
  assert.equal(harness.completedNodes[0].nodeId, 'wait-registration-success');
  assert.deepEqual({ ...harness.completedNodes[0].payload }, {});
  assert.equal(harness.logs.some((message) => message.includes('fixture-session-token')), false);
});

test('rejects an invalid ChatGPT session without completing step 6', async () => {
  const harness = createExecutorHarness({
    sessionResult: {
      session: [],
      accessToken: 'fixture-access-token',
    },
  });

  await assert.rejects(
    () => harness.executor.executeStep6({
      hotmailLocalBaseUrl: 'http://127.0.0.1:17373',
    }),
    /session|会话/i
  );

  assert.equal(harness.fetchCalls.length, 0);
  assert.deepEqual(harness.completedNodes, []);
});
