const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSub2ApiModule(fetchImpl, logMessages) {
  const filePath = path.join(__dirname, '..', 'background', 'sub2api-api.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    console,
    fetch: fetchImpl,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.runInNewContext(source, sandbox, { filename: filePath });
  return sandbox.MultiPageBackgroundSub2ApiApi.createSub2ApiApi({
    addLog: async (message) => {
      logMessages.push(String(message || ''));
    },
    normalizeSub2ApiUrl: (value) => String(value || '').trim(),
    fetchImpl,
  });
}

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      code: 0,
      message: 'success',
      data,
    }),
  };
}

test('submitOpenAiCallback deletes error duplicates and reuses a live account', async () => {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      url: parsed.toString(),
      path: parsed.pathname,
      search: parsed.search,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (parsed.pathname === '/api/v1/auth/login') {
      return jsonResponse({ access_token: 'sub-token' });
    }
    if (parsed.pathname === '/api/v1/admin/openai/exchange-code') {
      return jsonResponse({
        access_token: 'openai-token',
        email: 'dup@example.com',
        chatgpt_account_id: 'acct-1',
      });
    }
    if (parsed.pathname === '/api/v1/admin/accounts' && (options.method || 'GET') === 'GET') {
      return jsonResponse({
        items: [
          {
            id: 11,
            status: 'error',
            credentials: { email: 'dup@example.com' },
          },
          {
            id: 22,
            status: 'active',
            schedulable: true,
            credentials: { email: 'dup@example.com' },
          },
          {
            id: 33,
            status: 'active',
            schedulable: true,
            credentials: { email: 'dup@example.com' },
          },
        ],
        total: 3,
        page: 1,
        page_size: 100,
        pages: 1,
      });
    }
    if (parsed.pathname === '/api/v1/admin/accounts/11' && (options.method || 'GET') === 'DELETE') {
      return jsonResponse({ message: 'deleted' });
    }
    if (parsed.pathname === '/api/v1/admin/accounts/22' && (options.method || 'GET') === 'PUT') {
      return jsonResponse({ id: 22 });
    }
    if (parsed.pathname === '/api/v1/admin/accounts/33' && (options.method || 'GET') === 'DELETE') {
      return jsonResponse({ message: 'deleted' });
    }
    throw new Error(`Unexpected request: ${(options.method || 'GET')} ${parsed.pathname}`);
  };

  const api = loadSub2ApiModule(fetchImpl, logs);
  const result = await api.submitOpenAiCallback({
    localhostUrl: 'http://localhost:1455/auth/callback?code=test-code&state=test-state',
    sub2apiSessionId: 'session-1',
    sub2apiOAuthState: 'test-state',
    sub2apiUrl: 'https://sub.example.com/admin/accounts',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'secret',
    sub2apiGroupIds: [9001],
    sub2apiDraftName: 'draft-name',
  }, {
    visibleStep: 10,
    logLabel: '步骤 10',
  });

  assert.equal(result.verifiedStatus, 'SUB2API 已复用账号 #22');
  assert.equal(calls.some((call) => call.path === '/api/v1/admin/accounts' && call.method === 'POST'), false);
  assert.ok(calls.some((call) => call.path === '/api/v1/admin/accounts/11' && call.method === 'DELETE'));
  assert.ok(calls.some((call) => call.path === '/api/v1/admin/accounts/22' && call.method === 'PUT'));
  assert.ok(calls.some((call) => call.path === '/api/v1/admin/accounts/33' && call.method === 'DELETE'));
  assert.ok(logs.some((message) => message.includes('已删除同邮箱异常账号')));
  assert.ok(logs.some((message) => message.includes('已复用并更新 SUB2API 账号 #22')));
});

test('submitOpenAiCallback still creates a new account when no duplicate exists', async () => {
  const calls = [];
  const logs = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      path: parsed.pathname,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (parsed.pathname === '/api/v1/auth/login') {
      return jsonResponse({ access_token: 'sub-token' });
    }
    if (parsed.pathname === '/api/v1/admin/openai/exchange-code') {
      return jsonResponse({
        access_token: 'openai-token',
        email: 'fresh@example.com',
        chatgpt_account_id: 'acct-2',
      });
    }
    if (parsed.pathname === '/api/v1/admin/accounts' && (options.method || 'GET') === 'GET') {
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        pages: 1,
      });
    }
    if (parsed.pathname === '/api/v1/admin/accounts' && (options.method || 'GET') === 'POST') {
      return jsonResponse({ id: 99 });
    }
    throw new Error(`Unexpected request: ${(options.method || 'GET')} ${parsed.pathname}`);
  };

  const api = loadSub2ApiModule(fetchImpl, logs);
  const result = await api.submitOpenAiCallback({
    localhostUrl: 'http://localhost:1455/auth/callback?code=test-code&state=test-state',
    sub2apiSessionId: 'session-1',
    sub2apiOAuthState: 'test-state',
    sub2apiUrl: 'https://sub.example.com/admin/accounts',
    sub2apiEmail: 'admin@example.com',
    sub2apiPassword: 'secret',
    sub2apiGroupIds: [9001],
    sub2apiDraftName: 'draft-name',
  }, {
    visibleStep: 10,
    logLabel: '步骤 10',
  });

  assert.equal(result.verifiedStatus, 'SUB2API 已创建账号 #99');
  assert.ok(calls.some((call) => call.path === '/api/v1/admin/accounts' && call.method === 'POST'));
  assert.ok(logs.some((message) => message.includes('正在创建 SUB2API 账号')));
});
