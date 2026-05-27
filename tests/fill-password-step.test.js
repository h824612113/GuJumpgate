const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadStep3Module() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'fill-password.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundStep3;
}

function loadStep3Sandbox() {
  const filePath = path.join(__dirname, '..', 'background', 'steps', 'fill-password.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox;
}

test('phone signup step 3 generates, persists, and sends a password when state has none', async () => {
  const module = loadStep3Module();
  const sentMessages = [];
  const stateUpdates = [];
  let persistedPassword = '';

  const executor = module.createStep3Executor({
    addLog: async () => {},
    appendAccountRunRecord: async () => {},
    chrome: { tabs: { update: async () => {} } },
    ensureContentScriptReadyOnTab: async () => {},
    generatePassword: () => '',
    getTabId: async () => 123,
    isTabAlive: async () => true,
    resolveSignupMethod: () => 'phone',
    sendToContentScript: async (_source, message) => {
      sentMessages.push(message);
    },
    setPasswordState: async (password) => {
      persistedPassword = password;
    },
    setState: async (updates) => {
      stateUpdates.push(updates);
    },
    SIGNUP_PAGE_INJECT_FILES: [],
  });

  await executor.executeStep3({
    signupMethod: 'phone',
    signupPhoneNumber: '+573181272133',
    accounts: [],
  });

  assert.equal(persistedPassword.length, 14);
  assert.match(persistedPassword, /[A-Z]/);
  assert.match(persistedPassword, /[a-z]/);
  assert.match(persistedPassword, /\d/);
  assert.match(persistedPassword, /[!@#$%&*?]/);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].payload.password, persistedPassword);
  assert.equal(sentMessages[0].payload.accountIdentifierType, 'phone');
  assert.equal(sentMessages[0].payload.accountIdentifier, '+573181272133');
  assert.equal(stateUpdates.length, 1);
  assert.equal(stateUpdates[0].accounts[0].password, persistedPassword);
});

test('phone signup step 3 directly fills new-password input and completes when scripting is available', async () => {
  const module = loadStep3Module();
  const sentMessages = [];
  const completionPayloads = [];
  let executedArgs = null;
  let executedOptions = null;
  let persistedPassword = '';

  const executor = module.createStep3Executor({
    addLog: async () => {},
    appendAccountRunRecord: async () => {},
    chrome: {
      scripting: {
        executeScript: async (options) => {
          executedOptions = options;
          executedArgs = options.args;
          return [{
            result: {
              ok: true,
              inputName: 'new-password',
              inputId: '_r_4_-new-password',
              valueLength: String(options.args[0] || '').length,
              buttonText: '继续',
              url: 'https://auth.openai.com/create-account/password',
            },
          }];
        },
      },
      tabs: { update: async () => {} },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completionPayloads.push({ nodeId, payload });
    },
    ensureContentScriptReadyOnTab: async () => {},
    generatePassword: () => '',
    getTabId: async () => 123,
    isTabAlive: async () => true,
    resolveSignupMethod: () => 'phone',
    sendToContentScript: async (_source, message) => {
      sentMessages.push(message);
    },
    setPasswordState: async (password) => {
      persistedPassword = password;
    },
    setState: async () => {},
    SIGNUP_PAGE_INJECT_FILES: [],
  });

  await executor.executeStep3({
    signupMethod: 'phone',
    signupPhoneNumber: '+573181272133',
    accounts: [],
  });

  assert.equal(executedOptions.world, 'MAIN');
  assert.equal(executedArgs.length, 1);
  assert.equal(executedArgs[0], persistedPassword);
  assert.equal(persistedPassword.length, 14);
  assert.equal(sentMessages.length, 0);
  assert.equal(completionPayloads.length, 1);
  assert.equal(completionPayloads[0].nodeId, 'fill-password');
  assert.equal(completionPayloads[0].payload.password, persistedPassword);
  assert.equal(completionPayloads[0].payload.directPasswordFill, true);
  assert.equal(completionPayloads[0].payload.directFillResult.inputName, 'new-password');
});

test('phone signup step 3 injected script writes actual new-password input and advances', async () => {
  const sandbox = loadStep3Sandbox();
  const module = sandbox.MultiPageBackgroundStep3;
  const completionPayloads = [];
  let clicked = false;
  let inputEvents = 0;

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = Boolean(init.bubbles);
      this.cancelable = Boolean(init.cancelable);
    }
  }
  class FakeInputEvent extends FakeEvent {}
  class FakeKeyboardEvent extends FakeEvent {}
  class FakeMouseEvent extends FakeEvent {}
  class FakeHTMLInputElement {
    constructor() {
      this._value = '';
      this.name = 'new-password';
      this.id = '_r_4_-new-password';
      this.type = 'password';
      this.visible = true;
      this.disabled = false;
      this.attributes = new Map([
        ['name', 'new-password'],
        ['autocomplete', 'new-password'],
        ['id', '_r_4_-new-password'],
        ['type', 'password'],
      ]);
    }
    get value() {
      return this._value;
    }
    set value(nextValue) {
      this._value = String(nextValue || '');
    }
    focus() {}
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'value') this._value = String(value);
    }
    getAttribute(name) {
      return this.attributes.get(name) || '';
    }
    dispatchEvent(event) {
      if (event?.type === 'input') inputEvents += 1;
      return true;
    }
    getBoundingClientRect() {
      return this.visible ? { width: 320, height: 48 } : { width: 0, height: 0 };
    }
    closest() {
      return fakeForm;
    }
  }
  const input = new FakeHTMLInputElement();
  const button = {
    disabled: false,
    type: 'submit',
    visible: true,
    textContent: '继续',
    innerText: '继续',
    value: '',
    getAttribute: (name) => (name === 'type' ? 'submit' : ''),
    dispatchEvent: () => true,
    getBoundingClientRect: () => ({ width: 120, height: 44 }),
    click: () => {
      clicked = true;
      input.visible = false;
      sandbox.location.href = 'https://auth.openai.com/create-account/phone-verification';
      sandbox.location.pathname = '/create-account/phone-verification';
      sandbox.document.body.innerText = 'Check your phone Enter the code we sent';
      sandbox.document.body.textContent = sandbox.document.body.innerText;
    },
  };
  const queryAll = (selector) => {
    const text = String(selector || '');
    if (text.includes('new-password') || text.includes('password')) return [input];
    if (text.includes('button') || text.includes('submit')) return [button];
    return [];
  };
  const fakeForm = {
    querySelectorAll: queryAll,
  };
  input.form = fakeForm;
  sandbox.document = {
    body: {
      innerText: 'Create your account Password',
      textContent: 'Create your account Password',
    },
    querySelectorAll: queryAll,
    querySelector: (selector) => queryAll(selector)[0] || null,
  };
  sandbox.location = {
    href: 'https://auth.openai.com/create-account/password',
    pathname: '/create-account/password',
  };
  sandbox.window = sandbox;
  sandbox.Event = FakeEvent;
  sandbox.InputEvent = FakeInputEvent;
  sandbox.KeyboardEvent = FakeKeyboardEvent;
  sandbox.MouseEvent = FakeMouseEvent;
  sandbox.HTMLInputElement = FakeHTMLInputElement;
  sandbox.getComputedStyle = (element) => ({
    display: element?.visible === false ? 'none' : 'block',
    visibility: element?.visible === false ? 'hidden' : 'visible',
  });

  const executor = module.createStep3Executor({
    addLog: async () => {},
    appendAccountRunRecord: async () => {},
    chrome: {
      scripting: {
        executeScript: async (options) => [{ result: await options.func(options.args[0]) }],
      },
      tabs: { update: async () => {} },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completionPayloads.push({ nodeId, payload });
    },
    ensureContentScriptReadyOnTab: async () => {},
    generatePassword: () => 'Aa2!testPass99',
    getTabId: async () => 123,
    isTabAlive: async () => true,
    resolveSignupMethod: () => 'phone',
    sendToContentScript: async () => {
      throw new Error('content fallback should not be used');
    },
    setPasswordState: async () => {},
    setState: async () => {},
    SIGNUP_PAGE_INJECT_FILES: [],
  });

  await executor.executeStep3({
    signupMethod: 'phone',
    signupPhoneNumber: '+573181272133',
    accounts: [],
  });

  assert.equal(input.value, 'Aa2!testPass99');
  assert.equal(clicked, true);
  assert.equal(inputEvents > 0, true);
  assert.equal(completionPayloads.length, 1);
  assert.equal(completionPayloads[0].payload.directFillResult.inputName, 'new-password');
  assert.equal(completionPayloads[0].payload.directFillResult.transition.phoneVerificationPage, true);
});

