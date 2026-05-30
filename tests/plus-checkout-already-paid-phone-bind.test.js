const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPlusCheckoutModule() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'create-plus-checkout.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundPlusCheckoutCreate;
}

test('already paid checkout marks post-login phone bind continuation only for sub2api phone_bind_oauth', async () => {
  const module = loadPlusCheckoutModule();
  const stateUpdates = [];
  const completionPayloads = [];
  const logMessages = [];
  const state = {
    panelMode: 'sub2api',
    plusModeEnabled: true,
    plusPaymentMethod: 'paypal',
    plusAccountAccessStrategy: 'phone_bind_oauth',
    phoneVerificationEnabled: true,
  };

  const executor = module.createPlusCheckoutCreateExecutor({
    addLog: async (message) => {
      logMessages.push(String(message || ''));
    },
    chrome: {
      tabs: {
        create: async () => ({ id: 321, url: 'https://chatgpt.com/' }),
        get: async () => ({ id: 321, url: 'https://chatgpt.com/' }),
        update: async () => {},
      },
    },
    completeNodeFromBackground: async (_nodeId, payload) => {
      completionPayloads.push(payload);
    },
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    fetch: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        detail: 'User is already paid',
      }),
      text: async () => JSON.stringify({
        detail: 'User is already paid',
      }),
    }),
    getState: async () => state,
    registerTab: () => {},
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      if (message?.type === 'PLUS_CHECKOUT_GET_STATE') {
        return { accessToken: 'access-token' };
      }
      throw new Error(`unexpected message type: ${message?.type}`);
    },
    setNodeStatus: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    waitForTabCompleteUntilStopped: async () => {},
  });

  await executor.executePlusCheckoutCreate({
    ...state,
    nodeId: 'plus-checkout-create',
    plusCheckoutCloudConversionEnabled: true,
    plusCheckoutCloudConversionApiUrl: 'https://example.test/api/checkout',
    plusCheckoutCloudConversionApiKey: 'api-key',
  });

  assert.equal(completionPayloads.length, 1);
  assert.equal(completionPayloads[0].plusCheckoutAlreadyPaid, true);
  assert.ok(stateUpdates.some((updates) => updates.plusCheckoutAlreadyPaid === true));
  assert.ok(stateUpdates.some((updates) => updates.plusAlreadyPaidNeedsPostLoginPhoneBind === true));
  assert.ok(logMessages.some((message) => message.includes('当前用户已有订阅')));
});

test('already paid checkout does not enable post-login phone bind continuation outside sub2api phone_bind_oauth', async () => {
  const module = loadPlusCheckoutModule();
  const stateUpdates = [];
  const state = {
    panelMode: 'cpa',
    plusModeEnabled: true,
    plusPaymentMethod: 'paypal',
    plusAccountAccessStrategy: 'oauth',
    phoneVerificationEnabled: true,
  };

  const executor = module.createPlusCheckoutCreateExecutor({
    addLog: async () => {},
    chrome: {
      tabs: {
        create: async () => ({ id: 321, url: 'https://chatgpt.com/' }),
        get: async () => ({ id: 321, url: 'https://chatgpt.com/' }),
        update: async () => {},
      },
    },
    completeNodeFromBackground: async () => {},
    ensureContentScriptReadyOnTabUntilStopped: async () => {},
    fetch: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        detail: 'User is already paid',
      }),
      text: async () => JSON.stringify({
        detail: 'User is already paid',
      }),
    }),
    getState: async () => state,
    registerTab: () => {},
    sendTabMessageUntilStopped: async (_tabId, _source, message) => {
      if (message?.type === 'PLUS_CHECKOUT_GET_STATE') {
        return { accessToken: 'access-token' };
      }
      throw new Error(`unexpected message type: ${message?.type}`);
    },
    setNodeStatus: async () => {},
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
    waitForTabCompleteUntilStopped: async () => {},
  });

  await executor.executePlusCheckoutCreate({
    ...state,
    nodeId: 'plus-checkout-create',
    plusCheckoutCloudConversionEnabled: true,
    plusCheckoutCloudConversionApiUrl: 'https://example.test/api/checkout',
    plusCheckoutCloudConversionApiKey: 'api-key',
  });

  assert.ok(stateUpdates.some((updates) => updates.plusCheckoutAlreadyPaid === true));
  assert.ok(stateUpdates.some((updates) => updates.plusAlreadyPaidNeedsPostLoginPhoneBind === false));
});
