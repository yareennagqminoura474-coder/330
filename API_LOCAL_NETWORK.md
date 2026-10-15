# 手机 Edge 与本地 API（v1.7.79）

## 已确认的缺陷与修复

旧 `sw.js` 对所有 GET 调用 `respondWith(caches.match(request).then(...fetch(request)))`，包含用户填写的 `http://127.0.0.1:2156/v1/models`。这会把本应由窗口发起的 API 请求转移到 Service Worker，同时可能命中不该使用的 API 缓存。

已对照糯叽机公开网页：`sw-handlers.js` 限制自身 assets 路径；`sw.js` 的 Workbox 处理静态资源、页面和明确 CDN，不通配接管本地模型接口。其网页请求包装最终使用普通 fetch；安装版的原生 HTTP 是另一条通道，但用户已经确认同一手机 Edge 的网页版也可成功，所以不能用“App／网页差别”解释此次对比。

v1.7.79 改为明确的静态文件允许列表：

- API、非静态、非 GET 请求不调用 worker 的 respondWith、fetch 或 Cache Storage。
- 有 Authorization、Proxy-Authorization、x-api-key 或 x-goog-api-key 的请求一律不接管，包括看似静态的 URL。
- 导航仅处理本应用 scope 内的同源页面；心跳只处理本站指定路径。
- 保留已知静态文件的离线读取，缓存读取失败可直接取静态文件；不借此对 API 重试。
- 激活只清理旧 ephone-cache-* 静态缓存，不删除其他缓存，不访问／清理 IndexedDB、localStorage 或聊天数据。

`_ephoneApiFetch` 的浏览器回环地址请求增加 `targetAddressSpace: "loopback"` 标注，不改 URL、密钥头、请求体、取消信号或主副路由，不查询 VPN、不以 navigator.onLine 阻止请求。不新增测试连接或付费请求重试。原生 HTTP 路由不发送浏览器专用选项。

本机连接失败显示当前网站本地网络授权、Termux CORS 及不同站点授权独立的提示，不再重复泛化成“换网络”；失败本身不能证明具体是哪一项限制。

## 限制与依据

此修复解决已确认的前端请求接管问题，不等于已在用户手机上证明唯一根因。网站授权按来源区分，糯叽机成功不证明 GitHub 站点也获许可；本地服务也可能只允许某些 Origin。不能伪造浏览器 Origin、使用 no-cors 读取 JSON，或让用户关闭安全检查。无需重装 Edge、清空站点数据或公开密钥。

微软官方说明：Service Worker／Shared Worker 使用本地网络前，需要主窗口先获得本地网络权限；主窗口的本地请求能触发许可。回环地址标注仍受许可与 CORS 约束。

- https://learn.microsoft.com/zh-cn/deployedge/ms-edge-local-network-access
- https://developer.chrome.com/blog/local-network-access
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
- 对照：https://nuojiji.app/sw.js 、https://nuojiji.app/sw-handlers.js

## 验证

- `sw.test.js`：本地／远程／同源 API 与认证请求不被接管，过期模型缓存被忽略，静态与导航离线逻辑、缓存异常、只清理自己旧缓存。
- `api-local-network.test.js`：仅回环地址加标注；外部 API、原生请求、认证、请求体及取消保持原样，无 online／VPN 门槛，无自动重试，错误提示准确。
- `api-local-network.browser.test.js`：真实启用 Service Worker 的移动页面、隔离 IndexedDB 和本地 CORS 测试服务；主／副／生图设置均拉取 66 个模型，响应不来自 worker，故意种入错误 API 缓存仍获取真实列表；静态资源仍来自 worker；重开保留聊天、钱包和预设，不自动拉取。

浏览器测试只用本机随机空闲端口、假密钥和假模型列表，不接触用户手机的 2156 服务或真实凭据，不产生付费模型调用。自动化环境不等同于用户手机 Edge；实际授权弹窗和服务端 Origin 许可需要用户更新后复测。
