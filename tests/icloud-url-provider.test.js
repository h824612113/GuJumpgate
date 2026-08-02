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
