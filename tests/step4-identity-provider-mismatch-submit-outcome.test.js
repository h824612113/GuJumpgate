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

test('step 4 submit outcome throws identity_provider_mismatch instead of assuming success', async () => {
  const attrs = new Map();
  const bodyText = [
    '身份验证错误',
    '你尝试使用与注册时不同的身份验证方式登录。请使用注册时使用的身份验证方式重试。',
    '错误代码：identity_provider_mismatch',
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
        return { textContent: bodyText };
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
  sandbox.log = () => {};
  sandbox.humanPause = async () => {};
  sandbox.isVisibleElement = () => true;
  sandbox.isActionEnabled = () => true;

  await assert.rejects(
    () => sandbox.waitForVerificationSubmitOutcome(4, 50, { purpose: 'email' }),
    /SIGNUP_IDENTITY_PROVIDER_MISMATCH::/
  );
});
