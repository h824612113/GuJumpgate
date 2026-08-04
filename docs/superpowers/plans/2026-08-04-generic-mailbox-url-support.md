# 通用邮箱取信 URL 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让统一邮箱队列支持任意 HTTP/HTTPS 域名的 `/messages/{token}/{email}` 取信 URL，并在保持同源跳转约束的前提下完成验证码轮询。

**Architecture:** `mixed-mailbox-utils.js` 把静态 `show` 规则与通用 `messages` 结构规则统一到导入校验中；`background/icloud-url-provider.js` 用等价规则保护实际请求与最终响应 URL。界面和 README 使用域名无关示例，并明确 HTTP 明文风险。

**Tech Stack:** Manifest V3 extension、原生 JavaScript、Node `node:test`。

## Global Constraints

- 新 URL 允许 `http:` 和 `https:`，并且必须是 `/messages/{token}/{email}`。
- 兼容 `https://icloud-api.top/show/{token}/{email}` 与既有 `yangyang.website` 两行续行导入。
- 禁止 URL 用户名、密码、显式端口、查询参数和片段。
- 拒绝 localhost 及明显本地/私有 IP 字面量。
- 取信最终响应必须同协议、同主机、同端口且仍处于原路径族。
- 日志、错误和界面不得输出完整取信 URL 或 token。

---

### Task 1: 为通用导入规则建立失败测试

**Files:**
- Modify: `tests/mixed-mailbox-utils.test.js`
- Test: `tests/mixed-mailbox-utils.test.js`

**Interfaces:**
- Consumes: `parseMixedMailboxImport(value)` from `mixed-mailbox-utils.js`.
- Produces: 对通用 `messages` URL 与本地地址拒绝行为的回归覆盖。

- [ ] **Step 1: 写入失败测试**

```js
test('parses arbitrary HTTPS and HTTP messages mailbox URLs', () => {
  const result = utils.parseMixedMailboxImport([
    'one@icloud.com----https://mail.example/messages/token-one/one@icloud.com',
    'two@icloud.com----http://mail.example/messages/token-two/two@icloud.com',
  ].join('\n'));

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.records.map((entry) => entry.url), [
    'https://mail.example/messages/token-one/one@icloud.com',
    'http://mail.example/messages/token-two/two@icloud.com',
  ]);
});
```

再加入 `localhost`、`127.0.0.1`、`10.0.0.1`、`[::1]` 失败案例，并把旧的“非白名单主机拒绝”用例改成仅覆盖路径、邮箱、URL 字段和无效协议。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 新 HTTP/HTTPS 任意域名测试失败，错误来自当前白名单限制。

- [ ] **Step 3: 实现最小导入校验**

在 `mixed-mailbox-utils.js`：

```js
function getMailboxUrlRule(parsed) {
  if (isAllowedShowUrl(parsed)) return { pathPrefix: 'show', generic: false };
  if (isPublicMailboxHost(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol)
      && parsed.pathname.startsWith('/messages/')) {
    return { pathPrefix: 'messages', generic: true };
  }
  return null;
}
```

保留三个路径段、尾部邮箱一致和 URL 字段限制；`yangyang.website/messages/` 的两行续行识别保持专用逻辑不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 所有导入解析测试通过。

- [ ] **Step 5: Commit**

```bash
git add mixed-mailbox-utils.js tests/mixed-mailbox-utils.test.js
git commit -m "feat: accept generic mailbox message URLs"
```

### Task 2: 为通用 URL 轮询和跳转校验建立失败测试

**Files:**
- Modify: `tests/icloud-url-provider.test.js`
- Test: `tests/icloud-url-provider.test.js`

**Interfaces:**
- Consumes: `createIcloudUrlProvider({ fetchImpl, sleep, addLog })`.
- Produces: 通用 HTTP/HTTPS URL 请求、站内跳转和跨边界拒绝的回归覆盖。

- [ ] **Step 1: 写入失败测试**

```js
test('polls an arbitrary HTTPS messages URL and accepts same-origin inbox redirects', async () => {
  const api = provider.createIcloudUrlProvider({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://mail.example/messages/inbox',
      headers: { get: () => 'text/plain' },
      text: async () => '验证码：456789',
    }),
    sleep: async () => {},
    throwIfStopped() {},
  });
  const result = await api.pollVerificationCode(4, {
    activeMixedMailboxEntry: {
      type: 'icloud-url', email: 'user@icloud.com',
      url: 'https://mail.example/messages/token/user@icloud.com',
    },
  }, { maxAttempts: 1 });
  assert.equal(result.code, '456789');
});
```

增加 HTTP 同源 `messages` URL 成功用例，以及 `http://127.0.0.1/...` 请求在调用 fetch 前被拒绝的用例。保留跨协议、跨域、跨路径跳转拒绝测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: 通用域名轮询测试失败，错误为取信地址不受信任。

- [ ] **Step 3: 实现最小轮询 URL 校验**

在 `background/icloud-url-provider.js` 中用 `getMailboxUrlRule(parsed)` 识别固定 `show` 与通用 `messages` 格式；保存解析后的请求边界，并在响应 URL 校验中比较 `protocol`、`hostname`、`port` 和路径前缀。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: 全部 URL provider 测试通过，且 token 未出现在日志或错误断言中。

- [ ] **Step 5: Commit**

```bash
git add background/icloud-url-provider.js tests/icloud-url-provider.test.js
git commit -m "feat: poll generic mailbox message URLs"
```

### Task 3: 更新导入提示和用户文档

**Files:**
- Modify: `sidepanel/sidepanel.html`
- Modify: `README.md`

**Interfaces:**
- Consumes: 完成后的通用 URL 导入规则。
- Produces: 与真实支持范围一致的 UI 示例和风险说明。

- [ ] **Step 1: 更新两处导入框示例**

把固定主机文案替换为：

```text
iCloud URL：邮箱----http(s)://域名/messages/令牌/邮箱
```

保留 Outlook 四段格式和现有 yangyang 两行示例说明。

- [ ] **Step 2: 更新 README 导入说明**

将“两个精确白名单”改为“任意 HTTP/HTTPS 域名的 `/messages/{token}/{email}`”；说明 `icloud-api.top/show` 仍兼容、HTTP 明文风险、禁止跨域/跨路径跳转以及尾部邮箱一致性。

- [ ] **Step 3: 检查文案与敏感信息**

Run: `rg -n "仅允许.*白名单|两个精确白名单|http\(s\)://域名/messages" README.md sidepanel/sidepanel.html`

Expected: 不再向用户声明 `messages` 仅限固定域名；示例不含真实 token。

- [ ] **Step 4: Commit**

```bash
git add README.md sidepanel/sidepanel.html
git commit -m "docs: explain generic mailbox URL imports"
```

### Task 4: 执行全量验证

**Files:**
- Verify: `tests/*.test.js`
- Verify: `mixed-mailbox-utils.js`
- Verify: `background/icloud-url-provider.js`

- [ ] **Step 1: 运行所有测试**

Run: `node --test tests/*.test.js`

Expected: 所有测试通过。

- [ ] **Step 2: 执行语法和差异检查**

Run: `node --check mixed-mailbox-utils.js && node --check background/icloud-url-provider.js && git diff --check`

Expected: 三个命令均以退出码 0 完成。

- [ ] **Step 3: 审核工作区**

Run: `git status --short && git log -4 --oneline`

Expected: 仅保留用户已有的 `.learnings/`、`output/` 未跟踪目录，不把它们纳入提交。
