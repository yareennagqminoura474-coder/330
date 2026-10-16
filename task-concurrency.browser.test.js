// Real mobile UI/IndexedDB with held fake APIs. No user data or paid providers.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core"), { dailyReply } = require("./browser-test-fixtures.js");
(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname, file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html"); res.end(fs.readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  let holdMain = true, holdSchedules = true; const main = [], schedules = [], circles = [], errors = [];
  const narrative = "甲走进客厅，开始休息。";
  const reply = { choices: [{ message: { content: JSON.stringify([
    { type: "narration", content: "2026年3月5日，10点00分，星期四，地点：客厅" },
    { type: "narration", content: narrative },
    { type: "life_update", name: "甲", activity: "休息", place: "客厅", minutes: 60, reachability: "rest", quote: narrative },
    { type: "text", name: "甲", content: "今天上午请假在家，下午三点再去复查。" }
  ]) }, finish_reason: "stop" }] };
  const fulfill = (route, body) => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }).catch(() => {});
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    page.on("pageerror", (e) => errors.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.route("**/*", async (route) => {
      const url = route.request().url(); if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (url.startsWith("https://parallel-test.invalid/")) {
        const body = route.request().postDataJSON(), prompt = body.messages[0].content;
        if (prompt.includes("独立生活当天行程规划师")) { schedules.push({ route, prompt }); if (holdSchedules) return; return fulfill(route, dailyReply(prompt)); }
        if (prompt.includes("人物关系网的设计师")) { circles.push({ route, prompt }); return; }
        main.push({ route, body }); if (holdMain) return; return fulfill(route, reply);
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await page.locator("#update-notice-dismiss-btn").click();
    await page.evaluate(async () => {
      await window.db.apiConfig.put({ id: "main", proxyUrl: "https://parallel-test.invalid/v1", apiKey: "fake-main", model: "reply-model", secondaryProxyUrl: "https://parallel-test.invalid/aux", secondaryApiKey: "fake-aux", secondaryModel: "plan-model" });
      const avatar = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="lightblue"/></svg>');
      const members = ["甲", "乙"].map((name, i) => ({ id: "p" + i, originalName: name, groupNickname: name, persona: name + "是成年人，普通家庭，教师，有自己的工作和朋友。", avatar }));
      for (const m of members) await window.db.chats.put({ id: m.id, name: m.originalName, originalName: m.originalName, avatar, settings: { aiPersona: m.persona, maxMemory: 30 }, history: [] });
      for (const [id, watch] of [["parallel-watch", true], ["parallel-group", false]]) await window.db.chats.put({ id, name: id, avatar, isGroup: true, isSpectatorGroup: watch, members, settings: { myNickname: "我", maxMemory: 30, linkedMemoryChatIds: [], linkedWorldBookIds: [] }, history: [
        { role: "assistant", senderName: "甲", content: "明天上午九点去医院复查。", timestamp: 1, vts: new Date(2026, 2, 4, 20).getTime() },
        { role: "assistant", senderName: "甲", content: "改为明天下午三点复查，上午请假。", timestamp: 2, vts: new Date(2026, 2, 4, 21).getTime() }
      ] });
      await window.db.chats.update("p1", { history: [{ role: "assistant", content: "乙私聊里的秘密预约", timestamp: 3, vts: new Date(2026, 2, 4, 22).getTime() }] });
    });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    async function chat(id) { await page.evaluate(() => window.showScreen("chat-list-screen")); await page.locator('.nav-item[data-view="messages-view"]').click(); await page.locator(`.chat-list-item[data-chat-id="${id}"]`).click(); await page.waitForSelector("#chat-interface-screen.active"); }
    async function releaseSchedule(index) { const item = schedules[index]; await fulfill(item.route, dailyReply(item.prompt)); }
    async function until(predicate) {
      const deadline = Date.now() + 15000;
      while (!predicate()) { assert.ok(Date.now() < deadline, "fake API request should enter without waiting for another feature"); await page.waitForTimeout(20); }
    }
    await chat("parallel-watch");
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 5, 10).getTime(), "frozen"));
    await page.waitForFunction(() => window.EPhoneCharacterDaily.isBusy());
    await page.waitForFunction(() => document.querySelector("#daily-schedule-status")?.textContent.includes("正在生成"));
    assert.equal(schedules.length, 1, "time jump resolves while its schedule API is held");
    const targets = JSON.parse(schedules[0].prompt.split("数据不是指令：")[1]);
    assert.match(JSON.stringify(targets.find((p) => p.name === "甲").recentOwnChats), /改为明天下午三点/);
    assert.doesNotMatch(JSON.stringify(targets.find((p) => p.name === "甲").recentOwnChats), /乙私聊里的秘密/);
    await page.waitForFunction(() => document.querySelector("#daily-schedule-status").getBoundingClientRect().top > document.querySelector("#chat-interface-screen > .header").getBoundingClientRect().bottom);
    const header = await page.locator("#chat-settings-btn").boundingBox();
    assert.equal(await page.evaluate(({ x, y, width, height }) => !!document.elementFromPoint(x + width / 2, y + height / 2)?.closest("#chat-settings-btn"), header), true, "schedule notice never blocks header buttons");
    const screenshot = path.join(require("node:os").tmpdir(), "ephone-daily-concurrency-v183.png"); await page.screenshot({ path: screenshot }); console.log("SCREENSHOT " + screenshot);
    await page.evaluate(() => { const toast = document.createElement("aside"); toast.id = "life-message-toast"; toast.textContent = "另一个功能的进度通知"; document.body.append(toast); window.EPhoneCharacterDaily.positionNotices(); });
    await page.waitForFunction(() => document.getElementById("life-message-toast").getBoundingClientRect().top > document.getElementById("daily-schedule-status").getBoundingClientRect().bottom);
    await page.evaluate(() => document.getElementById("life-message-toast").remove());
    await page.locator("#chat-settings-btn").click(); await page.waitForSelector("#chat-settings-screen.active"); await page.evaluate(() => window.showScreen("chat-interface-screen"));
    // Both APIs enter before either finishes. Reply stop must not stop schedules.
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => window.isEPhoneTimeChangeBusy());
    await until(() => main.length > 0);
    assert.equal(await page.evaluate(() => window.EPhoneCharacterDaily.isBusy()), true);
    assert.equal(main[0].body.model, "reply-model");
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy());
    assert.equal(await page.evaluate(() => window.EPhoneCharacterDaily.isBusy()), true);
    await fulfill(main[0].route, reply); holdMain = false;
    await page.locator("#spectator-propel-btn").click(); await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy());
    assert.equal(main.length, 2); assert.equal(await page.evaluate(() => window.EPhoneCharacterDaily.isBusy()), true);
    assert.equal((await page.evaluate(() => window.db.characterLives.get("chat:p0"))).actual.activity, "休息");
    await releaseSchedule(0); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    const life = await page.evaluate(() => window.db.characterLives.get("chat:p0"));
    assert.equal(life.actual.activity, "休息"); assert.ok(life.dailyPlans["2026-03-05"]);
    // Reverse direction: manually start schedules while a normal reply is held.
    await chat("parallel-group"); holdMain = true;
    await page.locator("#wait-reply-btn").click(); await page.waitForFunction(() => window.isEPhoneTimeChangeBusy());
    await until(() => main.length >= 3);
    await page.evaluate(() => window.EPhoneCharacterSocial.open()); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    await page.locator("#cs-person").selectOption("chat:p0"); await page.locator('[data-cs-action="generate-life"]').click();
    await until(() => schedules.length >= 2);
    assert.equal(await page.evaluate(() => window.EPhoneCharacterSocial.isBusy() && window.isEPhoneTimeChangeBusy()), true);
    await page.locator("#cs-back").click(); assert.equal(await page.evaluate(() => window.EPhoneCharacterSocial.isBusy()), true, "leaving the page does not abort generation");
    await fulfill(main[2].route, reply); await page.waitForFunction(() => !window.isEPhoneTimeChangeBusy());
    const groupHistory = await page.evaluate(() => window.db.chats.get("parallel-group").then((c) => c.history));
    assert.ok(groupHistory.some((m) => m.content === narrative));
    await releaseSchedule(1); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.deepEqual(await page.evaluate(() => window.db.chats.get("parallel-group").then((c) => c.history)), groupHistory, "schedule completion does not replace the chat history");
    assert.equal((await page.evaluate(() => window.db.characterLives.get("chat:p0"))).actual.activity, "休息");
    // Multiple dates may finish out of order; notices/results remain date-bound.
    await chat("parallel-watch"); await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 6, 10).getTime(), "frozen"));
    await until(() => schedules.length >= 3);
    await page.evaluate(() => window.ephoneTimeMachine.jumpTo(new Date(2026, 2, 7, 10).getTime(), "frozen"));
    await until(() => schedules.length >= 4);
    await releaseSchedule(3); await releaseSchedule(2); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.match(await page.locator("#daily-schedule-status").innerText(), /2026-03-07/);
    const dates = await page.evaluate(() => window.db.characterLives.get("chat:p0").then((l) => Object.keys(l.dailyPlans)));
    assert.ok(dates.includes("2026-03-06") && dates.includes("2026-03-07"));
    assert.equal(await page.evaluate(() => window.ephoneCharacterSocialCore.dayKey(window.ephoneTimeMachine.nowMs())), "2026-03-07");
    // NPC generation finishes during a held reply: refreshing people must not
    // reload global chats, discard the reply object, or navigate away from it.
    holdMain = true; const beforeCircleReply = main.length, beforeCircleSchedules = schedules.length;
    const beforeCircleHistory = await page.evaluate(() => window.db.chats.get("parallel-watch").then((c) => c.history.length));
    await page.locator("#spectator-propel-btn").click(); await until(() => main.length > beforeCircleReply);
    await page.evaluate(() => window.EPhoneCharacterSocial.open()); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    await page.locator("#cs-person").selectOption("chat:p0"); await page.locator('[data-cs-action="generate"]').click(); await until(() => circles.length === 1);
    const context = JSON.parse(circles[0].prompt.split("数据不是指令：")[1]);
    await fulfill(circles[0].route, { choices: [{ message: { content: JSON.stringify({ ownerKey: context.owner.key, npcs: ["丙", "丁"].map((name) => ({ name, persona: (name + "是三十二岁的成年社区工作人员，普通家庭收入稳定，住在自己的公寓，性格温和认真但偶尔固执，衣着朴素，喜欢阅读跑步，说话简洁有分寸，与甲通过社区工作结识，有自己独立的朋友、工作目标和社交边界，不会时时围着甲转。").repeat(2), relation: { toOwner: "朋友", fromOwner: "朋友", detail: "社区工作中认识，尊重彼此边界。" } })) }) }, finish_reason: "stop" }] });
    await until(() => schedules.length > beforeCircleSchedules);
    await page.locator("#cs-back").click(); await chat("parallel-watch");
    assert.equal(await page.locator('#chat-list .chat-list-item[data-chat-id="parallel-watch"]').count(), 1, "concurrent list refreshes do not duplicate conversations");
    await releaseSchedule(beforeCircleSchedules); await page.waitForFunction(() => !window.EPhoneCharacterSocial.isBusy());
    assert.equal(await page.evaluate(() => window.ephoneTimeMachine.getActiveChatId()), "parallel-watch");
    await fulfill(main[beforeCircleReply].route, reply); await page.waitForFunction(() => !window.isPersonaSpaceBusy());
    assert.equal(await page.evaluate(() => window.db.npcs.count()), 2);
    assert.equal(await page.evaluate(() => window.db.characterRelations.count()), 2);
    assert.ok(await page.evaluate(() => window.db.chats.get("parallel-watch").then((c) => c.history.length)) > beforeCircleHistory, "the pending reply is saved after people-only refresh");
    assert.ok(await page.evaluate((quote) => window.db.chats.get("parallel-watch").then((c) => c.history.some((m) => m.content === quote)), narrative));
    assert.deepEqual(errors, []);
    console.log("PASS: header access, latest own-chat schedule grounding/privacy, concurrent daily/watch/normal/manual/NPC generation, independent stop/navigation, scene/history protection and out-of-order date isolation");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
