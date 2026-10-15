const assert = require("node:assert/strict"), image = require("./chat-image-view.js");
assert.equal(image.source({ content: "描述" }, {}).url, ""); assert.match(image.render({ content: '<img onerror="bad">' }, {}), /未生成图片/); assert.doesNotMatch(image.render({ content: '<img onerror="bad">' }, {}), /<img/);
assert.equal(image.source({ imageUrl: "javascript:alert(1)" }, {}).url, "");
assert.equal(image.source({ image_prompt: "rain%20&light" }, { enableAiDrawing: true }).url, "https://image.pollinations.ai/prompt/rain%20%26light");
assert.match(image.render({ imageUrl: "https://image.invalid/a.png", content: 'a" onerror="bad' }, {}), /ai-generated-image/);
assert.doesNotMatch(image.render({ imageUrl: "https://image.invalid/a.png", content: 'a" onerror="bad' }, {}), / onerror="bad/);
console.log("PASS: description-only versus real image source, explicit drawing toggle, safe encoded prompt/HTML/URLs, no fake placeholder image");
