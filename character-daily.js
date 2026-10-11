(function () {
  "use strict";
  const core = window.ephoneCharacterSocialCore;
  const seen = new Map(); let running = null, banner;
  const database = () => window.db?.characterLives?.db;
  const now = () => window.ephoneTimeMachine?.nowMs() ?? Date.now();
  function status(message, controls = "") {
    if (!banner) {
      banner = document.createElement("aside"); banner.id = "daily-schedule-status"; banner.setAttribute("role", "status");
      banner.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);width:min(94vw,420px);z-index:100000;background:#fff;color:#263349;padding:12px;border:1px solid #cbd8ee;border-radius:12px;font-size:12px;box-shadow:0 3px 16px #0002";
      banner.innerHTML = '<span></span><button type="button"></button>'; document.body.append(banner);
    }
    banner.hidden = false; banner.querySelector("span").textContent = message;
    const button = banner.querySelector("button"); button.textContent = controls || "关闭";
    button.onclick = () => {
      if (controls === "停止") running?.controller.abort();
      else if (controls === "重试") { if (window.isPersonaSpaceBusy?.()) return; ensureDay(now()).catch(() => {}); }
      else banner.hidden = true;
    };
  }
  async function generate(service, targets, vts, { signal, onProgress = () => {} } = {}) {
    let completed = 0;
    try {
      for (let offset = 0; offset < targets.length; offset += 4) {
        const group = targets.slice(offset, offset + 4);
        const grounded = await Promise.all(group.map(async (p) => {
          signal?.throwIfAborted();
          const context = await service.context(p.key);
          const lifeContinuity = window.ephoneLifeSimulationCore && service.db.tables.some((t) => t.name === "lifeSimulation") ? await new window.ephoneLifeSimulationCore.Service(service.db).dayContext(p.key, vts) : null;
          return { ...p, lifeContinuity, recentContext: context.sources.filter((s) => Number(s.vts) <= vts).sort((a, b) => Number(b.vts) - Number(a.vts)).slice(0, 16) };
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
    if (running) return running.id === id ? running.promise : 0;
    const controller = new AbortController(), abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
    const job = { id, controller }; running = job;
    const work = async () => {
      controller.signal.throwIfAborted();
      const service = new core.Service(db), targets = await service.dailyTargets(vts);
      if (!targets.length) return 0;
      const count = await generate(service, targets, vts, { signal: controller.signal, onProgress(completed, total, group, attempt) {
        status(date + " 当天行程：已保存" + completed + "/" + total + "人，正在生成" + group.map((p) => p.name).join("、") + (attempt ? "（修正后重试）" : ""), "停止");
      } });
      status(date + " 已为" + count + "位人物生成当天行程；已有行程未覆盖。");
      return count;
    };
    job.promise = (async () => {
      try { return await (navigator.locks ? navigator.locks.request("ephone-daily:" + id, { signal: controller.signal }, work) : work()); }
      catch (error) {
        status(date + " 已保存" + (error.completedSchedules || 0) + "人；" + (error.name === "AbortError" ? "已停止，其余行程可稍后补全。" : "行程尚未完成：" + error.message), "重试");
        if (signal?.aborted) throw error;
        return 0;
      } finally {
        signal?.removeEventListener("abort", abort); if (running === job) running = null;
        await window.EPhoneCharacterSocial?.refresh?.();
      }
    })();
    return job.promise;
  }
  function observeSpace(vts) {
    const db = database(); if (db) seen.set(db.name, core.dayKey(vts));
    if (banner) banner.hidden = true;
  }
  async function onTimeChange(before, after, options = {}) {
    const db = database(); if (!db) return;
    const date = core.dayKey(after), previous = seen.get(db.name);
    seen.set(db.name, date);
    if (core.dayKey(before) !== date || previous && previous !== date) return ensureDay(after, options);
  }
  async function checkTime() {
    if (!window.ephoneAppReady || window.isPersonaSpaceBusy?.()) return;
    const db = database(); if (!db) return;
    const vts = now(), date = core.dayKey(vts), previous = seen.get(db.name);
    seen.set(db.name, date);
    if (previous && previous !== date) await ensureDay(vts);
  }
  window.EPhoneCharacterDaily = { generate, ensureDay, onTimeChange, observeSpace, beforeReply: (vts, options) => onTimeChange(vts, vts, options), isBusy: () => Boolean(running), checkTime };
  document.addEventListener("DOMContentLoaded", () => setInterval(() => checkTime().catch(() => {}), 15000));
})();
