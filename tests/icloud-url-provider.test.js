const test = require('node:test');
const assert = require('node:assert/strict');

const provider = require('../background/icloud-url-provider');

const ICLOUD_ENTRY = {
  id: 'icloud-one',
  type: 'icloud-url',
  email: 'alias@icloud.com',
  credential: 'alias@icloud.com----https://icloud-api.top/show/sensitive-token/alias@icloud.com',
  enabled: true,
  used: false,
};

test('extracts verification codes from JSON, HTML and plain text', () => {
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload({ code: '123456' }).code, '123456');
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload('<div>Your code is 234567</div>').code, '234567');
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload('验证码：345678').code, '345678');
});

test('extracts a Base64 iframe message-body code before numeric mail identifiers', () => {
  const mailBody = '<p>输入此临时验证码以继续：</p><p>467887</p>';
  const frameUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(mailBody, 'utf8').toString('base64')}`;
  const payload = [
    '<a href="#mail-209218" data-id="209218">你的 ChatGPT 临时验证码</a>',
    `<iframe src="${frameUrl}"></iframe>`,
  ].join('');

  const result = provider.extractVerificationCodeFromIcloudUrlPayload(payload);

  assert.equal(result.code, '467887');
});

test('excludes previously used verification codes', () => {
  assert.equal(
    provider.extractVerificationCodeFromIcloudUrlPayload('code: 123456', { excludeCodes: ['123456'] }),
    null
  );
});

test('polls the credential URL until a fresh code appears without logging its token', async () => {
  const responseBodies = ['No code yet', '<p>code: 456789</p>'];
  const requests = [];
  const logs = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(responseBodies.shift(), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
  const api = provider.createIcloudUrlProvider({
    fetchImpl,
    sleep: async () => {},
    throwIfStopped() {},
    addLog: async (message) => logs.push(message),
  });

  const result = await api.pollVerificationCode(4, {
    activeMixedMailboxEntry: ICLOUD_ENTRY,
  }, {
    maxAttempts: 2,
    intervalMs: 1,
  });

  assert.equal(result.code, '456789');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(logs.join('\n').includes('sensitive-token'), false);
});

test('accepts a yangyang response that remains under the messages path', async () => {
  const entry = {
    id: 'yangyang-one',
    type: 'icloud-url',
    email: 'alias@icloud.com',
    url: 'http://yangyang.website/messages/token-a/alias@icloud.com',
    enabled: true,
    used: false,
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'http://yangyang.website/messages/inbox',
    headers: { get: () => 'text/plain' },
    text: async () => 'code: 456789',
  });
  const api = provider.createIcloudUrlProvider({
    fetchImpl,
    sleep: async () => {},
    throwIfStopped() {},
  });

  const result = await api.pollVerificationCode(4, {
    activeMixedMailboxEntry: entry,
  }, {
    maxAttempts: 1,
  });

  assert.equal(result.code, '456789');
});

test('polls arbitrary HTTPS and HTTP messages URLs with same-origin inbox responses', async () => {
  const cases = [
    {
      requestUrl: 'https://mailbox.example/messages/token-https/alias@icloud.com',
      responseUrl: 'https://mailbox.example/messages/inbox',
      responseText: '验证码：456789',
    },
    {
      requestUrl: 'http://mailbox.example/messages/token-http/alias@icloud.com',
      responseUrl: 'http://mailbox.example/messages/inbox',
      responseText: 'code: 567890',
    },
  ];

  for (const scenario of cases) {
    const api = provider.createIcloudUrlProvider({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: scenario.responseUrl,
        headers: { get: () => 'text/plain' },
        text: async () => scenario.responseText,
      }),
      sleep: async () => {},
      throwIfStopped() {},
    });

    const result = await api.pollVerificationCode(4, {
      activeMixedMailboxEntry: {
        type: 'icloud-url',
        email: 'alias@icloud.com',
        url: scenario.requestUrl,
      },
    }, { maxAttempts: 1 });

    assert.match(result.code, /^\d{6}$/);
  }
});

test('rejects redirected responses outside the original mailbox boundary before reading content', async () => {
  const scenarios = [
    {
      requestUrl: 'http://yangyang.website/messages/private-token/alias@icloud.com',
      responseUrl: 'http://example.com/messages/inbox',
    },
    {
      requestUrl: 'http://yangyang.website/messages/private-token/alias@icloud.com',
      responseUrl: 'https://yangyang.website/messages/inbox',
    },
    {
      requestUrl: 'http://yangyang.website/messages/private-token/alias@icloud.com',
      responseUrl: 'http://yangyang.website/login',
    },
    {
      requestUrl: 'http://yangyang.website/messages/private-token/alias@icloud.com',
      responseUrl: 'http://yangyang.website/messages-extra/inbox',
    },
    {
      requestUrl: 'https://icloud-api.top/show/private-token/alias@icloud.com',
      responseUrl: 'http://yangyang.website/messages/inbox',
    },
  ];

  for (const scenario of scenarios) {
    let bodyRead = false;
    const logs = [];
    const api = provider.createIcloudUrlProvider({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: scenario.responseUrl,
        headers: { get: () => 'text/plain' },
        text: async () => {
          bodyRead = true;
          return 'code: 456789';
        },
      }),
      sleep: async () => {},
      throwIfStopped() {},
      addLog: async (message) => logs.push(message),
    });

    await assert.rejects(
      api.pollVerificationCode(4, {
        activeMixedMailboxEntry: {
          type: 'icloud-url',
          email: 'alias@icloud.com',
          url: scenario.requestUrl,
        },
      }, {
        maxAttempts: 1,
      }),
      (error) => {
        assert.match(error.message, /响应地址不受信任/);
        assert.equal(error.message.includes('private-token'), false);
        return true;
      }
    );

    assert.equal(bodyRead, false);
    assert.equal(logs.join('\n').includes('private-token'), false);
  }
});

test('rejects local and explicit-port request URLs before fetch without exposing tokens', async () => {
  const urls = [
    'http://127.0.0.1/messages/private-token/alias@icloud.com',
    'http://localhost./messages/private-token/alias@icloud.com',
    'https://mailbox.example:443/messages/private-token/alias@icloud.com',
  ];

  for (const url of urls) {
    let fetchCalled = false;
    const logs = [];
    const api = provider.createIcloudUrlProvider({
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('fetch should not run');
      },
      sleep: async () => {},
      throwIfStopped() {},
      addLog: async (message) => logs.push(message),
    });

    await assert.rejects(
      api.pollVerificationCode(4, {
        activeMixedMailboxEntry: {
          type: 'icloud-url',
          email: 'alias@icloud.com',
          url,
        },
      }, {
        maxAttempts: 1,
      }),
      (error) => {
        assert.match(error.message, /取信地址不受信任/);
        assert.equal(error.message.includes('private-token'), false);
        return true;
      }
    );

    assert.equal(fetchCalled, false);
    assert.equal(logs.join('\n').includes('private-token'), false);
  }
});
