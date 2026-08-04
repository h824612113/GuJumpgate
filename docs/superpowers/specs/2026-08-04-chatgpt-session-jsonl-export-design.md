# 注册完成后保存 ChatGPT Session JSONL

## 目标

每个账号完成注册后，请求当前 ChatGPT 会话接口 `/api/auth/session`，将接口返回的完整 JSON 对象以紧凑 JSON 形式追加到本地文件，每行一条记录。

## 数据与安全边界

- 保存完整接口响应，不只保存 `accessToken`。
- 使用 JSONL/NDJSON 格式；`JSON.stringify` 产生的转义保证每条记录占一行。
- session 只发送到本机 helper 并写入本地，不写入扩展日志、不上传远程服务。
- 默认文件为项目目录下的 `data/chatgpt-session.jsonl`。

## 流程设计

1. 在 `wait-registration-success` 稳定等待后打开或复用已登录的 ChatGPT 标签页。
2. 通过现有内容脚本读取 `/api/auth/session`，校验响应成功且为对象。
3. 将完整对象序列化为单行，调用本地 helper 的追加接口。
4. helper 使用进程锁以追加模式写入 `data/chatgpt-session.jsonl`，返回文件路径。
5. 写入成功后再完成“等待注册成功”节点；任一步失败都让节点失败并保留可诊断错误。

## 测试

- Node 回归测试覆盖：完整 session 被序列化为单行并发给追加接口；空响应或非对象响应会失败。
- Python helper 测试覆盖：追加内容始终补充单个换行，不覆盖已有记录。
- 完成后运行相关测试、完整 `node --test tests/*.test.js`、语法检查和 diff 检查。
