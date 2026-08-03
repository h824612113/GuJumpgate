# Yangyang Mailbox URL Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让统一邮箱队列安全支持 `http://yangyang.website/messages/{token}/{邮箱}` 的单行和两行导入格式，同时保持 Outlook 与既有 iCloud URL 格式兼容。

**Architecture:** 在 `mixed-mailbox-utils.js` 中用精确、表驱动的 URL 白名单统一校验两种 iCloud URL，并由导入状态机只为 `yangyang.website/messages/` 接受一条续行。在 `background/icloud-url-provider.js` 中复用同一组明确规则校验请求 URL 与 `fetch` 最终响应 URL，阻止重定向逃逸；界面和文档只展示合成示例并提示 HTTP 明文风险。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、WHATWG `URL`、Fetch API、Node.js `node:test`。

## Global Constraints

- 只允许 `https://icloud-api.top/show/{token}/{邮箱}` 和 `http://yangyang.website/messages/{token}/{邮箱}` 两种精确形态。
- `token` 必须是单个非空路径段，URL 尾部邮箱解码后必须与记录首部邮箱一致。
- `yangyang.website/messages/` 后只允许下一条非空行作为一次续行，续行必须严格为 `token/邮箱`。
- 不接受任意其他 HTTP 主机、错误协议、错误路径、孤立续行、完整 URL 续行或包含 `----` 的续行。
- 续行记录的错误行号必须定位到记录起始行；有效记录仍允许在其他记录出错时导入。
- 完整 URL、token 和响应正文不得进入 DOM、日志、测试输出、文档或提交；测试只使用合成凭据。
- `fetch` 后必须在读取正文前验证 `response.url` 没有离开原白名单协议、主机和路径前缀。
- 不提交现有未跟踪目录 `.learnings/` 和 `output/`。

---

### Task 1: 扩展混合邮箱导入解析器

**Files:**
- Modify: `tests/mixed-mailbox-utils.test.js`
- Modify: `mixed-mailbox-utils.js`

**Interfaces:**
- Consumes: `parseMixedMailboxImport(value: string)`、`normalizeMixedMailboxQueueEntry(rawEntry: object)`。
- Produces: `validateIcloudUrl(rawUrl: string, email: string)` 的内部白名单行为；`parseMixedMailboxImport(value: string)` 继续返回 `{ records, errors, ignoredCount }`，其中成功的 iCloud URL 记录保持 `{ type, email, credential, url }`。

- [ ] **Step 1: 写入单行、两行和混排的失败测试**

```js
test('parses yangyang single-line and continuation records in original order', () => {
  const result = utils.parseMixedMailboxImport([
    'first@outlook.com----password----client-id----refresh-token',
    'second@icloud.com----http://yangyang.website/messages/token-a/second@icloud.com',
    'third@icloud.com----http://yangyang.website/messages/',
    '',
    '  token-b/third@icloud.com  ',
    'fourth@icloud.com----https://icloud-api.top/show/token-c/fourth@icloud.com',
  ].join('\n'));

  assert.deepEqual(result.records.map(({ type, email }) => ({ type, email })), [
    { type: 'outlook', email: 'first@outlook.com' },
    { type: 'icloud-url', email: 'second@icloud.com' },
    { type: 'icloud-url', email: 'third@icloud.com' },
    { type: 'icloud-url', email: 'fourth@icloud.com' },
  ]);
  assert.equal(result.errors.length, 0);
});
```

- [ ] **Step 2: 运行解析器测试并确认 RED**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 新增测试失败，因为当前校验器拒绝 HTTP，导入器也不会拼接续行。

- [ ] **Step 3: 写入严格白名单和非法续行的失败测试**

```js
test('rejects non-whitelisted mailbox URLs and malformed continuations at the start line', () => {
  const cases = [
    'a@icloud.com----http://icloud-api.top/show/token/a@icloud.com',
    'a@icloud.com----https://yangyang.website/messages/token/a@icloud.com',
    'a@icloud.com----http://example.com/messages/token/a@icloud.com',
    'a@icloud.com----http://yangyang.website/show/token/a@icloud.com',
    'a@icloud.com----http://yangyang.website/messages//a@icloud.com',
    'a@icloud.com----http://yangyang.website/messages/token/b@icloud.com',
  ];
  for (const value of cases) {
    const result = utils.parseMixedMailboxImport(value);
    assert.equal(result.records.length, 0);
    assert.equal(result.errors[0].lineNumber, 1);
  }

  const continuation = utils.parseMixedMailboxImport([
    'a@icloud.com----http://yangyang.website/messages/',
    '',
    'https://yangyang.website/messages/token/a@icloud.com',
  ].join('\n'));
  assert.equal(continuation.records.length, 0);
  assert.equal(continuation.errors[0].lineNumber, 1);
});
```

