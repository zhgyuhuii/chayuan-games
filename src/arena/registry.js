/**
 * 察元竞技场游戏插件注册表（games-llm-arena-plan Q5：单应用五件套共享壳，
 * 新游戏 = 注册一个插件，壳不动）。
 *
 * GameReferee 四件套契约（方案 §三，纯逻辑、无 IO、可测）：
 *   createGame({ seed, opts }) → game 实例：
 *     game.seats()            → 玩家数（五子棋/象棋 2、斗地主 3、血战 4）
 *     game.phase()            → 阶段串（"bid"/"play"/"lack"/…，UI/提示词用）
 *     game.pendingAction()    → { seat, kind, actions:[string] } | null
 *                               当前待谁行动、动作清单（动作一律字符串）
 *     game.apply(seat, action)→ { ok:true, events:[…] } | { ok:false, reason }
 *     game.result()           → null | { over:true, ranks:[按名次排的 seat],
 *                               scores?:number[], draw?:boolean, summary:string }
 *                               ranks[0] = 冠军；平局 draw:true 且 ranks 并列语义
 *     game.viewFor(seat)      → 该座位的观察文本（LLM 工程共识：着法/事件
 *                               历史优先于棋盘图示，合法步清单显式附上，
 *                               多人游戏附合作上下文——方案 §三）
 *     game.suggestAction(seat)→ 启发式代走（Q2 B 代走制：非纯随机——能挡杀
 *                               就挡、能吃就吃；麻将=缺门里价值最低，血战语义
 *                               见 mahjong.js 头注）
 *     game.anonymize          → true 时 viewFor 对对手只报「玩家A/B/C/D」
 *
 * 代走计数、>5 判负、事件流落盘、重试回喂都在 MatchRunner（不在裁判里），
 * 裁判只负责规则真值（Q1：胜负判定 100% 归代码，模型无权参与）。
 *
 * UI 元数据（壳消费，插件自带）：label/short/desc/minSeats/color/boardKind。
 */

const GAMES = new Map();

/** 注册一个游戏插件（幂等：同 id 覆盖，测试重挂载用）。 */
export function registerGame(def) {
  if (!def?.id || typeof def.createGame !== "function") throw new Error("registerGame: id/createGame 必填");
  GAMES.set(def.id, { ...def });
}

/** 大厅分组序（2026-11-07 用户裁定：同类型排在一起）——棋类 → 扑克 → 麻将。 */
export const CAT_ORDER = { board: 0, cards: 1, mahjong: 2 };
export const CAT_ZH = { board: "棋类", cards: "扑克", mahjong: "麻将" };

/** 全部已注册游戏（按 类别分组 + order 排序，大厅卡位用）。
 *  hidden:true 的游戏不进大厅（注册保留：旧对局回放/GamePanel 分发不受影响）。 */
export function getGames() {
  return [...GAMES.values()].sort((a, b) => (CAT_ORDER[a.cat] ?? 9) - (CAT_ORDER[b.cat] ?? 9) || (a.order ?? 0) - (b.order ?? 0));
}

export function getGame(id) {
  return GAMES.get(id) ?? null;
}

/** 云模型判定（Q6 透明性）：非本地前缀 = 云端。2026-11-07 摘建审计裁决：
 *  参数化签名保 registry.js 两侧逐字节同构——harness 默认 ["local"]（remote/
 *  跨端转发算云端，现状语义零变化）；chayuan-game 传本地推理商 id 清单
 *  （ollama/lm-studio…，modelRef 统一 vendor/model 后本地组由调用方定义）。 */
export function isCloudModelRef(ref, localPrefixes = ["local"]) {
  const prefixes = Array.isArray(localPrefixes) ? localPrefixes : ["local"]; // 容错：filter/map 直传回调时 index 会挤进第二参
  return typeof ref === "string" && !prefixes.some((p) => ref.startsWith(`${p}/`));
}

/** 匿名观战（Q6 默认开）：座位 → 玩家A/B/C/D。终局由 MatchRunner 揭晓。 */
export const SEAT_NAMES = ["玩家A", "玩家B", "玩家C", "玩家D"];
export const SEAT_NAMES_EN = ["Player A", "Player B", "Player C", "Player D"];
export function seatName(seat, locale = "zh") {
  return (locale === "en" ? SEAT_NAMES_EN : SEAT_NAMES)[seat] ?? `玩家${seat + 1}`;
}
