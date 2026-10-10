(function (root) {
  "use strict";
  // Offline, verified China mainland arrangements; do not extrapolate them
  // onto another year or fetch a third-party calendar during chat requests.
  // 2024: https://app.www.gov.cn/govdata/gov/202310/25/508678/article.html
  // 2025: https://www.forestry.gov.cn/c/www/szxx/594663.jhtml
  // 2026: https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html
  const schedules = {
    2024: { breaks: [["元旦", "2023-12-30", "2024-01-01"], ["春节", "02-10", "02-17"], ["清明节", "04-04", "04-06"],
      ["劳动节", "05-01", "05-05"], ["端午节", "06-08", "06-10"], ["中秋节", "09-15", "09-17"], ["国庆节", "10-01", "10-07"]],
      work: ["02-04", "02-18", "04-07", "04-28", "05-11", "09-14", "09-29", "10-12"] },
    2025: { breaks: [["元旦", "01-01", "01-01"], ["春节", "01-28", "02-04"], ["清明节", "04-04", "04-06"],
      ["劳动节", "05-01", "05-05"], ["端午节", "05-31", "06-02"], ["国庆节、中秋节", "10-01", "10-08"]],
      work: ["01-26", "02-08", "04-27", "09-28", "10-11"] },
    2026: { breaks: [["元旦", "01-01", "01-03"], ["春节", "02-15", "02-23"], ["清明节", "04-04", "04-06"],
      ["劳动节", "05-01", "05-05"], ["端午节", "06-19", "06-21"], ["中秋节", "09-25", "09-27"], ["国庆节", "10-01", "10-07"]],
      work: ["01-04", "02-14", "02-28", "05-09", "09-20", "10-10"] },
  };
  // Festival dates are NOT vacation schedules. 2027 dates checked against
  // HKO/official HK lunar calendar; never import Hong Kong vacation rules.
  // https://www.labour.gov.hk/chs/news/latest_holidays2027.htm
  // Avoid Intl's Chinese calendar here: some ICU versions misdate CNY 2027.
  const lunarDates = {
    2024: ["02-10", "04-04", "06-10", "09-17"],
    2025: ["01-29", "04-04", "05-31", "10-06"],
    2026: ["02-17", "04-05", "06-19", "09-25"],
    2027: ["02-06", "04-05", "06-09", "09-15"],
  };
  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(ms) {
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
  }
  function dayNumber(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
    const [y, m, d] = key.split("-").map(Number), date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d ? date.getTime() / 86400000 : NaN;
  }
  const fromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const fullDate = (year, date) => date.length === 5 ? `${year}-${date}` : date;
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const label = (key) => `${key} 周${weekdays[new Date(dayNumber(key) * 86400000).getUTCDay()]}`;
  const interval = (entry) => `${label(entry.start)}～${label(entry.end)}（${dayNumber(entry.end) - dayNumber(entry.start) + 1}天）`;
  function officialEntries(year) {
    const schedule = schedules[year];
    return schedule ? schedule.breaks.map(([name, start, end]) => ({ name, start: fullDate(year, start), end: fullDate(year, end) })) : [];
  }
  function festivals(year) {
    const result = [["元旦", `${year}-01-01`], ["劳动节", `${year}-05-01`], ["国庆节", `${year}-10-01`]];
    const dates = lunarDates[year];
    if (dates) {
      const spring = `${year}-${dates[0]}`;
      result.push(["除夕", fromDay(dayNumber(spring) - 1)], ["春节（正月初一）", spring], ["元宵节", fromDay(dayNumber(spring) + 14)],
        ["清明节", `${year}-${dates[1]}`], ["端午节", `${year}-${dates[2]}`], ["中秋节", `${year}-${dates[3]}`]);
    }
    return result.map(([name, date]) => ({ name, date })).sort((a, b) => a.date.localeCompare(b.date));
  }
  function describe(ms, custom = []) {
    const key = dayKey(ms), n = dayNumber(key), year = Number(key.slice(0, 4));
    if (!Number.isFinite(n)) return "日期无效，不能判断节假日。";
    const schedule = schedules[year], entries = officialEntries(year);
    const current = entries.find((entry) => key >= entry.start && key <= entry.end);
    const makeup = schedule?.work.map((date) => fullDate(year, date)) || [];
    const festival = festivals(year).filter((entry) => entry.date === key).map((entry) => entry.name);
    const weekend = [0, 6].includes(new Date(n * 86400000).getUTCDay());
    const lines = [`日历基准：${label(key)}；按本轮所选时间的年月日判断，不使用设备的今天。`, `当天节日：${festival.join("、") || "已内置日历中无节日标记"}。`];
    if (schedule) {
      lines.push(current ? `公共安排：${current.name}放假中，完整区间 ${interval(current)}；第${n - dayNumber(current.start) + 1}天，含今天还剩${dayNumber(current.end) - n + 1}天。` :
        makeup.includes(key) ? "公共安排：调休上班日，即使是周末也不是普通周末休息日。" :
          weekend ? "公共安排：普通周末，非已安排的调休上班日。" : "公共安排：普通工作日，非公共假期。" );
      for (const entry of entries) lines.push(`本年${entry.name}放假区间：${interval(entry)}${entry.start > key ? `，距开始${dayNumber(entry.start) - n}天` : ""}。`);
      if (makeup.length) lines.push("本年全部调休上班日：" + makeup.map(label).join("、") + "。");
    } else {
      lines.push(`${year}年的中国大陆放假调休安排尚未内置；只能确认已列出的节日本日，连续放假起止、补班日和是否因调休休息未知，严禁套用其他年份或编造。`);
      const next = festivals(year).filter((entry) => entry.date >= key).slice(0, 2);
      for (const entry of next) lines.push(`节日本日（不是连休区间）：${entry.name} ${label(entry.date)}。`);
    }
    const relevant = custom.filter((entry) => entry.end >= key).sort((a, b) => a.start.localeCompare(b.start));
    for (const entry of relevant) lines.push(`本空间自定义安排：${entry.name}；对象：${entry.audience}；${entry.kind}；${interval(entry)}；${entry.start <= key ? "当前生效" : `距开始${dayNumber(entry.start) - n}天`}。`);
    return lines.join("\n");
  }
  function parseDraft(text) {
    if (text.length > 12000) throw new Error("安排过长，请控制在12000字以内。");
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > 50) throw new Error("最多保存50段安排。");
    return lines.map((line, i) => {
      const [range, name, kind, audience = "本空间所有人物", ...extra] = line.split(/[|｜]/).map((part) => part.trim());
      const dates = range.match(/^(\d{4}-\d{2}-\d{2})(?:\s*[~～]\s*(\d{4}-\d{2}-\d{2}))?$/);
      if (!dates || !name || name.length > 80 || !["放假", "上班", "上课"].includes(kind) || !audience || audience.length > 100 || extra.length)
        throw new Error(`第${i + 1}行格式应为：起止日期 | 假期名 | 放假/上班/上课 | 适用人物或学校。`);
      const start = dates[1], end = dates[2] || start;
      if (!Number.isFinite(dayNumber(start)) || !Number.isFinite(dayNumber(end)) || end < start || dayNumber(end) - dayNumber(start) > 730)
        throw new Error(`第${i + 1}行日期无效、顺序颠倒或超过两年。`);
      return { start, end, name, kind, audience };
    });
  }
  let table = null, draft = "", custom = [], loadSerial = 0;
  const writes = new Map();
  async function loadSpace(db) {
    const selected = db?.spaceClock;
    if (!selected) { table = null; draft = ""; custom = []; return; }
    if (table?.db.name === selected.db.name) return;
    const serial = ++loadSerial;
    // Drop the previous space immediately; never leak its vacations while loading.
    table = null; draft = ""; custom = [];
    await (writes.get(selected.db.name) || Promise.resolve()).catch(() => {});
    const saved = await selected.get("holiday-calendar");
    if (serial !== loadSerial) return;
    const text = typeof saved?.draft === "string" ? saved.draft : "";
    try { custom = parseDraft(text); }
    catch { custom = []; console.warn("已保存的自定义假期格式无效；原文保留，请在时间设置中修正。"); }
    draft = text; table = selected;
  }
  async function saveDraft(text) {
    const entries = parseDraft(text), selected = table;
    if (!selected) throw new Error("日历尚未加载，请重新打开聊天后保存。");
    if (text === draft) return;
    const write = (writes.get(selected.db.name) || Promise.resolve()).catch(() => {}).then(() => selected.put({ id: "holiday-calendar", draft: text }));
    writes.set(selected.db.name, write);
    await write;
    if (table?.db.name === selected.db.name) { draft = text; custom = entries; }
  }
  function prompt(ms) {
    return "\n# 【节假日与作息日历】\n" + describe(ms, custom) + "\n" +
      "上述公共日历默认适用于中国大陆背景；人物明确在其他地区、架空世界或采用不同日历时，以当地/世界设定为准，不把大陆安排强加给他们。\n" +
      "节日本日、连休区间、周末、调休上班日不是一回事，周六周日也可能补班；元宵等节日不自动代表全体放假。\n" +
      "未内置的年份不能参照已内置年份编造放假调休；内置日历是公共安排的事实依据，有明确适用对象的自定义剧情安排可以覆盖该对象的作息，但不能改掉公共日历事实。\n" +
      "放假安排本身不会推进时间。涉及今天是否放假、放几天、何时返校/上班、假期计划，先核对上述日期再回答。\n" +
      "学生寒暑假、考试周、具体学校调课，及医护/服务业轮班、个人请假，不由公共假期推定；只使用人设、世界书或已明确的剧情/自定义安排，未设定则不编造。自定义安排仅对列出的对象生效、仅在指定日期内生效，其他角色不能一并放假；相同对象的重叠安排或设定冲突需要澄清，不擅自选择。\n";
  }
  function attachUi(modal) {
    const section = document.createElement("section"); section.className = "holiday-calendar";
    section.innerHTML = `<div id="holiday-preview" role="status" aria-live="polite"></div><details><summary>节假日安排 / 本空间自定义</summary>
      <p>默认中国大陆，已内置2024–2026年放假调休、2024–2027年主要传统节日本日。其他年份不猜连休。学校寒暑假、其他地区或架空假期可自行填写。</p>
      <label for="holiday-draft">每行一段：起止日期 | 名称 | 放假/上班/上课 | 适用人物或学校</label>
      <textarea id="holiday-draft" rows="4" spellcheck="false" placeholder="2027-01-20 ~ 2027-02-15 | 寒假 | 放假 | 清北班学生"></textarea>
      <p>单日可只填一个日期；留空后保存可清除自定义。只在本空间生效，不会跳转时间。</p>
      <button type="button" id="holiday-save">保存假期安排</button><div id="holiday-save-status" role="status" aria-live="polite"></div>
      <a href="https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html" target="_blank" rel="noopener noreferrer">2026年官方放假安排</a>
      </details>`;
    modal.querySelector(".time-machine-actions").before(section);
    section.querySelector("#holiday-draft").addEventListener("input", () => {
      section.querySelector("#holiday-save-status").textContent = "尚未保存，请点“保存假期安排”。";
    });
    section.querySelector("#holiday-save").addEventListener("click", async () => {
      const status = section.querySelector("#holiday-save-status"), button = section.querySelector("#holiday-save");
      if (root.isPersonaSpaceBusy?.()) { status.textContent = "请先停止回复或等当前操作结束，再修改假期安排。"; return; }
      button.disabled = true;
      try { await saveDraft(section.querySelector("#holiday-draft").value); status.textContent = "已保存，本空间所有聊天都会读取。"; renderPreview(modal); }
      catch (error) { status.textContent = "未保存：" + error.message; }
      finally { button.disabled = false; }
    });
  }
  function renderPreview(modal) {
    const preview = modal.querySelector("#holiday-preview");
    if (!preview) return;
    const real = modal.querySelector("[data-time-mode].active")?.dataset.timeMode === "real";
    const ms = real ? Date.now() : new Date(modal.querySelector("#time-machine-datetime")?.value).getTime();
    preview.textContent = describe(ms, custom);
  }
  function openUi(modal) {
    const input = modal.querySelector("#holiday-draft"); if (input) input.value = draft;
    const status = modal.querySelector("#holiday-save-status"); if (status) status.textContent = "";
    renderPreview(modal);
  }
  const api = { describe, prompt, parseDraft, festivals, loadSpace, saveDraft, attachUi, renderPreview, openUi };
  root.ephoneHolidayCalendar = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
