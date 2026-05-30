const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadSub2ApiModule(fetchImpl) {
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
    addLog: async () => {},
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

test('listSub2ApiErrorOpenAiOauthAccounts paginates and only keeps error oauth accounts', async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get('page') || 1);
    if (page === 1) {
      return jsonResponse({
        items: [
          { id: 1, status: 'error', credentials: { email: 'a@example.com' } },
          { id: 2, status: 'active', credentials: { email: 'b@example.com' } },
        ],
        total: 3,
        page: 1,
        page_size: 2,
        pages: 2,
      });
    }
    return jsonResponse({
      items: [
        { id: 3, status: 'error', credentials: { email: 'c@example.com' } },
        { id: 1, status: 'error', credentials: { email: 'a@example.com' } },
      ],
      total: 3,
      page: 2,
      page_size: 2,
      pages: 2,
    });
  };

  const api = loadSub2ApiModule(fetchImpl);
  const result = await api.listSub2ApiErrorOpenAiOauthAccounts('https://sub.example.com', 'token', {
    pageSize: 2,
    maxPages: 5,
  });

  assert.deepEqual(Array.from(result, (item) => item.id), [1, 3]);
});
