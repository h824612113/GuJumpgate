# Mixed Mailbox Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持在一个批量导入框中混合导入 Outlook 四段凭据和 iCloud URL 两段凭据，并按原始顺序自动注册、动态切换收码实现。

**Architecture:** 新增持久化的统一邮箱队列，Outlook 队列条目引用现有 Hotmail 账号，iCloud URL 条目保存脱敏管理的取信凭据。运行时通过当前队列条目解析有效邮件 provider，复用 Outlook Graph 轮询并新增独立 iCloud URL GET 轮询器。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、Service Worker、Chrome Storage、Node.js `node:test`。

## Global Constraints

- 保留 Outlook、纯自定义邮箱池和其他邮件提供商现有行为。
- 混合队列严格按数组顺序运行，失败时停止，不自动跳过。
- 只有完整流程成功后才标记队列条目已用。
- 密码、刷新令牌、完整取信 URL 和 URL token 不得出现在列表或日志。
- iCloud URL 第一版只允许 `https://icloud-api.top/show/`，并校验路径末尾邮箱。
- 不新增第三方依赖。

---

### Task 1: 混合导入与队列纯工具

**Files:**
- Create: `mixed-mailbox-utils.js`
- Create: `tests/mixed-mailbox-utils.test.js`

**Interfaces:**
- Produces: `parseMixedMailboxImport(text) -> { records, errors, ignoredCount }`
- Produces: `normalizeMixedMailboxQueueEntries(entries) -> entry[]`
- Produces: `mergeMixedMailboxQueueEntries(existing, imported) -> { entries, addedCount, updatedCount }`
- Produces: `getNextMixedMailboxQueueEntry(entries) -> entry | null`
- Produces: `redactMixedMailboxSecret(value) -> string`
- Produces: `resolveMixedMailboxProvider(entry) -> 'hotmail-api' | 'icloud-url' | ''`

- [ ] **Step 1: Write failing parser and queue tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../mixed-mailbox-utils');

test('parses mixed Outlook and iCloud URL lines in original order', () => {
  const result = utils.parseMixedMailboxImport([
    'outlook@example.com----password----client-id----refresh-token',
    'alias@icloud.com----https://icloud-api.top/show/token/alias@icloud.com',
  ].join('\n'));
  assert.deepEqual(result.records.map((item) => item.type), ['outlook', 'icloud-url']);
  assert.deepEqual(result.records.map((item) => item.email), ['outlook@example.com', 'alias@icloud.com']);
  assert.equal(result.errors.length, 0);
});

