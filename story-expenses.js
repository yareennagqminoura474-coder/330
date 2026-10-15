(function (root) {
  "use strict";
  const blocked = /打算|计划|准备|想买|想要|要买|如果|假如|要是|将会|明天|下次|以后|会花|预计|预算|大约要|需要花|可能|没有|还没|尚未|不是|并非|不曾|没(?:付|花|买|支出)|未(?:支付|付款|消费)|不(?:买|付|花)|取消|退款|退货|转账|红包|昨天|前天|上周|上次|以前|之前|曾经|记得|花过|付过|那笔|美元|港币|欧元|日元|[？?]|是不是|有没有|[-−]\s*\d/;
  const paid = /花(?:掉)?了|花费了|支付了|支付成功|付了|付清了|付款(?:了|成功)|已(?:经)?(?:支付|付款|消费|花费|结账|买单)|支出了|消费了|扣了|扣款成功|买(?:下|好)?了|购买了|结(?:了)?账|结清了|买单了|付完(?:钱|款)|付好(?:钱|款)|刷了卡|扫码(?:支付|付款)(?:成功)?/;
  const cashPattern = /[¥￥]\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?[万]?|[零〇一二两三四五六七八九十百千万]+)\s*(?:元|块钱|块)/g;
  function cash(raw) {
    const s = raw.replace(/,/g, "");
    if (/^\d+(?:\.\d+)?万?$/.test(s)) return Number(s.replace("万", "")) * (s.endsWith("万") ? 10000 : 1);
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }, units = { 十: 10, 百: 100, 千: 1000 };
    let total = 0, section = 0, n = 0;
    for (const c of s) { if (c in digits) n = digits[c]; else if (c === "万") { total += (section + n) * 10000; section = 0; n = 0; } else { section += (n || 1) * units[c]; n = 0; } }
    return total + section + n;
  }
  function category(quote) {
    return /餐|饭|外卖|咖啡|奶茶|饮料|早餐|午餐|晚餐|面包|水果/.test(quote) ? "food" : /车费|打车|出租车|地铁|公交|交通|车票/.test(quote) ? "transport" :
      /租金|房租|水电|物业/.test(quote) ? "housing" : /电影|游戏|门票|娱乐/.test(quote) ? "entertainment" : /书|衣服|衣物|玩具|鞋|文具|书店|商场|超市|购物/.test(quote) ? "shopping" : "other";
  }
  const references = [
    ["手机壳", 25, 60], ["手机", 2000, 6500], ["电脑", 4500, 10000], ["奶茶", 16, 28], ["咖啡", 20, 40], ["矿泉水", 3, 6], ["饮料", 6, 12],
    ["早餐", 12, 30], ["午饭|午餐|晚饭|晚餐|盒饭", 25, 70], ["面包", 10, 25], ["蛋糕", 28, 65], ["水果", 25, 60], ["书|书籍", 40, 80],
    ["电影票", 40, 80], ["打车|出租车|车费", 25, 60], ["地铁", 4, 6], ["公交", 2, 2], ["衣服|衣物", 150, 600], ["鞋", 200, 800], ["文具|笔", 10, 30],
    ["鲜花|花束", 80, 300], ["香水", 200, 1000], ["戒指", 500, 5000], ["项链", 500, 5000], ["手表", 400, 5000], ["眼镜", 300, 1200], ["耳机", 200, 1200], ["汽车|轿车", 150000, 500000]
  ];
  function inferPrice(quote, options) {
    if (/免费|白拿|赠品|无需付款|不用付款|不用付钱/.test(quote)) return null;
    const source = /买(?:下|好)?了|购买了/.exec(quote), goodsText = source ? quote.slice(source.index + source[0].length).split(/[，,]/)[0] : quote.replace(/(?:用|拿出|掏出|拿起|打开)(?:了)?(?:自己的)?手机|手机(?:扫码)?支付/g, "");
    const rich = /富裕|优渥|富有|豪门|高收入|不差钱|财务自由/.test(options.persona || "") && !/不富裕|并不富裕|不是豪门|普通家庭|经济拮据/.test(options.persona || "");
    const matches = [], occupied = [];
    for (const [names, basic, high] of references) {
      const match = new RegExp(names, "g").exec(goodsText); if (!match || occupied.some(([a, b]) => match.index >= a && match.index < b)) continue;
      if (!source && match[0] === "书" && /^书店|^书馆/.test(goodsText.slice(match.index))) continue;
      occupied.push([match.index, match.index + match[0].length]);
      const count = goodsText.slice(Math.max(0, match.index - 10), match.index).match(/([\d]+|[一二两三四五六七八九十百]+)\s*[杯份本双件台部瓶张盒碗袋支包]\s*$/);
      const quantity = count ? cash(count[1]) : 1; if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return null;
      const item = { name: match[0], quantity, unitPrice: rich ? high : basic, method: "reference_price" };
      // A known current catalog is preferable to a broad retail reference.
      const catalog = (options.catalog || []).filter((p) => p.name && (p.name === item.name || p.name.includes(item.name)) && Number(p.price) > 0);
      if (catalog.length === 1) { item.unitPrice = Number(catalog[0].price); item.method = "catalog_price"; }
      // Only same-item, single-price context is used. Budget/questions/old
      // payments are NOT prices, and multi-price/bundle ambiguity is rejected.
      for (const m of (options.history || []).slice(-20).reverse()) {
        if (m.walletEntry || m.marketOrder || m.isHidden || typeof m.content !== "string") continue;
        const line = m.content.split(/[。；;\n]/).find((s) => s.includes(item.name) && /每|一[杯份本双件台部瓶张盒碗袋支包]|单价|售价|标价|价格/.test(s) && !/预算|假如|如果|昨天|上次|以前|[？?]/.test(s));
        if (!line) continue;
        const prices = [...line.matchAll(cashPattern)]; if (prices.length !== 1) continue;
        const value = cash(prices[0][1] || prices[0][2]); if (value <= 0) continue;
        item.unitPrice = value; item.method = "context_price"; break;
      }
      matches.push(item);
    }
    if (!matches.length) {
      if (options.fallbackGoods) return inferPrice("买了" + options.fallbackGoods, { ...options, fallbackGoods: "" });
      return null;
    }
    const amount = Math.round(matches.reduce((total, p) => total + p.unitPrice * p.quantity, 0) * 100) / 100;
    return { amount, estimated: true, estimate: { method: matches.every((p) => p.method === "context_price") ? "context_price" : "mixed_reference", items: matches,
      reason: matches.map((p) => `${p.name}×${p.quantity}，单价¥${p.unitPrice}（${p.method === "context_price" ? "前文单价" : p.method === "catalog_price" ? "商品目录参考" : "日常零售参考"}）`).join("；") + "；未明确的数量按1，非实际付款凭证，可在角色钱包校正。" } };
  }
  function extract(message, people, resolve, options = {}) {
    if (!message || message.isHidden || message.walletEntry || message.marketOrder || message.moneyReceipt || message.isReplyHeader ||
      message.type && !["text", "narration"].includes(message.type) || typeof message.content !== "string" || /data:|https?:\/\//i.test(message.content)) return [];
    const sender = resolve(people, message.senderName), claims = [];
    for (const quote of message.content.slice(0, 6000).split(/[。；;\n]|(?<=[！？!?])/).map((s) => s.trim()).filter(Boolean)) {
      if (quote.length > 800 || blocked.test(quote)) continue;
      const verb = paid.exec(quote), matches = [...quote.matchAll(cashPattern)]; if (!verb || matches.length > 1) continue;
      const prefix = quote.slice(0, verb.index), named = people.filter((p) => [p.name, ...(p.aliases || [])].some((name) => name && prefix.includes(name)));
      if (/说|听说|告诉|提到|问/.test(prefix)) continue;
      let person;
      if (named.length === 1 && !/说|听说|告诉|提到|问/.test(prefix)) person = named[0];
      else if (!named.length && sender && message.type !== "narration" && (/(?:^|[，,\s])我/.test(prefix) || !prefix.trim())) person = sender;
      if (!person) continue; // Never charge a bystander based on an ambiguous pronoun or reported speech.
      const samePerson = (m) => resolve(people, m.senderName)?.key === person.key || m.type === "narration" && [person.name, ...(person.aliases || [])].some((name) => m.content?.includes(name)) && !people.some((p) => p.key !== person.key && m.content?.includes(p.name));
      const earlier = message.content.slice(0, message.content.indexOf(quote));
      const contextLine = [earlier, ...(options.history || []).filter((m) => m.timestamp < message.timestamp && samePerson(m)).slice(-3).reverse().map((m) => m.content || "")]
        .find((s) => /拿了|拿起|选了|选好|点了|点好|要了|单价|售价|标价|价格/.test(s) && !paid.test(s));
      const inference = !matches.length && options.infer ? inferPrice(quote, { ...options, persona: options.personas?.[person.key] || options.persona || "", fallbackGoods: contextLine || "" }) : null;
      const amount = matches.length ? cash(matches[0][1] || matches[0][2]) : inference?.amount;
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
        if (!matches.length && options.allowUnpriced) claims.push({ key: person.key, name: person.name, amount: null, needsEstimate: true, quote, category: category(quote), sourceTimestamp: message.timestamp });
        continue;
      }
      claims.push({ key: person.key, name: person.name, amount: Math.round(amount * 100) / 100, quote, category: category(quote + (inference ? inference.estimate.items.map((p) => p.name).join(" ") : "")), ...(inference || {}),
        repeat: /又|再次|再买|再付|第二|另一次|另外|额外/.test(quote), sourceTimestamp: message.timestamp });
    }
    return claims;
  }
  function fingerprint(claim) {
    return claim.quote.replaceAll(claim.name, "我").replace(/[\s，,：:。]/g, "").replace(/已经|刚才|刚刚|刚/g, "");
  }
  const couldContainPayment = (m) => m && !m.walletEntry && !m.marketOrder && !m.moneyReceipt && !m.isHidden && (!m.type || ["text", "narration"].includes(m.type)) && typeof m.content === "string" && paid.test(m.content);
  const api = { extract, fingerprint, category, cash, inferPrice, couldContainPayment };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneStoryExpenses = api;
})(typeof window !== "undefined" ? window : globalThis);
