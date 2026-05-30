const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function extractLastFunctionSource(source, signature) {
  const start = source.lastIndexOf(signature);
  if (start === -1) {
    throw new Error(`Missing signature: ${signature}`);
  }
  const paramsStart = source.indexOf('(', start);
  if (paramsStart === -1) {
    throw new Error(`Missing params start for: ${signature}`);
  }
  let paramsDepth = 0;
  let braceStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      paramsDepth += 1;
    } else if (char === ')') {
      paramsDepth -= 1;
      if (paramsDepth === 0) {
        braceStart = source.indexOf('{', index);
        break;
      }
    }
  }
  if (braceStart === -1) {
    throw new Error(`Missing body start for: ${signature}`);
  }
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces for: ${signature}`);
}

function loadHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const snippets = [
    extractLastFunctionSource(source, 'function isSignupUserAlreadyExistsFailure'),
    extractLastFunctionSource(source, 'function isSignupIdentityProviderMismatchFailure'),
    extractLastFunctionSource(source, 'function isSignupIdentityRateLimitFailure'),
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationFailure'),
    extractLastFunctionSource(source, 'function isAutoRunNextRoundPageFailure'),
    extractLastFunctionSource(source, 'function isStep8EmailInUseFailure'),
    extractLastFunctionSource(source, 'function isRegistrationIdentityConflictFailure'),
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationIdentityConflict'),
    extractLastFunctionSource(source, 'function isSignupAccountDeactivatedFailure'),
    extractLastFunctionSource(source, 'function isSignupPhonePasswordMismatchFailure'),
    extractLastFunctionSource(source, 'function isPlusCheckoutNonFreeTrialFailure'),
    extractLastFunctionSource(source, 'function isCloudCheckoutAlreadyPaidFailure'),
    extractLastFunctionSource(source, 'function getRegistrationAccountUnavailableMarking'),
    extractLastFunctionSource(source, 'function shouldFetchSignupCodeFailureAdvanceToNextRound'),
    extractLastFunctionSource(source, 'function getFetchSignupCodeFailureHandling'),
  ];

  const sandbox = {
    console,
    getErrorMessage: (error) => String(error?.message || error || ''),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(snippets.join('\n\n'), sandbox, { filename: filePath });
  return sandbox;
}

test('fetch-signup-code next-round helper blocks consumed email failures from same-email restart', () => {
  const sandbox = loadHelpers();

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('SIGNUP_ACCOUNT_DEACTIVATED::步骤 2：检测到 account_deactivated / 账号已删除或停用，当前轮将结束并进入下一轮。')
    ),
    true
  );

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('SIGNUP_IDENTITY_PROVIDER_MISMATCH::步骤 2：检测到 identity_provider_mismatch / 身份验证方式冲突，当前轮将结束并进入下一轮。')
    ),
    true
  );

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 URL: https://auth.openai.com/email-verification')
    ),
    true
  );

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('PLUS_CHECKOUT_NON_FREE_TRIAL::步骤 6：检测到今日应付金额不是 0（US$20.00），当前账号没有免费试用资格。')
    ),
    true
  );

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('认证页 内容脚本 150 秒内未响应，请刷新页面后重试。')
    ),
    true
  );

  assert.equal(
    sandbox.shouldFetchSignupCodeFailureAdvanceToNextRound(
      new Error('普通验证码轮询失败，准备重试')
    ),
    false
  );
});

test('fetch-signup-code handling never routes consumed-email failures into same-email restart', () => {
  const sandbox = loadHelpers();

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('SIGNUP_ACCOUNT_DEACTIVATED::步骤 2：检测到 account_deactivated / 账号已删除或停用，当前轮将结束并进入下一轮。')
    ),
    'throw'
  );

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('SIGNUP_IDENTITY_PROVIDER_MISMATCH::步骤 2：检测到 identity_provider_mismatch / 身份验证方式冲突，当前轮将结束并进入下一轮。')
    ),
    'throw'
  );

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('SIGNUP_PHONE_PASSWORD_MISMATCH::当前邮箱已存在，需要重新开始新一轮')
    ),
    'restart_phone'
  );

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('普通验证码轮询失败，准备重试')
    ),
    'restart_email'
  );

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('任意错误'),
      { mail2925Terminated: true }
    ),
    'throw'
  );

  assert.equal(
    sandbox.getFetchSignupCodeFailureHandling(
      new Error('任意错误'),
      { phoneResendBanned: true }
    ),
    'restart_phone'
  );
});
