const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createVerificationPageHarness() {
  const source = fs.readFileSync(require.resolve('../content/signup-page.js'), 'utf8');
  const listeners = [];
  const bodyText = '检查您的收件箱 输入我们刚刚向 test@icloud.com 发送的验证码 验证码 继续 重新发送电子邮件 使用条款 隐私政策';
  let fakeNow = 0;
  const RealDate = Date;
  class TestDate extends RealDate {
    static now() {
      return fakeNow;
    }
  }

  const document = {
    title: '',
    readyState: 'complete',
    body: { innerText: bodyText, textContent: bodyText },
    documentElement: {
      getAttribute: () => null,
      setAttribute: () => {},
    },
    querySelector(selector) {
      return String(selector).includes('form[action*="email-verification"') ? {} : null;
    },
    querySelectorAll: () => [],
  };
  const context = {
    AbortController,
    Date: TestDate,
    URL,
    clearTimeout,
    console: { error: () => {}, log: () => {}, warn: () => {} },
    document,
    globalThis: null,
    humanPause: async () => {},
    location: {
      href: 'https://auth.openai.com/email-verification',
      pathname: '/email-verification',
    },
    log: () => {},
    reportError: () => {},
    resetStopState: () => {},
    setTimeout,
    sleep: async (milliseconds = 0) => {
      fakeNow += Math.max(1, Number(milliseconds) || 1);
    },
    isStopError: () => false,
    throwIfStopped: () => {},
    window: null,
    chrome: {
      runtime: {
        onMessage: {
          addListener: (listener) => listeners.push(listener),
        },
      },
    },
  };
  context.window = {
    clearTimeout,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1200,
    outerHeight: 900,
    outerWidth: 1200,
    setTimeout,
  };
  context.self = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'content/signup-page.js' });

  return {
    execute(message) {
      return new Promise((resolve) => {
        listeners[0](message, {}, resolve);
      });
    },
    executeNode(payload) {
      return this.execute({
        type: 'EXECUTE_NODE',
        nodeId: 'submit-signup-email',
        step: 2,
        payload,
      });
    },
  };
}

test('treats an existing signup verification page as a valid step 2 result', async () => {
  const harness = createVerificationPageHarness();

  const result = await harness.executeNode({ email: 'test@icloud.com' });

  assert.equal(result.ok, true);
  assert.equal(result.alreadyOnVerificationPage, true);
  assert.equal(result.url, 'https://auth.openai.com/email-verification');
});

test('treats a signup verification page as a valid registration state probe', async () => {
  const harness = createVerificationPageHarness();

  const result = await harness.execute({
    type: 'ENSURE_SIGNUP_ENTRY_READY',
    step: 2,
    payload: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.state, 'verification_page');
  assert.equal(result.url, 'https://auth.openai.com/email-verification');
});
