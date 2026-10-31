(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.EPhoneNovelReading = api;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  "use strict";
  function signature(chapter) {
    const value = String(chapter?.timestamp ?? "") + "|" + String(chapter?.content || "");
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return value.length + ":" + (hash >>> 0).toString(36);
  }
  function resolve(chapters, bookmark) {
    if (!chapters?.length) return { chapterIndex: 0, bookmark: null };
    let index = Math.max(0, Math.min(Number.isInteger(bookmark?.chapterIndex) ? bookmark.chapterIndex : 0, chapters.length - 1));
    if (bookmark?.chapterSignature && signature(chapters[index]) !== bookmark.chapterSignature) {
      const found = chapters.findIndex(chapter => signature(chapter) === bookmark.chapterSignature);
      if (found >= 0) index = found;
      else return { chapterIndex: index, bookmark: { ...bookmark, chapterIndex: index, scrollTop: 0, ratio: 0 } };
    }
    return { chapterIndex: index, bookmark: bookmark ? { ...bookmark, chapterIndex: index } : null };
  }
  function create({ element, visible, blocked = () => false, save, scope = "default" }) {
    const cache = new Map(), pending = new Map(), scheduled = new Map();
    const storageKey = "ephone_novel_reading_pending_v1:" + scope;
    const key = id => typeof id + ":" + String(id);
    let current = null, restoring = false, paused = false, timer = 0, epoch = 0, queue = Promise.resolve();
    try {
      for (const entry of JSON.parse(root.localStorage?.getItem(storageKey) || "[]")) {
        if (entry?.id != null && Number.isFinite(entry.position?.updatedAt)) { cache.set(key(entry.id), entry.position); pending.set(key(entry.id), entry); }
      }
    } catch {}
    function journal() {
      // Only a few pending coordinates are journalled for immediate tab close;
      // complete chapter text stays in IndexedDB and never enters localStorage.
      try {
        if (pending.size) root.localStorage?.setItem(storageKey, JSON.stringify([...pending.values()].slice(-12)));
        else root.localStorage?.removeItem(storageKey);
      } catch { /* A full small-storage quota cannot block IndexedDB saves. */ }
    }
    function latest(id, stored) {
      const local = cache.get(key(id));
      return local && (!stored || local.updatedAt > stored.updatedAt) ? local : stored || null;
    }
    function remember(position) {
      if (!current) return;
      const id = current.id, old = latest(id, null);
      const next = { ...position, updatedAt: Math.max(Date.now(), (old?.updatedAt || 0) + 1) };
      cache.set(key(id), next); pending.set(key(id), { id, position: next });
      clearTimeout(timer); timer = setTimeout(() => flush(false), 250);
    }
    function bodyMetrics() {
      const body = element.querySelector(".gr-chapter-text");
      return body ? { bodyOffset: body.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop, bodyHeight: body.scrollHeight } : {};
    }
    function capture() {
      if (!current || restoring || paused || !visible() || blocked(current.id)) return;
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      remember({ chapterIndex: current.index, chapterSignature: current.signature, scrollTop: element.scrollTop,
        ratio: max ? element.scrollTop / max : 0, scrollHeight: element.scrollHeight, viewportWidth: element.clientWidth, ...bodyMetrics() });
    }
    function flush(captureNow = true) {
      clearTimeout(timer); timer = 0; if (captureNow) capture(); clearTimeout(timer); timer = 0;
      journal();
      const jobs = [...pending.values()].filter(entry => scheduled.get(key(entry.id)) !== entry.position.updatedAt);
      for (const entry of jobs) scheduled.set(key(entry.id), entry.position.updatedAt);
      queue = queue.catch(() => {}).then(async () => {
        for (const entry of jobs) {
          const id = key(entry.id);
          try { await save(entry.id, entry.position); if (pending.get(id)?.position.updatedAt === entry.position.updatedAt) pending.delete(id); }
          catch { /* Keep the coordinate journal for a later successful save. */ }
          finally { if (scheduled.get(id) === entry.position.updatedAt) scheduled.delete(id); journal(); }
        }
      });
      return queue;
    }
    function unmount() { epoch++; current = null; restoring = false; }
    function adopt(id, position) {
      if (position) cache.set(key(id), position); else cache.delete(key(id));
      pending.delete(key(id)); journal();
      if (current?.id === id) {
        if (!position || current.signature !== position.chapterSignature) unmount();
        else current.index = position.chapterIndex;
      }
    }
    function mount(story, index, restore) {
      const token = ++epoch, saved = resolve(story.chapters, latest(story.id, story.readingPosition));
      if (!story.chapters[index]) { unmount(); return; }
      const bookmark = restore && saved.chapterIndex === index ? saved.bookmark : null;
      current = { id: story.id, index, signature: signature(story.chapters[index]), interacted: false };
      paused = false; restoring = true;
      function apply() {
        if (epoch !== token || !current || current.interacted) return;
        const max = Math.max(0, element.scrollHeight - element.clientHeight);
        const metrics = bodyMetrics(), sameBodyLayout = bookmark && Number.isFinite(bookmark.bodyOffset) &&
          Math.abs((bookmark.viewportWidth || element.clientWidth) - element.clientWidth) <= 1 && Math.abs((bookmark.bodyHeight || 0) - (metrics.bodyHeight || 0)) <= 1;
        const reflow = bookmark && (Math.abs((bookmark.viewportWidth || element.clientWidth) - element.clientWidth) > 1 || Math.abs((bookmark.scrollHeight || element.scrollHeight) - element.scrollHeight) > 20);
        const top = !bookmark ? 0 : sameBodyLayout ? (bookmark.scrollTop || 0) + metrics.bodyOffset - bookmark.bodyOffset : reflow ? (bookmark.ratio || 0) * max : bookmark.scrollTop || 0;
        element.scrollTop = Math.max(0, Math.min(max, top));
      }
      apply();
      // Remember explicit chapter navigation immediately, before another frame
      // or pagehide can occur. Later layout settles refine this coordinate.
      remember({ chapterIndex: index, chapterSignature: current.signature, scrollTop: element.scrollTop,
        ratio: bookmark?.ratio || 0, scrollHeight: element.scrollHeight, viewportWidth: element.clientWidth, ...bodyMetrics() });
      root.requestAnimationFrame(() => root.requestAnimationFrame(() => { if (epoch === token) { apply(); restoring = false; capture(); } }));
      root.document?.fonts?.ready?.then(() => { if (epoch === token && !current?.interacted) { apply(); restoring = false; capture(); } })?.catch(() => {});
    }
    const interact = () => { if (current && visible()) { current.interacted = true; restoring = false; } };
    element.addEventListener("scroll", () => { if (!restoring && current && visible() && !blocked(current.id)) { current.interacted = true; capture(); } }, { passive: true });
    for (const event of ["pointerdown", "touchstart", "wheel"]) element.addEventListener(event, interact, { passive: true });
    element.addEventListener("scrollend", () => flush());
    root.addEventListener?.("pagehide", () => flush(false));
    root.document?.addEventListener("visibilitychange", () => { if (root.document.hidden) flush(false); });
    return Object.freeze({ latest, mount, flush, unmount, adopt, pause: id => { if (current?.id === id) paused = true; }, resume: () => { paused = false; },
      forget: id => { adopt(id, null); if (current?.id === id) unmount(); } });
  }
  return Object.freeze({ signature, resolve, create });
});
