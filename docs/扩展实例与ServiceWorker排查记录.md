# 扩展实例与 Service Worker 排查记录

## 结论

2026-05-29 本地排查确认：

- 当前仓库对应的未打包扩展是 `GuJumpgate V0.1.5`
- 当前可正常打开的扩展实例 ID 为 `ngfikaakjalhhbkjeapmplejadcekhod`
- 出现 `ERR_BLOCKED_BY_CLIENT` 的扩展页实例 ID 为 `lkplekjecodnnfmoohjjjojoiibmogkj`
- 这两个 ID 对应的不是同一个当前仓库实例，不能混用

## 已确认事实

1. 当前仓库 [manifest.json](/Users/hanhao/Documents/Gujump-author/manifest.json:1) 未声明固定 `"key"`。
2. 对未打包扩展来说，不同加载目录或不同 Chrome 配置下，扩展 ID 变化是正常现象。
3. `background.js` 及其 `importScripts(...)` 依赖文件都存在，且通过了最小语法检查。
4. Chrome 扩展详情页中，`ngfikaakjalhhbkjeapmplejadcekhod` 的 `Service Worker` 可以正常打开 DevTools。
5. 当前实例的侧边栏页面可以正常打开：
   - `chrome-extension://ngfikaakjalhhbkjeapmplejadcekhod/sidepanel/sidepanel.html`

## 实际含义

- `lkplekjecodnnfmoohjjjojoiibmogkj` 对应的是旧实例、其他目录实例，或已经失效的实例。
- 后续本地调试时，应只使用 `ngfikaakjalhhbkjeapmplejadcekhod` 这份当前仓库对应的实例。
- 如果再次看到 `lkple...` 的扩展页报错，不应直接归因到当前仓库代码。

## 调试建议

- 统一从 `chrome://extensions/?id=ngfikaakjalhhbkjeapmplejadcekhod` 进入当前实例详情页。
- 统一从 `chrome-extension://ngfikaakjalhhbkjeapmplejadcekhod/sidepanel/sidepanel.html` 打开当前实例 UI。
- 如果再次怀疑后台异常，优先检查该实例的 `Service Worker` DevTools，而不是旧标签页缓存状态。
