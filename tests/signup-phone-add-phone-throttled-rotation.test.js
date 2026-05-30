const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPhoneVerificationModule() {
  const filePath = path.join(__dirname, '..', 'background', 'phone-verification-flow.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = { console, setTimeout, clearTimeout, URL };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundPhoneVerification;
}

test('step 9 add-phone rotates to a new number when OpenAI says requests are too frequent', async () => {
  const module = loadPhoneVerificationModule();
  const logs = [];
  const stateUpdates = [];
  const submittedNumbers = [];
  const acquiredNumbers = [];
  const bannedActivations = [];
  const returnedToAddPhoneCalls = [];
  const submittedCodes = [];

  const firstActivation = {
    activationId: 'activation-1',
    phoneNumber: '+15550000001',
    provider: 'hero-sms',
    successfulUses: 0,
    maxUses: 3,
    countryId: 1,
    countryLabel: 'USA',
  };
  const secondActivation = {
    activationId: 'activation-2',
    phoneNumber: '+15550000002',
    provider: 'hero-sms',
    successfulUses: 0,
    maxUses: 3,
    countryId: 1,
    countryLabel: 'USA',
  };

  let pageReadCount = 0;
  let currentState = {
    signupPhoneActivation: { ...firstActivation },
    signupPhoneCompletedActivation: null,
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 1,
    heroSmsCountryLabel: 'USA',
    phoneCodeWaitSeconds: 15,
    phoneCodeTimeoutWindows: 1,
    phoneCodePollIntervalSeconds: 1,
    phoneCodePollMaxRounds: 1,
    freePhoneReuseEnabled: false,
    freePhoneReuseAutoEnabled: false,
    nodeStatuses: {},
  };

  const helpers = module.createPhoneVerificationHelpers({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    broadcastDataUpdate: () => {},
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.1': { count: 1 } }),
        };
      }
      if (action === 'getNumber') {
        const next = acquiredNumbers.length === 0 ? firstActivation : secondActivation;
        acquiredNumbers.push(next.phoneNumber);
        return {
          ok: true,
          text: async () => `ACCESS_NUMBER:${next.activationId}:${next.phoneNumber}`,
        };
      }
      if (action === 'setStatus') {
        bannedActivations.push({
          id: parsed.searchParams.get('id'),
          status: parsed.searchParams.get('status'),
        });
        return {
          ok: true,
          text: async () => 'ACCESS_READY',
        };
      }
      if (action === 'getStatus') {
        const id = parsed.searchParams.get('id');
        return {
          ok: true,
          text: async () => (id === 'activation-1' ? 'STATUS_WAIT_CODE' : 'STATUS_OK:222222'),
        };
      }
      throw new Error(`unexpected request: ${parsed.toString()}`);
    },
    getState: async () => currentState,
    getTabId: async () => 777,
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'GET_PHONE_PAGE_STATE') {
        pageReadCount += 1;
        return {
          addPhonePage: pageReadCount <= 2,
          phoneVerificationPage: pageReadCount > 2,
          url: pageReadCount <= 2
            ? 'https://auth.openai.com/add-phone'
            : 'https://auth.openai.com/phone-verification',
        };
      }
      if (message.type === 'SUBMIT_PHONE_NUMBER') {
        submittedNumbers.push(message.payload.phoneNumber);
        if (message.payload.phoneNumber === firstActivation.phoneNumber) {
          return {
            addPhoneRejected: true,
            errorText: '你请求手机验证的次数过多。请稍后再试。',
            url: 'https://auth.openai.com/add-phone',
          };
        }
        return {
          addPhonePage: false,
          phoneVerificationPage: true,
          url: 'https://auth.openai.com/phone-verification',
        };
      }
      if (message.type === 'RETURN_TO_ADD_PHONE') {
        returnedToAddPhoneCalls.push(true);
        return {
          addPhonePage: true,
          phoneVerificationPage: false,
          url: 'https://auth.openai.com/add-phone',
        };
      }
      if (message.type === 'SUBMIT_PHONE_VERIFICATION_CODE') {
        submittedCodes.push(message.payload.code);
        return { ok: true };
      }
      throw new Error(`unexpected message type: ${message.type}`);
    },
    setState: async (updates) => {
      stateUpdates.push(updates);
      currentState = { ...currentState, ...updates };
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });

  const result = await helpers.completePhoneVerificationFlow(777, {
    addPhonePage: true,
    phoneVerificationPage: false,
    url: 'https://auth.openai.com/add-phone',
  }, {
    state: currentState,
    visibleStep: 9,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(submittedNumbers, ['+15550000001', '+15550000002']);
  assert.deepEqual(acquiredNumbers, ['+15550000001', '+15550000002']);
  assert.ok(bannedActivations.some((item) => item.id === 'activation-1' && item.status === '8'));
  assert.deepEqual(submittedCodes, ['222222']);
  assert.ok(logs.some((message) => message.includes('你请求手机验证的次数过多')));
  assert.ok(logs.some((message) => message.includes('添加手机号页面拒绝号码 +15550000001')));
});
