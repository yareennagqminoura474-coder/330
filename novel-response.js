(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelResponse = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const fields = {
    title: ["title", "chapter_title", "novel_title", "标题", "章节标题"],
    content: ["content", "body", "chapter_content", "novel_content", "正文", "章节正文", "text"],
    summary: ["summary", "chapter_summary", "novel_summary", "摘要", "本章摘要"]
  };
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const strings = (value) => typeof value === "string" ? value : "";
  const error = () => Object.assign(new Error("返回内容中没有识别到小说正文，可查看或复制原始返回。"), { code: "NOVEL_CONTENT_MISSING" });
  const pick = (value, kind) => fields[kind].map((key) => own(value, key) ? value[key] : undefined).find((v) => typeof v === "string" && v.trim());
  const isField = (key) => Object.values(fields).some((keys) => keys.includes(key));
  const statusOnly = (value) => /^(?:(?:正在|开始|即将|准备|继续)(?:生成|创作|输出|思考|处理)|生成中|创作中|思考中|loading|processing|done|success|失败|错误|error)[\s.。…!！]*$/i.test(value.trim());
  function result(value, fallback, format, warnings = [], partial = false) {
    if (!strings(value?.content).trim() || statusOnly(value.content)) throw error();
    return { title: strings(value.title).trim() || fallback || "未命名章节", content: value.content,
      summary: strings(value.summary), format, warnings, partial };
  }
  // Imported strings are data. This parser never evaluates code or renders HTML.
  function fromValue(value, depth = 0) {
    if (depth > 12 || value == null) return null;
    if (typeof value === "string") {
      try { return fromValue(JSON.parse(value), depth + 1); } catch { return value.trim() ? { content: value } : null; }
    }
    if (Array.isArray(value)) {
      const parts = value.filter((part) => part?.thought !== true && !["thinking", "reasoning", "thought_chain", "analysis"].includes(part?.type)).map((part) => typeof part === "string" ? { content: part } : fromValue(part, depth + 1)).filter((part) => part?.content?.trim());
      return parts.length ? { title: parts.find((p) => p.title)?.title, content: parts.map((p) => p.content).join("\n\n"), summary: parts.map((p) => p.summary).filter(Boolean).join("\n\n") } : null;
    }
    if (typeof value !== "object") return null;
    const content = pick(value, "content");
    if (typeof content === "string") return { title: pick(value, "title"), content, summary: pick(value, "summary") };
    for (const key of fields.content) if (Array.isArray(value[key]) || value[key] && typeof value[key] === "object") {
      const nested = fromValue(value[key], depth + 1);
      if (nested?.content?.trim()) return { ...nested, title: pick(value, "title") || nested.title, summary: pick(value, "summary") || nested.summary };
    }
    for (const key of ["chapter", "novel", "result", "data", "response", "answer", "output", "chapters", "messages", "replies"]) {
      if (!own(value, key)) continue;
      const nested = fromValue(value[key], depth + 1); if (nested?.content?.trim()) return nested;
    }
    return null;
  }
  function skip(text, at) { while (at < text.length && /\s/.test(text[at])) at++; return at; }
  function quoted(text, start, value = false) {
    const quote = text[start]; let content = "";
    for (let i = start + 1; i < text.length; i++) {
      const c = text[i];
      if (c === quote && (!value || valueBoundary(text, i + 1))) return { value: content, end: i + 1, complete: true };
      if (c !== "\\") { content += c; continue; }
      const next = text[++i], escapes = { '"': '"', "'": "'", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (next === undefined) { content += "\\"; break; }
      if (next === "u" && /^[a-f\d]{4}$/i.test(text.slice(i + 1, i + 5))) { content += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)); i += 4; }
      else content += own(escapes, next) ? escapes[next] : "\\" + next;
    }
    return { value: content, end: text.length, complete: false };
  }
  function keyAt(text, at) {
    if (text[at] === '"' || text[at] === "'") {
      const key = quoted(text, at); if (!key.complete) return null;
      const colon = skip(text, key.end); return text[colon] === ":" ? { key: key.value, end: colon + 1 } : null;
    }
    const match = text.slice(at).match(/^([a-z_\u3400-\u9fff][\w\u3400-\u9fff]*)\s*:/i);
    return match ? { key: match[1], end: at + match[0].length } : null;
  }
  function valueBoundary(text, after) {
    let at = skip(text, after);
    if (at === text.length || text.startsWith("```", at)) return true;
    if (text[at] === ",") return !!keyAt(text, skip(text, at + 1)) || /^[}\]]/.test(text.slice(skip(text, at + 1)));
    if (text[at] !== "}" && text[at] !== "]") return false;
    while (at < text.length && /[\s}\]]/.test(text[at])) at++;
    return at === text.length || text.startsWith("```", at) || /[,\[{]/.test(text[at]);
  }
  function container(text, start) {
    const stack = []; let quote = "", escaped = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (quote) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === quote) quote = ""; continue; }
      if (c === '"') { quote = c; continue; }
      if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") { if (stack.pop() !== (c === "}" ? "{" : "[")) return { end: i + 1, complete: false }; if (!stack.length) return { end: i + 1, complete: true }; }
    }
    return { end: text.length, complete: false };
  }
  function roots(text) {
    const found = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "{" && text[i] !== "[") continue;
      const next = skip(text, i + 1);
      if (text[i] === "{" && text[next] !== "}" && !keyAt(text, next)) continue;
      if (text[i] === "[" && !/[{\[\]"]/.test(text[next] || "")) continue;
      const token = container(text, i);
      found.push({ start: i, ...token });
      if (!token.complete) break;
      i = token.end - 1;
    }
    return found;
  }
  // Tolerate unescaped dialogue quotes and literal line breaks in JSON strings.
  // A value quote ends only at actual field/container syntax, not mid-sentence.
  function recover(text, start) {
    if (text[start] !== "{") return null;
    const value = {}, incomplete = new Set(); let i = start + 1, sawField = false;
    while (i < text.length) {
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      if (text[i] === "}") break;
      const field = keyAt(text, i); if (!field) break;
      sawField = true; i = skip(text, field.end);
      if (text[i] === '"' || text[i] === "'") {
        const token = quoted(text, i, true);
        if (isField(field.key)) { value[field.key] = token.value; if (!token.complete) incomplete.add(field.key); }
        i = token.end;
      } else if (text[i] === "{" || text[i] === "[") {
        const token = container(text, i);
        try { value[field.key] = JSON.parse(text.slice(i, token.end)); } catch {}
        i = token.end;
      } else {
        // Do not reinterpret metadata booleans/numbers as a chapter body.
        const next = text.slice(i).search(/[,}\n]/); if (next < 0) break; i += next;
      }
    }
    const chapter = sawField && fromValue(value);
    return chapter?.content?.trim() ? { value: chapter, partial: fields.content.some((key) => incomplete.has(key)) } : null;
  }
  function stripThinking(raw) {
    let text = raw.replace(/^\uFEFF/, "");
    // Only leading reasoning blocks are transport wrappers; literal tags within
    // a novel are preserved. An unfinished reasoning-only block is not prose.
    while (/^\s*<(?:think|thinking|analysis)\b/i.test(text)) {
      const start = text.match(/^\s*<(think|thinking|analysis)\b[^>]*>/i), close = start && new RegExp("</" + start[1] + "\\s*>", "i").exec(text.slice(start[0].length));
      if (!close) throw error();
      text = text.slice(start[0].length + close.index + close[0].length);
    }
    return text;
  }
  function tags(text, fallback) {
    const opening = /<novel_content\b[^>]*>/ig, pieces = []; let match, title = "", summary = "", partial = false;
    while ((match = opening.exec(text))) {
      const start = match.index + match[0].length, tail = text.slice(start), closing = /<\/novel_content\s*>/i.exec(tail);
      let end;
      if (closing) end = start + closing.index;
      else { const next = /<(?:novel_summary|novel_title)\b[^>]*>/i.exec(tail); end = next ? start + next.index : text.length; partial = !next; }
      pieces.push(text.slice(start, end)); opening.lastIndex = closing ? end + closing[0].length : end;
      if (!closing && end === text.length) break;
    }
    if (!pieces.length) return null;
    const read = (name) => new RegExp("<" + name + "\\b[^>]*>([\\s\\S]*?)</" + name + "\\s*>", "i").exec(text)?.[1] || "";
    title = read("novel_title"); summary = read("novel_summary");
    return result({ title, content: pieces.join("\n\n"), summary }, fallback, "tags", partial ? ["返回的正文没有结束标记，已保留实际收到的文字；结尾可能未完成。"] : [], partial);
  }
  function parse(raw, fallbackTitle = "未命名章节") {
    if (raw && typeof raw === "object") return result(fromValue(raw), fallbackTitle, "json");
    if (typeof raw !== "string" || !raw.trim()) throw error();
    const text = stripThinking(raw), trimmed = text.trim();
    const fence = /^\s*```(?:json|xml|text|markdown|md|novel|javascript|js)?(?:[ \t]*\r?\n|[ \t]*(?=[{\[]))/i.exec(text);
    const payload = fence ? text.slice(fence[0].length).replace(/\r?\n?```[ \t]*\s*$/, "") : text;
    const tagged = tags(payload, fallbackTitle); if (tagged) return tagged;
    const whole = payload.trim();
    try { const value = JSON.parse(whole), parsed = fromValue(value); return result(parsed, fallbackTitle, "json"); }
    catch (err) { if (err.code === "NOVEL_CONTENT_MISSING") throw err; }
    const fragments = roots(whole), first = fragments[0]?.start;
    const prefix = first != null ? whole.slice(0, first).trim() : "";
    const structured = /^[{\[]/.test(whole) || /```\s*json\b/i.test(text) || first != null &&
      (!prefix || /^(?:好的[，,。\s]*)?(?:以下|下面|这是|这里|已|请查收|Here|The following|Sure)[\s\S]*[:：。.!！]?$/i.test(prefix) && prefix.length < 220);
    if (structured) {
      const candidates = [];
      for (const fragment of fragments) {
        if (fragment.complete) {
          try { const value = fromValue(JSON.parse(whole.slice(fragment.start, fragment.end))); if (value?.content?.trim()) { candidates.push({ value, partial: false, recovered: false }); continue; } } catch {}
        }
        const value = recover(whole, fragment.start); if (value) candidates.push({ ...value, recovered: true });
      }
      if (candidates.length) {
        const recovered = candidates.some((v) => v.recovered), partial = candidates.some((v) => v.partial);
        return result({ title: candidates.find((v) => v.value.title)?.value.title, content: candidates.map((v) => v.value.content).join("\n\n"), summary: candidates.map((v) => v.value.summary).filter(Boolean).join("\n\n") }, fallbackTitle, recovered ? "recovered-json" : "json", recovered ? ["已在本地修复返回格式并保留正文，没有再次请求 API。", ...(partial ? ["只保留了实际收到的正文，结尾可能未完成。"] : [])] : [], partial);
      }
      throw error();
    }
    if (/^\s*```(?:javascript|js|html|css|python|sql)\b/i.test(text) || /^\s*(?:<!doctype\b|<html\b|(?:const|let|var)\s+\w+\s*=|function\s+\w+\s*\()/i.test(text)) throw error();
    if (/^\s*(?:<novel_(?:title|summary)>|\{?\s*"?(?:title|summary|标题|摘要)"?\s*:)/i.test(text)) throw error();
    if (statusOnly(trimmed)) throw error();
    if (!whole.trim()) throw error();
    const heading = /^(?:#{1,3}\s+([^\r\n]+)|([^\r\n]{1,90}第[一二三四五六七八九十百千\d]+章[^\r\n]*))/m.exec(whole);
    return result({ title: heading?.[1] || heading?.[2], content: payload, summary: "" }, fallbackTitle, "text", ["服务商返回了普通正文，已直接保留；未额外调用 API 整理格式。"]);
  }
  return Object.freeze({ parse });
});
