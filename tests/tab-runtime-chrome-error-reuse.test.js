const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadTabRuntimeModule() {
  const filePath = path.join(__dirname, '..', 'background', 'tab-runtime.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundTabRuntime;
}

test('reuseOrCreateTab tolerates chrome error page script injection failure and reloads same tab', async () => {
  const module = loadTabRuntimeModule();
  const registryState = {
    tabRegistry: {
      'signup-page': {
        tabId: 99,
        ready: true,
      },
    },
  };
  const updateCalls = [];
  const injectedFiles = [];
  let scriptCallCount = 0;
  let onUpdatedListener = null;

  const runtime = module.createTabRuntime({
    addLog: async () => {},
    chrome: {
      tabs: {
        get: async () => ({ id: 99, url: 'chrome-error://chromewebdata/', windowId: 1 }),
        update: async (tabId, payload) => {
          updateCalls.push({ tabId, payload });
          return { id: tabId, ...payload };
        },
        query: async () => [],
        onUpdated: {
          addListener: (listener) => {
            onUpdatedListener = listener;
            setTimeout(() => {
              if (typeof onUpdatedListener === 'function') {
                onUpdatedListener(99, { status: 'complete' });
              }
            }, 0);
          },
          removeListener: () => {},
        },
      },
      scripting: {
        executeScript: async (payload) => {
          scriptCallCount += 1;
          if (scriptCallCount <= 2) {
            throw new Error('Frame with ID 0 is showing error page');
          }
          injectedFiles.push(payload.files || []);
          return [];
        },
      },
    },
    getSourceLabel: (source) => source,
    getState: async () => registryState,
    isLocalhostOAuthCallbackUrl: () => false,
    isRetryableContentScriptTransportError: () => false,
    LOG_PREFIX: '[test]',
    matchesSourceUrlFamily: () => true,
    setState: async (patch) => {
      Object.assign(registryState, patch);
    },
    sleepWithStop: async () => {},
    STOP_ERROR_MESSAGE: 'stopped',
    throwIfStopped: () => {},
  });

  await runtime.reuseOrCreateTab('signup-page', 'https://chatgpt.com/', {
    inject: ['content/signup-page.js'],
    injectSource: 'signup-page',
    reloadIfSameUrl: false,
  });

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].tabId, 99);
  assert.equal(updateCalls[0].payload.url, 'https://chatgpt.com/');
  assert.equal(updateCalls[0].payload.active, true);
  assert.equal(injectedFiles.length, 0);
});
