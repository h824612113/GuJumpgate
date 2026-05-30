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

function loadConflictHelpers() {
  const filePath = path.join(__dirname, '..', 'background.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const extracted = [
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationFailure'),
    extractLastFunctionSource(source, 'function isStep5StaleSignupVerificationIdentityConflict'),
  ].join('\n\n');
  const sandbox = {
    console,
    getErrorMessage: (error) => String(error?.message || error || ''),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('step 5 stale verification with identity_provider_mismatch is treated as identity conflict', () => {
  const sandbox = loadConflictHelpers();
  const error = new Error(
    'STEP5_STALE_SIGNUP_VERIFICATION::步骤 5：资料页启动时认证页仍停留在邮箱验证码阶段，当前轮将结束并进入下一轮。 identity_provider_mismatch URL: https://auth.openai.com/email-verification'
  );

  assert.equal(sandbox.isStep5StaleSignupVerificationFailure(error), true);
  assert.equal(sandbox.isStep5StaleSignupVerificationIdentityConflict(error), true);
});
