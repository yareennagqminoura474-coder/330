(function () {
  "use strict";
  const core = window.ephoneCharacterSocialCore;
  const seen = new Map(), jobs = new Map(); let banner, statusJob, layoutPending = false;
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
    if (database() !== job.db || core.dayKey(now()) !== job.date) return;
    statusJob = job;
    if (!banner) {
      banner = document.createElement("aside"); banner.id = "daily-schedule-status"; banner.setAttribute("role", "status");
      banner.style.cssText = "position:fixed;top:90px;left:50%;transform:translateX(-50%);box-sizing:border-box;width:min(94vw,420px);z-index:90;background:#fffc;color:#263349;padding:8px 10px;border:1px solid #cbd8ee;border-radius:12px;font-size:12px;box-shadow:0 3px 16px #0002;pointer-events:none;display:flex;gap:8px;align-items:center";
      banner.innerHTML = '<span style="flex:1;min-width:0"></span><button type="button" style="pointer-events:auto;flex:none;min-height:32px"></button>'; document.body.append(banner);
    }
    banner.hidden = false; banner.style.display = "flex"; positionBanner(); banner.querySelector("span").textContent = message;
    const button = banner.querySelector("button"); button.textContent = controls || "关闭";
    button.onclick = () => {
      if (controls === "停止") job.controller.abort();
      else if (controls === "重试") ensureDay(now()).catch(() => {});
      else hideBanner();
    };
  }
  async function generate(service, targets, vts, { signal, onProgress = () => {} } = {}) {
    let completed = 0;
    try {
      for (let offset = 0; offset < targets.length; offset += 4) {
        const group = targets.slice(offset, offset + 4), snapshot = await service.snapshot();
        const grounded = await Promise.all(group.map(async (p) => {
          signal?.throwIfAborted();
          const context = await service.dailyContext(p.key, vts, snapshot);
          const lifeContinuity = window.ephoneLifeSimulationCore && service.db.tables.some((t) => t.name === "lifeSimulation") ? await new window.ephoneLifeSimulationCore.Service(service.db).dayContext(p.key, vts) : null;
          return { ...p, lifeContinuity, recentContext: context.sources };
        }));
        const prompt = core.dailyPrompt(grounded, vts, window.ephoneHolidayCalendar?.prompt(vts) || "");
        let reason = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          signal?.throwIfAborted(); onProgress(completed, targets.length, group, attempt);
          const raw = await window.EPhoneMarketAdapter.generate(prompt + (reason ? "\n上一轮未保存，原因：" + reason + "。请修正后重新返回本批所有人的完整当天行程。" : ""), signal);
          signal?.throwIfAborted();
          try { completed += await service.saveDailySchedules(raw, group, vts); break; }
          catch (error) { if (attempt || error.code !== "SOCIAL_GENERATION_INVALID") throw error; reason = error.message; }
        }
      }
      return completed;
    } catch (error) { error.completedSchedules = completed; throw error; }
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
      const count = await generate(service, targets, vts, { signal: controller.signal, onProgress(completed, total, group, attempt) {
        status(job, date + " 当天行程：已保存" + completed + "/" + total + "人，正在生成" + group.map((p) => p.name).join("、") + (attempt ? "（修正后重试）" : ""), "停止");
      } });
      status(job, date + " 已为" + count + "位人物生成当天行程；已有行程未覆盖。");
      return count;
    };
    job.promise = (async () => {
      try { return await (navigator.locks ? navigator.locks.request("ephone-daily:" + id, { signal: controller.signal }, work) : work()); }
      catch (error) {
        status(job, date + " 已保存" + (error.completedSchedules || 0) + "人；" + (error.name === "AbortError" ? "已停止，其余行程可稍后补全。" : "行程尚未完成：" + error.message), "重试");
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
    if (core.dayKey(before) !== date || previous && previous !== date) ensureDay(after).catch(() => {});
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
