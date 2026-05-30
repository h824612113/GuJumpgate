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
    extractLastFunctionSource(source, 'function isPhoneResendServerError'),
    extractLastFunctionSource(source, 'function isOpenAiAuthServerErrorPageSnapshot'),
    extractLastFunctionSource(source, 'function getPhoneResendServerErrorFromSnapshot'),
  ].join('\n\n');
  const sandbox = {
    console,
    PHONE_RESEND_SERVER_ERROR_PREFIX: 'PHONE_RESEND_SERVER_ERROR::',
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('generic auth.openai.com HTTP 500 page is recognized as phone auth server error snapshot', () => {
  const sandbox = loadHelpers();
  const snapshot = {
    url: 'https://auth.openai.com/',
    title: '该网页无法正常运作',
    text: 'auth.openai.com 目前无法处理此请求。 HTTP ERROR 500',
    bodyText: 'auth.openai.com 目前无法处理此请求。 HTTP ERROR 500',
  };

  assert.equal(sandbox.isOpenAiAuthServerErrorPageSnapshot(snapshot), true);
  assert.match(
    sandbox.getPhoneResendServerErrorFromSnapshot(snapshot),
    /HTTP ERROR 500|无法处理此请求/
  );
});
