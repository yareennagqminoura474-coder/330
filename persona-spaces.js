(() => {
  const SPACES_KEY = "ephone-persona-spaces-v1";
  const ACTIVE_KEY = "ephone-persona-space-active";
  const DEFAULT_SPACE = { id: "default", name: "默认空间" };

  function readSpaces() {
    try {
      const saved = JSON.parse(localStorage.getItem(SPACES_KEY) || "null");
      const valid = Array.isArray(saved)
        ? saved.filter(
            (space) =>
              space &&
              typeof space.id === "string" &&
              typeof space.name === "string" &&
              /^[a-zA-Z0-9_-]+$/.test(space.id) &&
              space.name.trim(),
          )
        : [];
      const spaces = [
        DEFAULT_SPACE,
        ...valid.filter((space) => space.id !== DEFAULT_SPACE.id),
      ];
      localStorage.setItem(SPACES_KEY, JSON.stringify(spaces));
      return spaces;
    } catch {
      return [DEFAULT_SPACE];
    }
  }

  const spaces = readSpaces();
  let activeId = localStorage.getItem(ACTIVE_KEY) || DEFAULT_SPACE.id;
  if (!spaces.some((space) => space.id === activeId)) {
    activeId = DEFAULT_SPACE.id;
    localStorage.setItem(ACTIVE_KEY, activeId);
  }

  window.EPHONE_SPACE_ID = activeId;
  window.EPHONE_SPACE_NAME =
    spaces.find((space) => space.id === activeId)?.name || DEFAULT_SPACE.name;

  function makeModal() {
    const overlay = document.createElement("div");
    overlay.id = "ephone-persona-spaces-modal";
    overlay.innerHTML = `
      <section class="ephone-spaces-card" role="dialog" aria-modal="true" aria-labelledby="ephone-spaces-title">
        <header class="ephone-spaces-header">
          <div>
            <h2 id="ephone-spaces-title">人设空间</h2>
            <p>每个空间的聊天、角色、NPC、记忆和设定分别保存。</p>
          </div>
          <button type="button" class="ephone-spaces-close" aria-label="关闭">×</button>
        </header>
        <div class="ephone-spaces-list" role="list"></div>
        <div class="ephone-spaces-create">
          <label for="ephone-spaces-name">新建人设空间</label>
          <div class="ephone-spaces-create-row">
            <input id="ephone-spaces-name" type="text" maxlength="40" placeholder="例如：现代人设、修仙人设">
            <button type="button" class="ephone-spaces-create-button">新建</button>
          </div>
        </div>
        <footer class="ephone-spaces-footer">
          <span>原有资料保存在“默认空间”</span>
          <button type="button" class="ephone-spaces-done">完成</button>
        </footer>
      </section>`;

    const list = overlay.querySelector(".ephone-spaces-list");
    const close = () => overlay.classList.remove("visible");
    const render = () => {
      const currentSpaces = readSpaces();
      list.replaceChildren();
      for (const space of currentSpaces) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ephone-space-option";
        button.setAttribute("role", "listitem");
        button.innerHTML = `<span class="ephone-space-name"></span><span class="ephone-space-state"></span>`;
        button.querySelector(".ephone-space-name").textContent = space.name;
        button.querySelector(".ephone-space-state").textContent =
          space.id === activeId ? "当前空间" : "切换";
        if (space.id === activeId) button.classList.add("current");
        button.addEventListener("click", () => {
          if (space.id === activeId) return;
          if (!window.confirm(`切换到“${space.name}”并重新加载页面？`)) return;
          localStorage.setItem(ACTIVE_KEY, space.id);
          window.location.reload();
        });
        list.append(button);
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector(".ephone-spaces-close").addEventListener("click", close);
    overlay.querySelector(".ephone-spaces-done").addEventListener("click", close);
    overlay.querySelector(".ephone-spaces-create-button").addEventListener("click", () => {
      const input = overlay.querySelector("#ephone-spaces-name");
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      const currentSpaces = readSpaces();
      const id = `space_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
      currentSpaces.push({ id, name });
      localStorage.setItem(SPACES_KEY, JSON.stringify(currentSpaces));
      localStorage.setItem(ACTIVE_KEY, id);
      window.location.reload();
    });
    document.body.append(overlay);
    return { overlay, render };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const { overlay, render } = makeModal();
    const activeName = window.EPHONE_SPACE_NAME;
    for (const id of ["persona-space-button", "npc-persona-space-button"]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.textContent = activeName.length > 12 ? `${activeName.slice(0, 11)}…` : activeName;
      button.title = `当前人设空间：${activeName}（点击切换或新建）`;
      button.addEventListener("click", () => {
        render();
        overlay.classList.add("visible");
      });
    }
  });
})();
