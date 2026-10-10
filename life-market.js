(function () {
  "use strict";
  const core = window.ephoneLifeMarketCore;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (value) => Number(value || 0).toFixed(2);
  let screen, state = core.blank(), orders = [], balance = 0, chats = [], store, spaceId, spaceName;
  let tab = "goods", category = "全部", search = "", busy = false, controller, message = "", confirmation = false, recipient = "", openToken = 0;
  function create() {
    if (screen) return;
    screen = document.createElement("section"); screen.id = "life-market-screen"; screen.className = "screen";
    screen.innerHTML = '<header class="header"><button type="button" class="market-back" aria-label="返回">‹</button><span>逛逛</span><button type="button" id="market-refresh">刷新</button></header><div class="market-account"></div><div class="market-message" role="status" aria-live="polite"></div><div class="market-content"></div><nav class="market-nav" aria-label="逛逛导航"></nav>';
    document.getElementById("phone-screen").append(screen);
    screen.querySelector(".market-back").onclick = () => window.showScreen("home-screen");
    screen.querySelector("#market-refresh").onclick = refresh;
    screen.addEventListener("click", async (event) => {
      const button = event.target.closest("button"); if (!button) return;
      if (button.dataset.tab) { tab = button.dataset.tab; category = "全部"; confirmation = false; render(); }
      if (button.dataset.category) { category = button.dataset.category; render(); }
      if (button.dataset.delta && !busy) {
        busy = true; renderBusy();
        try { state = await store.changeCart(button.dataset.item, Number(button.dataset.delta)); message = "购物车已保存"; }
        catch (error) { message = error.message; }
        finally { busy = false; confirmation = false; render(); }
      }
      if (button.dataset.action === "checkout" && !busy) { confirmation = true; render(); }
      if (button.dataset.action === "cancel") { confirmation = false; render(); }
      if (button.dataset.action === "pay") await pay();
    });
    screen.addEventListener("change", (event) => {
      if (event.target.id === "market-recipient") { recipient = event.target.value; confirmation = false; render(); }
    });
    screen.addEventListener("input", (event) => {
      if (event.target.id !== "market-search") return;
      search = event.target.value; renderProducts();
    });
  }
  function renderBusy() {
    const button = screen.querySelector("#market-refresh");
    button.textContent = controller ? "停止刷新" : "刷新";
    button.disabled = busy && !controller;
    screen.querySelectorAll("[data-delta], [data-action=pay], [data-action=checkout], #market-recipient").forEach((el) => { el.disabled = busy; });
    screen.querySelector(".market-message").textContent = message;
  }
  function recipientOptions() {
    const options = [{ label: "给自己下单", value: "" }];
    for (const chat of chats) {
      const names = chat.isGroup || chat.isSpectatorGroup ? (chat.members || []).map((member) => member.originalName) : [chat.originalName || chat.name];
      for (const name of [...new Set(names)].filter(Boolean)) options.push({ label: `${name} · ${chat.name}`, value: JSON.stringify({ chatId: chat.id, recipientName: name }) });
    }
    return options.map((option) => `<option value="${esc(option.value)}" ${option.value === recipient ? "selected" : ""}>${esc(option.label)}</option>`).join("");
  }
  function renderProducts() {
    const grid = screen.querySelector(".market-products"); if (!grid) return;
    const items = state.items.filter((item) => item.kind === tab && (category === "全部" || category === item.category) && `${item.name} ${item.description} ${item.reason} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
    grid.innerHTML = items.map((item) => `<article class="market-card"><div class="market-art">${esc(item.emoji)}</div><div class="market-card-body"><small>${esc(item.category)} · ${esc(item.merchant)}</small><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p class="market-reason">${esc(item.reason)}</p>${item.kind === "food" ? `<small>约${item.deliveryMinutes}分钟 · 配送¥${money(item.deliveryFee)}</small>` : ""}<div class="market-price"><strong>¥${money(item.price)}</strong><button type="button" data-item="${esc(item.id)}" data-delta="1" aria-label="加入购物车：${esc(item.name)}" ${busy ? "disabled" : ""}>＋</button></div></div></article>`).join("") || '<div class="market-empty">没有匹配的内容，试试其他分类。</div>';
  }
  function render() {
    create();
    screen.querySelector(".market-account").textContent = `${spaceName || "默认空间"} · 钱包 ¥${money(balance)}`;
    screen.querySelector(".market-nav").innerHTML = [["goods", "🛍", "购物"], ["food", "🍱", "外卖"], ["cart", "🛒", `购物车${state.cart.length ? " · " + state.cart.reduce((n, line) => n + line.quantity, 0) : ""}`], ["orders", "🧾", "订单"]].map(([id, icon, label]) => `<button type="button" data-tab="${id}" class="${tab === id ? "selected" : ""}" aria-current="${tab === id ? "page" : "false"}"><span>${icon}</span>${label}</button>`).join("");
    const content = screen.querySelector(".market-content");
    if (tab === "goods" || tab === "food") {
      content.innerHTML = `<div class="market-hero"><small>只在你点刷新时更新</small><h2>${esc(state.headline || "今天，想买点什么？")}</h2><p>${esc(state.note || "只参考本空间人物的性格与喜好，挑选日常好物和餐饮。")}</p><small>${state.refreshedAt ? "上次刷新：" + esc(new Date(state.refreshedAt).toLocaleString("zh-CN")) : "尚未刷新"}</small></div>` + (state.items.length ? `<input id="market-search" aria-label="搜索商品或餐饮" placeholder="搜索商品、餐饮或推荐理由" value="${esc(search)}"><div class="market-categories">${["全部", ...new Set(state.items.filter((item) => item.kind === tab).map((item) => item.category))].map((name) => `<button type="button" data-category="${esc(name)}" class="${category === name ? "selected" : ""}">${esc(name)}</button>`).join("")}</div><div class="market-products ${tab}"></div>` : '<div class="market-empty">点右上角“刷新”，生成第一批商品和外卖。<br>未点击刷新，不会调用API，也不会自动换列表。</div>');
      renderProducts();
    } else if (tab === "cart") {
      const totals = core.quote(state.cart);
      content.innerHTML = '<h2 class="market-section-title">购物车</h2>' + (state.cart.length ? state.cart.map((line) => `<article class="market-cart-line"><span class="market-cart-emoji">${esc(line.item.emoji)}</span><div><h3>${esc(line.item.name)}</h3><small>${esc(line.item.merchant)} · ¥${money(line.item.price)}</small><div class="market-quantity"><button type="button" data-item="${esc(line.item.id)}" data-delta="-1" aria-label="减少：${esc(line.item.name)}">−</button><span>${line.quantity}</span><button type="button" data-item="${esc(line.item.id)}" data-delta="1" aria-label="增加：${esc(line.item.name)}">＋</button></div></div></article>`).join("") + `<div class="market-checkout"><label for="market-recipient">收货角色</label><select id="market-recipient">${recipientOptions()}</select><p>商品 ¥${money(totals.subtotal)} · 配送 ¥${money(totals.delivery)}</p><strong>合计 ¥${money(totals.total)}</strong><p class="market-disclaimer">仅小手机内的虚拟购买，不产生现实订单。为角色下单会在对应聊天留下可被角色感知的订单记录。</p>${confirmation ? '<p>确认从当前空间钱包付款？</p><div class="market-confirm"><button type="button" data-action="cancel">取消</button><button type="button" data-action="pay" class="market-primary">确认付款</button></div>' : '<button type="button" data-action="checkout" class="market-primary">去下单</button>'}</div>` : '<div class="market-empty">购物车还是空的。刷新不会清空已加入的商品。</div>');
    } else {
      content.innerHTML = '<h2 class="market-section-title">我的订单</h2>' + (orders.length ? orders.map((order) => `<article class="market-order"><div><strong>${esc(order.recipientName)}</strong><span>已支付 · 虚拟订单</span></div><small>${esc(window.EPhoneMarketAdapter?.formatTime(order.vts) || new Date(order.timestamp).toLocaleString("zh-CN"))}</small>${order.items.map((line) => `<p>${esc(line.item.emoji)} ${esc(line.item.name)} × ${line.quantity}</p>`).join("")}<strong>¥${money(order.total)}</strong><small> 含配送 ¥${money(order.delivery)}</small></article>`).join("") : '<div class="market-empty">还没有订单。手动刷新不会删除已付订单。</div>');
    }
    renderBusy();
  }
  async function open() {
    create(); window.showScreen?.("life-market-screen");
    if (busy) { render(); return; }
    const token = ++openToken;
    try {
      if (!window.EPhoneMarketAdapter || !window.db?.marketState) throw new Error("应用还在启动，请稍后重新打开。");
      const nextSpace = window.EPHONE_SPACE_ID || "default";
      const nextStore = new core.Store(window.db);
      const [loaded, wallet, records, characters] = await Promise.all([nextStore.load(), nextStore.wallet.get("main"), nextStore.orders.orderBy("timestamp").reverse().limit(100).toArray(), nextStore.chats.toArray()]);
      if (token !== openToken || nextSpace !== (window.EPHONE_SPACE_ID || "default")) return;
      if (spaceId !== nextSpace) { tab = "goods"; category = "全部"; search = ""; recipient = ""; }
      store = nextStore; spaceId = nextSpace; spaceName = window.EPHONE_SPACE_NAME; state = loaded;
      balance = Number(wallet?.balance || 0); orders = records; chats = characters; confirmation = false; message = "";
    } catch (error) { message = error.message; }
    render();
  }
  async function refresh() {
    if (controller) { controller.abort(); return; }
    if (busy || !store) return;
    busy = true; controller = new AbortController(); confirmation = false;
    message = "正在生成整批购物和外卖…旧列表会保留到刷新成功。"; renderBusy();
    try {
      const adapter = window.EPhoneMarketAdapter, snapshot = await adapter.snapshot(store, spaceId);
      balance = snapshot.walletBalance;
      state = await store.refresh({ ...snapshot, generate: adapter.generate, formatTime: adapter.formatTime, signal: controller.signal, batchId: crypto.randomUUID() });
      category = "全部"; search = ""; message = "购物和外卖已全部更新，购物车和订单已保留。";
    } catch (error) { message = error.name === "AbortError" ? "已停止刷新，保留上一次的内容。" : `刷新失败，旧内容已保留：${error.message}`; }
    finally { controller = null; busy = false; render(); }
  }
  async function pay() {
    if (busy || !confirmation || !store) return;
    busy = true; message = "正在付款…"; renderBusy();
    try {
      const adapter = window.EPhoneMarketAdapter;
      const target = recipient ? JSON.parse(recipient) : null;
      const result = await store.checkout({ orderId: crypto.randomUUID(), expectedCart: state.cart, target, vts: adapter.now(target?.chatId), spaceId });
      balance = result.balance; confirmation = false;
      state = await store.load(); orders = await store.orders.orderBy("timestamp").reverse().limit(100).toArray();
      // The transaction already committed. Display/cache synchronization must
      // never present a paid order as a failed payment or charge it again.
      try { await adapter.onPaid(result); } catch (error) { console.warn("商城显示同步失败", error); }
      message = "下单成功，已从本空间钱包付款。"; tab = "orders";
    } catch (error) { message = error.message; }
    finally { busy = false; render(); }
  }
  window.EPhoneLifeMarket = { open, isBusy: () => busy };
})();
