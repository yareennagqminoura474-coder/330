const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sent = [];
const window = { fetch: async (url, options) => {
  sent.push({ url, options });
  return { ok: true };
} };
class Image {
  naturalWidth = 3000;
  naturalHeight = 2000;
  set src(value) { this.onload(); }
}
const document = { createElement: () => ({
  getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(value) {} }),
  toDataURL: () => "data:image/jpeg;base64," + "a".repeat(30_000),
}) };
vm.runInNewContext(fs.readFileSync("api-payload-guard.js", "utf8"), {
  window, document, Image, URL, location: { href: "https://example.github.io/330/" },
});

(async () => {
  const oldImage = "data:image/png;base64," + "x".repeat(4_000_000);
  const newImage = "data:image/png;base64," + "y".repeat(3_350_000);
  const payload = { model: "test", messages: [
    { role: "system", content: "Instructions" },
    { role: "user", content: [{ type: "image_url", image_url: { url: oldImage } }] },
    { role: "assistant", content: "I saw the old photo" },
    { role: "user", content: [{ type: "text", text: "See this" }, { type: "image_url", image_url: { url: newImage } }] },
  ] };
  const body = JSON.stringify(payload);
  await window.fetch("https://gcli.ggchan.dev/v1/chat/completions", { method: "POST", body });
  const compacted = JSON.parse(sent[0].options.body);
  assert.ok(sent[0].options.body.length < 2_800_000);
  assert.equal(compacted.messages[1].content[0].type, "text");
  assert.equal(compacted.messages[3].content[1].image_url.url.length, 30_023);
  assert.equal(payload.messages[1].content[0].image_url.url, oldImage);
  assert.equal(payload.messages[3].content[1].image_url.url, newImage);
  await window.fetch("https://gcli.ggchan.dev/v1/models", { method: "GET" });
  assert.equal(sent[1].url, "https://gcli.ggchan.dev/v1/models");
  console.log("API payload guard tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
