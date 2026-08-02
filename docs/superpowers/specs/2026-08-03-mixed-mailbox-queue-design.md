# Outlook 与 iCloud URL 混合邮箱队列设计

## 目标

在同一个批量导入框中混合导入以下两种邮箱记录，并按导入顺序连续完成自动注册和验证码接收：

```text
outlook@example.com----密码----客户端ID----刷新令牌
bismuth.quizzes.7u@icloud.com----https://icloud-api.top/show/令牌/bismuth.quizzes.7u@icloud.com
```

自动运行必须根据当前队列条目切换收码实现，不要求用户手动切换邮箱服务。现有 Outlook 账号池、自定义纯邮箱池和其他邮件提供商保持兼容。

## 方案选择

采用“统一邮箱运行队列 + 复用现有提供商”的方案。

- Outlook 导入记录继续写入现有 `hotmailAccounts`，统一队列仅保存 `hotmailAccountId` 引用。
- iCloud URL 记录在统一队列中保存完整取信凭据。
- 自动运行只设置当前队列条目，不持久化覆盖用户选择的全局邮箱服务。
- 邮件配置和验证码轮询根据当前队列条目解析有效 provider。

不采用将记录简单拆入两个旧池的方案，因为它不能保留混合顺序。不进行全邮件系统重构，因为其影响范围超过本需求。

## 数据模型

新增持久化字段 `mixedMailboxQueueEntries`：

```js
{
  id: 'mixed-mailbox-...',
  type: 'outlook' | 'icloud-url',
  email: 'user@example.com',
  hotmailAccountId: 'hotmail-...',
  credential: 'user@icloud.com----https://icloud-api.top/show/.../user@icloud.com',
  enabled: true,
  used: false,
  lastError: '',
  lastUsedAt: 0
}
```

约束：

- Outlook 条目必须有 `hotmailAccountId`，不在队列中复制密码、客户端 ID 或刷新令牌。
- iCloud URL 条目必须有完整 `credential`，其显示和日志只能使用脱敏值。
- 数组顺序是唯一运行顺序，不另设可漂移的排序字段。
- 唯一键为 `type + email`。重复导入更新凭据或账户引用，保留原队列位置和使用状态。

运行态新增 `activeMixedMailboxEntryId`，用于定位当前轮条目。该字段不改变侧栏持久化的 `mailProvider`。

## 导入识别

导入器按行处理，允许两种格式混排：

1. 第一段是合法邮箱，余下内容以 `https://` 开头时识别为 `icloud-url`。
2. 否则按四段 `邮箱----密码----客户端ID----刷新令牌` 识别为 `outlook`。
3. 空行和已知表头被忽略。
4. 无效行不阻止有效行导入，结果必须报告成功数、更新数、跳过数和具体错误行。

iCloud URL 第一版只接受：

- `https:` 协议；
- 主机名 `icloud-api.top`；
- 路径以 `/show/` 开始；
- URL 最后一段解码后与导入邮箱一致。

## 界面

新增“统一邮箱队列”区域，提供：

- 单个混合批量导入框；
- 导入、刷新、清空已用、全部删除；
- 搜索和全部/当前/可用/已用/异常筛选；
- 列表类型标签 `Outlook`、`iCloud URL`；
- 使用此邮箱、启用/停用、标记已用/未用、删除；
- 汇总 Outlook、iCloud URL、可用、已用和异常数量。

列表不渲染密码、刷新令牌、完整取信 URL或 URL 令牌。

选择统一邮箱队列模式后，自动轮数锁定为启用且未使用的条目数。现有 Outlook 专用导入入口和自定义纯邮箱池继续保留。

## 自动运行数据流

每一目标轮开始时：

1. 按数组顺序选择第一个启用且未使用的队列条目。
2. 将其 ID 写入 `activeMixedMailboxEntryId`，将邮箱写入当前注册邮箱状态。
3. Outlook 条目设置本轮 `currentHotmailAccountId`，邮件路由复用 `hotmail-api`。
4. iCloud URL 条目由运行时邮件配置解析为新 provider `icloud-url`。
5. 注册和登录验证码步骤都根据运行时 provider 调用对应轮询器。
6. 完整流程成功后才将队列条目标记为已用并写入 `lastUsedAt`。
7. 失败时写入脱敏错误到 `lastError`，保持未用并停止批次。

任何队列条目失败后都不自动越过该条目，避免导入顺序、账号历史和实际注册结果错位。

## iCloud URL 取信适配器

新增独立的 `icloud-url` 轮询器，不复用当前要求 Worker `/api/verification-code` 的 `icloud-api` provider。

每次轮询直接对凭据中的 URL 发起 `GET`：

- `credentials: 'omit'`；
- 单次请求设超时；
- 只接受成功 HTTP 状态；
- 不记录完整请求 URL；
- 支持 JSON、HTML 和纯文本响应。

响应解析顺序：

1. JSON 明确字段：`code`、`verificationCode`；
2. JSON 邮件集合：`messages`、`mails`、`items`、`data`；
3. HTML 或纯文本正文；
4. 使用当前邮件规则传入的 `codePatterns`；
5. 回退到现有六位验证码模式。

解析时应用 `excludeCodes`，并在响应包含收件人信息时优先匹配当前目标邮箱。注册与登录步骤沿用现有轮询次数、间隔和停止信号。

## 错误处理

- 导入错误包含行号，但敏感字段使用固定占位符。
- URL 协议、主机、路径或邮箱不匹配时拒绝导入。
- Outlook 字段不足时沿用现有四段格式错误说明。
- 取信请求的超时、401、403、404、429 和 5xx 转换为可识别错误，不输出 token。
- 响应无法解析或未找到验证码时继续当前轮询窗口；窗口耗尽后记录异常并停止批次。
- 用户停止操作时沿用现有 stop error，不将条目标记为异常或已用。

## 兼容与迁移

- 不迁移或重写现有 `hotmailAccounts`、`customEmailPoolEntries`。
- 统一队列是新增的可选运行模式。
- 配置导入导出需要包含 `mixedMailboxQueueEntries`，旧配置缺少该字段时使用空数组。
- 删除 Outlook 队列条目不删除其底层 Hotmail 账号；删除底层 Hotmail 账号时，对应队列条目标记异常并禁止运行。

## 测试与验收

新增可在 Node 中运行的纯工具模块和 `node:test` 测试，覆盖：

- Outlook 四段格式解析；
- iCloud URL 两段格式解析；
- 两种格式混排后顺序保持；
- 表头、空行、无效行和部分成功导入；
- 重复导入更新但不改变位置；
- URL 协议、主机、路径和邮箱校验；
- 敏感值脱敏；
- JSON、HTML、纯文本验证码提取；
- `excludeCodes` 生效；
- Outlook 与 iCloud URL 运行时 provider 解析；
- 成功后标记已用、失败后保持未用并停止。

验证步骤：

1. 运行新增单元测试。
2. 对所有修改过的 JavaScript 执行 `node --check`。
3. 加载扩展，混合导入至少一条 Outlook 和一条 iCloud URL，确认顺序、类型标签和敏感值不泄露。
4. 使用可用 Outlook 账号验证 Graph 收码不回归。
5. 使用用户提供的有效 iCloud URL 完成一次真实验证码轮询，确认能提取并提交验证码。
6. 验证失败 URL 不会跳过当前条目或误标记已用。

只有单元测试、脚本语法检查和两种真实收码路径均通过后，才视为功能完成。
