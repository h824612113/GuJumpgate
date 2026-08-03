const test = require('node:test');
const assert = require('node:assert/strict');

const mixedMailboxUtils = require('../mixed-mailbox-utils');

function createElement(initial = {}) {
  const listeners = new Map();
  return {
    disabled: false,
    value: '',
    classList: { toggle() {} },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    setAttribute() {},
    async dispatch(type, event = {}) {
      return listeners.get(type)?.({ target: this, ...event });
    },
    ...initial,
  };
}

function loadHotmailManagerModule() {
  const modulePath = require.resolve('../sidepanel/hotmail-manager');
  delete require.cache[modulePath];
  global.window = {};
  require(modulePath);
  return global.window.SidepanelHotmailManager;
}

test('routes URL mailbox records from the legacy Hotmail bulk importer into the mixed queue', async () => {
  const module = loadHotmailManagerModule();
  const inputHotmailImport = createElement({
    value: [
      'alias@icloud.com----http://yangyang.website/messages/',
      'token-a/alias@icloud.com',
    ].join('\n'),
  });
  const btnImportHotmailAccounts = createElement();
  const messages = [];
  const toasts = [];
  let mixedImportResult = null;

  const manager = module.createHotmailManager({
    state: {
      getLatestState: () => ({}),
      syncLatestState() {},
    },
    dom: {
      inputHotmailImport,
      btnImportHotmailAccounts,
      selectMailProvider: createElement({ value: 'hotmail-api' }),
      inputEmail: createElement(),
    },
    helpers: {
      getHotmailAccounts: () => [],
      getCurrentHotmailEmail: () => '',
      showToast: (message, type) => toasts.push({ message, type }),
      onMixedMailboxImported: async (result) => {
        mixedImportResult = result;
      },
    },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        if (message.type === 'IMPORT_MIXED_MAILBOX_QUEUE') {
          return {
            ok: true,
            entries: [{ id: 'icloud-one', type: 'icloud-url', email: 'alias@icloud.com' }],
            addedCount: 1,
            updatedCount: 0,
            errors: [],
          };
        }
        if (message.type === 'GET_STATE') {
          return { state: { mixedMailboxQueueEntries: [] } };
        }
        throw new Error(`unexpected message: ${message.type}`);
      },
    },
    hotmailUtils: {
      parseHotmailImportText: () => [],
    },
    mixedMailboxUtils,
  });

  manager.bindHotmailEvents();
  await btnImportHotmailAccounts.dispatch('click');

  assert.deepEqual(messages.map((message) => message.type), [
    'IMPORT_MIXED_MAILBOX_QUEUE',
    'GET_STATE',
  ]);
  assert.equal(mixedImportResult.addedCount, 1);
  assert.equal(inputHotmailImport.value, '');
  assert.equal(toasts.some(({ message }) => message.includes('没有解析到有效账号')), false);
  assert.equal(toasts.at(-1).type, 'success');
});
