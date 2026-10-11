(function (root) {
  "use strict";
  const blocked = /打算|计划|准备|想买|想要|要买|如果|假如|要是|将会|明天|下次|以后|会花|预计|预算|大约要|需要花|可能|没有|还没|尚未|不是|并非|不曾|没(?:付|花|买|支出)|未(?:支付|付款|消费)|不(?:买|付|花)|取消|退款|退货|转账|红包|昨天|前天|上周|上次|以前|之前|曾经|记得|花过|付过|那笔|美元|港币|欧元|日元|[？?]|是不是|有没有|[-−]\s*\d/;
  const paid = /花(?:掉)?了|花费了|支付了|付了|付款(?:了|成功)|已(?:经)?(?:支付|付款|消费|花费)|支出了|消费了|扣了|扣款成功|买了/;
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
  function extract(message, people, resolve) {
    if (!message || message.isHidden || message.walletEntry || message.marketOrder || message.moneyReceipt || message.isReplyHeader ||
      message.type && !["text", "narration"].includes(message.type) || typeof message.content !== "string" || /data:|https?:\/\//i.test(message.content)) return [];
    const sender = resolve(people, message.senderName), claims = [];
    for (const quote of message.content.slice(0, 6000).split(/[。；;\n]|(?<=[！？!?])/).map((s) => s.trim()).filter(Boolean)) {
      if (quote.length > 800 || blocked.test(quote)) continue;
      const verb = paid.exec(quote), matches = [...quote.matchAll(cashPattern)]; if (!verb || matches.length !== 1) continue;
      const amount = cash(matches[0][1] || matches[0][2]); if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 100))) continue;
      const prefix = quote.slice(0, verb.index), named = people.filter((p) => [p.name, ...(p.aliases || [])].some((name) => name && prefix.includes(name)));
      if (/说|听说|告诉|提到|问/.test(prefix)) continue;
      let person;
      if (named.length === 1 && !/说|听说|告诉|提到|问/.test(prefix)) person = named[0];
      else if (!named.length && sender && message.type !== "narration" && (/(?:^|[，,\s])我/.test(prefix) || !prefix.trim())) person = sender;
      if (!person) continue; // Never charge a bystander based on an ambiguous pronoun or reported speech.
      claims.push({ key: person.key, name: person.name, amount: Math.round(amount * 100) / 100, quote, category: category(quote),
        repeat: /又|再次|再买|再付|第二|另一次|另外|额外/.test(quote), sourceTimestamp: message.timestamp });
    }
    return claims;
  }
  function fingerprint(claim) {
    return claim.quote.replaceAll(claim.name, "我").replace(/[\s，,：:。]/g, "").replace(/已经|刚才|刚刚|刚/g, "");
  }
  const api = { extract, fingerprint, category, cash };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ephoneStoryExpenses = api;
})(typeof window !== "undefined" ? window : globalThis);
