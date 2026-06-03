import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSub2apiDocument, buildTargetDocument, parseInputDocument } from '../src/converter.mjs';

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fakeJwt(payload) {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.`;
}

test('converts ChatGPT web session to sub2api account document', () => {
  const now = new Date('2026-05-13T00:00:00.000Z');
  const input = {
    user: { id: 'user-1', email: 'person@example.com' },
    account: { id: 'account-1', planType: 'plus' },
    accessToken: fakeJwt({ exp: 1770000000 }),
    sessionToken: 'session-token-1',
  };

  const result = parseInputDocument(input, 'session.json', now);
  const document = buildSub2apiDocument(result.converted, now);

  assert.equal(result.skipped.length, 0);
  assert.equal(document.accounts.length, 1);
  assert.deepEqual(document.proxies, []);
  assert.equal(document.accounts[0].platform, 'openai');
  assert.equal(document.accounts[0].type, 'oauth');
  assert.equal(document.accounts[0].credentials.email, 'person@example.com');
  assert.equal(document.accounts[0].credentials.chatgpt_account_id, 'account-1');
  assert.equal(document.accounts[0].credentials.chatgpt_user_id, 'user-1');
  assert.equal(document.accounts[0].credentials.plan_type, 'plus');
  assert.equal(document.accounts[0].extra.source_name, 'session.json');
});

test('builds CPA, Cockpit and 9router target documents from one session', () => {
  const now = new Date('2026-05-13T00:00:00.000Z');
  const input = {
    user: { id: 'user-2', email: 'person2@example.com' },
    account: { id: 'account-2', planType: 'plus' },
    accessToken: fakeJwt({ exp: 1770000000 }),
    sessionToken: 'session-token-2',
    disabled: false,
  };

  const result = parseInputDocument(input, 'session-2.json', now);

  const cpa = buildTargetDocument('cpa', result.converted, now, { singleObjectWhenOne: true });
  assert.equal(cpa.type, 'codex');
  assert.equal(cpa.email, 'person2@example.com');
  assert.equal(cpa.account_id, 'account-2');
  assert.equal(cpa.session_token, 'session-token-2');
  assert.equal(cpa.id_token_synthetic, true);

  const cockpit = buildTargetDocument('cockpit', result.converted, now, { singleObjectWhenOne: true });
  assert.equal(cockpit.type, 'codex');
  assert.equal(cockpit.email, 'person2@example.com');
  assert.equal(cockpit.account_id, 'account-2');
  assert.equal(cockpit.access_token, input.accessToken);

  const nineRouter = buildTargetDocument('9router', result.converted, now, { singleObjectWhenOne: true });
  assert.equal(nineRouter.provider, 'codex');
  assert.equal(nineRouter.authType, 'oauth');
  assert.equal(nineRouter.email, 'person2@example.com');
  assert.equal(nineRouter.id, 'account-2');
  assert.equal(nineRouter.providerSpecificData.chatgptPlanType, 'plus');
  assert.equal(nineRouter.isActive, true);
});