test('rejects non-HTTPS and mismatched iCloud URL email', () => {
  const result = utils.parseMixedMailboxImport([
    'alias@icloud.com----http://icloud-api.top/show/token/alias@icloud.com',
    'alias@icloud.com----https://icloud-api.top/show/token/other@icloud.com',
  ].join('\n'));
  assert.equal(result.records.length, 0);
  assert.deepEqual(result.errors.map((item) => item.lineNumber), [1, 2]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: FAIL because `mixed-mailbox-utils.js` does not exist.

- [ ] **Step 3: Implement the UMD utility module**

```js
(function attachMixedMailboxUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MixedMailboxUtils = api;
})(typeof self !== 'undefined' ? self : globalThis, function createMixedMailboxUtils() {
  const OUTLOOK_TYPE = 'outlook';
  const ICLOUD_URL_TYPE = 'icloud-url';
  // Implement strict line parsing, normalization, stable merge, selection and redaction.
  return {
    ICLOUD_URL_TYPE,
    OUTLOOK_TYPE,
    getNextMixedMailboxQueueEntry,
    mergeMixedMailboxQueueEntries,
    normalizeMixedMailboxQueueEntries,
    parseMixedMailboxImport,
    redactMixedMailboxSecret,
    resolveMixedMailboxProvider,
  };
});
```

- [ ] **Step 4: Add tests for headers, partial success, duplicate update, stable position, selection and redaction**

```js
test('updates duplicate credentials without moving the queue item', () => {
  const existing = [{ id: 'one', type: 'icloud-url', email: 'a@icloud.com', credential: 'old', enabled: true, used: false }];
  const imported = [{ type: 'icloud-url', email: 'a@icloud.com', credential: 'new' }];
  const result = utils.mergeMixedMailboxQueueEntries(existing, imported);
  assert.equal(result.entries[0].id, 'one');
  assert.equal(result.entries[0].credential, 'new');
  assert.equal(result.updatedCount, 1);
});
```

- [ ] **Step 5: Run Task 1 tests and commit**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: all Task 1 tests PASS.

Commit: `feat: add mixed mailbox queue utilities`

---

### Task 2: iCloud URL response parser and poller

**Files:**
- Create: `background/icloud-url-provider.js`
- Create: `tests/icloud-url-provider.test.js`
- Modify: `background.js:3-84`

**Interfaces:**
- Consumes: normalized `icloud-url` entry from Task 1.
- Produces: `createIcloudUrlProvider(deps)` with `pollVerificationCode(step, state, pollPayload)`.
- Produces: `extractVerificationCodeFromIcloudUrlPayload(payload, options) -> { code, mailId } | null`.

- [ ] **Step 1: Write failing response parsing tests**

```js
test('extracts codes from JSON, HTML and plain text', () => {
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload({ code: '123456' }).code, '123456');
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload('<div>Your code is 234567</div>').code, '234567');
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload('验证码：345678').code, '345678');
});

test('excludes previously used codes', () => {
  assert.equal(provider.extractVerificationCodeFromIcloudUrlPayload('code: 123456', { excludeCodes: ['123456'] }), null);
});
```

- [ ] **Step 2: Run parser tests and verify RED**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: FAIL because provider module does not exist.

- [ ] **Step 3: Implement recursive JSON text collection and rule-based code extraction**

```js
function extractVerificationCodeFromIcloudUrlPayload(payload, options = {}) {
  const explicitCode = findExplicitCode(payload);
  const candidates = explicitCode ? [explicitCode] : collectSearchTexts(payload);
  return selectAllowedCode(candidates, options.codePatterns, options.excludeCodes);
}
```

- [ ] **Step 4: Write a failing poller test with mocked fetch retries and URL redaction**

```js
test('polls the credential URL until a fresh code appears', async () => {
  const responses = ['No code yet', '<p>code: 456789</p>'];
  const fetchImpl = async () => new Response(responses.shift(), { status: 200 });
  const api = provider.createIcloudUrlProvider({ fetchImpl, sleep: async () => {}, throwIfStopped() {}, addLog: async () => {} });
  const result = await api.pollVerificationCode(4, { activeMixedMailboxEntry: ICLOUD_ENTRY }, { maxAttempts: 2, intervalMs: 1 });
  assert.equal(result.code, '456789');
});
```

- [ ] **Step 5: Implement GET polling with timeout, `credentials: 'omit'`, status handling and sanitized errors**

The poller obtains the URL through the active queue entry, never interpolates it into logs, and returns the same `{ ok, code, emailTimestamp, mailId }` shape used by existing providers.

- [ ] **Step 6: Load the provider in `background.js`, run tests and commit**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: all Task 2 tests PASS.

Commit: `feat: add iCloud URL verification provider`

---

### Task 3: Persisted queue state and runtime routing

**Files:**
- Modify: `background.js`
- Modify: `background/message-router.js`
- Modify: `background/verification-flow.js`
- Modify: `background/steps/fetch-signup-code.js`
- Modify: `background/steps/fetch-login-code.js`
- Modify: `mail-provider-utils.js`
- Create: `tests/mixed-mailbox-runtime.test.js`

**Interfaces:**
- Consumes: Task 1 queue utilities and Task 2 provider.
- Produces messages: `IMPORT_MIXED_MAILBOX_QUEUE`, `PATCH_MIXED_MAILBOX_QUEUE`, `SET_ACTIVE_MIXED_MAILBOX_ENTRY`.
- Produces effective mail config `{ provider: 'icloud-url', label: 'iCloud URL' }` for active iCloud entries.

- [ ] **Step 1: Add failing tests for normalization and effective provider routing**

```js
test('active Outlook and iCloud entries resolve different providers', () => {
  assert.equal(utils.resolveMixedMailboxProvider({ type: 'outlook' }), 'hotmail-api');
  assert.equal(utils.resolveMixedMailboxProvider({ type: 'icloud-url' }), 'icloud-url');
});
```

- [ ] **Step 2: Add defaults and persistence normalization**

Add `mixedMailboxQueueEntries: []` to persisted defaults and `activeMixedMailboxEntryId: null` to runtime state. Normalize all writes with `normalizeMixedMailboxQueueEntries`.

- [ ] **Step 3: Implement atomic mixed import in the background**

For each parsed Outlook record call the existing Hotmail normalization/upsert path, capture its account ID, then merge a queue reference. Merge iCloud records directly. Persist `hotmailAccounts` and `mixedMailboxQueueEntries` in one settings update and return counts/errors.

- [ ] **Step 4: Route verification by the active entry**

Add `ICLOUD_URL_PROVIDER = 'icloud-url'`. Teach mail config resolution and verification flow to call `pollIcloudUrlVerificationCode` for both signup and login code steps without opening a mail tab.

- [ ] **Step 5: Add missing-account validation**

If an Outlook queue entry references a deleted Hotmail account, return an error that names only the email, set `lastError`, keep `used: false`, and stop the batch.

- [ ] **Step 6: Run runtime tests and syntax checks, then commit**

Run:

```bash
node --test tests/mixed-mailbox-runtime.test.js
node --check background.js
node --check background/message-router.js
node --check background/verification-flow.js
```

Expected: tests PASS and all syntax checks exit 0.

Commit: `feat: route verification through mixed mailbox entries`

---

### Task 4: Mixed queue sidepanel manager

**Files:**
- Create: `sidepanel/mixed-mailbox-queue-manager.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/sidepanel.css`
- Create: `tests/mixed-mailbox-queue-manager.test.js`

**Interfaces:**
- Consumes: background messages from Task 3 and `window.MixedMailboxUtils`.
- Produces UI callbacks: `bindEvents`, `renderEntries`, `refresh`, `reset`.

- [ ] **Step 1: Write failing manager tests for summary and safe display model**

```js
test('display rows expose type labels but no secrets', () => {
  const row = manager.buildDisplayEntry(ICLOUD_ENTRY);
  assert.equal(row.typeLabel, 'iCloud URL');
  assert.equal(JSON.stringify(row).includes('/show/token/'), false);
});
```

- [ ] **Step 2: Add the unified import and list markup**

Add a `mixed-pool` option to the email generator selector and a dedicated section with mixed import textarea, import/refresh/clear controls, filter, summary and list. Placeholder text must show both accepted formats without real credentials.

- [ ] **Step 3: Implement manager rendering and actions**

Use stable dimensions and existing `luckmail-*`/account-pool styles. Render only email, provider badge, current/used/enabled/error state and commands. Send all mutations through the Task 3 background messages.

- [ ] **Step 4: Integrate settings restore and auto-run count lock**

When `emailGenerator === 'mixed-pool'`, lock run count to enabled and unused mixed entries. Restore and broadcast queue updates without affecting the selected global mail provider.

- [ ] **Step 5: Run UI utility tests and syntax checks, then commit**

Run:

```bash
node --test tests/mixed-mailbox-queue-manager.test.js
node --check sidepanel/mixed-mailbox-queue-manager.js
node --check sidepanel/sidepanel.js
```

Expected: tests PASS and syntax checks exit 0.

Commit: `feat: add mixed mailbox queue controls`

---

### Task 5: Auto-run order, success marking and stop-on-failure

**Files:**
- Modify: `background.js`
- Modify: `background/auto-run-controller.js`
- Modify: `background/account-run-history.js`
- Create: `tests/mixed-mailbox-auto-run.test.js`

**Interfaces:**
- Consumes: normalized queue from Task 3.
- Produces: `prepareNextMixedMailboxEntry(state)`, `markActiveMixedMailboxEntryUsed(state)`, `markActiveMixedMailboxEntryError(state, error)`.

- [ ] **Step 1: Write failing state-transition tests**

```js
test('selects the first enabled unused entry and preserves mixed order', () => {
  const selected = utils.getNextMixedMailboxQueueEntry([USED_OUTLOOK, ACTIVE_ICLOUD, ACTIVE_OUTLOOK]);
  assert.equal(selected.id, ACTIVE_ICLOUD.id);
});

test('failure keeps the active entry unused', () => {
  const next = markError([ACTIVE_ICLOUD], ACTIVE_ICLOUD.id, new Error('HTTP 403'));
  assert.equal(next[0].used, false);
  assert.match(next[0].lastError, /403/);
});
```

- [ ] **Step 2: Prepare each target run from the queue**

Replace custom-pool-only selection branches with a mixed-pool branch that sets `email`, `activeMixedMailboxEntryId`, and the referenced `currentHotmailAccountId` only for Outlook entries.

- [ ] **Step 3: Mark success only at the existing full-flow success boundary**

Call `markActiveMixedMailboxEntryUsed` next to existing account-used finalization. Persist and broadcast queue changes, then clear the active ID before the next target run.

- [ ] **Step 4: Record sanitized failure and stop the batch**

At the auto-run catch boundary call `markActiveMixedMailboxEntryError`, retain `used: false`, and use the existing stop/error path rather than advancing target count.

- [ ] **Step 5: Run auto-run tests and commit**

Run: `node --test tests/mixed-mailbox-auto-run.test.js`

Expected: all Task 5 tests PASS.

Commit: `feat: run mixed mailbox queue in import order`

---

### Task 6: Configuration, regression and real mailbox verification

**Files:**
- Modify: `README.md` or `docs/使用教程/使用教程.md`
- Modify: `docs/superpowers/specs/2026-08-03-mixed-mailbox-queue-design.md` only if implementation behavior required a documented correction.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified extension behavior and user-facing import instructions.

- [ ] **Step 1: Add configuration export/import coverage**

Verify `mixedMailboxQueueEntries` survives settings export/import while `activeMixedMailboxEntryId` does not persist across extension restart.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
node --test tests/mixed-mailbox-utils.test.js tests/icloud-url-provider.test.js tests/mixed-mailbox-runtime.test.js tests/mixed-mailbox-queue-manager.test.js tests/mixed-mailbox-auto-run.test.js
node --check mixed-mailbox-utils.js
node --check background/icloud-url-provider.js
node --check background.js
node --check background/message-router.js
node --check background/verification-flow.js
node --check sidepanel/mixed-mailbox-queue-manager.js
node --check sidepanel/sidepanel.js
```

Expected: zero failed tests and every syntax check exits 0.

- [ ] **Step 3: Load the unpacked extension and verify mixed import visually**

Confirm one Outlook line followed by one iCloud URL line renders in the same order, type badges are correct, run count is 2, and neither credential is visible in DOM text or logs.

- [ ] **Step 4: Verify Outlook Graph regression path**

Use a valid imported Outlook record, request a real verification code, and confirm the existing Graph path returns and submits it.

- [ ] **Step 5: Verify the provided iCloud URL path**

Use the provided authorized URL, request a fresh verification email, run the `icloud-url` poller, and confirm the code is extracted and submitted. Inspect logs to ensure the URL token is absent.

- [ ] **Step 6: Verify failure behavior**

Use an invalid/expired iCloud URL and confirm the current item remains unused, records a sanitized error, and the following Outlook item is not started.

- [ ] **Step 7: Document usage and commit**

Document both accepted line formats and the stop-on-failure behavior.

Commit: `docs: document mixed mailbox queue`

