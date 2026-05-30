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
  const filePath = path.join(__dirname, '..', 'background', 'phone-verification-flow.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const extracted = [
    extractLastFunctionSource(source, 'function isPhoneNumberUsedError'),
    extractLastFunctionSource(source, 'function isPhoneNumberInvalidError'),
    extractLastFunctionSource(source, 'function isPhoneNumberDeliveryRefusedError'),
    extractLastFunctionSource(source, 'function isPhoneRequestTooFrequentError'),
    extractLastFunctionSource(source, 'function classifyAddPhoneRejectedReason'),
    extractLastFunctionSource(source, 'function shouldBanActivationAfterAddPhoneFailure'),
  ].join('\n\n');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('add-phone request-too-frequent message bans current phone activation', () => {
  const sandbox = loadHelpers();
  const message = '你请求手机验证的次数过多。请稍后再试。';

  assert.equal(sandbox.isPhoneRequestTooFrequentError(message), true);
  assert.equal(sandbox.classifyAddPhoneRejectedReason(message), 'phone_request_too_frequent');
  assert.equal(sandbox.shouldBanActivationAfterAddPhoneFailure(message, ''), true);
});
