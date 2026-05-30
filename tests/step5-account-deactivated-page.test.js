const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSignupPageSandbox({ document, location }) {
  const filePath = path.join(__dirname, '..', 'content', 'signup-page.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    document,
    location,
    chrome: {
      runtime: {
        onMessage: {
          addListener: () => {},
        },
        sendMessage: () => {},
      },
    },
    setTimeout,
    clearTimeout,
    Math,
    URL,
    Event: class {},
    InputEvent: class {},
    KeyboardEvent: class {},
    MouseEvent: class {},
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox;
}

test('step 5 treats account_deactivated page without retry button as direct next-round failure', async () => {
  const attrs = new Map();
  const bodyText = [
    '身份验证错误',
    '你没有账户，因为该账户已被删除或停用。如果你认为这是错误，请通过我们的帮助中心联系。',
    '错误代码：account_deactivated',
  ].join(' ');
  const document = {
    readyState: 'complete',
    title: '身份验证错误',
    body: {
      innerText: bodyText,
      textContent: bodyText,
    },
    documentElement: {
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
    },
    querySelector(selector) {
      if (selector === 'main') {
        return {
          textContent: bodyText,
        };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('button') || selector.includes('[role="button"]')) {
        return [{
          disabled: false,
          textContent: '使用条款',
          value: '',
          getAttribute: (name) => {
            if (name === 'aria-disabled') return 'false';
            return '';
          },
          getBoundingClientRect: () => ({ width: 120, height: 40 }),
        }];
      }
      return [];
    },
  };
  const location = {
    href: 'https://auth.openai.com/email-verification',
    pathname: '/email-verification',
  };

  const sandbox = loadSignupPageSandbox({ document, location });
  sandbox.throwIfStopped = () => {};
  sandbox.sleep = async () => {};
  sandbox.humanPause = async () => {};
  sandbox.log = () => {};
  sandbox.reportComplete = () => {
    throw new Error('reportComplete should not be called when account_deactivated page is shown');
  };
  sandbox.waitForElement = async () => {
    throw new Error('waitForElement should not run before account_deactivated is detected');
  };
  sandbox.isVisibleElement = () => true;
  sandbox.isActionEnabled = () => true;

  await assert.rejects(
    () => sandbox.step5_fillNameBirthday({
      firstName: 'Linda',
      lastName: 'Jones',
      year: 2005,
      month: 10,
      day: 17,
    }),
    /SIGNUP_ACCOUNT_DEACTIVATED::/
  );
});
