# ChatGPT Session to CPA / sub2api / Cockpit / 9router / Codex / AxonHub / Codex-Manager

纯前端单页面工具，用来把 ChatGPT Web 登录 session JSON 转换成 CPA、sub2api、Cockpit Tools、9router、Codex auth.json、AxonHub 或 Codex-Manager 可导入 JSON。

## 在线使用

### [**》》 点我直接使用 《《**](https://gtxx3600.github.io/GPTSession2CPAandSub2API/)

## 使用提示

Plus 号可以用此方式导入中转站使用；Free 号的 access token 不能用于调用接口。

本工具可用来解决 Codex OAuth 登录需要绑定手机的问题。Plus 账号通过 Web 登录后的 session 就能生成可导入中转站的账号 JSON 数据；这类数据没有 `refresh_token`，但 `access_token` 有效期通常足够长。

解释一下： plus激活前（free状态）或激活后（plus状态）获取的session在使用上没有区别（free时拿到的session, 激活plus后就可以调模型了），只是账号级别标识有点区别（标识为free or plus），不影响调模型。 换句话讲，不管你啥时候拿到的session, 用本项目转换导入中转站，只要账号当前激活了plus, 就能正常调模型接口。

本工具主要针对 Plus 账号适用，Free 账号即使转换了也没有权限调用 GPT 模型。GoPay 拉闸了，没法每天发 Plus 了；加入 Discord 频道免费获取 GPT 撸羊毛信息，然后配合本工具导入 CPA or Sub2API 使用。

## GOAPY 拉闸了， Party is OVER ～ 
## **加入 Discord 频道免费获取 GPT 撸羊毛信息：**

### [**》》 加入 Discord 频道 《《**](https://discord.gg/GFmHY2TZNy)

邀请链接：`https://discord.gg/GFmHY2TZNy`


## 支持输入

支持粘贴或拖入 ChatGPT Web session JSON，例如包含：

- `user.email`
- `accessToken`
- `sessionToken`
- `expires`
- `account.id`
- `account.planType`

也支持粘贴或拖入 9router Codex OAuth JSON，例如包含 `accessToken`、`refreshToken`、`expiresAt`、`providerSpecificData.chatgptAccountId` 和 `providerSpecificData.chatgptPlanType`。

也支持粘贴或拖入 Codex 原生 auth.json，例如包含 `auth_mode`、`OPENAI_API_KEY`、`tokens.access_token`、`tokens.refresh_token`、`tokens.id_token`、`tokens.account_id` 和 `last_refresh`。

也支持粘贴或拖入 AxonHub Codex auth.json，例如包含 `tokens.access_token`、`tokens.refresh_token`、`tokens.id_token` 和 `last_refresh`。

也支持粘贴或拖入 Codex-Manager 批量导入 JSON，例如包含 `tokens.access_token`、`tokens.refresh_token`、`tokens.id_token` 和 `meta.label`。

页面也会尝试从 `accessToken` 的 JWT payload 中补充邮箱、账号 ID、用户 ID、计划类型和过期时间。

## 输出格式

