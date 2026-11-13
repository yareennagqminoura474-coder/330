const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
require("fake-indexeddb/auto");
const Dexie = require("dexie");
(async () => {
  const name = "spaces-quota-test-" + Date.now(), source = new Dexie(name), other = new Dexie(name + "__space_other");
  const schema = { chats: "&id" };
  source.version(1).stores(schema); other.version(1).stores(schema);
  await source.open(); await other.open();
  const storage = new Map([["ephone-persona-spaces-v1", JSON.stringify([{ id: "other", name: "另一空间" }])], ["ephone-persona-space-active", "other"]]);
  let full = true, refreshed = 0;
  const window = { Dexie, EPHONE_DB_BASE_NAME: name, refreshPersonaSpaceData: async () => { refreshed++; } };
  const localStorage = { getItem: k => storage.get(k) || null, setItem(k,v) { if (full) throw new DOMException("full", "QuotaExceededError"); storage.set(k,v); } };
  try {
    vm.runInNewContext(fs.readFileSync("persona-spaces.js", "utf8"), { window, localStorage, structuredClone, console, document: { addEventListener() {} } });
    assert.equal(window.EPHONE_SPACE_ID, "other", "full localStorage must not hide an existing space");
    const facade = window.EPhoneSpaces.bindDatabases(other, source, "other");
    await assert.rejects(window.EPhoneSpaces.switchSpace("default"), /无法保存空间选择/);
    assert.equal(window.EPHONE_SPACE_ID, "other"); assert.equal(facade.chats.db, other); assert.equal(refreshed, 0);
    full = false; await window.EPhoneSpaces.switchSpace("default");
    assert.equal(facade.chats.db, source); assert.equal(window.EPHONE_SPACE_ID, "default");
    window.refreshPersonaSpaceData = async () => { full = true; throw new Error("refresh failed"); };
    await assert.rejects(window.EPhoneSpaces.switchSpace("other"), /refresh failed/);
    assert.equal(facade.chats.db, source, "rollback must still restore database when preference write fails");
    assert.equal(window.EPHONE_SPACE_ID, "default");
    console.log("PASS: storage quota preserves existing spaces, failed switch keeps database/UI consistent, refresh failure rolls back despite storage error");
  } finally { source.close(); other.close(); await Dexie.delete(name); await Dexie.delete(name + "__space_other"); }
})().catch(error => { console.error(error); process.exitCode = 1; });
