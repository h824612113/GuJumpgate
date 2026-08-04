# 通用 HTTP/HTTPS 邮箱取信 URL 设计

## 目标

统一邮箱队列新增对任意域名 `messages` 取信 URL 的支持，使以下记录可直接批量导入并参与注册、登录验证码轮询：

```text
user@icloud.com----https://mailbox.example/messages/取信令牌/user@icloud.com
second@icloud.com----http://mailbox.example/messages/取信令牌/second@icloud.com
```

原有格式继续兼容：

```text
user@icloud.com----https://icloud-api.top/show/取信令牌/user@icloud.com
user@icloud.com----http://yangyang.website/messages/取信令牌/user@icloud.com
```

本需求只扩展 URL 导入和取信边界，不改变 Outlook Graph、iCloud 网页邮箱或其他邮箱提供商的注册逻辑。

## 方案选择

采用“结构白名单 + 动态同源校验”，不再维护 `messages` 域名白名单。

- 对任意 HTTP/HTTPS 域名，接受精确的 `/messages/{token}/{email}` 凭据结构。
- 保留 `https://icloud-api.top/show/{token}/{email}` 兼容规则。
- 请求后的最终响应必须与原始请求保持相同协议、主机和端口，并且仍位于原路径族内。
- 导入、请求和日志继续使用同一套脱敏约束。

不采用“完全不校验 URL”的方案，因为扩展拥有广泛网络权限，任意 URL 会扩大本地网络探测、跨域跳转和凭据泄露风险。不采用用户维护域名列表的方案，因为用户已明确要求新域名无需逐个加入白名单。

## 导入规则

一行记录仍使用：

```text
邮箱----取信URL
```

通用 URL 必须同时满足：

1. 协议为 `http:` 或 `https:`。
2. 主机名非空，且不是 `localhost` 或以 `.localhost` 结尾的本地主机名。
3. 不允许 URL 用户名、密码、显式端口、查询参数或片段。
4. 路径必须恰好包含三个非空段：`messages/{token}/{email}`。
5. token 必须是单个路径段。
6. 最后一个路径段解码并规范化后，必须与记录开头邮箱完全一致。
7. 拒绝 IPv4、IPv6 回环、私网、链路本地和未指定地址的字面量形式，避免直接访问明显的本地网络目标。

原有 `icloud-api.top/show/{token}/{email}` 仍按相同字段约束处理。原有 `yangyang.website/messages/` 两行续接格式继续保留；通用新域名只要求支持用户当前提供的完整单行格式，不扩大续行状态机范围。

## 取信请求与跳转校验

轮询器继续使用 `GET`、`credentials: 'omit'`、`cache: 'no-store'` 和单次请求超时。

请求前保存已验证的原始 URL 边界：

- 协议；
- 主机；
- 有效端口；
- 路径族 `/messages/` 或 `/show/`。

收到响应后，在读取响应正文前校验最终 URL：

1. 协议、主机和有效端口必须与请求 URL 相同。
2. `messages` 请求的最终路径必须仍以 `/messages/` 开头。
3. `show` 请求的最终路径必须仍以 `/show/` 开头。
4. 不允许跳转到另一个域名、HTTP/HTTPS 互换、其他端口或其他路径族。

这样允许同一取信站点把凭据 URL 重定向到站内收件箱页面，同时阻止跨站读取和令牌被带到其他目标。

## HTTP 风险处理

用户明确要求任意新域名同时支持 HTTP。HTTP 请求中的主机、邮箱、路径和取信令牌可能被网络中间节点读取或篡改，因此：

- 导入器允许 HTTP，但界面和 README 必须明确显示明文传输警告。
- HTTP 与 HTTPS 使用相同的结构校验和同源跳转校验。
- 程序不在日志、列表、错误消息中输出完整取信 URL 或 token。
- 不把 HTTP 自动升级成 HTTPS，避免改变用户提供站点的实际接口行为。

该设计只能降低明显的目标逃逸和本地地址风险，无法为 HTTP 提供传输机密性或完整性。

## 验证码解析

现有解析行为保持不变，继续支持：

- JSON 明确字段，如 `code`、`verificationCode`、`verification_code`、`otp`；
- JSON 嵌套文本；
- HTML；
- 纯文本；
- 运行时自定义验证码正则；
- 六位数字回退匹配；
- `excludeCodes` 排除已经使用或被拒绝的验证码。

本次不针对特定新域名编写响应解析分支；所有符合结构约束的站点复用统一解析器。

## 界面与文档

统一邮箱队列和 Hotmail 批量导入框的提示更新为通用示例：

```text
iCloud URL：邮箱----http(s)://域名/messages/令牌/邮箱
```

README 说明：

- `messages` 格式不再限制域名；
- HTTP 与 HTTPS 均可导入；
- HTTP 会暴露邮箱和取信令牌，只应在可信网络中使用；
- URL 尾部邮箱必须一致；
- 跨域或跨路径跳转会被拒绝。

列表和日志继续只显示 provider 类型、邮箱及脱敏错误，不显示完整 URL。

## 测试策略

按 TDD 增加以下回归测试：

1. 任意 HTTPS 域名 `/messages/{token}/{email}` 可导入。
2. 任意 HTTP 域名 `/messages/{token}/{email}` 可导入。
3. 多条通用 URL 可通过统一队列和旧 Hotmail 批量入口导入，并保持顺序。
4. URL 尾部邮箱不一致、路径段数量错误、非 `messages` 路径、查询参数、片段、账号密码或显式端口被拒绝。
5. localhost、私网及其他本地 IP 字面量被拒绝。
6. 通用 HTTP/HTTPS URL 可以轮询 JSON、HTML和纯文本中的六位验证码。
7. 同源 `/messages/` 内跳转可接受。
8. 跨协议、跨域、跨端口和离开 `/messages/` 的跳转在读取正文前被拒绝。
9. 日志和错误消息不泄露 token。
10. 原有 `icloud-api.top/show`、`yangyang.website/messages`、Outlook 混合队列测试继续通过。

## 验收标准

- 用户提供的多条 `https://任意域名/messages/令牌/邮箱` 记录可全部导入，而不是显示 0 条。
- 等价的 HTTP 记录同样可导入并进入 URL 轮询。
- 步骤 4 日志显示正在通过 iCloud URL 获取验证码，但不包含完整 URL 或 token。
- 当取信页面返回新的六位验证码时，流程可以提取并提交。
- 违规 URL 和越界跳转被拒绝，且错误可诊断但不泄密。
- 新增测试、现有全量测试、JavaScript 语法检查和 diff 检查全部通过。

