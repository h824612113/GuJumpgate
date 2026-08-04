# iCloud 共享 URL 支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 `https://icloud-api.top/s/{token}/{email}` 的批量导入和安全验证码轮询。

**Architecture:** 导入器和 URL provider 各维护同一组受信任 iCloud HTTPS 路径族：`/show/` 与新增 `/s/`。通用 HTTP/HTTPS `/messages/` 规则不变；响应校验继续比较协议、主机、端口和路径族。

**Tech Stack:** Manifest V3 extension、原生 JavaScript、Node `node:test`。

## Global Constraints

- 仅接受 HTTPS `icloud-api.top/s/{token}/{email}`，不放宽为任意域名或 HTTP `/s/`。
- URL 尾部邮箱必须等于行首邮箱；禁止 URL 登录信息、端口、查询参数、片段和本机/IP 主机。
- 取信响应必须保留同协议、同主机、同端口和 `/s/` 路径族。
- 日志、错误与测试断言不得使用真实取信 token。

---

### Task 1: 测试并实现 `/s/` 导入校验

**Files:**
- Modify: `tests/mixed-mailbox-utils.test.js`
- Modify: `mixed-mailbox-utils.js`

**Interfaces:**
- Consumes: `parseMixedMailboxImport(value)`。
- Produces: 可进入队列的 `icloud-url` 记录，URL 保持原有 `/s/` 路径。

- [ ] **Step 1: 写入失败测试**

```js
test('parses HTTPS iCloud shared mailbox URLs', () => {
  const result = utils.parseMixedMailboxImport(
    'alias@icloud.com----https://icloud-api.top/s/shared-token/alias@icloud.com'
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].url, 'https://icloud-api.top/s/shared-token/alias@icloud.com');
});
```

再添加 HTTP `/s/`、错误路径和尾部邮箱不一致的拒绝用例。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 新增 `/s/` 成功导入断言失败，因为当前规则只允许 `/show/`。

- [ ] **Step 3: 最小实现**

将 iCloud 固定规则表示为 `show` 和 `s` 两个 HTTPS 路径族；保留现有通用 `/messages/` 分支与所有 URL 字段校验。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/mixed-mailbox-utils.test.js`

Expected: 导入测试全部通过。

### Task 2: 测试并实现 `/s/` 取信响应边界

**Files:**
- Modify: `tests/icloud-url-provider.test.js`
- Modify: `background/icloud-url-provider.js`

**Interfaces:**
- Consumes: `createIcloudUrlProvider({ fetchImpl, sleep, addLog }).pollVerificationCode()`。
- Produces: `/s/` 站内页面的六位验证码，或针对越界响应的安全错误。

- [ ] **Step 1: 写入失败测试**

```js
test('polls an iCloud shared URL that remains under the shared path', async () => {
  const api = provider.createIcloudUrlProvider({
    fetchImpl: async () => responseFor('https://icloud-api.top/s/inbox', '验证码：654321'),
    sleep: async () => {},
  });
  const result = await api.pollVerificationCode(4, sharedUrlState(), { maxAttempts: 1 });
  assert.equal(result.code, '654321');
});
```

增加 `/s/` 跳转到 `/show/` 或异站响应时失败的断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: 新增成功用例在请求前以“不受信任”失败。

- [ ] **Step 3: 最小实现**

让 provider 识别 `/s/` 为固定 HTTPS iCloud 路径族；不改变动态 `/messages/` API 解析分支。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/icloud-url-provider.test.js`

Expected: provider 测试全部通过，且越界响应仍被拒绝。

### Task 3: 全量验证与提交

**Files:**
- Verify: `tests/*.test.js`
- Verify: `mixed-mailbox-utils.js`
- Verify: `background/icloud-url-provider.js`

- [ ] **Step 1: 执行回归与语法检查**

Run: `node --test tests/*.test.js && node --check mixed-mailbox-utils.js && node --check background/icloud-url-provider.js && git diff --check`

Expected: 全部命令以退出码 0 完成。

- [ ] **Step 2: 提交代码**

```bash
git add mixed-mailbox-utils.js background/icloud-url-provider.js \\
  tests/mixed-mailbox-utils.test.js tests/icloud-url-provider.test.js \\
  docs/superpowers/specs/2026-08-04-icloud-shared-url-design.md \\
  docs/superpowers/plans/2026-08-04-icloud-shared-url-support.md
git commit -m "feat: support iCloud shared mailbox URLs"
```