test('phone signup step 3 fails instead of completing when direct password fill remains on password page', async () => {
  const module = loadStep3Module();
  const sentMessages = [];
  const completionPayloads = [];
  let persistedPassword = '';

  const executor = module.createStep3Executor({
    addLog: async () => {},
    appendAccountRunRecord: async () => {},
    chrome: {
      scripting: {
        executeScript: async (options) => ([{
          result: {
            ok: false,
            fatal: true,
            error: '密码已写入并点击继续，但页面仍停留在密码页。当前密码长度=0。',
            inputName: 'new-password',
            inputId: '_r_4_-new-password',
            valueLength: 0,
            url: 'https://auth.openai.com/create-account/password',
            argsLength: options.args.length,
          },
        }]),
      },
      tabs: { update: async () => {} },
    },
    completeNodeFromBackground: async (nodeId, payload) => {
      completionPayloads.push({ nodeId, payload });
    },
    ensureContentScriptReadyOnTab: async () => {},
    generatePassword: () => '',
    getTabId: async () => 123,
    isTabAlive: async () => true,
    resolveSignupMethod: () => 'phone',
    sendToContentScript: async (_source, message) => {
      sentMessages.push(message);
    },
    setPasswordState: async (password) => {
      persistedPassword = password;
    },
    setState: async () => {},
    SIGNUP_PAGE_INJECT_FILES: [],
  });

  await assert.rejects(
    () => executor.executeStep3({
      signupMethod: 'phone',
      signupPhoneNumber: '+573181272133',
      accounts: [],
    }),
    /手机号注册密码自动填写失败/
  );

  assert.equal(persistedPassword.length, 14);
  assert.equal(sentMessages.length, 0);
  assert.equal(completionPayloads.length, 0);
});
