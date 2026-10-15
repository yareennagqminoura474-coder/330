# 可选择的 API 中转（v1.7.81）

## v1.7.82：免手填的私密配置链接

新增独立 DEVICE_TOKEN Worker secret，不替换旧 PROXY_TOKEN。私密链接使用 URL fragment，在任何第三方脚本前由同步加载的 api-transport.js 捕获到闭包，并立即 history.replaceState 移除。凭据不放入公开源码、默认配置、query 参数或服务端 URL；但链接本身仍是私密凭据，不能公开或转发，也不宣称一次性／过期。

初始化仅对明确打开的配置链接调用自有 /device/check，不发送服务商 API 密钥，不触发上游。验证成功才原子写入当前浏览器的 api-transport 行，同时仅设置 69.deepsuck.sbs 中转，保留其他地址选择。验证失败、格式无效、重复参数不覆盖原配置。普通重开不重复验证、不拉模型、不生成。主副模型、API keys、预设、人物空间、历史和钱包不变。

这是在原 GitHub 站点当前浏览器中一次完成配置，不是远程控制用户手机；在电脑打开只配置电脑，手机需在原来的 Edge 中打开。不同浏览器／隐私窗口不共享 IndexedDB。

依据：https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment 。保留原日志／trace 隐私限制。测试覆盖新旧凭据并存、空／错误凭据拒绝、验证无上游调用、读取前清理 fragment、成功保存与重开、拒绝及畸形链接保留原数据、无自动付费调用。

默认仍然直连，不自动探测或失败后切换。主 API、副 API、第三方生图旁都有「此地址连接方式」：只有手动选中转的地址经过账户自己的 ephone-gcli-proxy；其他地址不变。按规范化 API 基础地址保存选择，同一服务根地址／v1 共用，切换到未设置的新地址默认直连。保存在共享 IndexedDB globalSettings 的 api-transport 行，基础设置跨人物空间共享，不按角色分割。

中转访问需要旧 PROXY_TOKEN（不是服务商 API Key）。从已有旧中转预设／当前配置自动提取；不存在时，用户需在「我的中转」粘贴一次旧完整链接或 64 位授权码。代码、GitHub 和默认配置不包含这个秘密。原服务器秘密不重置，旧 token 路径继续仅兼容原 gcli 接口。备份将连接设置嵌入 globalSettings 主行，恢复只消费一次，与独立生图设置相同；备份含凭据，不可公开。

网页中转包装位于原 payload guard 下面：先原有图片保护与完整请求统计，再流式转发。原模型、人设、记忆、请求内容与取消信号保持原分工；原生 Gemini 的 URL key 转为 x-goog-api-key 请求头。只拦截已选地址的模型列表／聊天／图片标准接口，静态文件、图片预览、非 API 和本机／局域网请求不走云中转。选择中转但授权缺失或失败时停止，不回退直连，不轮试其他地址，不新增付费重试。

## Worker 安全与部署

沿用账户 520b96b45cc1a71386b801dd71f0704c 的 ephone-gcli-proxy，不改其他 Workers。部署入口 relay-worker.mjs，兼容日期保持现有 2026-09-24，PROXY_TOKEN 保留。无新数据库、订阅或计划升级。

- 固定允许 GitHub 网页 Origin，另以秘密做 SHA-256 后恒时校验，Origin 不是唯一认证。
- 公网 HTTPS 域名／标准 API 路径／GET-POST 方法限制；拒绝 IP、本机和常见内网域名、userinfo、URL 密钥、中转环路。
- 不跟随重定向，不把 API 密钥转发至 Location；不转发浏览器 Cookie、Origin 或中转授权头给上游。
- 请求和响应透传流，不读完整大正文；不缓存、存储或记录聊天、API 密钥。
- 隐私例外：不启用自动调用日志／trace，因为兼容的旧 URL 路径含授权码，原生上游也可能有私人信息。仅保留无请求内容的日志能力；不打印原始异常。
- CORS OPTIONS 本地返回；预检不触发上游生成。

验证：api-transport.test.js、relay-worker.test.js、api-transport.browser.test.js；原有本机 Service Worker 测试、主副分工、预设、生图、上下文统计回归。隔离假凭据和假接口；真实 69 域名仅用无效假密钥 GET /v1/models 验证可读 401，不调用真实付费生成。Wrangler dry-run 与本地 workerd 检查流式和 Web Crypto。

参考：
- https://developers.cloudflare.com/workers/runtime-apis/request/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/

中转不能解决服务商额度、无效 API Key、不支持模型、网络不可达或 workers.dev 在用户网络不可达的问题；不会承诺任意服务全部可用。
