(function () {
  "use strict";
  const core = window.ephoneImageApiCore;
  const defaults = () => ({ id: "image-api", provider: "pollinations", config: core.config(), presets: [], selectedPresetId: "", sourceName: "" });
  let adapter, row = defaults(), queue = Promise.resolve(), busy = 0, manualController, manualStamp, modelController, editSerial = 0, availableModels = [];
  const el = (name) => document.getElementById("image-api-" + name);
  const status = (text) => { if (el("status")) el("status").textContent = text; };
  const selectedCustom = () => row.provider === "custom";
  function draft() {
    return { provider: el("provider").value, config: core.config(Object.fromEntries(["baseUrl", "apiKey", "model", "protocol", "size", "quality"].map((key) => [key, el(key).value]))) };
  }
  function showProvider() { el("details").hidden = el("provider").value !== "custom"; }
  function renderModels() {
    const select = el("models"), current = el("model").value;
    select.replaceChildren(new Option(availableModels.length ? "请选择生图模型（也可手动填写）" : "请先拉取模型", ""), ...availableModels.map((model) => new Option(model, model)));
    select.disabled = !availableModels.length;
    select.value = availableModels.includes(current) ? current : "";
  }
  function clearModels() {
    modelController?.abort(); modelController = null; availableModels = [];
    el("fetch-models").disabled = false; renderModels();
  }
  function render() {
    el("provider").value = row.provider;
    for (const [key, value] of Object.entries(core.config(row.config))) el(key).value = value;
    el("preset-name").value = row.sourceName || ""; showProvider(); renderModels();
    status(selectedCustom() ? `当前生图：${row.config.model || "尚未选择模型"}${row.sourceName ? " · " + row.sourceName : ""}。配置独立保存，不随主／副 API 切换。` : "当前使用原通用绘图服务。可以选择第三方生图 API，再载入一个预设。");
  }
  function write(transform) {
    const operation = queue.catch(() => {}).then(async () => {
      const table = adapter.db.globalSettings;
      const saved = await table.db.transaction("rw", table, async () => {
        const latest = { ...defaults(), ...await table.get("image-api") };
        const next = transform(latest); await table.put(next); return next;
      });
      row = saved; return saved;
    });
    queue = operation; return operation;
  }
  async function saveDraft() {
    const patch = draft();
    await write((latest) => ({ ...latest, ...patch }));
    status("生图设置已保存。只使用选定生图接口；失败不自动换接口或重复请求。");
  }
  async function refreshPresets() {
    if (!adapter || !el("preset-select")) return;
    const generic = await adapter.db.apiPresets.toArray(), select = el("preset-select"), previous = select.value;
    select.replaceChildren(new Option("选择生图预设或已有 API 预设", ""));
    for (const [label, values, prefix] of [["独立生图预设", row.presets || [], "image:"], ["已保存的 API 预设（载入独立副本）", generic, "api:"]]) {
      const group = document.createElement("optgroup"); group.label = label;
      for (const preset of values) group.append(new Option(preset.name || "未命名预设", prefix + preset.id));
      select.append(group);
    }
    const value = previous || row.selectedPresetId;
    if ([...select.options].some((option) => option.value === value)) select.value = value;
  }
  async function usePreset() {
    const id = el("preset-select").value, serial = ++editSerial; if (!id) throw new Error("请先选择一个预设。");
    clearModels();
    await queue.catch(() => {});
    const own = id.startsWith("image:"), preset = own ? row.presets.find((p) => "image:" + p.id === id) : await adapter.db.apiPresets.get(Number(id.slice(4)));
    if (serial !== editSerial || el("preset-select").value !== id) return;
    if (!preset) throw new Error("这个预设已删除，请重新选择。");
    const c = core.snapshot(preset);
    if (!c.baseUrl || !c.apiKey) throw new Error("这个预设缺少 API 地址或密钥，原生图配置未更改。");
    await write((latest) => serial === editSerial ? { ...latest, provider: "custom", config: c, selectedPresetId: id, sourceName: preset.name || "未命名预设" } : latest);
    if (serial !== editSerial) return;
    render(); status("已使用独立副本。请确认这里选的是生图模型；原预设之后修改、删除不会影响它。");
  }
  async function savePreset(update = false) {
    const patch = draft(), name = el("preset-name").value.trim(); core.validate(patch.config);
    if (!name) throw new Error("请填写生图预设名称。");
    const selected = el("preset-select").value;
    if (update && !selected.startsWith("image:")) throw new Error("更新只覆盖独立生图预设；从普通 API 预设载入后，请先另存为生图预设。");
    const id = update ? selected.slice(6) : crypto.randomUUID();
    await write((latest) => {
      const presets = [...(latest.presets || [])], index = presets.findIndex((p) => p.id === id), preset = { id, name, config: patch.config };
      if (update && index < 0) throw new Error("这个生图预设已不存在。");
      if (index < 0) presets.push(preset); else presets[index] = preset;
      return { ...latest, ...patch, presets, selectedPresetId: "image:" + id, sourceName: name };
    });
    el("preset-select").value = ""; await refreshPresets(); status(update ? "已更新当前生图预设。主／副 API 未更改。" : "已保存独立生图预设，下次可以直接选择使用。");
  }
  async function removePreset() {
    const id = el("preset-select").value;
    if (!id.startsWith("image:")) throw new Error("这里只能删除独立生图预设，不会删除主／副 API 预设。");
    if (!window.confirm("删除这个生图预设？当前正在使用的生图配置和已有图片仍保留。")) return;
    await write((latest) => ({ ...latest, presets: latest.presets.filter((p) => "image:" + p.id !== id), selectedPresetId: latest.selectedPresetId === id ? "" : latest.selectedPresetId }));
    el("preset-select").value = ""; await refreshPresets(); status("已删除预设，当前生图配置及已有图片未变。");
  }
  async function fetchModels() {
    clearModels(); const controller = new AbortController(); modelController = controller;
    const c = draft().config, signature = JSON.stringify(c); el("fetch-models").disabled = true; status("正在拉取模型；不会测试生成图片或产生生图请求…");
    try {
      const models = await core.models(c, adapter.fetch, { signal: controller.signal });
      if (controller.signal.aborted || JSON.stringify(draft().config) !== signature) return;
      availableModels = models; renderModels();
      status(models.length ? `已拉取 ${models.length} 个模型，请点击上方“生图模型列表”选择。列表可能包含文字模型，请选择服务商支持生图的模型；也可以手动输入。` : "接口返回的模型列表为空。可以手动填写服务商支持的生图模型，或检查地址与密钥后重新拉取。");
    } catch (error) { if (!controller.signal.aborted) throw error; }
    finally { if (modelController === controller) { modelController = null; el("fetch-models").disabled = false; } }
  }
  async function generateMessage(action, settings, { signal } = {}) {
    await queue.catch(() => {});
    const fields = window.ephoneChatImages.messageFields(action);
    if (!settings?.enableAiDrawing || !selectedCustom() || fields.imageUrl) return fields;
    const c = core.config(row.config), controller = new AbortController(), stop = () => controller.abort(signal.reason);
    if (signal?.aborted) signal.throwIfAborted(); signal?.addEventListener("abort", stop, { once: true });
    let timedOut = false; const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 180000);
    const metadata = { provider: "custom", model: c.model, protocol: core.protocol(c) }; busy++;
    try {
      const imageUrl = await core.generate(c, fields.image_prompt, adapter.fetch, { signal: controller.signal });
      signal?.throwIfAborted();
      return { ...fields, imageUrl, imageGeneration: { ...metadata, status: "complete", generatedAt: Date.now() } };
    } catch (error) {
      if (signal?.aborted) throw error;
      return { ...fields, imageGeneration: { ...metadata, status: "failed", error: timedOut ? "生图请求超时。服务商可能已受理，请先查用量，再决定是否手动重试。" : core.redact(error, c) } };
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", stop); busy--; }
  }
  async function manualGenerate(button) {
    const stamp = Number(button.closest("[data-timestamp]")?.dataset.timestamp);
    if (!Number.isFinite(stamp)) return;
    if (manualController) { if (manualStamp === stamp) manualController.abort(); return; }
    if (window.isPersonaSpaceBusy?.()) throw new Error("请先停止回复或完成当前操作，再生成图片。");
    if (!adapter.settings().enableAiDrawing) throw new Error("请先开启通用 AI 生图。");
    if (!selectedCustom()) { window.showScreen("api-settings-screen"); el("provider").focus(); return; }
    const controller = new AbortController(); manualController = controller; manualStamp = stamp; busy++;
    button.textContent = "停止生成";
    try { await adapter.generateExisting(stamp, (message) => generateMessage(message, adapter.settings(), { signal: controller.signal }), controller.signal); }
    catch (error) { if (!controller.signal.aborted) throw error; }
    finally { busy--; manualController = null; manualStamp = null; if (button.isConnected) button.textContent = "使用当前生图设置生成"; }
  }
  async function init(value) {
    adapter = value;
    // Full/merge backups historically store only the main globalSettings row.
    // Consume an imported image snapshot once, without leaving a stale snapshot
    // in live settings that could overwrite later edits on every reload.
    const table = adapter.db.globalSettings;
    await table.db.transaction("rw", table, async () => {
      const main = await table.get("main");
      if (main?.ephoneImageApiSettings) { await table.put({ ...main.ephoneImageApiSettings, id: "image-api" }); delete main.ephoneImageApiSettings; await table.put(main); }
    });
    if (adapter.settings()) delete adapter.settings().ephoneImageApiSettings;
    row = { ...defaults(), ...await table.get("image-api") }; row.config = core.config(row.config); render(); await refreshPresets();
    const handle = (fn) => async () => { try { await fn(); } catch (error) { status("未完成：" + core.redact(error, draft().config)); } };
    for (const field of ["provider", "baseUrl", "apiKey", "model", "protocol", "size", "quality"]) {
      el(field).addEventListener(field === "baseUrl" || field === "apiKey" || field === "model" ? "input" : "change", async () => {
        editSerial++; showProvider();
        if (["provider", "baseUrl", "apiKey", "protocol"].includes(field)) clearModels();
        else if (field === "model") renderModels();
        try { await saveDraft(); } catch (error) { render(); status("保存失败，继续保留上次已保存设置：" + core.redact(error, draft().config)); }
      });
    }
    el("models").addEventListener("change", () => {
      if (!availableModels.includes(el("models").value)) return;
      el("model").value = el("models").value;
      el("model").dispatchEvent(new Event("input", { bubbles: true }));
    });
    el("use-preset").onclick = handle(usePreset); el("save-preset").onclick = handle(() => savePreset()); el("update-preset").onclick = handle(() => savePreset(true)); el("delete-preset").onclick = handle(removePreset);
    el("fetch-models").onclick = handle(fetchModels); el("preset-select").addEventListener("focus", () => refreshPresets().catch(() => {}));
    document.addEventListener("click", (event) => { const button = event.target.closest(".ephone-image-generate"); if (!button) return; event.preventDefault(); event.stopPropagation(); manualGenerate(button).catch((error) => window.alert(core.redact(error, row.config))); });
  }
  window.ephoneImageApi = { init, refreshPresets, selectedCustom, generateMessage, isBusy: () => busy > 0, flush: () => queue };
})();