- `CPA`：生成 Codex CPA auth JSON，包含 `type: "codex"`、`access_token`、`session_token`、`id_token`、`email`、`account_id`、套餐和过期时间等字段；缺少真实 `id_token` 时会根据 session 与 access token claims 构造 Codex 可解析的占位 JWT claims。
- `sub2api`：生成参考 `CPA2sub2API` 项目的 `exported_at/proxies/accounts` 结构，账号平台为 `openai`，类型为 `oauth`；每个账号对象包含 `expires_at` 和 `auto_pause_on_expired`，其中 `expires_at` 来自该账号 access token 的 JWT `exp` 秒级时间戳。
- `Cockpit`：生成 Cockpit Tools Codex JSON 导入可识别的扁平 token 格式，包含 `id_token`、`access_token`、`refresh_token`、`account_id`、`email`、`expired` 等字段。
- `9router`：生成 9router Codex OAuth JSON，包含 `accessToken`、`refreshToken`、`expiresAt`、`providerSpecificData`、`provider`、`authType`、`priority`、`isActive`、`createdAt` 和 `updatedAt` 等字段。
- `Codex`：生成原生 Codex `auth.json`，包含 `auth_mode: "chatgpt"`、`OPENAI_API_KEY: null`、`tokens.id_token/access_token/refresh_token/account_id` 和 `last_refresh`。缺少真实 `refresh_token` 时保留空字符串，access token 过期后不能自动刷新。
- `AxonHub`：生成 AxonHub Codex auth.json，包含 `auth_mode: "chatgpt"`、`last_refresh` 和 `tokens.access_token/refresh_token/id_token`。缺少真实 `refresh_token` 时会写入 `__missing_refresh_token__` 占位值，方便在 access token 过期前试用；过期后不能自动刷新。
- `Codex-Manager`：生成 Codex-Manager 批量导入 JSON，包含 `tokens.access_token/refresh_token/id_token` 和 `meta.label/workspace_id/chatgpt_account_id/note`。缺少真实 `refresh_token` 时保留空字符串，避免被 Codex-Manager 误判为可刷新账号。
ChatGPT Web session 通常不包含 OAuth 文件里常见的 `refresh_token`，因此 access token 过期后不能自动刷新。

## 本地使用

直接打开：

```text
docs/index.html
```

所有解析和转换都在浏览器本地完成，不上传 token，不写入本地存储。

## 批量导出 CPA / sub2api / Cockpit / 9router

如果使用 `/Users/hanhao/Documents/freecodex/codex-oauth-automation-extension` 批量注册，注册成功后只要把 helper 或自动化流程落盘的 session/auth JSON 目录作为输入，就可以一次生成四套配置，并分别放到不同目录：

```bash
npm run export:configs -- \
  /Users/hanhao/Documents/freecodex/codex-oauth-automation-extension/data \
  --out ./exports
```

输出结构：

```text
exports/
├── cpa/
│   ├── accounts/
│   └── cpa-accounts.json
├── sub2api/
│   ├── accounts/
│   └── sub2api-accounts.json
├── cockpit/
│   ├── accounts/
│   └── cockpit-accounts.json
├── 9router/
│   ├── accounts/
│   └── 9router-accounts.json
└── manifest.json
```

可通过 `--targets cpa,sub2api,cockpit,9router` 指定导出目标；默认会读取已有 `accounts/` 单账号文件并合并去重，方便后续分批追加。若想完全按本次输入重建合并文件，添加 `--replace`。

## 批量导出 sub2api JSON

项目也提供 Node CLI，用于把注册成功后落盘的 session/auth JSON 批量转换成 sub2api 可导入格式，并统一放到一个目录里。

```bash
npm run export:sub2api -- /path/to/auth-json-or-dir --out ./exports/sub2api
```

输出结构：

```text
exports/sub2api/
├── accounts/
│   └── <email>.sub2api.json      # 单账号导入 JSON
├── sub2api-accounts.json         # 合并后的 sub2api 导入 JSON
└── manifest.json                 # 本次导出摘要、输入文件、跳过项
```

用于 AutoTeam 的常见命令：

```bash
npm run export:sub2api -- \
  /Users/hanhao/Documents/freecodex/AutoTeam-F/auths \
  --out /Users/hanhao/Documents/freecodex/AutoTeam-F/exports/sub2api
```

导出脚本会读取输入目录下所有 `.json`，识别包含 `accessToken/access_token` 和邮箱或账号 ID 的对象，生成 `exported_at/proxies/accounts` 结构。重复账号按邮箱或账号 ID 去重，后转换的文件覆盖旧记录。

如果只想生成合并文件，不需要每个账号单独文件：

```bash
npm run export:sub2api -- /path/to/auths --out ./exports/sub2api --no-individual
```
