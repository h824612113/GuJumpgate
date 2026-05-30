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

test('step 5 fails with dedicated stale verification error when auth page stays on email-verification', async () => {
  const attrs = new Map();
  const document = {
    readyState: 'complete',
    title: 'Email verification',
    body: {
      innerText: 'Enter the code we sent to your email Continue Resend code',
      textContent: 'Enter the code we sent to your email Continue Resend code',
    },
    documentElement: {
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
    },
    querySelector(selector) {
      if (selector === 'form[action*="email-verification" i]') {
        return {};
      }
      if (selector.includes('input[name="code"]')) {
        return {
          disabled: false,
          getAttribute: () => '',
          getBoundingClientRect: () => ({ width: 120, height: 40 }),
        };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('button') || selector.includes('[role="button"]')) {
        return [{
          disabled: false,
          textContent: 'Continue',
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
    throw new Error('reportComplete should not be called when verification page is stale');
  };
  sandbox.waitForElement = async () => {
    throw new Error('waitForElement should not run before stale verification is detected');
  };
  sandbox.isVisibleElement = () => true;
  sandbox.isActionEnabled = () => true;

  await assert.rejects(
    () => sandbox.step5_fillNameBirthday({
      firstName: 'William',
      lastName: 'Hernandez',
      year: 2007,
      month: 8,
      day: 12,
    }),
    /STEP5_STALE_SIGNUP_VERIFICATION::/
  );
});
