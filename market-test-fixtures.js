// Deterministic complete catalogs for isolated tests, never a live API.
const { departments } = require("./life-market-core");
function marketBatch(prefix) {
  const make = (kind) => Array.from({ length: departments[kind].length * 2 }, (_, i) => ({
    name: `${prefix}${kind === "goods" ? "物" : "餐"}${i}`, productIdentity: `${prefix}${kind === "goods" ? "物" : "餐"}${i}`,
    department: departments[kind][Math.floor(i / 2)], category: `类别${i % 4}`,
    selection: i < departments[kind].length ? "everyday" : i % 2 ? "discovery" : "personal",
    merchant: `店${i % 3}`, description: "日常所需", reason: "多样化的实用选择", price: 10.15 + i,
    deliveryFee: 2.35, deliveryMinutes: 30, emoji: kind === "food" ? "🍱" : "🛍",
  }));
  return { headline: `${prefix} · 新生活`, goods: make("goods"), food: make("food") };
}
module.exports = { marketBatch };
