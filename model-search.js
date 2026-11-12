(function () {
  "use strict";
  const labels = {
    "model-select": "主 API 模型",
    "secondary-model-select": "副 API 模型",
    "image-api-models": "生图模型",
    "minimax-model-select": "语音模型"
  };
  let activeSelect, observer, opener;
  const dialog = document.createElement("dialog");
  dialog.className = "model-search-dialog";
  dialog.setAttribute("aria-labelledby", "model-search-title");
  dialog.innerHTML = `<div class="model-search-header"><strong id="model-search-title">选择模型</strong><button type="button" class="model-search-close" aria-label="关闭模型搜索">关闭</button></div>
    <input type="search" class="model-search-input" placeholder="搜索模型名称…" aria-label="搜索模型名称" autocomplete="off">
    <div class="model-search-count" role="status" aria-live="polite"></div>
    <div class="model-search-results" role="group" aria-label="匹配的模型"></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector("input"), results = dialog.querySelector(".model-search-results"), count = dialog.querySelector(".model-search-count");
  function render() {
    if (!activeSelect) return;
    const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const all = [...activeSelect.options].filter((option) => option.value && !option.disabled && !option.parentElement.disabled);
    const matches = all.filter((option) => terms.every((term) => (option.textContent + " " + option.value).toLocaleLowerCase().includes(term)));
    count.textContent = all.length ? `找到 ${matches.length} / ${all.length} 个模型` : "请先关闭此窗口，点击“拉取”获取模型。";
    const fragment = document.createDocumentFragment();
    for (const option of matches) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-search-option";
      button.textContent = option.textContent;
      button.setAttribute("aria-pressed", String(option.selected));
      button.addEventListener("click", () => {
        if (!activeSelect || activeSelect.disabled || !activeSelect.contains(option)) return;
        const select = activeSelect;
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        dialog.close();
      });
      fragment.append(button);
    }
    if (all.length && !matches.length) {
      const empty = document.createElement("p");
      empty.textContent = "没有匹配的模型，请换个关键词或清空搜索。";
      fragment.append(empty);
    }
    results.replaceChildren(fragment);
  }
  function open(select) {
    if (select.disabled || dialog.open) return;
    activeSelect = select; opener = select;
    input.value = "";
    dialog.querySelector("strong").textContent = labels[select.id];
    render();
    observer = new MutationObserver(() => { if (select.disabled) dialog.close(); else render(); });
    observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true });
    dialog.showModal();
    results.scrollTop = 0;
    input.focus();
  }
  input.addEventListener("input", () => { render(); results.scrollTop = 0; });
  dialog.querySelector(".model-search-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { observer?.disconnect(); activeSelect = null; opener?.focus({ preventScroll: true }); });
  for (const id of Object.keys(labels)) {
    const select = document.getElementById(id);
    if (!select) continue;
    select.setAttribute("aria-label", labels[id] + "，点击搜索选择");
    // Keep the original select as the saved value and change-event source.
    select.addEventListener("pointerdown", (event) => { if (event.button === 0 && !select.disabled) event.preventDefault(); });
    select.addEventListener("mousedown", (event) => event.preventDefault());
    select.addEventListener("click", (event) => { event.preventDefault(); open(select); });
    select.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); open(select); }
    });
  }
})();
