const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createFakeDocument() {
  const attrs = new Map();
  const profileInput = {
    disabled: false,
    getAttribute: () => '',
  };

  return {
    readyState: 'complete',
    body: {
      innerText: 'Check your phone Enter the code we sent to +57 318 127 2133',
      textContent: 'Check your phone Enter the code we sent to +57 318 127 2133',
    },
    documentElement: {
      getAttribute: (name) => attrs.get(name) || '',
      setAttribute: (name, value) => attrs.set(name, String(value)),
    },
    querySelector: (selector) => {
      const text = String(selector || '');
      if (text.includes('input[name="name"]') || text.includes('[role="spinbutton"][data-type="year"]')) {
        return profileInput;
      }
      return null;
    },
    querySelectorAll: () => [],
  };
}

function loadSignupPageModule(locationPathname = '/create-account/phone-verification') {
  const filePath = path.join(__dirname, '..', 'content', 'signup-page.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const fakeDocument = createFakeDocument();
  const sandbox = {
    console,
    document: fakeDocument,
    Event: class {},
    KeyboardEvent: class {},
    location: {
      href: `https://auth.openai.com${locationPathname}`,
      pathname: locationPathname,
    },
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
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox;
}

test('signup phone verification page is not treated as already verified when profile fields are present', () => {
  const sandbox = loadSignupPageModule();

  const postVerificationState = sandbox.getStep4PostVerificationState({ ignoreVerificationVisibility: true });
  assert.equal(postVerificationState, null);

  const verificationState = sandbox.inspectSignupVerificationState();
  assert.equal(verificationState.state, 'verification');
  assert.equal(verificationState.phoneVerificationPage, true);
});
