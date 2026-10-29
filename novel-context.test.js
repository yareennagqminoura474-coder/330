"use strict";
const assert = require("node:assert/strict");
const identity = require("./player-identity.js");
const groupContext = require("./group-context.js");
const core = require("./novel-context.js");
const profile = "完整人物档案".repeat(800) + "：杨帆是林澈的师兄，林珣是两人的师父；我是杨帆，{{user}}原来是师父。";
const a = { id: "a", name: "师兄备注", originalName: "杨帆", ephonePersonKey: "shared-a",
  settings: { aiPersona: profile, myNickname: "师父", myPersona: "林珣，杨帆和林澈的师父。" },
  longTermMemory: [{ content: "杨帆答应林澈次日一起练功。", vts: 100 }, { content: "杨帆答应林澈次日一起练功。", vts: 101 }],
  history: [{ role: "assistant", senderName: "杨帆", content: "OLDER_NOT_SELECTED", timestamp: 1 },
    { role: "assistant", senderName: "杨帆", content: "NEW_FULL_TEXT：" + "未截断的长句".repeat(50) + "；我用手机给师弟转账。", timestamp: 2 },
    { role: "assistant", type: "narration", content: "这句已被用户删除", timestamp: 3 },
    { role: "system", isHidden: true, content: "SECRET_HIDDEN", timestamp: 4 }] };
const b = { id: "b", name: "林澈", originalName: "林澈", settings: { aiPersona: "我叫林澈，杨帆是我的师兄，林珣是师父。" },
  longTermMemory: [{ content: "个人记忆：已经约好与杨帆一起练功。", vts: 99 }], history: [{ role: "user", content: "UNSELECTED_PRIVATE_HISTORY", timestamp: 4 }] };
const npc = { id: 7, name: "林珣", persona: "林澈和杨帆都是我的弟子。", associatedWith: ["a", "b"], longTermMemory: [{ content: "NPC的主人明确的记忆", vts: 98 }] };
const hidden = { id: "hidden", name: "未选择角色", originalName: "未选择角色", settings: { aiPersona: "UNSELECTED_PERSONA_SECRET" }, history: [{ role: "assistant", content: "UNSELECTED_HISTORY_SECRET", timestamp: 5 }] };
const group = { id: "g", name: "练功场", isGroup: true, isSpectatorGroup: true, settings: { aiPersona: "群内场景是在古风书院。" },
  members: [
    { id: "a", originalName: "杨帆", groupNickname: "大师兄", persona: "过期群人设不能覆盖基础", ephoneSourcePersona: "过期群人设不能覆盖基础", ephonePersonaOverride: false },
    { id: "b", originalName: "林澈", groupNickname: "小师弟", persona: "本群额外设定：林澈正在养伤。", ephonePersonaOverride: true },
    { id: "npc_7", originalName: "林珣", isNpc: true, persona: npc.persona },
    { id: "orphan", originalName: "张宁", groupNickname: "同窗", persona: "只存在于群聊的成年人同窗，有自己的工作。" }
  ], longTermMemory: [{ content: "本群记忆：师父安排两位弟子周末练功。", vts: 95 }],
  history: [{ role: "assistant", senderName: "大师兄", content: "读到原文里约好了下周去练功。", timestamp: 10 },
    { role: "assistant", type: "narration", content: "林澈拿起手机，看到一笔转账，不再漏掉包含数字的历史原文。", timestamp: 11 }] };
const relations = [{ a: "shared-a", b: "chat:b", aToB: "师弟", bToA: "师兄", detail: "双方辈分不同，不是亲兄弟。", source: "manual", evidence: [{ chatId: "g", quote: "明确关系的实际原文" }] },
  { a: "member:a", b: "npc:7", aToB: "师父", bToA: "弟子", detail: "旧编号通过当前成员来源修复。" },
  { a: "chat:a", b: "chat:hidden", aToB: "未选关系泄漏", bToA: "未知" },
  { a: "shared-a", b: "member:orphan", aToB: "上司", bToA: "下属", status: "pending", detail: "PENDING_RELATION_NOT_FACT" }];
const chats = [a, b, group, hidden], options = { selectedIds: ["a", "g", "npc_7", "g"], chats, npcs: [npc], relations,
  player: { key: "chat:b", name: "林澈", persona: b.settings.aiPersona, valid: true }, historyLimit: 1, identity, groupContext, formatTime: (v) => "虚拟" + v };
