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

  function databaseNameFor(spaceId) {
    const baseName = window.EPHONE_DB_BASE_NAME;
    if (!baseName) throw new Error("当前空间数据库尚未准备好，请稍后再试。");
    return spaceId === "default" ? baseName : `${baseName}__space_${spaceId}`;
  }

  function cloneRecord(value) {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function recordBelongsToChat(tableName, record, chatId) {
    const id = String(chatId);
    const relatedFields =
      tableName === "qzonePosts"
        ? ["authorId", "characterId", "chatId"]
        : ["chatId", "characterId", "contactId", "targetChatId", "authorId"];
    const matches = (value) => value != null && String(value) === id;
    if (relatedFields.some((field) => matches(record[field]))) return true;
    const content = record.content;
    return Boolean(
      content &&
        typeof content === "object" &&
        ["chatId", "characterId", "authorId"].some((field) =>
          matches(content[field]),
        ),
    );
  }

  async function moveChatData(chatId, targetSpaceId) {
    const source = window.db;
    if (!source || !window.Dexie) throw new Error("数据库还在加载，请稍后再试。");
    if (!chatId || targetSpaceId === activeId)
      throw new Error("请选择另一个空间作为目标。");

    const chat = await source.chats.get(chatId);
    if (!chat) throw new Error("找不到这个角色的聊天资料。");
    if (chat.isGroup) throw new Error("群聊暂不支持移动到其他空间。");

    const sideTableNames = ["favorites", "memories", "callRecords", "qzonePosts"];
    const relatedRows = {};
    for (const name of sideTableNames) {
      const table = source.table(name);
      if (!table) continue;
      relatedRows[name] = (await table.toArray()).filter((record) =>
        recordBelongsToChat(name, record, chatId),
      );
    }

    const stores = Object.fromEntries(
      source.tables.map((table) => {
        const indexes = table.schema.indexes
          .map((index) => index.src)
          .filter(Boolean);
        return [table.name, [table.schema.primKey.src, ...indexes].join(", ")];
      }),
    );
    const target = new window.Dexie(databaseNameFor(targetSpaceId));
    target.version(source.verno).stores(stores);
    const tableNames = [
      "chats",
      ...Object.keys(relatedRows).filter((name) => relatedRows[name].length),
    ];
    const targetTables = tableNames.map((name) => target.table(name));
    const insertedKeys = { chats: [] };

    try {
      await target.open();
      await target.transaction("rw", ...targetTables, async () => {
        if (await target.chats.get(chatId))
          throw new Error("目标空间已经存在同一个角色记录，未进行移动。");
        await target.chats.add(cloneRecord(chat));
        insertedKeys.chats.push(chatId);

        for (const name of tableNames.slice(1)) {
          const sourceTable = source.table(name);
          const targetTable = target.table(name);
          const keyPath = sourceTable.schema.primKey.keyPath;
          const isAutoKey = sourceTable.schema.primKey.auto;
          insertedKeys[name] = [];
          for (const record of relatedRows[name]) {
            const copy = cloneRecord(record);
            if (isAutoKey && typeof keyPath === "string") delete copy[keyPath];
            insertedKeys[name].push(await targetTable.add(copy));
          }
        }
      });

      const sourceTables = tableNames.map((name) => source.table(name));
      await source.transaction("rw", ...sourceTables, async () => {
        await source.chats.delete(chatId);
        for (const name of tableNames.slice(1)) {
          const table = source.table(name);
          const keyPath = table.schema.primKey.keyPath;
          if (typeof keyPath !== "string") continue;
          for (const record of relatedRows[name]) {
            if (record[keyPath] != null) await table.delete(record[keyPath]);
          }
        }
      });
      return true;
    } catch (error) {
      try {
        if (target.isOpen()) {
          await target.transaction("rw", ...targetTables, async () => {
            for (const [name, keys] of Object.entries(insertedKeys)) {
              const table = target.table(name);
              for (const key of keys) await table.delete(key);
            }
          });
        }
      } catch (rollbackError) {
        console.error("角色移动回滚失败", rollbackError);
      }
      throw error;
    } finally {
      target.close();
    }
  }

  function makeModal() {
    const overlay = document.createElement("div");
    overlay.id = "ephone-persona-spaces-modal";
    overlay.innerHTML = `
      <section class="ephone-spaces-card" role="dialog" aria-modal="true" aria-labelledby="ephone-spaces-title">
        <header class="ephone-spaces-header">
          <div>
            <h2 id="ephone-spaces-title">人设空间</h2>
            <p id="ephone-spaces-description">每个空间的聊天、角色、NPC、记忆和设定分别保存。</p>
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
          <span class="ephone-spaces-footer-note">原有资料保存在“默认空间”</span>
          <div class="ephone-spaces-footer-actions">
            <button type="button" class="ephone-spaces-move-button" hidden>移动到此空间</button>
            <button type="button" class="ephone-spaces-done">完成</button>
          </div>
        </footer>
      </section>`;

    const list = overlay.querySelector(".ephone-spaces-list");
    const title = overlay.querySelector("#ephone-spaces-title");
    const description = overlay.querySelector("#ephone-spaces-description");
    const createSection = overlay.querySelector(".ephone-spaces-create");
    const moveButton = overlay.querySelector(".ephone-spaces-move-button");
    const footerNote = overlay.querySelector(".ephone-spaces-footer-note");
    let moveMode = null;
    let moveTargetId = null;
    let resolveMove;

    const close = () => {
      overlay.classList.remove("visible");
      if (resolveMove) {
        resolveMove(false);
        resolveMove = null;
      }
      moveMode = null;
      moveTargetId = null;
    };
    const render = () => {
      const currentSpaces = readSpaces();
      const moving = Boolean(moveMode);
      list.replaceChildren();
      for (const space of currentSpaces) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ephone-space-option";
        button.setAttribute("role", "listitem");
        button.innerHTML = `<span class="ephone-space-name"></span><span class="ephone-space-state"></span>`;
        button.querySelector(".ephone-space-name").textContent = space.name;
        const isCurrent = space.id === activeId;
        const isSelected = space.id === moveTargetId;
        button.querySelector(".ephone-space-state").textContent = moving
          ? isCurrent
            ? "当前空间"
            : isSelected
              ? "已选择"
              : "选择"
          : isCurrent
            ? "当前空间"
            : "切换";
        if (isCurrent) button.classList.add("current");
        if (isSelected) button.classList.add("selected");
        button.addEventListener("click", () => {
          if (moving) {
            if (isCurrent) return;
            moveTargetId = space.id;
            render();
            return;
          }
          if (isCurrent) return;
          if (!window.confirm(`切换到“${space.name}”并重新加载页面？`)) return;
          localStorage.setItem(ACTIVE_KEY, space.id);
          window.location.reload();
        });
        list.append(button);
      }
      title.textContent = moving ? "移动角色到空间" : "人设空间";
      description.textContent = moving
        ? `选择目标空间；“${moveMode.name}”和关联的聊天记录会一起移动。`
        : "每个空间的聊天、角色、NPC、记忆和设定分别保存。";
      createSection.hidden = moving;
      moveButton.hidden = !moving;
      moveButton.disabled = !moveTargetId;
      footerNote.textContent = moving
        ? "原空间中的角色将在移动成功后移除"
        : "原有资料保存在“默认空间”";
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
    moveButton.addEventListener("click", async () => {
      if (!moveMode || !moveTargetId || !resolveMove) return;
      const destination = readSpaces().find((space) => space.id === moveTargetId);
      if (!destination) return;
      const movingName = moveMode.name;
      moveButton.disabled = true;
      moveButton.textContent = "正在移动…";
      try {
        await moveChatData(moveMode.id, moveTargetId);
        const resolve = resolveMove;
        resolveMove = null;
        overlay.classList.remove("visible");
        moveMode = null;
        moveTargetId = null;
        resolve(true);
        window.alert(`已将“${movingName}”移动到“${destination.name}”。`);
        window.location.reload();
      } catch (error) {
        console.error("移动角色失败", error);
        window.alert(error?.message || "移动角色失败，请稍后重试。");
        moveButton.textContent = "移动到此空间";
        render();
      }
    });
    document.body.append(overlay);
    return {
      overlay,
      render,
      close,
      setMoveMode(value) {
        moveMode = value;
        moveTargetId = null;
      },
      beginMove(value) {
        return new Promise((resolve) => {
          moveMode = value;
          moveTargetId = null;
          resolveMove = resolve;
          render();
          overlay.classList.add("visible");
        });
      },
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    const modal = makeModal();
    const spaceName = document.getElementById("me-space-name");
    if (spaceName) spaceName.textContent = window.EPHONE_SPACE_NAME;
    const button = document.getElementById("me-space-button");
    if (button) {
      button.title = `当前人设空间：${window.EPHONE_SPACE_NAME}（点击切换或新建）`;
      button.addEventListener("click", () => {
        modal.setMoveMode(null);
        modal.render();
        modal.overlay.classList.add("visible");
      });
    }

    window.EPhoneSpaces = {
      async moveChat(chatId, name) {
        return modal.beginMove({ id: chatId, name: name || "角色" });
      },
    };
  });
})();