- [ ] **Step 4: 实现表驱动 URL 白名单和单条续行状态机**

```js
const ICLOUD_URL_RULES = [
  { protocol: 'https:', hostname: 'icloud-api.top', prefix: 'show' },
  { protocol: 'http:', hostname: 'yangyang.website', prefix: 'messages' },
];

function findIcloudUrlRule(parsed) {
  return ICLOUD_URL_RULES.find((rule) => (
    parsed.protocol === rule.protocol
    && parsed.hostname.toLowerCase() === rule.hostname
  )) || null;
}
```

将 `validateIcloudUrl` 改为按匹配规则检查恰好三个路径段 `{prefix}/{token}/{email}`；将 `parseMixedMailboxImport` 从 `forEach` 改为可前移索引的循环，遇到精确的 `邮箱----http://yangyang.website/messages/` 时寻找下一条非空行、验证续行不能包含 `----`、不能是完整 URL、只能有两个路径段，并将解析错误固定记录在起始行。

- [ ] **Step 5: 运行解析器测试并确认 GREEN**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 所有解析、队列归一化、脱敏与 provider 路由测试通过。

- [ ] **Step 6: 提交解析器改动**

```bash
git add mixed-mailbox-utils.js
git add -f tests/mixed-mailbox-utils.test.js
git commit -m "feat: support yangyang mailbox imports"
```

---

### Task 2: 限制 provider 重定向目标

**Files:**
- Modify: `tests/icloud-url-provider.test.js`
- Modify: `background/icloud-url-provider.js`

**Interfaces:**
- Consumes: `createIcloudUrlProvider({ fetchImpl, sleep, throwIfStopped, addLog })`。
- Produces: 内部 `validateMailboxResponseUrl(requestUrl: string, responseUrl: string)`；`pollVerificationCode(step, state, pollPayload)` 的成功返回结构不变。

- [ ] **Step 1: 写入允许同源最终 URL 的失败测试**

```js
test('accepts a yangyang response that remains under the messages path', async () => {
  const entry = {
    type: 'icloud-url',
    email: 'alias@icloud.com',
    url: 'http://yangyang.website/messages/token/alias@icloud.com',
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    url: 'http://yangyang.website/messages/inbox',
    headers: { get: () => 'text/plain' },
    text: async () => 'code: 456789',
  });
  const api = provider.createIcloudUrlProvider({ fetchImpl, sleep: async () => {} });
  const result = await api.pollVerificationCode(4, { activeMixedMailboxEntry: entry }, { maxAttempts: 1 });
  assert.equal(result.code, '456789');
});
```

- [ ] **Step 2: 写入跨主机、跨协议和越界路径的失败测试**

```js
test('rejects redirected responses outside the original mailbox allowlist without leaking secrets', async () => {
  const requestUrl = 'http://yangyang.website/messages/private-token/alias@icloud.com';
  for (const responseUrl of [
    'http://example.com/messages/inbox',
    'https://yangyang.website/messages/inbox',
    'http://yangyang.website/login',
  ]) {
    const logs = [];
    const api = provider.createIcloudUrlProvider({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: responseUrl,
        headers: { get: () => 'text/plain' },
        text: async () => 'code: 456789',
      }),
      sleep: async () => {},
      addLog: async (message) => logs.push(message),
    });
    await assert.rejects(
      api.pollVerificationCode(4, {
        activeMixedMailboxEntry: { type: 'icloud-url', email: 'alias@icloud.com', url: requestUrl },
      }, { maxAttempts: 1 }),
      /响应地址不受信任/
    );
    assert.equal(logs.join('\n').includes('private-token'), false);
  }
});
```

- [ ] **Step 3: 运行 provider 测试并确认 RED**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: 重定向逃逸测试失败，因为当前代码在读取正文前不校验 `response.url`。

- [ ] **Step 4: 实现请求和最终响应 URL 的同规则校验**

```js
const MAILBOX_URL_RULES = [
  { protocol: 'https:', hostname: 'icloud-api.top', pathPrefix: '/show/' },
  { protocol: 'http:', hostname: 'yangyang.website', pathPrefix: '/messages/' },
];

function getMailboxUrlRule(rawUrl) {
  const parsed = new URL(String(rawUrl || '').trim());
  const rule = MAILBOX_URL_RULES.find((candidate) => (
    parsed.protocol === candidate.protocol
    && parsed.hostname.toLowerCase() === candidate.hostname
    && parsed.pathname.startsWith(candidate.pathPrefix)
  ));
  return rule ? { parsed, rule } : null;
}
```

