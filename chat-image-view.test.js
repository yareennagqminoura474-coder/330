const assert = require("node:assert/strict"), image = require("./chat-image-view.js");
assert.equal(image.source({ content: "描述" }, {}).url, ""); assert.match(image.render({ content: '<img onerror="bad">' }, {}), /未生成图片/); assert.doesNotMatch(image.render({ content: '<img onerror="bad">' }, {}), /<img/);
assert.equal(image.source({ imageUrl: "javascript:alert(1)" }, {}).url, "");
assert.equal(image.source({ image_prompt: "rain%20&light" }, { enableAiDrawing: true }).url, "https://image.pollinations.ai/prompt/rain%20%26light");
assert.match(image.render({ imageUrl: "https://image.invalid/a.png", content: 'a" onerror="bad' }, {}), /ai-generated-image/);
assert.doesNotMatch(image.render({ imageUrl: "https://image.invalid/a.png", content: 'a" onerror="bad' }, {}), / onerror="bad/);
const enabled = { enableAiDrawing: true }, description = '蓝白机甲，透明盒子，40%光照，标签%20，<img onerror="bad">';
for (const prompt of [undefined, null, "", "   ", 12, {}]) {
  const action = { description, image_prompt: prompt }, saved = image.messageFields(action);
  assert.equal(saved.content, description); assert.equal(saved.image_prompt, description); assert.equal(saved.imagePromptSource, "description");
  assert.equal(image.source(action, enabled).url, "https://image.pollinations.ai/prompt/" + encodeURIComponent(description));
  assert.equal(image.source(saved, enabled).url, image.source(action, enabled).url);
  assert.equal(image.source(saved, {}).url, "", "fallback must not bypass disabled drawing");
  assert.equal(action.image_prompt, prompt, "no mutation of model output or old history");
}
assert.equal(image.source({ content: description }, enabled).url, "https://image.pollinations.ai/prompt/" + encodeURIComponent(description), "legacy saved description fallback");
assert.equal(image.messageFields({ description: " ", content: "柜台上的奶茶" }).content, "柜台上的奶茶");
assert.equal(image.source({ content: " ", image_prompt: " " }, enabled).url, "");
assert.match(image.source({}, enabled).reason, /没有有效/);
assert.equal(image.source(image.messageFields({ description, image_prompt: "robot%20&light" }), enabled).url, "https://image.pollinations.ai/prompt/robot%20%26light", "valid explicit prompt has priority");
assert.match(image.render({ content: description }, enabled), /已按图片描述补全提示词/);
assert.doesNotMatch(image.render({ content: description }, enabled), / onerror="bad/);
assert.equal(image.getPromptRule({}), ""); assert.match(image.getPromptRule(enabled), /image_prompt/); assert.match(image.getPromptRule(enabled), /description/);
assert.match(image.source({ imageUrl: "https://image.invalid/old.png", content: description }, enabled).url, /old\.png$/);
console.log("PASS: missing/blank/malformed prompt uses only image description, old history and persisted fallback, explicit prompt priority, disabled and empty guards, plain-percent preservation, safe HTML/URLs, complete-field prompt and no fake placeholder image");
