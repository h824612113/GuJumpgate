const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPhoneAuthModule(document, location) {
  const filePath = path.join(__dirname, '..', 'content', 'phone-auth.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    document,
    location,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPagePhoneAuth;
}

function createTextRoot(text) {
  return {
    textContent: text,
    querySelectorAll(selector) {
      if (selector.includes('role="alert"') || selector.includes('aria-live')) {
        return [{ textContent: text }];
      }
      return [];
    },
  };
}

test('phone auth returns invalidCode immediately when verification page reports number in use', async () => {
  const errorText = '糟糕，出错了！该电话号码已被占用。错误代码：phone_number_in_use';
  const main = createTextRoot(errorText);
  const document = {
    body: main,
    querySelector(selector) {
      if (selector === 'main') {
        return main;
      }
      return null;
    },
  };
  const location = {
    href: 'https://auth.openai.com/phone-verification',
    pathname: '/phone-verification',
  };
  const module = loadPhoneAuthModule(document, location);
  let waitedForCodeInput = false;
  const helpers = module.createPhoneAuthHelpers({
    fillInput() {},
    getActionText: () => '',
    getPageTextSnapshot: () => errorText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => false,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => true,
    isVisibleElement: () => true,
    performOperationWithDelay: async (_metadata, operation) => operation(),
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => {
      waitedForCodeInput = true;
      throw new Error('waitForElement should not be called for phone_number_in_use pages');
    },
  });

  const result = await helpers.submitPhoneVerificationCode({ code: '982099' });

  assert.equal(result.invalidCode, true);
  assert.equal(result.phoneNumberUsed, true);
  assert.match(result.errorText, /phone_number_in_use|电话号码已被占用/);
  assert.equal(waitedForCodeInput, false);
});

test('phone resend page probe reports number-in-use as replaceable phone error', () => {
  const errorText = '糟糕，出错了！该电话号码已被占用。错误代码：phone_number_in_use';
  const main = createTextRoot(errorText);
  const document = {
    body: main,
    querySelector(selector) {
      if (selector === 'main') {
        return main;
      }
      return null;
    },
  };
  const location = {
    href: 'https://auth.openai.com/phone-verification',
    pathname: '/phone-verification',
  };
  const module = loadPhoneAuthModule(document, location);
  const helpers = module.createPhoneAuthHelpers({
    getActionText: () => '',
    getPageTextSnapshot: () => errorText,
    getVerificationErrorText: () => '',
    isVisibleElement: () => true,
  });

  const result = helpers.checkPhoneResendError();

  assert.equal(result.hasError, true);
  assert.equal(result.reason, 'phone_number_used');
  assert.match(result.message, /phone_number_in_use|电话号码已被占用/);
});
