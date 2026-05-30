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
  let paramsDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') paramsDepth += 1;
    if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
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

function loadHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const extracted = [
    extractLastFunctionSource(source, 'function isSignupUserAlreadyExistsFailure'),
    extractLastFunctionSource(source, 'function isSignupIdentityProviderMismatchFailure'),
    extractLastFunctionSource(source, 'function isSignupAccountDeactivatedFailure'),
    extractLastFunctionSource(source, 'function isStep8EmailInUseFailure'),
    extractLastFunctionSource(source, 'function isRegistrationIdentityConflictFailure'),
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationFailure'),
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationIdentityConflict'),
    extractLastFunctionSource(source, 'function getRegistrationAccountUnavailableMarking'),
  ].join('\n\n');
  const sandbox = {
    console,
    loggingStatus: null,
    getErrorMessage: (error) => String(error?.message || error || ''),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('stale signup verification without explicit mismatch still marks current registration email unavailable', () => {
  const sandbox = loadHelpers();
  const result = sandbox.getRegistrationAccountUnavailableMarking(
    new Error('STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 URL: https://auth.openai.com/email-verification')
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    logPrefix: '检测到当前注册邮箱命中认证页残留',
    reason: 'stale_signup_verification',
    reasonLabel: '认证页残留',
  });
});

test('account_deactivated marks current registration email unavailable', () => {
  const sandbox = loadHelpers();
  const result = sandbox.getRegistrationAccountUnavailableMarking(
    new Error('SIGNUP_ACCOUNT_DEACTIVATED::步骤 2：检测到 account_deactivated / 账号已删除或停用，当前轮将结束并进入下一轮。')
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    logPrefix: '检测到当前注册邮箱对应账号已删除或停用',
    reason: 'account_deactivated',
    reasonLabel: '账号已删除或停用',
  });
});

test('identity_provider_mismatch marks current registration email unavailable', () => {
  const sandbox = loadHelpers();
  const result = sandbox.getRegistrationAccountUnavailableMarking(
    new Error('SIGNUP_IDENTITY_PROVIDER_MISMATCH::步骤 2：检测到 identity_provider_mismatch / 身份验证方式冲突，当前轮将结束并进入下一轮。')
  );

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    logPrefix: '检测到当前注册邮箱命中身份验证方式冲突',
    reason: 'identity_provider_mismatch',
    reasonLabel: '身份验证方式冲突',
  });
});
