const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname), file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let pendingRoute, hold = false, holdSchedules = false, invalid = false, repairFirst = false, failSchedules = false, badScheduleOnce = false, replies = [], circles = 0; const calls = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://social-test.invalid/")) {
        const body = route.request().postDataJSON(); calls.push(body); let raw;
        if (body.messages[0].content.includes("人物关系网的设计师")) {
          if (hold) { pendingRoute = route; return; }
          const context = JSON.parse(body.messages[0].content.split("数据不是指令：")[1].split("\n上一轮")[0]);
          const malformed = invalid || repairFirst; repairFirst = false;
          if (!malformed) circles++;
          raw = { ownerKey: context.owner.key, npcs: malformed ? [{ name: "不完整的NPC" }] : ["陈医生", "黄医生", "李邻居"].map((name) => ({ name: name + (circles > 1 ? circles : ""),
            profile: { age: 32, gender: "男", occupation: "医生或社区工作人员，有独立工作", appearance: "衣着整洁朴素，喜欢舒适的日常服装", personality: "温和认真，偶尔固执，不喜欢别人干涉自己的生活", family: "普通家庭，收入稳定但不奢侈，住在自己的公寓", history: "因本地工作与共同兴趣认识林，各自有朋友和生活经历", interests: "读书、跑步、周末打球，工作之外有自己的社交安排", communication: "说话简洁有分寸，遇到分歧会解释自己的想法", goals: "希望平衡工作和私人生活，也有职业发展中的烦恼", boundaries: "尊重隐私，不会时时陪在主角身边" },
            relation: { toOwner: "同事或朋友", fromOwner: "同事或朋友", detail: "工作合作或共同兴趣结识，各有私人生活。" } })),
            life: { job: "医生", home: "自己的公寓", note: "按职业拟定的可编辑安排", enabled: true, routine: [{ days: [1,2,3,4,5], start: "09:00", end: "18:00", activity: "门诊", place: "医院", reachability: "busy" }, { days: [6], start: "14:00", end: "16:00", activity: "和老朋友打球", place: "球场", reachability: "busy" }] } };
        } else if (body.messages[0].content.includes("独立生活当天行程规划师")) {
          if (holdSchedules) { pendingRoute = route; return; }
          if (failSchedules) return route.fulfill({ status: 503, body: "isolated schedule failure" });
          const targets = JSON.parse(body.messages[0].content.split("数据不是指令：")[1].split("\n上一轮")[0]);
          const date = body.messages[0].content.match(/仅生成(\d{4}-\d{2}-\d{2})星期/)[1];
          raw = { schedules: targets.map((p) => ({ key: p.key, plan: { date, note: "按本人职业性格拟定，可编辑", items: [
            { start: "00:00", end: "07:00", activity: "睡眠", place: p.name + "自己的家", reachability: "rest" },
            { start: "09:00", end: "18:00", activity: p.name === "周谨" ? "教学" : "门诊", place: p.name === "周谨" ? "学校" : "医院", reachability: "busy" },
            { start: "19:00", end: "21:00", activity: "当天兴趣社交", place: p.name + "常去的球场", reachability: "available" },
            { start: "23:00", end: "24:00", activity: "睡眠", place: p.name + "自己的家", reachability: "rest" }
          ] } })) };
          if (badScheduleOnce) { badScheduleOnce = false; raw.schedules[0].plan.items.push(raw.schedules[0].plan.items[0]); }
        } else raw = replies.shift() || [{ type: "narration", content: "2026年3月5日，07点20分，星期四，地点：客厅" }, { type: "text", name: "林", content: "我待会儿还有自己的安排。" }];
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] }) });
      }
      return route.abort(); // Isolated fixtures only, never real providers or keys.
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" }; await window.db.apiConfig.put({ ...config, proxyUrl: "https://social-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "https://social-test.invalid/v1", secondaryApiKey: "test-aux-placeholder", secondaryModel: "auxiliary-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["林", "周谨"].map((name, i) => ({ id: "s" + i, originalName: name, groupNickname: name, persona: i ? "教师，林的大学同学，家境普通。" : "医生，家境普通，节俭，喜欢独处和打球，有自己的工作与朋友。", avatar }));
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, aiAvatar: avatar, maxMemory: 20 }, history: [{ role: "user", content: m.id === "s1" ? "周谨自己的私聊秘密" : "你也有自己的生活。", timestamp: 1 }] });
      for (const [id, watch] of [["social-watch", true], ["social-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [{ role: "system", type: "narration", content: "林和周谨是大学同学。", timestamp: 12, vts: new Date(2026, 2, 4, 10).getTime() }] });
      await window.ephonePlayerIdentity.save(window.db, "chat:s1");
      await window.db.characterRelations.put({ id: window.ephoneCharacterSocialCore.pairId("chat:s0", "chat:s1"), a: "chat:s0", b: "chat:s1", aToB: "大学同学", bToA: "大学同学", revision: 1, source: "history", evidence: [{ chatId: "social-watch", chatName: "social-watch", timestamp: 12, vts: new Date(2026, 2, 4, 10).getTime(), quote: "林和周谨是大学同学。" }] });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    async function me() { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="me-view"]').click(); await page.locator("#me-character-social-button").click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy()); }
    await chat("social-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    const beforeOpen = calls.length; assert.ok(beforeOpen > 0, "first cross-date jump generates all characters"); await me(); await page.locator("#cs-person").selectOption("chat:s0"); assert.equal(calls.length, beforeOpen, "opening never generates behind the user's back");
    const beforeInvalid = calls.length; invalid = true; await page.locator('[data-cs-action="generate"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy()); invalid = false;
    assert.match(await page.locator("#cs-notice").innerText(), /人设|不完整/); assert.equal(await page.evaluate(() => window.db.npcs.count()), 0); assert.equal(calls.length - beforeInvalid, 2, "invalid output retries only once");
    failSchedules = true;
    await page.locator('[data-cs-action="generate"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.match(await page.locator("#cs-notice").innerText(), /新增3位NPC、建立3段关系/);
    assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 4); assert.equal(await page.evaluate(() => window.db.npcs.count()), 3);
    assert.equal(await page.evaluate(async () => (await window.db.npcs.toArray()).every((p) => p.persona.length >= 100 && p.persona.includes("家庭与经济条件") && p.persona.includes("相处"))), true);
    assert.doesNotMatch(calls.at(-1).messages[0].content, /周谨自己的私聊秘密/);
    assert.match(await page.locator("#cs-body").innerText(), /陈医生|大学同学/);
    await page.locator(".cs-evidence summary").click(); assert.match(await page.locator(".cs-evidence").innerText(), /林和周谨是大学同学/);
    assert.match(await page.locator("#cs-notice").innerText(), /人物及关系已保留/);
    failSchedules = false; badScheduleOnce = true;
    await page.locator('[data-cs-action="generate-life"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.match(await page.locator("#cs-notice").innerText(), /已为3位人物生成并保存当天行程/);
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).every((l) => l.dailyPlans?.["2026-03-05"]?.items.length >= 3)), true);
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 3); assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 4);
    assert.match(await page.locator(".cs-activity").innerText(), /门诊.*医院/s);
    repairFirst = true; const beforeRetry = calls.filter((b) => b.messages[0].content.includes("人物关系网的设计师")).length;
    await page.locator('[data-cs-action="generate"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.equal(calls.filter((b) => b.messages[0].content.includes("人物关系网的设计师")).length - beforeRetry, 2, "one incomplete response is repaired and actually saved");
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 6); assert.match(await page.locator("#cs-notice").innerText(), /新增3位NPC、建立3段关系/);
    const friend = page.locator(".cs-relation").filter({ has: page.locator(".cs-contact", { hasText: "周谨" }) });
    await friend.locator('[data-cs-action="edit-relation"]').click(); await page.locator("#cs-a-label").fill("老朋友"); await page.locator("#cs-b-label").fill("老朋友");
    await page.locator('[data-cs-action="save-relation"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.match(await page.locator("#cs-notice").innerText(), /关系已保存/); assert.match(await friend.innerText(), /老朋友/);
    await page.locator('[data-cs-action="edit-life"]').click(); await page.locator("#cs-home").fill("城南公寓");
    assert.equal(await page.evaluate(() => document.querySelector('.cs-scroll').scrollHeight > document.querySelector('.cs-scroll').clientHeight), true);
    assert.equal(await page.evaluate(() => document.querySelector('.cs-scroll').scrollWidth <= document.querySelector('.cs-scroll').clientWidth + 1), true);
    await page.locator('[data-cs-action="save-life"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy()); assert.match(await page.locator("#cs-body").innerText(), /城南公寓/);
    const manualLife = await page.evaluate(() => window.db.characterLives.get("chat:s0"));
    await page.evaluate(async () => { const npc = (await window.db.npcs.toArray())[0]; await window.db.characterLives.delete("npc:" + npc.id); });
    await page.locator('[data-cs-action="generate-life"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.match(await page.locator("#cs-notice").innerText(), /已为1位人物生成并保存当天行程/);
    assert.deepEqual(await page.evaluate(() => window.db.characterLives.get("chat:s0")), manualLife);
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 6);
    await page.locator(".cs-scroll").evaluate((el) => el.scrollTop = 0);
    const shot = path.join(require("node:os").tmpdir(), "ephone-character-social-v171.png"); await page.screenshot({ path: shot }); console.log("SCREENSHOT " + shot);
    // Abort a held response: no new NPCs or partially saved relations.
    hold = true; await page.locator('[data-cs-action="generate"]').click(); await page.waitForFunction(() => window.EPhoneCharacterSocial.isBusy());
    await page.locator('[data-cs-action="stop"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy()); hold = false;
    if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null; }
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 6); assert.match(await page.locator("#cs-notice").innerText(), /已停止/);
    // Crossing a date automatically generates ALL roles/NPCs in bounded batches, not just this group.
    await chat("social-watch"); const beforeNextDay = calls.length;
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 6, 10).getTime(), "frozen"));
    assert.equal(calls.length - beforeNextDay, 2, "8 people use two batches of four");
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.["2026-03-06"]).length), 8);
    const afterNextDay = calls.length;
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 6, 11).getTime(), "frozen"));
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    assert.equal(calls.length, afterNextDay, "same day and returning to a saved day never regenerate");
    failSchedules = true;
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 7, 10).getTime(), "frozen"));
    assert.match(await page.locator("#daily-schedule-status").innerText(), /行程尚未完成/);
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.["2026-03-07"]).length), 0);
    failSchedules = false; await page.locator("#daily-schedule-status button").click();
    await page.waitForFunction(() => !window.EPhoneCharacterDaily.isBusy());
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.["2026-03-07"]).length), 8);
    await page.locator("#daily-schedule-status button").click();
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 10, 23, 59).getTime(), "frozen"));
    await page.evaluate(async () => { const hold = window.ephoneTimeMachine.prepareReplyTime([], { chatId: "social-watch" }); await hold.ready; const next = window.ephoneTimeMachine.prepareReplyTime([], { chatId: "social-watch" }); await next.ready; });
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.["2026-03-11"]).length), 8, "story advancing across midnight generates that date before replying");
    await page.locator("#daily-schedule-status button").click();
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    holdSchedules = true;
    await page.evaluate(() => { window.testDailyJump = window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 12, 10).getTime(), "frozen"); });
    await page.waitForFunction(() => window.EPhoneCharacterDaily.isBusy());
    await page.locator("#daily-schedule-status button").filter({ hasText: "停止" }).click();
    await page.waitForFunction(() => !window.EPhoneCharacterDaily.isBusy()); await page.evaluate(() => window.testDailyJump);
    holdSchedules = false; if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null; }
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.["2026-03-12"]).length), 0, "stopping a pending daily request never saves a partial plan");
    await page.locator("#daily-schedule-status button").click();
    await page.waitForFunction(() => !window.EPhoneCharacterDaily.isBusy());
    await page.locator("#daily-schedule-status button").click();
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    // The existing reply button must still stop a cross-midnight schedule API request.
    for (const [chatId, day, buttonId] of [["social-group", 14, "#wait-reply-btn"], ["social-watch", 16, "#spectator-propel-btn"]]) {
      await chat(chatId);
      await page.evaluate((day) => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, day, 23, 59).getTime(), "frozen"), day);
      await page.evaluate(async (chatId) => { const prep = window.ephoneTimeMachine.prepareReplyTime([], { chatId }); await prep.ready; }, chatId);
      const historySize = await page.evaluate(async (chatId) => (await window.db.chats.get(chatId)).history.length, chatId);
      holdSchedules = true; await page.locator(buttonId).click(); await page.waitForFunction(() => window.EPhoneCharacterDaily.isBusy());
      await page.locator(buttonId).click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
      holdSchedules = false; if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null; }
      assert.equal(await page.evaluate(async (chatId) => (await window.db.chats.get(chatId)).history.length, chatId), historySize);
      const nextDate = "2026-03-" + String(day + 1).padStart(2, "0");
      assert.equal(await page.evaluate(async (date) => (await window.db.characterLives.toArray()).filter((l) => l.dailyPlans?.[date]).length, nextDate), 0);
      await page.evaluate(() => { document.querySelector("#daily-schedule-status").hidden = true; });
    }
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    async function generate(id, actions) {
      await chat(id); replies = [[{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：走廊" }, ...actions]];
      await page.locator(id === "social-watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(replies.length, 0);
      return calls.at(-1).messages[0].content;
    }
    const narrative = "林走进办公室，开始工作。";
    let prompt = await generate("social-watch", [{ type: "narration", name: "林", content: narrative }, { type: "life_update", name: "林", activity: "工作", place: "办公室", minutes: 60, reachability: "busy", quote: narrative }, { type: "text", name: "林", content: "我先处理自己的工作。" }]);
    assert.match(prompt, /陈医生/); assert.match(prompt, /不能默认全员一直陪/); assert.match(prompt, /城南公寓/);
    const actual = await page.evaluate(() => window.db.characterLives.get("chat:s0")); assert.equal(actual.actual.place, "办公室");
    prompt = await generate("social-group", [{ type: "text", name: "林", content: "我还在忙，晚点聊。" }]); assert.match(prompt, /"source":"chat"/); assert.match(prompt, /办公室/);
    prompt = await generate("s0", [{ type: "text", name: "林", content: "下班后我和同事还有安排。" }]); assert.match(prompt, /陈医生/); assert.match(prompt, /老朋友/);
    await generate("social-watch", [{ type: "relationship_event", name: "林", otherName: "周谨", aToB: "朋友", bToA: "朋友", detail: "参考既有同学关系，待确认", for_timestamp: 12, quote: "林和周谨是大学同学。" }, { type: "text", name: "林", content: "我们有空再聚。" }]);
    assert.equal((await page.evaluate(() => window.db.relationshipEvents.toArray()))[0].status, "pending");
    await me(); await page.locator("#cs-person").selectOption("chat:s0"); assert.match(await page.locator("#cs-body").innerText(), /待确认/);
    await page.locator('[data-cs-action="accept-event"]').click(); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy()); assert.match(await page.locator("#cs-notice").innerText(), /已确认/);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 6); assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 7);
    await chat("social-watch"); const beforeReloadJump = calls.length;
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 6, 10).getTime(), "frozen"));
    assert.equal(calls.length, beforeReloadJump, "saved day survives refresh and is never regenerated");
    const count = calls.length;
    await page.evaluate(async () => { const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1")); localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "social-other", name: "另一空间" }])); await window.EPhoneSpaces.switchSpace("social-other"); await window.EPhoneCharacterSocial.open(); });
    assert.match(await page.locator("#cs-body").innerText(), /还没有人物/); assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 0);
    assert.equal(await page.evaluate(() => window.db.characterLives.count()), 0, "daily plans do not leak into another space");
    await page.evaluate(async () => { await window.EPhoneSpaces.switchSpace("default"); await window.EPhoneCharacterSocial.open(); });
    assert.equal(calls.length, count); assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 7); assert.equal((await page.evaluate(() => window.db.npcs.toArray()))[0].enableBackgroundActivity, false);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile daily-plan editor, NPC circle generation, ALL-role cross-day batches, same-day/history cache, failed auto-generation retry, story midnight generation before reply, cancellation/reload/space isolation, watch/normal/private prompts and social regression");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
