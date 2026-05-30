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

test('login phone recovery rotates to a new number when old number is reported as in use', async () => {
  const module = loadPhoneVerificationModule();
  const logs = [];
  const stateUpdates = [];
  const submittedCodes = [];
  const requestedNumbers = [];
  const statusChecks = [];
  const setStatusCalls = [];

  let currentState = {
    signupPhoneCompletedActivation: {
      activationId: 'old-activation',
      phoneNumber: '+15550000001',
      provider: 'hero-sms',
      successfulUses: 1,
      maxUses: 3,
      countryId: 1,
      countryLabel: 'USA',
    },
    signupPhoneActivation: null,
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 1,
    heroSmsCountryLabel: 'USA',
    phoneCodeWaitSeconds: 15,
    phoneCodeTimeoutWindows: 1,
    phoneCodePollIntervalSeconds: 1,
    phoneCodePollMaxRounds: 1,
  };

  const helpers = module.createPhoneVerificationHelpers({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');

      if (action === 'reactivate') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'old-activation',
            phoneNumber: '+15550000001',
            provider: 'hero-sms',
            countryId: 1,
            countryLabel: 'USA',
            successfulUses: 1,
            maxUses: 3,
          }),
        };
      }

      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.1': { count: 1 } }),
        };
      }

      if (action === 'getNumber') {
        requestedNumbers.push(parsed.searchParams.get('country'));
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:new-activation:+15550000002',
        };
      }

      if (action === 'getStatus') {
        const id = parsed.searchParams.get('id');
        statusChecks.push(id);
        if (id === 'old-activation') {
          return {
            ok: true,
            text: async () => 'STATUS_OK:111111',
          };
        }
        if (id === 'new-activation') {
          return {
            ok: true,
            text: async () => 'STATUS_OK:222222',
          };
        }
      }

      if (action === 'setStatus') {
        setStatusCalls.push({
          id: parsed.searchParams.get('id'),
          status: parsed.searchParams.get('status'),
        });
        return {
          ok: true,
          text: async () => 'ACCESS_READY',
        };
      }

      throw new Error(`unexpected request: ${parsed.toString()}`);
    },
    getState: async () => currentState,
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'SUBMIT_PHONE_VERIFICATION_CODE') {
        submittedCodes.push(message.payload.code);
        if (message.payload.code === '111111') {
          return {
            invalidCode: true,
            errorText: '该电话号码已被占用。请重试。错误代码：phone_number_in_use',
          };
        }
        return { ok: true };
      }
      if (message.type === 'RESEND_VERIFICATION_CODE') {
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

  const result = await helpers.completeLoginPhoneVerificationFlow(123, {
    state: currentState,
    visibleStep: 11,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(submittedCodes, ['111111', '222222']);
  assert.deepEqual(statusChecks, ['old-activation', 'new-activation']);
  assert.equal(requestedNumbers.length, 1);
  assert.ok(setStatusCalls.some((item) => item.id === 'old-activation' && item.status === '8'));
  assert.ok(stateUpdates.some((update) => update.signupPhoneNumber === '+15550000002'));
  assert.ok(logs.some((message) => message.includes('被提示已占用，立即更换新号码继续恢复')));
  assert.ok(logs.some((message) => message.includes('已切换为新号码 +15550000002')));
});

test('login phone recovery rotates to a new number when old number hits identity provider mismatch', async () => {
  const module = loadPhoneVerificationModule();
  const logs = [];
  const stateUpdates = [];
  const submittedCodes = [];
  const requestedNumbers = [];
  const statusChecks = [];
  const setStatusCalls = [];

  let currentState = {
    signupPhoneCompletedActivation: {
      activationId: 'old-activation',
      phoneNumber: '+15550000001',
      provider: 'hero-sms',
      successfulUses: 1,
      maxUses: 3,
      countryId: 1,
      countryLabel: 'USA',
    },
    signupPhoneActivation: null,
    phoneSmsProvider: 'hero-sms',
    heroSmsApiKey: 'hero-key',
    heroSmsCountryId: 1,
    heroSmsCountryLabel: 'USA',
    phoneCodeWaitSeconds: 15,
    phoneCodeTimeoutWindows: 1,
    phoneCodePollIntervalSeconds: 1,
    phoneCodePollMaxRounds: 1,
  };

  const helpers = module.createPhoneVerificationHelpers({
    addLog: async (message) => {
      logs.push(String(message || ''));
    },
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');

      if (action === 'reactivate') {
        return {
          ok: true,
          text: async () => JSON.stringify({
            activationId: 'old-activation',
            phoneNumber: '+15550000001',
            provider: 'hero-sms',
            countryId: 1,
            countryLabel: 'USA',
            successfulUses: 1,
            maxUses: 3,
          }),
        };
      }

      if (action === 'getPrices') {
        return {
          ok: true,
          text: async () => JSON.stringify({ '0.1': { count: 1 } }),
        };
      }

      if (action === 'getNumber') {
        requestedNumbers.push(parsed.searchParams.get('country'));
        return {
          ok: true,
          text: async () => 'ACCESS_NUMBER:new-activation:+15550000002',
        };
      }

      if (action === 'getStatus') {
        const id = parsed.searchParams.get('id');
        statusChecks.push(id);
        if (id === 'old-activation') {
          return {
            ok: true,
            text: async () => 'STATUS_OK:111111',
          };
        }
        if (id === 'new-activation') {
          return {
            ok: true,
            text: async () => 'STATUS_OK:222222',
          };
        }
      }

      if (action === 'setStatus') {
        setStatusCalls.push({
          id: parsed.searchParams.get('id'),
          status: parsed.searchParams.get('status'),
        });
        return {
          ok: true,
          text: async () => 'ACCESS_READY',
        };
      }

      throw new Error(`unexpected request: ${parsed.toString()}`);
    },
    getState: async () => currentState,
    sendToContentScriptResilient: async (_source, message) => {
      if (message.type === 'SUBMIT_PHONE_VERIFICATION_CODE') {
        submittedCodes.push(message.payload.code);
        if (message.payload.code === '111111') {
          return {
            invalidCode: true,
            errorText: '身份验证错误：你尝试使用与注册时不同的身份验证方式登录。错误代码：identity_provider_mismatch',
          };
        }
        return { ok: true };
      }
      if (message.type === 'RESEND_VERIFICATION_CODE') {
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

  const result = await helpers.completeLoginPhoneVerificationFlow(123, {
    state: currentState,
    visibleStep: 11,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(submittedCodes, ['111111', '222222']);
  assert.deepEqual(statusChecks, ['old-activation', 'new-activation']);
  assert.equal(requestedNumbers.length, 1);
  assert.ok(setStatusCalls.some((item) => item.id === 'old-activation' && item.status === '8'));
  assert.ok(stateUpdates.some((update) => update.signupPhoneNumber === '+15550000002'));
  assert.ok(logs.some((message) => message.includes('identity_provider_mismatch')));
  assert.ok(logs.some((message) => message.includes('已切换为新号码 +15550000002')));
});
