(function () {
  "use strict";
  const core = window.ephoneCharacterSocialCore;
  const seen = new Map(), jobs = new Map(), offers = new Map(), dismissed = new Set(); let banner, statusJob, layoutPending = false;
  const database = () => window.db?.characterLives?.db;
  const now = () => window.ephoneTimeMachine?.nowMs() ?? Date.now();
  function positionBanner() {
    if (layoutPending) return;
    layoutPending = true;
    requestAnimationFrame(() => {
      layoutPending = false;
      const headers = [...document.querySelectorAll(".screen.active > .header")].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
      let top = Math.max(80, ...headers.map((r) => r.bottom)) + 8;
      if (banner && !banner.hidden) { banner.style.top = top + "px"; top = banner.getBoundingClientRect().bottom + 8; }
      const toast = document.getElementById("life-message-toast");
      if (toast && !toast.hidden) toast.style.top = top + "px";
    });
  }
  function hideBanner() { if (banner) { banner.hidden = true; banner.style.display = "none"; positionBanner(); } }
  function status(job, message, controls = "") {
    // Slow results from another date or space must not replace this notice.
    if (database() !== job.db || core.dayKey(now()) !== job.date || dismissed.has(job.id)) return;
    statusJob = job;
    if (!banner) {
      banner = document.createElement("aside"); banner.id = "daily-schedule-status"; banner.setAttribute("role", "status");
      banner.style.cssText = "position:fixed;top:90px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(94vw,420px);z-index:90;background:#fffc;color:#263349;padding:8px 10px;border:1px solid #cbd8ee;border-radius:12px;font-size:12px;box-shadow:0 3px 16px #0002;pointer-events:none;display:flex;gap:8px;align-items:center";
      banner.innerHTML = '<span style="flex:1;min-width:0"></span><button type="button" data-action="primary" style="pointer-events:auto;flex:none;min-height:32px"></button><button type="button" data-action="close" style="pointer-events:auto;flex:none;min-height:32px">关闭</button>'; document.body.append(banner);
    }
    banner.hidden = false; banner.style.display = "flex"; positionBanner(); banner.querySelector("span").textContent = message;
    const button = banner.querySelector('[data-action="primary"]'); button.hidden = !controls; button.textContent = controls;
    button.onclick = () => {
      if (controls === "停止") job.controller.abort();
      else if (controls === "重试") ensureDay(now()).catch(() => {});
      else if (controls === "生成") ensureDay(now()).catch(() => {});
    };
    banner.querySelector('[data-action="close"]').onclick = () => {
      dismissed.add(job.id);
      job.controller?.abort();
      hideBanner();
    };
  }
  async function generate(service, targets, vts, { signal, onProgress = () => {} } = {}) {
    if (!targets.length) return 0;
    signal?.throwIfAborted();
    const snapshot = await service.snapshot();
    const grounded = await Promise.all(targets.map(async (p) => {
      signal?.throwIfAborted();
      const context = await service.dailyContext(p.key, vts, snapshot);
      const lifeContinuity = window.ephoneLifeSimulationCore && service.db.tables.some((t) => t.name === "lifeSimulation") ? await new window.ephoneLifeSimulationCore.Service(service.db).dayContext(p.key, vts) : null;
      return { ...p, lifeContinuity, recentContext: context.sources };
    }));
    signal?.throwIfAborted(); onProgress(0, targets.length, targets, 0);
    try {
      const raw = await window.EPhoneMarketAdapter.generate(core.dailyPrompt(grounded, vts, window.ephoneHolidayCalendar?.prompt(vts) || ""), signal);
      signal?.throwIfAborted();
      return await service.saveDailySchedules(raw, targets, vts, { signal });
    } catch (error) { error.completedSchedules = 0; throw error; }
  }
  async function offerDay(vts) {
    const db = database(); if (!db || !window.EPhoneMarketAdapter) return;
    const date = core.dayKey(vts), id = db.name + ":" + date;
    if (dismissed.has(id) || jobs.has(id) || offers.has(id)) return;
    const promise = (async () => {
      const targets = await new core.Service(db).dailyTargets(vts);
      if (targets.length) status({ id, db, date }, date + " 有" + targets.length + "位角色的行程待生成。可生成或关闭，聊天不受影响。", "生成");
    })();
    offers.set(id, promise);
    try { await promise; } finally { if (offers.get(id) === promise) offers.delete(id); }
  }
  async function ensureDay(vts, { signal } = {}) {
    const db = database(); if (!db || !window.EPhoneMarketAdapter) return 0;
    const date = core.dayKey(vts), id = db.name + ":" + date;
    if (jobs.has(id)) return jobs.get(id).promise;
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
    const job = { id, db, date, controller }; jobs.set(id, job);
    const work = async () => {
      controller.signal.throwIfAborted();
      const service = new core.Service(db), targets = await service.dailyTargets(vts);
      if (!targets.length) return 0;
      const count = await generate(service, targets, vts, { signal: controller.signal, onProgress(completed, total, group) {
        status(job, date + " 当天行程：正在一次生成" + total + "位角色（" + group.map((p) => p.name).join("、") + "）。", "停止");
      } });
      status(job, date + " 已为" + count + "位人物生成当天行程；已有行程未覆盖。");
      return count;
    };
    job.promise = (async () => {
      try { return await (navigator.locks ? navigator.locks.request("ephone-daily:" + id, { signal: controller.signal }, work) : work()); }
      catch (error) {
        status(job, date + " 行程" + (error.name === "AbortError" ? "已停止，未保存；可稍后手动生成。" : "未保存：" + error.message + "。本次只调用了一次副 API。"), "重试");
        if (signal?.aborted) throw error;
        return 0;
      } finally {
        signal?.removeEventListener("abort", abort); if (jobs.get(id) === job) jobs.delete(id);
        if (database() === db) await window.EPhoneCharacterSocial?.refresh?.();
      }
    })();
    return job.promise;
  }
  function observeSpace(vts) {
    const db = database(); if (db) seen.set(db.name, core.dayKey(vts));
    hideBanner(); statusJob = null;
  }
  function onTimeChange(before, after) {
    const db = database(); if (!db) return;
    const date = core.dayKey(after), previous = seen.get(db.name);
    seen.set(db.name, date);
    if (statusJob?.date !== date) hideBanner();
    // Independent job; replying/jumping waits for clock writes, not the API.
    // Stopping a reply must not abort daily plans already being generated.
    if (core.dayKey(before) !== date || previous && previous !== date) offerDay(after).catch(() => {});
  }
  function checkTime() {
    if (!window.ephoneAppReady) return;
    const db = database(); if (!db) return;
    const vts = now(), date = core.dayKey(vts), previous = seen.get(db.name);
    if (previous && previous !== date) onTimeChange(vts - 86400000, vts);
    else seen.set(db.name, date);
  }
  window.EPhoneCharacterDaily = { generate, ensureDay, onTimeChange, observeSpace, beforeReply: (vts) => onTimeChange(vts, vts), isBusy: () => jobs.size > 0, checkTime, positionNotices: positionBanner };
  document.addEventListener("DOMContentLoaded", () => {
    setInterval(checkTime, 15000);
    window.addEventListener("resize", positionBanner); window.visualViewport?.addEventListener("resize", positionBanner);
    const phone = document.getElementById("phone-screen");
    if (phone) new MutationObserver(positionBanner).observe(phone, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
})();
