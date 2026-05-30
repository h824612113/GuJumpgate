const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractLastFunctionSource(source, signature) {
  const start = source.lastIndexOf(signature);
  if (start < 0) {
    throw new Error(`Signature not found: ${signature}`);
  }
  const paramsStart = source.indexOf('(', start);
  if (paramsStart < 0) {
    throw new Error(`Function parameters not found: ${signature}`);
  }
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
      continue;
    }
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  if (bodyStart < 0) {
    throw new Error(`Function body not found: ${signature}`);
  }
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Function not terminated: ${signature}`);
}

function loadRecoveryHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const extracted = [
    extractLastFunctionSource(source, 'function resolveAlreadyPaidPhoneBindRecoveryNodeId'),
    extractLastFunctionSource(source, 'async function recoverAlreadyPaidPostLoginPhoneBindAutoRunState'),
  ].join('\n\n');
  const sandbox = {
    console,
    isAlreadyPaidPostLoginPhoneBindPending: (state = {}) => Boolean(
      state?.panelMode === 'sub2api'
      && state?.plusModeEnabled
      && state?.phoneVerificationEnabled
      && String(state?.plusAccountAccessStrategy || '').trim().toLowerCase() === 'phone_bind_oauth'
      && state?.plusCheckoutAlreadyPaid
      && state?.plusAlreadyPaidNeedsPostLoginPhoneBind
    ),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('already-paid phone bind recovery only reopens phone-bind tail nodes', async () => {
  const sandbox = loadRecoveryHelpers();
  const sentMessages = [];
  const stateUpdates = [];
  const logs = [];
  const state = {
    panelMode: 'sub2api',
    plusModeEnabled: true,
    phoneVerificationEnabled: true,
    plusAccountAccessStrategy: 'phone_bind_oauth',
    plusCheckoutAlreadyPaid: true,
    plusAlreadyPaidNeedsPostLoginPhoneBind: true,
    nodeStatuses: {
      'plus-checkout-create': 'completed',
      'post-login-phone-verification': 'completed',
      'confirm-oauth': 'completed',
      'platform-verify': 'failed',
    },
  };

  sandbox.getAutoRunWorkflowNodeIds = () => [
    'open-chatgpt',
    'submit-signup-email',
    'fill-password',
    'fetch-signup-code',
    'fill-profile',
    'wait-registration-success',
    'oauth-login',
    'fetch-login-code',
    'post-login-phone-verification',
    'plus-checkout-create',
    'confirm-oauth',
    'platform-verify',
  ];
  sandbox.setState = async (updates) => {
    stateUpdates.push(updates);
  };
  sandbox.chrome = {
    runtime: {
      sendMessage: async (message) => {
        sentMessages.push(message);
      },
    },
  };
  sandbox.addLog = async (message) => {
    logs.push(String(message || ''));
  };

  const recoveryNodeId = await sandbox.recoverAlreadyPaidPostLoginPhoneBindAutoRunState({
    state,
    visibleStep: 9,
    sourceNodeId: 'confirm-oauth',
    reason: 'entered add-phone after already paid',
  });

  assert.equal(recoveryNodeId, 'post-login-phone-verification');
  assert.equal(stateUpdates.length, 1);
  assert.equal(stateUpdates[0].nodeStatuses['plus-checkout-create'], 'completed');
  assert.equal(stateUpdates[0].nodeStatuses['post-login-phone-verification'], 'pending');
  assert.equal(stateUpdates[0].nodeStatuses['confirm-oauth'], 'pending');
  assert.equal(stateUpdates[0].nodeStatuses['platform-verify'], 'pending');
  assert.ok(sentMessages.some((message) => message?.payload?.nodeId === 'post-login-phone-verification'));
  assert.ok(logs.some((message) => message.includes('继续补绑手机')));
});