在 `requestMailbox` 中调用 `fetch` 前验证请求 URL；收到响应后、检查状态和读取正文前，验证 `response.url || url` 与原请求匹配同一个规则，并保持相同协议、主机和路径前缀。所有校验错误使用固定中文消息，不拼入 URL。

- [ ] **Step 5: 运行 provider 测试并确认 GREEN**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: JSON/HTML/文本提取、排除旧验证码、轮询和重定向边界测试全部通过。

- [ ] **Step 6: 提交 provider 安全改动**

```bash
git add background/icloud-url-provider.js
git add -f tests/icloud-url-provider.test.js
git commit -m "fix: restrict mailbox response redirects"
```

---

### Task 3: 更新导入提示与使用文档

**Files:**
- Modify: `sidepanel/sidepanel.html:669`
- Modify: `README.md:168`
- Modify: `项目文件结构说明.md:32`

**Interfaces:**
- Consumes: Task 1 已支持的两种 iCloud URL 输入形态。
- Produces: 不包含真实凭据的界面占位提示和用户文档。

- [ ] **Step 1: 更新侧栏占位文本**

```html
placeholder="Outlook：邮箱----密码----客户端ID----刷新令牌&#10;iCloud HTTPS：邮箱----https://icloud-api.top/show/令牌/邮箱&#10;iCloud HTTP：邮箱----http://yangyang.website/messages/&#10;令牌/邮箱"
```

- [ ] **Step 2: 更新 README 示例和风险说明**

```text
outlook@example.com----邮箱密码----客户端ID----刷新令牌
alias@icloud.com----https://icloud-api.top/show/取信令牌/alias@icloud.com
second@icloud.com----http://yangyang.website/messages/
取信令牌/second@icloud.com
```

明确说明两行格式只接受一条非空续行，`yangyang.website` 使用明文 HTTP，网络中间节点可能看到请求路径中的敏感令牌，应只在信任网络环境使用。

- [ ] **Step 3: 更新文件职责说明**

将 `mixed-mailbox-utils.js` 的职责补充为“精确 URL 白名单和两行续接解析”，将 `background/icloud-url-provider.js` 的职责补充为“最终响应 URL 重定向边界校验”。

- [ ] **Step 4: 运行静态检查并提交文档/UI 改动**

```bash
node --check sidepanel/sidepanel.js
git diff --check
git add sidepanel/sidepanel.html README.md 项目文件结构说明.md
git commit -m "docs: explain yangyang mailbox imports"
```

Expected: 命令退出码均为 0，文档和界面中不存在真实邮箱、令牌或用户提供的完整 URL。

---

### Task 4: 全量验证与脱敏实测

**Files:**
- Verify: `mixed-mailbox-utils.js`
- Verify: `background/icloud-url-provider.js`
- Verify: `background.js`
- Verify: `sidepanel/sidepanel.js`
- Verify: `sidepanel/mixed-mailbox-queue-manager.js`
- Verify: repository tests and tracked diff

**Interfaces:**
- Consumes: Tasks 1-3 的实现与用户授权的有效 HTTP 邮箱 URL。
- Produces: 可追溯的测试、语法检查、白名单和脱敏验证结果；不新增包含真实凭据的文件。

- [ ] **Step 1: 运行全量测试和语法检查**

```bash
node --test
node --check mixed-mailbox-utils.js
node --check background/icloud-url-provider.js
node --check background.js
node --check sidepanel/sidepanel.js
node --check sidepanel/mixed-mailbox-queue-manager.js
git diff --check
```

Expected: 所有测试通过，所有语法检查和 diff 检查退出码为 0。

- [ ] **Step 2: 用真实 HTTP 凭据执行无敏感输出的连通性验证**

通过环境变量或标准输入把用户授权的 URL 传给一次性检查脚本；脚本只能输出以下布尔字段，不打印 URL、token、响应正文或验证码：

```text
http_request_ok=true|false
parser_accepts=true|false
provider_parses_response=true|false
secret_leaked=false
```

Expected: 网络可用时前三项为 `true` 且 `secret_leaked=false`；若远端当前没有验证码，只报告 HTTP/解析层的布尔状态，不输出响应内容。

- [ ] **Step 3: 检查提交范围和敏感信息**

```bash
git status --short
git diff HEAD~3 --stat
git log -4 --oneline
```

确认 `.learnings/`、`output/` 未被暂存或提交，并用合成 token 关键字以外的定向检查确认真实凭据未进入 tracked diff。

- [ ] **Step 4: 使用 verification-before-completion 做新鲜验证**

重新运行 Task 4 Step 1 的全部命令，并基于本轮输出汇报：改动点、设计原因、测试结果、真实 HTTP 验证结果、未验证项和剩余风险。
