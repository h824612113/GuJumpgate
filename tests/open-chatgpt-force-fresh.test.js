const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep1Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'open-chatgpt.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep1;
}

test('step 1 opens signup entry tab with forceFresh enabled', async () => {
  const module = loadStep1Module();
  const openCalls = [];

  const executor = module.createStep1Executor({
    addLog: async () => {},
    chrome: {},
    completeNodeFromBackground: async () => {},
    openSignupEntryTab: async (...args) => {
      openCalls.push(args);
      return 123;
    },
  });

  await executor.executeStep1();

  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0][0], 1);
  assert.equal(openCalls[0][1]?.forceFresh, true);
});
