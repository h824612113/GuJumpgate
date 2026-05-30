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
    'const DEFAULT_HOTMAIL_LOCAL_BASE_URL = "http://127.0.0.1:17373";',
    'const DEFAULT_ACCOUNT_RUN_HISTORY_HELPER_BASE_URL = "http://127.0.0.1:17373";',
    extractLastFunctionSource(source, 'function normalizeHotmailLocalBaseUrl'),
    extractLastFunctionSource(source, 'function normalizeAccountRunHistoryHelperBaseUrl'),
    extractLastFunctionSource(source, 'function buildHotmailLocalEndpoint'),
  ].join('\n\n');
  const sandbox = {
    console,
    URL,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(extracted, sandbox, { filename: filePath });
  return sandbox;
}

test('normalizes legacy full sync-sub2api-error-refresh-records helper URL back to base URL', () => {
  const sandbox = loadHelpers();
  const normalized = sandbox.normalizeAccountRunHistoryHelperBaseUrl(
    'http://127.0.0.1:17373/sync-sub2api-error-refresh-records'
  );
  assert.equal(normalized, 'http://127.0.0.1:17373');
  assert.equal(
    sandbox.buildHotmailLocalEndpoint(normalized, '/sync-sub2api-error-refresh-records'),
    'http://127.0.0.1:17373/sync-sub2api-error-refresh-records'
  );
});
