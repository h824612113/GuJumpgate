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
    Event: class {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options?.bubbles);
      }
    },
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

test('identity provider mismatch page is treated as replaceable phone error', async () => {
  const errorText = '身份验证错误 你尝试使用与注册时不同的身份验证方式登录。请使用注册时使用的身份验证方式重试。 错误代码：identity_provider_mismatch';
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
      throw new Error('waitForElement should not be called for identity_provider_mismatch pages');
    },
  });

  const submitResult = await helpers.submitPhoneVerificationCode({ code: '982099' });
  const resendResult = helpers.checkPhoneResendError();

  assert.equal(submitResult.invalidCode, true);
  assert.equal(submitResult.phoneNumberUsed, true);
  assert.match(submitResult.errorText, /identity_provider_mismatch|身份验证方式/);
  assert.equal(resendResult.hasError, true);
  assert.equal(resendResult.reason, 'phone_number_used');
  assert.match(resendResult.message, /identity_provider_mismatch|身份验证方式/);
});

test('add-phone page detects maximum-account phone error from page text snapshot', async () => {
  const errorText = '此电话号码已关联到可关联的最多账户。';
  const submitButton = {
    disabled: false,
    getAttribute: () => '',
    textContent: '继续',
  };
  const phoneInput = {
    disabled: false,
    value: '',
    getAttribute: () => '',
    dispatchEvent: () => {},
    closest: () => null,
  };
  const form = {
    querySelector(selector) {
      if (selector.includes('input[type="tel"]') || selector.includes('input[autocomplete="tel"]')) {
        return phoneInput;
      }
      if (selector === 'select') {
        return {
          value: 'US',
          selectedIndex: 0,
          options: [{ value: 'US', textContent: '美国 (+1)' }],
          dispatchEvent: () => {},
        };
      }
      if (selector.includes('button[type="submit"]')) {
        return submitButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('button[type="submit"]')) {
        return [submitButton];
      }
      return [];
    },
  };
  const main = createTextRoot(errorText);
  const document = {
    body: main,
    querySelector(selector) {
      if (selector === 'main') {
        return main;
      }
      if (selector === 'form[action*="/add-phone" i]') {
        return form;
      }
      return null;
    },
  };
  const location = {
    href: 'https://auth.openai.com/add-phone',
    pathname: '/add-phone',
  };
  const module = loadPhoneAuthModule(document, location);
  const helpers = module.createPhoneAuthHelpers({
    fillInput(element, value) {
      element.value = value;
    },
    getActionText: (element) => String(element?.textContent || ''),
    getPageTextSnapshot: () => errorText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => true,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => false,
    isVisibleElement: () => true,
    performOperationWithDelay: async (_metadata, operation) => operation(),
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => {
      throw new Error('waitForElement should not be needed for add-phone maximum-account error');
    },
  });

  const result = await helpers.submitPhoneNumber({
    phoneNumber: '+13392411006',
    countryLabel: '美国',
  });

  assert.equal(result.addPhoneRejected, true);
  assert.match(result.errorText, /最多账户|maximum|phone_number_in_use/i);
});

test('add-phone page surfaces phone verification request-too-frequent error for current number', async () => {
  const errorText = '你请求手机验证的次数过多。请稍后再试。';
  const submitButton = {
    disabled: false,
    getAttribute: () => '',
    textContent: '继续',
  };
  const phoneInput = {
    disabled: false,
    value: '',
    getAttribute: () => '',
    dispatchEvent: () => {},
    closest: () => null,
  };
  const form = {
    querySelector(selector) {
      if (selector.includes('input[type="tel"]') || selector.includes('input[autocomplete="tel"]')) {
        return phoneInput;
      }
      if (selector === 'select') {
        return {
          value: 'US',
          selectedIndex: 0,
          options: [{ value: 'US', textContent: '美国 (+1)' }],
          dispatchEvent: () => {},
        };
      }
      if (selector.includes('button[type="submit"]')) {
        return submitButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('button[type="submit"]')) {
        return [submitButton];
      }
      return [];
    },
  };
  const main = createTextRoot(errorText);
  const document = {
    body: main,
    querySelector(selector) {
      if (selector === 'main') {
        return main;
      }
      if (selector === 'form[action*="/add-phone" i]') {
        return form;
      }
      return null;
    },
  };
  const location = {
    href: 'https://auth.openai.com/add-phone',
    pathname: '/add-phone',
  };
  const module = loadPhoneAuthModule(document, location);
  const helpers = module.createPhoneAuthHelpers({
    fillInput(element, value) {
      element.value = value;
    },
    getActionText: (element) => String(element?.textContent || ''),
    getPageTextSnapshot: () => errorText,
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => true,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => false,
    isVisibleElement: () => true,
    performOperationWithDelay: async (_metadata, operation) => operation(),
    simulateClick() {},
    sleep: async () => {},
    throwIfStopped() {},
    waitForElement: async () => {
      throw new Error('waitForElement should not be needed for add-phone request-too-frequent error');
    },
  });

  const result = await helpers.submitPhoneNumber({
    phoneNumber: '+17313886244',
    countryLabel: '美国',
  });

  assert.equal(result.addPhoneRejected, true);
  assert.match(result.errorText, /请求手机验证的次数过多|请稍后再试/i);
});