const original = JSON.stringify(options), result = core.build(options);
assert.equal(result.people.length, 4, "private/group/NPC references share their stable canonical identity");
assert.equal(result.people.filter((p) => p.name === "杨帆").length, 1);
assert.equal(result.people.find((p) => p.name === "杨帆").key, "shared-a");
assert.equal((result.text.match(/# 本名：杨帆（/g) || []).length, 1);
assert.ok(result.text.includes(profile), "the entire long character persona is preserved");
assert.match(result.text, /群内场景是在古风书院/);
assert.match(result.text, /本群额外设定：林澈正在养伤/);
assert.match(result.text, /只存在于群聊的成年人同窗/);
assert.match(result.text, /原聊天对象（\{\{user\}\}）：师父/);
assert.match(result.text, /原聊天对象人设：引用原聊天对象档案【U1】的完整文本/);
assert.match(result.text, /原聊天对象档案【U1】\n林珣/);
assert.match(result.text, /林澈是杨帆的师弟；杨帆是林澈的师兄/);
assert.match(result.text, /林珣是杨帆的师父；杨帆是林珣的弟子/);
assert.match(result.text, /明确关系的实际原文/);
assert.match(result.text, /本空间中充当用户的绑定角色：林澈/);
assert.match(result.text, /本群记忆：师父安排/);
assert.match(result.text, /个人记忆：已经约好/);
assert.match(result.text, /NPC的主人明确的记忆/);
assert.ok(result.text.includes(a.history[1].content), "selected recent messages are never reduced to 50 characters or discarded for 手机/转账");
assert.match(result.text, /看到一笔转账/);
assert.doesNotMatch(result.text, /OLDER_NOT_SELECTED|SECRET_HIDDEN|已被用户删除|UNSELECTED_PRIVATE_HISTORY|UNSELECTED_PERSONA_SECRET|UNSELECTED_HISTORY_SECRET|未选关系泄漏|PENDING_RELATION_NOT_FACT|过期群人设不能覆盖基础/);
assert.equal(JSON.stringify(options), original, "prompt construction never changes records or relations");
assert.match(result.text, /\[虚拟100\] 杨帆答应/);
assert.match(result.text, /\[虚拟101\] 杨帆答应/, "different dated memories remain distinct");
assert.equal(core.build({ ...options, selectedIds: ["b"], player: null }).people.length, 1);
assert.doesNotMatch(core.build({ ...options, selectedIds: ["b"], player: null }).text, /双方辈分不同|完整人物档案|师兄备注/);
const boundRelation = core.build({ ...options, selectedIds: ["a"] });
assert.match(boundRelation.text, /本空间中充当用户的绑定角色：林澈/);
assert.match(boundRelation.text, /林澈是杨帆的师弟；杨帆是林澈的师兄/, "the bound default user is a valid saved-relation endpoint");
assert.equal(boundRelation.people.length, 1, "binding does not silently select a second cast archive");
assert.doesNotMatch(boundRelation.text, /UNSELECTED_PRIVATE_HISTORY|个人记忆：已经约好|UNSELECTED_PERSONA_SECRET|未选关系泄漏/, "binding never imports unselected private chats/memories or outsider relations");
assert.doesNotMatch(core.build({ ...options, selectedIds: ["a"], player: { ...options.player, valid: false } }).text, /林澈是杨帆的师弟；杨帆是林澈的师兄/, "invalid bindings are not relationship endpoints");
assert.doesNotMatch(core.build({ ...options, historyLimit: 0 }).text, /NEW_FULL_TEXT|看到一笔转账/, "explicit zero suppresses chat history while retaining personas and saved memories");
const missing = core.build({ ...options, selectedIds: ["gone", "npc_404"], player: null });
assert.equal(missing.people.length, 0); assert.equal(missing.warnings.length, 2);
assert.match(missing.text, /缺失的档案不能凭空补写/);
const duplicate = { ...a, id: "same-person-new-chat" };
assert.equal(core.build({ ...options, chats: [...chats, duplicate], selectedIds: ["a", duplicate.id] }).people.length, 1, "same stable person key across private archives remains one person");
const distinct = { ...a, id: "independent", ephonePersonKey: "distinct-person", ephoneIndependentIdentity: true, name: "杨帆", settings: { aiPersona: "这是独立的同名角色，不是师兄。" } };
assert.equal(core.build({ ...options, chats: [...chats, distinct], selectedIds: ["a", distinct.id] }).people.length, 2, "a shared name alone must not merge independent identities");
const fallback = core.build({ selectedIds: ["g"], chats, npcs: [npc], identity, historyLimit: 1 });
assert.match(fallback.text, /完整人物档案/); assert.match(fallback.text, /本群额外设定/); assert.equal(fallback.people.length, 4);
const numericPrivate = { id: 7, name: "王老师", settings: { aiPersona: "王老师是独立的成年人角色，与林珣不是一个人。" } };
const sharedNumericId = core.build({ ...options, selectedIds: ["7", "g"], chats: [...chats, numericPrivate], relations: [{ a: "chat:7", b: "chat:b", aToB: "学生", bToA: "老师" }] });
assert.match(sharedNumericId.text, /林澈是王老师的学生；王老师是林澈的老师/);
assert.doesNotMatch(sharedNumericId.text, /林澈是林珣的学生/, "numeric NPC IDs must not overwrite a different private archive's key");

// Large groups often share the same full original-user persona. Reusing its
// exact text must not merge that per-character identity or drop the bindings.
const commonUser = "SHARED_ORIGINAL_USER_PERSONA_".repeat(120);
const manyRoles = Array.from({ length: 15 }, (_, index) => ({ id: "many-" + index, name: "角色" + index,
  settings: { aiPersona: "CANONICAL_ROLE_" + index + "：" + "独立而完整的人设。".repeat(25), myNickname: "各自原用户" + index, myPersona: commonUser }, history: [], longTermMemory: [] }));
const largeGroup = { id: "many-group", name: "大群", isGroup: true, settings: {}, members: manyRoles.map((role) => ({ id: role.id, originalName: role.name, persona: role.settings.aiPersona, ephonePersonaOverride: false })), history: [], longTermMemory: [] };
let resolvedMembers = 0;
const leanResolver = { memberProfile: (...args) => { resolvedMembers++; return groupContext.memberProfile(...args); },
  describeMessage: groupContext.describeMessage, buildContext: () => { throw new Error("unused full context must not be built"); } };
const manyOptions = { selectedIds: [largeGroup.id], chats: [...manyRoles, largeGroup], npcs: [], relations: [], identity, groupContext: leanResolver,
  player: { key: "chat:" + manyRoles[0].id, name: manyRoles[0].name, persona: manyRoles[0].settings.aiPersona }, historyLimit: 0 };
const manyBefore = JSON.stringify(manyOptions), many = core.build(manyOptions);
assert.equal(resolvedMembers, 15, "reuse only the shared canonical member resolver, not its unused history/memory builder");
assert.equal(many.people.length, 15, "sharing persona text must not merge characters or original user identities");
assert.equal(many.text.split(commonUser).length - 1, 1, "all 15 full original user personas are retained by one shared text definition");
assert.equal(many.text.split(manyRoles[0].settings.aiPersona).length - 1, 1, "the bound player's full persona is not repeated after its existing canonical cast archive");
assert.match(many.text, /本空间中充当用户的绑定角色：角色0/);
assert.match(many.text, /绑定角色档案：见上方本名“角色0”/);
for (const role of manyRoles) {
  assert.ok(many.text.includes(role.settings.aiPersona));
  assert.ok(many.text.includes("原聊天对象（{{user}}）：" + role.settings.myNickname + "\n原聊天对象人设：引用原聊天对象档案【U1】的完整文本"));
}
assert.equal(JSON.stringify(manyOptions), manyBefore, "deduplicating prompt text leaves source archives untouched");
const firstUser = "SAME_NICKNAME_FIRST_USER_FULL_PROFILE", secondUser = "SAME_NICKNAME_SECOND_USER_FULL_PROFILE";
const separateUsers = manyRoles.slice(0, 2).map((role, index) => ({ ...role, settings: { ...role.settings, myNickname: "同名原用户", myPersona: index ? secondUser : firstUser } }));
const separate = core.build({ selectedIds: separateUsers.map((role) => role.id), chats: separateUsers, identity, historyLimit: 0 });
assert.equal(separate.people.length, 2);
assert.equal(separate.text.split(firstUser).length - 1, 1);
assert.equal(separate.text.split(secondUser).length - 1, 1, "same nicknames with different full personas never share a definition");
assert.match(separate.text, /本名：角色0[\s\S]*原聊天对象人设：引用原聊天对象档案【U1】/);
assert.match(separate.text, /本名：角色1[\s\S]*原聊天对象人设：引用原聊天对象档案【U2】/);
const overlapsCast = core.build({ ...manyOptions, chats: manyOptions.chats.map((chat) => chat.id === manyRoles[1].id ? { ...chat, settings: { ...chat.settings, myPersona: manyRoles[0].settings.aiPersona } } : chat) });
assert.equal(overlapsCast.text.split(manyRoles[0].settings.aiPersona).length - 1, 1, "an original-user definition may reference identical canonical cast text without equating those identities");
const independentPlayer = core.build({ ...manyOptions, player: { key: "chat:another-person", name: manyRoles[0].name, persona: "DIFFERENT_BOUND_PERSONA" } });
assert.match(independentPlayer.text, /DIFFERENT_BOUND_PERSONA/, "the binding is not deduplicated by display name alone");
console.log("PASS: full canonical personas, scoped group overrides, original user identity, directed saved relations, owner/time-preserving memory, complete selected history, NPC and group-only members, selection boundaries, aliases, immutable sources and lossless shared-persona prompt deduplication");
