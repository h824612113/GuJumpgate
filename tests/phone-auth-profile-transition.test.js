const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('returns immediately when phone verification advances to the signup profile page', async () => {
  const source = fs.readFileSync(require.resolve('../content/phone-auth.js'), 'utf8');
  let phase = 'phone-verification';
  let fakeNow = 0;
  const RealDate = Date;
  class TestDate extends RealDate {
    static now() {
      return fakeNow;
    }
  }

  const input = { disabled: false, getAttribute: () => '', value: '' };
  const button = { disabled: false, getAttribute: () => '' };
  const form = {
    contains: () => false,
    getAttribute: () => '',
    parentElement: null,
    querySelector: () => input,
    querySelectorAll: () => [button],
  };
  const document = {
    body: { innerText: '', textContent: '' },
    querySelector(selector) {
      return phase === 'phone-verification' && String(selector).includes('phone-verification')
        ? form
        : null;
    },
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const context = {
    Date: TestDate,
    document,
    Event,
    globalThis: null,
    location: { href: 'https://auth.openai.com/phone-verification', pathname: '/phone-verification' },
    self: null,
    window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
  };
  context.self = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'content/phone-auth.js' });

  const helpers = context.MultiPagePhoneAuth.createPhoneAuthHelpers({
    fillInput: (element, value) => { element.value = value; },
    getActionText: () => '继续',
    getPageTextSnapshot: () => '',
    getVerificationErrorText: () => '',
    humanPause: async () => {},
    isActionEnabled: () => true,
    isAddPhonePageReady: () => false,
    isConsentReady: () => false,
    isPhoneVerificationPageReady: () => phase === 'phone-verification',
    isSignupProfilePageReady: () => phase === 'profile',
    isVisibleElement: () => true,
    simulateClick: () => { phase = 'profile'; },
    sleep: async (milliseconds = 0) => { fakeNow += Math.max(1, Number(milliseconds) || 1); },
    throwIfStopped: () => {},
    waitForElement: async () => input,
  });

  const result = await helpers.submitPhoneVerificationCode({ code: '123456' });

  assert.equal(result.profilePage, true);
  assert.equal(result.assumed, undefined);
});
