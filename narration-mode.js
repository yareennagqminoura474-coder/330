(function () {
  "use strict";

  const narrationTypeAliases = new Set([
    "narration",
    "narrative",
    "state",
    "action",
    "act",
    "scene",
    "描述",
    "旁白",
    "动描",
    "動描",
    "动作",
    "動作",
    "动作描写",
    "動作描寫",
  ]);

  function getMessageText(item) {
    for (const key of ["content", "message", "c"]) {
      if (typeof item[key] === "string") return item[key];
    }
    return "";
  }

  function withText(item, type, text) {
    const next = { ...item, type, content: text.trim() };
    if (Object.prototype.hasOwnProperty.call(next, "message"))
      next.message = next.content;
    if (Object.prototype.hasOwnProperty.call(next, "c")) next.c = next.content;
    if (!next.name && typeof next.n === "string") next.name = next.n;
    return next;
  }

  function stripNarrationMarker(text) {
    return text
      .replace(/^\s*\[(?:NARRATION|STATE|旁白|动作|動作)\]\s*[:：]?\s*/i, "")
      .replace(/^\s*〈(?:past-)?narration(?:\s*[\xb7:：]\s*)?/i, "")
      .replace(/〉\s*$/, "")
      .trim();
  }

  function isMarkedNarration(text) {
    return /^\s*(?:\[(?:NARRATION|STATE|旁白|动作|動作)\]|〈(?:past-)?narration\b)/i.test(
      text,
    );
  }

  function isNumericDetail(text) {
    const value = text.normalize("NFKC").trim();
    // Amounts, quantities, sizes, dates and arithmetic are dialogue details,
    // not stage directions. Do not exempt actions merely because they contain
    // a number: “等了10分钟，拿起手机” must still be narration.
    return /[\d零〇一二两三四五六七八九十百千万亿]/.test(value) &&
      /^(?:(?:价格|单价|总价|合计|总计|金额|约|共|含税|规格|数量|尺寸|码数)\s*[:：]?\s*)?(?:[\d零〇一二两三四五六七八九十百千万亿\s.,，、:：;；+\-–—~～×xX*÷/=<>≤≥%‰¥￥$€£°℃²³]|元|块|角|分|钱|人民币|美元|港币|每|到|至|起|含|税|个|件|份|盒|箱|袋|包|瓶|罐|杯|碗|盘|斤|公斤|千克|克|毫升|升|厘米|毫米|米|码|寸|英寸|年|月|日|号|天|小时|分钟|秒|折|成|万|亿|kg|mg|ml|cm|mm|gb|tb|mah|mb|hz|[gLlMmWwVv])+$/.test(value);
  }

  function isActionMarker(mark, text, index) {
    if (mark.startsWith("**")) return false; // Markdown bold, never an action delimiter.
    if (isNumericDetail(mark.slice(1, -1))) return false;
    // “三文鱼*1、排骨*1” uses multiplication, not paired action stars.
    if (mark[0] === "*" && /[\p{L}\p{N})）]\s*$/u.test(text.slice(0, index)) && /^\*\s*\d/.test(mark)) return false;
    return true;
  }

  // 先靠 type 区分，再兜底兼容（动作）/*动作*/；数字和排版不转为动作。
  function splitMarkedActions(item, text) {
    // Mask non-action star spans before looking for paired action delimiters.
    // Otherwise a multiplication star can pair with the next action's opener.
    let scan = text.replace(/(?<!\*)(\*{1,2})(?!\*)[^*\r\n]{1,1000}\1(?!\*)/g, (mark) => {
      const inner = mark.slice(1, -1);
      return mark.startsWith("**") || (isNumericDetail(inner) && !/[，,、:：;；]\s*$/.test(inner)) ? "\0".repeat(mark.length) : mark;
    });
    scan = scan.replace(/([\p{L}\p{N})）])([ \t]*)\*(?=\s*\d)/gu, (mark) => mark.slice(0, -1) + "\0");
    const markerPattern =
      /(?:（[^（）\r\n]{1,1000}）|\([^()\r\n]{1,1000}\)|(?<!\*)(\*{1,2})(?!\*)[^*\r\n]{1,1000}\1(?!\*))/g;
    const parts = [];
    let cursor = 0;
    let match;
    let foundMarker = false;

    while ((match = markerPattern.exec(scan))) {
      const marker = text.slice(match.index, markerPattern.lastIndex);
      if (!isActionMarker(marker, text, match.index)) {
        continue;
      }
      foundMarker = true;
      const before = text.slice(cursor, match.index).trim();
      if (before) parts.push(withText(item, "text", before));

      const action = marker
        .replace(/^(?:（|\(|\*)|(?:）|\)|\*)$/g, "")
        .trim();
      if (action) parts.push(withText(item, "narration", action));
      cursor = markerPattern.lastIndex;
    }

    if (!foundMarker) return [item];

    const after = text.slice(cursor).trim();
    if (after) parts.push(withText(item, "text", after));
    return parts.length ? parts : [item];
  }

  function splitQuotedDialogue(item, text) {
    const quotePattern = /“([^”\r\n]+)”|「([^」\r\n]+)」|『([^』\r\n]+)』/g;
    const matches = Array.from(text.matchAll(quotePattern));
    if (!matches.length) return null;

    const outside = text.replace(quotePattern, " ").trim();
    const name = String(item.name || item.n || "").trim();
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const subjectPattern = new RegExp(
      `^(?:${escapedName ? escapedName + "|" : ""}他|她|TA|对方|男人|女人|少年|少女|空气|房间|屋内|窗外|门外|走廊|厨房|客厅|夜色|雨声|风声|灯光|屏幕)`,
      "i",
    );
    const actionWords =
      /(?:目光|眼神|眉|嘴角|抬|低头|垂|抿|偏头|侧身|看向|盯|望|转身|起身|坐|站|走|拿|放|推|拉|握|攅|敲|打字|输入|按下|点击|叹|笑|哭|皱|摇头|点头|挑眉|沉默|停顿|开口|说道|问道|答道|淡淡|冷冷|声音|呼吸|心想|心里|内心|正在|继续|缓缓|轻轻|默默|下意识|不由得|伸手|擦|切|穿|关|开)/;
    if (!outside || !subjectPattern.test(outside) || !actionWords.test(outside))
      return null;

    const parts = [];
    let cursor = 0;
    for (const quote of matches) {
      const before = text
        .slice(cursor, quote.index)
        .replace(/[，,：:]\s*$/, "")
        .trim();
      if (before) parts.push(withText(item, "narration", before));
      const dialogue = (quote[1] || quote[2] || quote[3] || "").trim();
      if (dialogue) parts.push(withText(item, "text", dialogue));
      cursor = quote.index + quote[0].length;
    }
    const after = text.slice(cursor).trim();
    if (after) parts.push(withText(item, "narration", after));
    return parts;
  }

  function normalizeEPhoneNarrationOutput(items) {
    if (!Array.isArray(items)) return items;

    return items.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        return [item];

      const rawType = String(item.type || item.t || "").trim();
      const normalizedType = rawType.toLowerCase();
      // Operational events may contain parenthesized actions, but must not be
      // converted into display-only narration or their side effects are lost.
      if (["market_order_share", "market_phone_check", "market_order_arrived", "cancel_market_order", "wallet_income", "wallet_expense", "life_update", "relationship_event"].includes(normalizedType)) return [item];
      const text = getMessageText(item).trim();

      if (narrationTypeAliases.has(normalizedType) || isMarkedNarration(text)) {
        return text
          ? [withText(item, "narration", stripNarrationMarker(text))]
          : [];
      }

      if (normalizedType !== "text" || !text) return [item];

      const markedParts = splitMarkedActions(item, text);
      if (markedParts.length !== 1 || markedParts[0] !== item)
        return assignSceneTiming(markedParts, item);

      const quotedParts = splitQuotedDialogue(item, text);
      return quotedParts ? assignSceneTiming(quotedParts, item) : [item];
    });
  }

  function assignSceneTiming(parts, source) {
    // Splitting one mixed dialogue/action must not repeat one scene's elapsed
    // minutes on every fragment. Preserve its timing once, at the first action.
    const keys = ["scene_elapsed_minutes", "scene_time_reason", "scene_phase", "scene_time", "scene_location"];
    if (!keys.some((key) => Object.prototype.hasOwnProperty.call(source, key))) return parts;
    const owner = Math.max(0, parts.findIndex((part) => part.type === "narration"));
    const explicit = window.ephoneTimeMachine?.elapsedSceneMinutes?.(getMessageText(source));
    return parts.map((part, index) => {
      if (index === owner) return part;
      const next = { ...part };
      for (const key of keys) delete next[key];
      next.ephoneSceneTimingCovered = true;
      next.ephoneSceneTimingExplicit = explicit != null && explicit > 0;
      return next;
    });
  }

  // 主程序的 AI 回复解析器会调用这个全局兼容层。
  window.normalizeEPhoneNarrationOutput = normalizeEPhoneNarrationOutput;

  function initNarrationMode() {
    const button = document.getElementById("narration-mode-btn");
    const input = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-btn");
    const inputArea = document.getElementById("chat-input-area");
    const messages = document.getElementById("chat-messages");
    const chatTitle = document.getElementById("chat-header-title");
    const backButton = document.getElementById("back-to-list-btn");

    if (!button || !input || !sendButton || !inputArea || !messages) return;

    let sendAsNarration = false;
    const normalPlaceholder =
      input.getAttribute("placeholder") || "输入消息...";

    function setNarrationMode(enabled) {
      sendAsNarration = Boolean(enabled);
      button.classList.toggle("active", sendAsNarration);
      button.setAttribute("aria-pressed", String(sendAsNarration));
      button.setAttribute(
        "aria-label",
        sendAsNarration ? "关闭旁白" : "旁白模式",
      );
      button.title = sendAsNarration ? "关闭旁白" : "旁白模式";
      inputArea.classList.toggle("narration-mode-active", sendAsNarration);
      input.placeholder = sendAsNarration ? "输入旁白..." : normalPlaceholder;
    }

    function markNarrationBubbles(root) {
      const scope = root && root.querySelectorAll ? root : messages;
      const spans = scope.querySelectorAll(
        '.message-wrapper.system-pat .message-bubble.system-bubble > span[style*="font-style"]',
      );

      spans.forEach((span) => {
        const bubble = span.parentElement;
        const wrapper = bubble && bubble.parentElement;
        if (
          !bubble ||
          !wrapper ||
          !/italic/i.test(span.getAttribute("style") || "")
        )
          return;
        bubble.classList.add("narration-bubble");
        wrapper.classList.add("narration-wrapper");
      });
    }

    // 兼容升级前已经落库的“纯动作气泡”，打开旧聊天时也立即按旁白显示。
    function markLegacyActionBubbles(root) {
      const scope = root && root.querySelectorAll ? root : messages;
      const actionBubbles = scope.querySelectorAll(
        ".message-wrapper.ai .message-bubble.ai:not(.is-card-like)",
      );
      const fullActionPattern =
        /^(?:（[^（）\r\n]{1,1000}）|\([^()\r\n]{1,1000}\)|\*[^*\r\n]{1,1000}\*)$/;

      actionBubbles.forEach((bubble) => {
        if (bubble.dataset.messageKindOverride === "text") return;
        const content = bubble.querySelector(":scope > .content");
        const rawText = content ? content.textContent.trim() : "";
        if (!fullActionPattern.test(rawText) || !isActionMarker(rawText, rawText, 0)) return;

        const narrationText = rawText
          .replace(/^(?:（|\(|\*)|(?:）|\)|\*)$/g, "")
          .trim();
        if (!narrationText) return;

        const wrapper = bubble.closest(".message-wrapper");
        if (!wrapper) return;
        const senderName = wrapper.querySelector(":scope > .sender-name");
        if (senderName) senderName.remove();

        const span = document.createElement("span");
        span.style.cssText = "font-style:italic; opacity:0.9;";
        span.textContent = narrationText;
        bubble.replaceChildren(span);
        bubble.className = "message-bubble system-bubble narration-bubble";
        wrapper.classList.remove("ai");
        wrapper.classList.add("system-pat", "narration-wrapper");
      });
    }

    button.addEventListener("click", function () {
      setNarrationMode(!sendAsNarration);
      input.focus();
    });

    // EPhone 原有的 /n 发送路径负责落库、历史兼容和私聊/群聊共用逻辑。
    // 捕获阶段仅把当前输入标记成旁白，再交回原发送处理器。
    sendButton.addEventListener(
      "click",
      function () {
        const text = input.value.trim();
        if (!sendAsNarration || !text || /^(?:\/n|\/旁白)\s+/i.test(text))
          return;
        input.value = "/n " + text;
      },
      true,
    );

    button.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      button.click();
    });

    if (backButton)
      backButton.addEventListener("click", function () {
        setNarrationMode(false);
      });

    if (chatTitle) {
      let currentTitle = chatTitle.textContent;
      new MutationObserver(function () {
        if (chatTitle.textContent === currentTitle) return;
        currentTitle = chatTitle.textContent;
        setNarrationMode(false);
      }).observe(chatTitle, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    markLegacyActionBubbles(messages);
    markNarrationBubbles(messages);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            markLegacyActionBubbles(node);
            markNarrationBubbles(node);
          }
        });
      });
    }).observe(messages, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNarrationMode, {
      once: true,
    });
  } else {
    initNarrationMode();
  }
})();
