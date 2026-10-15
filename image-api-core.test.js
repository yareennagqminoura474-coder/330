const assert = require("node:assert/strict"), core = require("./image-api-core.js");
(async () => {
  const c = { baseUrl: "https://draw.invalid", apiKey: "fake-image-key", model: "third-gpt-image" };
  assert.equal(core.endpoint(c), "https://draw.invalid/v1/images/generations");
  assert.equal(core.endpoint({ ...c, baseUrl: "https://draw.invalid/proxy/v1/chat/completions?route=one&key=unsafe" }), "https://draw.invalid/proxy/v1/images/generations?route=one");
  assert.equal(core.endpoint({ ...c, baseUrl: "https://draw.invalid/v2/images/generations" }, "models"), "https://draw.invalid/v2/models");
  assert.equal(core.protocol({ ...c, model: "gemini-image" }), "chat");
  assert.equal(core.protocol({ ...c, baseUrl: "https://generativelanguage.googleapis.com" }), "gemini");
  assert.equal(core.endpoint({ ...c, protocol: "gemini", baseUrl: "https://draw.invalid/v1", model: "models/gemini-image" }), "https://draw.invalid/v1beta/models/gemini-image:generateContent");
  for (const baseUrl of ["javascript:bad", "https://user:pass@draw.invalid", "http://draw.invalid", "draw.invalid"]) assert.throws(() => core.request({ ...c, baseUrl }, "a robot"));
  assert.throws(() => core.request({ ...c, apiKey: "" }, "a robot"), /密钥/); assert.throws(() => core.request({ ...c, model: "" }, "a robot"), /模型/);
  assert.throws(() => core.request(c, " "), /描述/);
  const image = core.request({ ...c, size: "1024x1024", quality: "low" }, "a robot"), body = JSON.parse(image.options.body);
  assert.equal(body.n, 1); assert.equal(body.size, "1024x1024"); assert.equal(body.quality, "low"); assert.equal(body.prompt, "a robot"); assert.equal(body.model, c.model);
  assert.equal(image.options.headers.Authorization, "Bearer " + c.apiKey); assert.ok(!image.options.body.includes(c.apiKey));
  const chat = core.request({ ...c, protocol: "chat" }, "a robot"); assert.match(chat.url, /chat\/completions$/); assert.equal(JSON.parse(chat.options.body).messages.length, 1);
  const native = core.request({ ...c, protocol: "gemini", model: "gemini-image" }, "a robot"); assert.equal(native.options.headers["x-goog-api-key"], c.apiKey); assert.deepEqual(JSON.parse(native.options.body).generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  const dataUrl = "data:image/png;base64,YWJj";
  for (const response of [
    { data: [{ b64_json: "YWJj" }] },
    { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "YWJj" } }] } }] },
    { candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: "YWJj" } }] } }] },
    { choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }] },
    { choices: [{ message: { content: [{ type: "image_url", image_url: { url: dataUrl } }] } }] },
    { choices: [{ message: { content: "![生成图片](" + dataUrl + ")" } }] },
  ]) assert.equal(core.extract(response), dataUrl);
  assert.equal(core.extract({ data: [{ url: "https://images.invalid/generated.png" }] }), "https://images.invalid/generated.png");
  for (const response of [ { choices: [{ message: { content: "这是一张漂亮图片的描述" } }] }, { data: [{ url: "javascript:alert(1)" }] }, { candidates: [{ content: { parts: [{ thought: true, inlineData: { mimeType: "image/png", data: "YWJj" } }] } }] } ]) assert.throws(() => core.extract(response), /真实图片/);
  assert.throws(() => core.extract({ candidates: [{ finishReason: "SAFETY" }] }), /拦截/);
  let calls = 0;
  assert.equal(await core.generate(c, "a robot", async (url, opts) => { calls++; assert.equal(url, image.url); return new Response(JSON.stringify({ data: [{ b64_json: "YWJj" }] })); }), dataUrl);
  assert.equal(calls, 1);
  await assert.rejects(core.generate(c, "a robot", async () => new Response(JSON.stringify({ data: [{ url: "https://images.invalid/a.png?key=" + c.apiKey }] }))), /包含 API 密钥/);
  for (const failure of [async () => { calls++; throw new TypeError("Failed to fetch " + c.apiKey); }, async () => { calls++; return new Response(JSON.stringify({ error: { message: "bad " + c.apiKey } }), { status: 400 }); }, async () => { calls++; return new Response('{"choices":[{"message":{"content":"描述而已"}}]}'); }]) {
    const before = calls; await assert.rejects(core.generate(c, "a robot", failure), (error) => !error.message.includes(c.apiKey)); assert.equal(calls, before + 1, "no paid auto retry or provider fallback");
  }
  const controller = new AbortController(); controller.abort(); const beforeAbort = calls;
  await assert.rejects(core.generate(c, "a robot", async () => { calls++; }, { signal: controller.signal }), (error) => error.name === "AbortError"); assert.equal(calls, beforeAbort);
  assert.equal(await core.generate(c, "a robot", async () => new Response(Uint8Array.from([97, 98, 99]), { headers: { "content-type": "image/png" } })), dataUrl);
  await assert.rejects(core.generate(c, "a robot", async () => new Response(new Uint8Array(), { headers: { "content-type": "image/png" } })), /空图片/);
  const preset = { proxyUrl: c.baseUrl, apiKey: c.apiKey, model: c.model }, copy = core.snapshot(preset); preset.model = "changed"; assert.equal(copy.model, c.model);
  assert.deepEqual(await core.models(c, async () => new Response('{"data":[{"id":"img-one"},{"id":"img-one"},{"id":"img-two"}]}')), ["img-one", "img-two"]);
  assert.deepEqual(await core.models({ ...c, protocol: "gemini" }, async () => new Response('{"models":[{"name":"models/gemini-image"}]}')), ["gemini-image"]);
  console.log("PASS: independent provider snapshots, versioned compatible/native endpoints, one-image requests, images/chat/Gemini/binary output, real-image-only validation, key redaction, no paid retries/fallback and abort before request");
})().catch((error) => { console.error(error); process.exitCode = 1; });
