(function (root) {
  "use strict";
  const MISSING_AUXILIARY = "副 API 尚未配置完整。请到设置中的「副 API」载入已保存预设，或填写密钥和模型。本次不会改用主 API。";
  const clean = (v) => typeof v === "string" ? v.trim() : "";
  function select(config, purpose) {
    if (!["reply", "novel", "auxiliary"].includes(purpose)) throw new Error("未知 API 任务类型，已停止请求。");
    const secondary = purpose === "auxiliary", result = {
      proxyUrl: clean(config?.[secondary ? "secondaryProxyUrl" : "proxyUrl"]) || "https://api.openai.com",
      apiKey: clean(config?.[secondary ? "secondaryApiKey" : "apiKey"]),
      model: clean(config?.[secondary ? "secondaryModel" : "model"])
    };
    if (!result.apiKey || !result.model) throw Object.assign(new Error(secondary ? MISSING_AUXILIARY : "请先配置主 API 的密钥和模型。"), { code: secondary ? "AUXILIARY_API_MISSING" : "PRIMARY_API_MISSING" });
    return result;
  }
  function presetSnapshot(preset, normalize = clean, selectedAt = Date.now()) {
    const connection = { proxyUrl: normalize(clean(preset?.proxyUrl)) || "https://api.openai.com", apiKey: clean(preset?.apiKey), model: clean(preset?.model) };
    if (!connection.apiKey || !connection.model) throw new Error("这个预设没有完整的主 API 密钥和模型，请先补全预设；原副 API 没有改动。");
    return { secondaryProxyUrl: connection.proxyUrl, secondaryApiKey: connection.apiKey, secondaryModel: connection.model,
      secondaryPresetSnapshot: { id: preset.id ?? null, name: clean(preset.name) || "未命名预设", selectedAt } };
  }
  const api = { select, presetSnapshot, MISSING_AUXILIARY };
  root.ephoneApiRoutingCore = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
