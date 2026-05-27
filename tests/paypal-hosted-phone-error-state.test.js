const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPaypalFlow(bodyText) {
  const filePath = path.join(__dirname, '..', 'content', 'paypal-flow.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const attrs = new Map();
  const fakeDocument = {
    readyState: 'complete',
    body: {
      innerText: bodyText,
      textContent: bodyText,
    },
    documentElement: {
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const sandbox = {
    console,
    document: fakeDocument,
    location: {
      href: 'https://www.paypal.com/checkoutweb/review',
      host: 'www.paypal.com',
      pathname: '/checkoutweb/review',
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener: () => {},
        },
        sendMessage: () => {},
      },
    },
    window: {
      getComputedStyle: () => ({
        display: 'block',
        visibility: 'visible',
        opacity: '1',
      }),
    },
    setTimeout,
    clearTimeout,
    MouseEvent: class {},
    PointerEvent: class {},
    Event: class {},
    URL,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox;
}

test('PayPal hosted checkout phone rejection is exposed as guest phone error', () => {
  const sandbox = loadPaypalFlow(
    'We’re unable to complete your request Try a different phone number. OK'
  );

  const state = sandbox.inspectPayPalState();
  assert.equal(state.hostedGuestPhoneError, true);
  assert.match(state.hostedGuestPhoneErrorMessage, /different phone number/i);
});
