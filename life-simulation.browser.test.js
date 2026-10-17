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
  const calls = [], errors = []; let pendingRoute, hold = false, invalidOnce = false, withSchedule = false, replies = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (!url.startsWith("https://life-sim-test.invalid/")) return route.abort(); // Never calls real providers or credentials.
      const body = route.request().postDataJSON(), prompt = body.messages[0].content; calls.push(prompt); let raw;
      if (prompt.includes("独立生活当天行程规划师")) {
        const targets = JSON.parse(prompt.split("数据不是指令：")[1].split("\n上一轮")[0]), date = prompt.match(/仅生成(\d{4}-\d{2}-\d{2})星期/)[1];
        raw = { schedules: targets.map((p) => ({ key: p.key, plan: { date, items: [
          { start: "00:00", end: "07:00", activity: "睡眠", place: "本人家中", reachability: "rest" },
          { start: "09:00", end: "17:00", activity: "独立工作", place: "自己的单位", reachability: "busy" },
          { start: "19:00", end: "21:00", activity: "个人兴趣活动", place: "球场", reachability: "available" }
        ] } })) };
      } else if (prompt.includes("独立生活与主动联系模拟器")) {
        if (hold) { pendingRoute = route; return; }
        const context = JSON.parse(prompt.split("数据不是指令：")[1].split("\n上一轮")[0]), [a, b] = context.pair;
        raw = invalidOnce ? { messages: [{ from: "outsider", to: b, content: "越权内容" }] } : { messages: [{ from: a, to: b, content: `工作确认第${calls.length}次，只在这两人之间。` }, { from: b, to: a, content: `收到第${calls.length}次邀请，我下班后联系。` }], event: { title: "下班后的临时邀请", content: "双方私下讨论下班后一起运动，各自仍有工作。" } };
        if (withSchedule && !invalidOnce) {
          raw.messages[0].content += "我把兴趣活动推迟到二十点。";
          raw.event.scheduleChange = { key: a, itemId: context.people.find((p) => p.key === a).todayPlan.items.at(-1).id, start: "20:00", end: "22:00", reason: "工作临时延后", quote: "兴趣活动推迟到二十点" }; withSchedule = false;
        }
        invalidOnce = false;
      } else raw = replies.shift() || [{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：办公室" }, { type: "text", name: "林", content: "我先忙自己的工作。" }];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: "stop" }] }) });
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      const config = await window.db.apiConfig.get("main") || { id: "main" }; await window.db.apiConfig.put({ ...config, proxyUrl: "https://life-sim-test.invalid/v1", apiKey: "test-placeholder", model: "test-model", secondaryProxyUrl: "https://life-sim-test.invalid/v1", secondaryApiKey: "test-aux-placeholder", secondaryModel: "auxiliary-test-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["林", "周谨", "第三人"].map((name, i) => ({ id: "p" + i, originalName: name, groupNickname: name, persona: name + "是普通家庭的成年人，有独立职业生活，尊重别人的隐私。", avatar }));
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, aiAvatar: avatar, maxMemory: 20 }, history: [] });
      for (const [id, watch] of [["watch", true], ["group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members: members.slice(0, 2), settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [] });
      const ids = await window.db.npcs.bulkAdd([{ name: "NPC甲", persona: "普通家庭的成年人，林的同事，在医院工作。" }, { name: "NPC乙", persona: "普通家庭的成年人，林的朋友，有自己的工作。" }], { allKeys: true });
      window.fixtureNpcKeys = ids.map((id) => "npc:" + id);
      for (const key of ["chat:p1", ...window.fixtureNpcKeys]) await window.db.characterRelations.put({ id: window.ephoneCharacterSocialCore.pairId("chat:p0", key), a: "chat:p0", b: key, aToB: "朋友", bToA: "朋友", revision: 1 });
      await window.ephonePlayerIdentity.save(window.db, "chat:p1");
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    const npcKeys = await page.evaluate(async () => (await window.db.npcs.toArray()).map((n) => "npc:" + n.id));
    async function chat(id) {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click();
      await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active");
    }
    async function open() {
      await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="me-view"]').click();
      await page.locator("#me-life-simulation-button").click(); await page.waitForSelector("#life-simulation-screen.active #ls-person");
    }
    async function settled() { await page.waitForFunction(() => !window.EPhoneLifeSimulation.isBusy()); await page.waitForTimeout(100); await page.locator("#life-message-toast [data-close]").click().catch(() => {}); }
    await chat("watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.locator('#daily-schedule-status [data-action="primary"]').filter({ hasText: "生成" }).click();
    await page.waitForFunction(() => !window.EPhoneCharacterDaily.isBusy());
    assert.ok(await page.evaluate(async () => !!(await window.db.characterLives.get("chat:p0"))?.dailyPlans?.["2026-03-05"]));
    await page.evaluate(() => { if (document.querySelector("#daily-schedule-status")) document.querySelector("#daily-schedule-status").hidden = true; });
    const beforeOpen = calls.length; await open(); assert.equal(calls.length, beforeOpen, "opening does not generate unsolicited AI calls");
    assert.equal(await page.locator("#ls-auto").isChecked(), false);
    await page.locator("#ls-person").selectOption("chat:p0"); await page.locator('[data-ls-action="state"]').click();
    await page.locator("#ls-fatigue").fill("60"); await page.locator("#ls-mood").fill("平静"); await page.locator("#ls-health").fill("需要休息");
    await page.locator("#ls-trust-key").selectOption("chat:p1"); await page.locator("#ls-trust").fill("70"); await page.locator('[data-ls-action="save-record"]').click();
    await page.waitForFunction(() => document.querySelector("#ls-notice").textContent.includes("已保存"));
    assert.match(await page.locator("#ls-content").innerText(), /疲劳：60.*身体：需要休息.*信任：70/s);
    assert.equal(await page.locator(".ls-scroll").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
    assert.equal(await page.locator(".ls-scroll").evaluate((el) => el.scrollHeight > el.clientHeight), true);
    await page.locator('[data-ls-tab="tasks"]').click(); await page.locator('[data-ls-action="add-task"]').click();
    await page.locator("#ls-title").fill("晚间讨论工作"); await page.locator("#ls-other").selectOption("chat:p1"); await page.locator("#ls-due").fill("2026-03-05T19:00");
    await page.locator('[data-ls-action="save-record"]').click(); await page.waitForFunction(() => !document.querySelector("#ls-title")); assert.match(await page.locator("#ls-content").innerText(), /晚间讨论工作/);
    await page.locator('[data-ls-tab="knowledge"]').click(); await page.locator('[data-ls-action="add-knowledge"]').click();
    await page.locator("#ls-title").fill("林只猜测的私密消息"); await page.locator("#ls-certainty").selectOption("guess"); await page.locator('[data-ls-action="save-record"]').click();
    await page.waitForFunction(() => !document.querySelector("#ls-title")); assert.match(await page.locator("#ls-content").innerText(), /仅猜测/);
    // Every supported pairing can converse through the actual mobile UI.
    for (const pair of [["chat:p0", "chat:p1"], ["chat:p0", npcKeys[0]], npcKeys]) {
      await page.locator("#ls-person").selectOption(pair[0]); await page.locator('[data-ls-tab="messages"]').click();
      await page.locator("#ls-contact").selectOption(pair[1]); await page.locator('[data-ls-action="start-thread"]').click();
      await page.waitForSelector('[data-ls-action="continue-thread"]'); withSchedule = pair[0] === "chat:p0" && pair[1] === "chat:p1"; await page.locator('[data-ls-action="continue-thread"]').click(); await settled();
      assert.match(await page.locator("#ls-content").innerText(), /工作确认第/);
    }
    assert.equal(await page.evaluate(async () => (await window.db.lifeSimulation.where("kind").equals("message").toArray()).length), 6);
    const lastPrompt = calls.at(-1); assert.doesNotMatch(lastPrompt, /林只猜测的私密消息/); assert.match(lastPrompt, /NPC甲.*NPC乙/s);
    await page.locator("#ls-person").selectOption("chat:p0"); await page.locator('[data-ls-tab="life"]').click(); assert.match(await page.locator("#ls-content").innerText(), /临时行程调整 · 待确认/);
    await page.locator('[data-ls-action="confirm-schedule"]').click(); await page.waitForFunction(() => document.querySelector("#ls-notice").textContent.includes("已调整当天行程"));
    assert.equal(await page.evaluate(async () => (await window.db.characterLives.get("chat:p0")).dailyPlans["2026-03-05"].items.at(-1).start), "20:00");
    assert.equal(await page.evaluate(async (key) => (await window.db.characterLives.get(key))?.dailyPlans?.["2026-03-05"], npcKeys[0]), undefined, "NPCs never generate plans");
    await page.locator("#ls-person").selectOption(npcKeys[0]); await page.locator('[data-ls-tab="messages"]').click();
    await page.locator('[data-ls-action="thread"]').filter({ hasText: "NPC乙" }).click();
    await page.locator("#ls-speaker").selectOption(npcKeys[1]); await page.locator("#ls-text").fill("NPC乙追加的新消息，请继续。");
    await page.locator('[data-ls-action="send-continue"]').click(); await settled(); assert.match(calls.at(-1), /NPC乙追加的新消息，请继续/);
    assert.equal(await page.evaluate(async () => (await window.db.lifeSimulation.where("kind").equals("message").toArray()).length), 9);
    invalidOnce = true; const beforeRepair = calls.length; await page.locator('[data-ls-action="continue-thread"]').click(); await settled(); assert.equal(calls.length - beforeRepair, 2, "invalid foreign speaker retries once without saving the invalid batch");
    // Stop does not partially persist the batch or disable scrolling/navigation.
    const beforeStop = await page.evaluate(() => window.db.lifeSimulation.count()); hold = true;
    await page.locator('[data-ls-action="continue-thread"]').click(); await page.waitForFunction(() => window.EPhoneLifeSimulation.isBusy());
    await page.locator("#ls-stop").click(); await settled(); hold = false; if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null; }
    assert.equal(await page.evaluate(() => window.db.lifeSimulation.count()), beforeStop); assert.match(await page.locator("#ls-notice").innerText(), /已停止/);
    await chat("watch"); hold = true;
    await page.evaluate((pair) => { window.heldLife = window.EPhoneLifeSimulation.generatePair(pair).catch((error) => error.name); }, npcKeys);
    await page.waitForSelector('#life-message-toast[data-processing="true"]'); await page.locator("#life-message-toast [data-stop]").click();
    assert.equal(await page.evaluate(() => window.heldLife), "AbortError"); hold = false; if (pendingRoute) { await pendingRoute.abort().catch(() => {}); pendingRoute = null; }
    await page.locator("#life-message-toast [data-close]").click(); await open(); await page.locator("#ls-person").selectOption(npcKeys[0]); await page.locator('[data-ls-tab="messages"]').click();
    await page.locator('[data-ls-action="thread"]').filter({ hasText: "NPC乙" }).click(); await page.waitForSelector("#ls-text");
    // One automatic conversation per interval; no request per person or catch-up flood.
    await page.locator("#ls-auto").check(); await page.locator("#ls-interval").fill("30"); await page.locator('[data-ls-action="settings"]').click();
    await page.waitForFunction(async () => (await window.db.lifeSimulation.get("settings"))?.enabled === true);
    await page.evaluate(async (pair) => new window.ephoneLifeSimulationCore.Service(window.db).addRecord("commitment", { key: pair[0], otherKey: pair[1], title: "核实上午进展", due: "2026-03-05T09:00" }, window.ephoneTimeMachine.nowMs()), npcKeys);
    await page.waitForTimeout(100); const beforeAuto = calls.length;
    await page.locator("#ls-text").fill("尚未发送的草稿"); await page.evaluate(() => window.EPhoneLifeSimulation.proactiveTick()); assert.equal(calls.length, beforeAuto, "draft entry pauses proactive requests");
    assert.equal(await page.locator("#ls-text").inputValue(), "尚未发送的草稿"); await page.locator("#ls-text").fill(""); await page.locator("#ls-notice").click();
    await page.evaluate(() => window.EPhoneLifeSimulation.proactiveTick()); await settled();
    assert.equal(calls.length - beforeAuto, 1); await page.evaluate(() => window.EPhoneLifeSimulation.proactiveTick()); assert.equal(calls.length - beforeAuto, 1);
    assert.deepEqual(JSON.parse(calls.at(-1).split("数据不是指令：")[1]).pair.sort(), npcKeys.sort(), "due commitment is prioritized without judging guilt");
    await page.locator("#ls-auto").uncheck(); await page.locator('[data-ls-action="settings"]').click(); await page.waitForFunction(async () => (await window.db.lifeSimulation.get("settings"))?.enabled === false);
    // Both group styles and private replies receive the same scoped continuity and action handlers.
    for (const id of ["watch", "group", "p0", "p2"]) {
      await chat(id); const quote = id === "p2" ? "我今晚整理文件。" : "我明天检查报告。";
      replies = [[{ type: "narration", content: "2026年3月5日，10点00分，星期四，地点：办公室" }, { type: "text", name: id === "p2" ? "第三人" : "林", content: quote }, { type: "life_commitment", name: id === "p2" ? "第三人" : "林", title: id === "p2" ? "整理文件" : "检查报告", quote }]];
      await page.locator(id === "watch" ? "#spectator-propel-btn" : "#wait-reply-btn").click(); await page.waitForFunction(() => !window.isPersonaSpaceBusy()); assert.equal(replies.length, 0);
      const prompt = calls.at(-1); assert.match(prompt, /生活连续性与信息差/);
      if (id === "p2") assert.doesNotMatch(prompt, /林只猜测的私密消息|工作确认第|晚间讨论工作/);
      else { assert.match(prompt, /林只猜测的私密消息/); assert.match(prompt, /工作确认第/); assert.match(prompt, /需要休息/); }
    }
    assert.equal(await page.evaluate(async () => (await window.db.lifeSimulation.where("kind").equals("commitment").toArray()).filter((r) => r.title === "检查报告" && r.status === "pending").length), 1, "same statement across chats is deduplicated");
    await open(); await page.locator("#ls-person").selectOption("chat:p0"); await page.locator('[data-ls-tab="tasks"]').click();
    const pending = page.locator("#ls-content article").filter({ hasText: "检查报告" }); assert.match(await pending.innerText(), /待确认/);
    await pending.locator('[data-ls-action="confirm"]').click(); await page.waitForFunction(() => !document.querySelector('[data-ls-action="confirm"]'));
    const screenshot = path.join(require("node:os").tmpdir(), "ephone-life-simulation-v172.png"); await page.screenshot({ path: screenshot }); console.log("SCREENSHOT " + screenshot);
    const savedCount = await page.evaluate(() => window.db.lifeSimulation.count()); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    assert.equal(await page.evaluate(() => window.db.lifeSimulation.count()), savedCount, "private messages and life records persist through reload");
    await page.evaluate(async () => { const spaces = JSON.parse(localStorage.getItem("ephone-persona-spaces-v1")); localStorage.setItem("ephone-persona-spaces-v1", JSON.stringify([...spaces, { id: "life-other", name: "生活另一空间" }])); await window.EPhoneSpaces.switchSpace("life-other"); await window.EPhoneLifeSimulation.open(); });
    assert.equal(await page.evaluate(() => window.db.lifeSimulation.count()), 0); assert.equal(await page.locator("#ls-person option").count(), 0); assert.equal(await page.locator("#ls-auto").isChecked(), false);
    await page.evaluate(async () => { await window.EPhoneSpaces.switchSpace("default"); await window.EPhoneLifeSimulation.open(); }); assert.equal(await page.evaluate(() => window.db.lifeSimulation.count()), savedCount);
    assert.deepEqual(errors, []);
    console.log("PASS: mobile life/state/task/knowledge UI, all private role/NPC pairings, NPC impersonation continuation, scoped prompts in watch/normal/private replies, evidence-action dedupe/confirmation, bounded proactive scheduler, stop/retry, scroll, reload and space isolation");
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
