// Real mobile reader and local formula/font assets. No provider is contacted.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright-core");

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.resolve(__dirname, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(__dirname + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : "text/html");
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const body = String.raw`黑板上的化学式与公式，都要完整显示。

向含有 $1\text{ mol }\text{Ca(HCO}_3)_2$ 的溶液中逐滴加入 $\text{NaOH}$ 溶液。

先把 $\text{OH}^-$ 与 $\text{HCO}_3^-$ 的真实消耗比确定下来。

反应：$$\ce{Ca(HCO3)2 + 2 NaOH -> CaCO3 v + Na2CO3 + 2 H2O}$$

分数与根式：$\frac{a+b}{c}=\sqrt{x^2+1}$。

集合：\(x\in A,\quad A\subseteq B,\quad x\notin C\)。

积分求和：\[\int_0^1 x^2\,dx=\frac13,\quad \sum_{k=1}^n k=\frac{n(n+1)}2\]

矩阵：$$\begin{pmatrix}1&2\\3&4\end{pmatrix}\begin{bmatrix}x\\y\end{bmatrix}$$

物理：$\vec F=m\vec a,\quad E=mc^2,\quad \alpha+\beta=\pi$。

\begin{align}a+b&=c\\x^2+y^2&=z^2\end{align}

普通价格 $20 和 $30 不应变成公式。未知公式 $\unknownCommand{x}$ 应保留。
<img src=x onerror="window.__mathInjected=true"> 最后一行，原文保留。`;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const errors = [], fontResponses = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.url().includes("/vendor/katex/fonts/")) fontResponses.push({ url: response.url(), status: response.status() }); });
    await page.route("**/*", route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.includes("unpkg.com/dexie")) return route.fulfill({ contentType: "application/javascript", body: fs.readFileSync(path.join(path.dirname(require.resolve("dexie")), "dexie.min.js"), "utf8") });
      if (/chat\/completions|generateContent|\/models/.test(url)) unexpected.push(url);
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady);
    await page.locator("#update-notice-dismiss-btn").click();
    const id = await page.evaluate(async content => {
      const authorId = await window.db.grAuthors.add({ name: "公式测试", style: "自然" });
      return window.db.grStories.add({ title: "公式课堂", authorId, settings: { charIds: [], bookIds: [], outputLength: 5000 }, chapters: [{ title: "第三章 化学与数学", content, summary: "本章原文保留。" }], lastUpdated: Date.now() });
    }, body);
    const open = async () => {
      await page.evaluate(() => window.openGreenRiverScreen());
      await page.locator("#gr-book-list .gr-book-card").first().click();
      await page.waitForSelector("#gr-reader-screen.active");
    };
    await open();
    const reader = page.locator("#gr-reader-content .gr-chapter-text");
    assert.equal(await reader.locator(".katex").count(), 11, "all delimiter styles and chemistry render, unsupported notation remains literal");
    assert.ok(await reader.locator("math mfrac").count() >= 3);
    assert.ok(await reader.locator("math msqrt").count() >= 1);
    assert.ok(await reader.locator("math msub").count() >= 1);
    assert.ok(await reader.locator("math msup").count() >= 1);
    assert.ok(await reader.locator("math mtable").count() >= 3);
    assert.equal(await reader.locator(".katex-error").count(), 0);
    const text = await reader.textContent();
    for (const expected of ["普通价格 $20 和 $30", "$\\unknownCommand{x}$", "<img src=x", "最后一行，原文保留。", "先把"]) assert.ok(text.includes(expected), expected);
    assert.equal(await reader.locator("img, iframe, a").count(), 0);
    assert.equal(await page.evaluate(() => !!window.__mathInjected), false);
    assert.equal(await page.evaluate(async id => (await window.db.grStories.get(id)).chapters[0].content, id), body);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(fontResponses.length >= 4, "formula fonts load from this site's vendored assets");
    assert.ok(fontResponses.every(response => response.status === 200 && response.url.startsWith(origin)));
    assert.equal(await page.evaluate(() => document.querySelector("#gr-reader-content").scrollWidth > document.querySelector("#gr-reader-content").clientWidth + 1), false, "wide display math scrolls within its own line on a phone");
    await page.screenshot({ path: path.join(require("node:os").tmpdir(), "ephone-novel-math-mobile.png") });
    // The same renderer handles streamed fragments without editing saved source.
    const incremental = await page.evaluate(() => {
      const node = document.createElement("div");
      EPhoneNovelPresentation.render(node, "正文 $\\frac{1}");
      const partial = node.textContent;
      EPhoneNovelPresentation.render(node, "正文 $\\frac{1}{2}$，结束。");
      const count = node.querySelectorAll(".katex").length;
      EPhoneNovelPresentation.render(node);
      return { partial, count, repeated: node.querySelectorAll(".katex").length, tail: node.textContent.endsWith("，结束。") };
    });
    assert.deepEqual(incremental, { partial: "正文 $\\frac{1}", count: 1, repeated: 1, tail: true });
    // KaTeX trust is disabled: TeX cannot create external links or HTML nodes.
    assert.equal(await page.evaluate(() => {
      const node = document.createElement("div"); EPhoneNovelPresentation.render(node, "$\\href{javascript:alert(1)}{x}$ $\\includegraphics{https://example.invalid/x.png}$");
      return node.querySelectorAll("a,img,iframe").length;
    }), 0);
    await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForFunction(() => window.ephoneAppReady); await open();
    assert.equal(await reader.locator(".katex").count(), 11, "existing chapters re-render after re-entry, without regeneration");
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log("PASS: mobile reader chemistry, units, fractions, roots, sets, integrals, matrices, all delimiters, local fonts, preserved original/unsupported text, streaming fragments and safe reload without API calls");
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
