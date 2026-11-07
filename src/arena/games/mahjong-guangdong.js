/**
 * 广东推倒胡（鸡平胡）麻将裁判（games-llm-arena-games2 Q1：136 张含字风、
 * 可吃、胡即终局；与血战同族但 27→34 维泛化 + chi 动作 + 番种表，差异面大故
 * 独立文件——mahjong.js 血战/血流引擎零改动，风险隔离）。
 *
 * 简化口径（对局摘要声明，评审可砍）：
 *  - 胡牌型只收「4 面子 + 1 对子」（七对不收，同血战口径）；
 *  - 番种表（可叠加）：平胡 1 / 对对胡 +2 / 混一色 +2 / 清一色 +4 / 字一色 +8；
 *    自摸 +1。无杠番、无抢杠胡、无杠上开花（LLM 对局放大复杂度不划算）；
 *  - 计分：点炮 = 放炮者付 fan；自摸 = 其余三家各付 fan（自摸 +1 已入 fan）；
 *    杠与血战同价：明杠放杠者付 2，暗杠/补杠三家各付 2；
 *  - 胡即终局（推倒胡正统）：胡者第 1，其余按累计分排（杠分可产生名次差）；
 *  - 流局不查叫（广东主流口径）：无分差 → 四家并列（draw）。
 *
 * 牌串：数牌 "1m".."9m"/"1p".."9p"/"1s".."9s"（小写花色）；
 *       字牌大写 "E"东 "S"南 "W"西 "N"北 "C"中 "F"发 "B"白（与小写花色区分，
 *       viewFor 全程用中文牌名展示，动作清单显式列出，防混淆）。
 * 动作：打牌 "discard:5m"；表态 "action:pass|pon|kan|hora"；
 *       吃 "action:chi:<顺子最小牌>"（如手里 4m6m 吃 5m → "action:chi:4m"）；
 *       自摸轮暗杠 "action:ankan:2s"、补杠 "action:kakan:2s"、自摸胡 "action:hora"。
 */
import { registerGame } from "../registry.js";

const SUITS = ["m", "p", "s"];
const SUIT_ZH = { m: "万", p: "筒", s: "索" };
export const HONORS = ["E", "S", "W", "N", "C", "F", "B"];
const HONOR_ZH = { E: "东", S: "南", W: "西", N: "北", C: "红中", F: "发财", B: "白板" };
export const HONOR_START = 27;
export const N_KINDS = 34;

export const tileIdx = (t) => (HONORS.includes(t) ? HONOR_START + HONORS.indexOf(t) : SUITS.indexOf(t[1]) * 9 + (Number(t[0]) - 1));
export const idxTile = (i) => (i >= HONOR_START ? HONORS[i - HONOR_START] : `${(i % 9) + 1}${SUITS[Math.floor(i / 9)]}`);
export const tileZh = (t) => (HONORS.includes(t) ? HONOR_ZH[t] : `${t[0]}${SUIT_ZH[t[1]]}`);
export const sortTiles = (tiles) => [...tiles].sort((a, b) => tileIdx(a) - tileIdx(b));
const isHonorIdx = (i) => i >= HONOR_START;

export function fullWall() {
  const wall = [];
  for (let s = 0; s < 3; s += 1) for (let n = 1; n <= 9; n += 1) {
    for (let k = 0; k < 4; k += 1) wall.push(`${n}${SUITS[s]}`);
  }
  for (const h of HONORS) for (let k = 0; k < 4; k += 1) wall.push(h);
  return wall;
}

export function countsOf(tiles) {
  const c = new Array(N_KINDS).fill(0);
  for (const t of tiles) c[tileIdx(t)] += 1;
  return c;
}

/** counts（34）能否全拆成面子（顺/刻；顺子不跨花色、字牌无顺）。 */
function allMelds(c, min = 0) {
  let i = min;
  while (i < N_KINDS && c[i] === 0) i += 1;
  if (i >= N_KINDS) return true;
  if (c[i] >= 3) { // 刻子（含字牌）
    c[i] -= 3;
    if (allMelds(c, i)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  if (!isHonorIdx(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) { // 顺子
    c[i] -= 1; c[i + 1] -= 1; c[i + 2] -= 1;
    if (allMelds(c, i)) { c[i] += 1; c[i + 1] += 1; c[i + 2] += 1; return true; }
    c[i] += 1; c[i + 1] += 1; c[i + 2] += 1;
  }
  return false;
}

/** tiles 是否为胡牌型（4 面子 + 1 对子；34 维）。 */
export function isWinHand(tiles) {
  if (tiles.length % 3 !== 2) return false;
  const c = countsOf(tiles);
  for (let i = 0; i < N_KINDS; i += 1) {
    if (c[i] >= 2) {
      c[i] -= 2;
      if (allMelds(c)) { c[i] += 2; return true; }
      c[i] += 2;
    }
  }
  return false;
}

/** 3n+1 张的听牌待牌集合（空 = 未听）。 */
export function waitTiles(tiles) {
  if (tiles.length % 3 !== 1) return [];
  const base = countsOf(tiles);
  const waits = [];
  for (let i = 0; i < N_KINDS; i += 1) {
    if (base[i] >= 4) continue;
    base[i] += 1;
    if (isWinHandCounts(base, tiles.length + 1)) waits.push(idxTile(i));
    base[i] -= 1;
  }
  return waits;
}

function isWinHandCounts(c, total) {
  if (total % 3 !== 2) return false;
  const cc = [...c];
  for (let i = 0; i < N_KINDS; i += 1) {
    if (cc[i] >= 2) {
      cc[i] -= 2;
      if (allMelds(cc)) { cc[i] += 2; return true; }
      cc[i] += 2;
    }
  }
  return false;
}

/** counts 能否全拆成刻子（对对胡判定用）。 */
function allTriplets(c, min = 0) {
  let i = min;
  while (i < N_KINDS && c[i] === 0) i += 1;
  if (i >= N_KINDS) return true;
  if (c[i] === 3) { c[i] -= 3; const ok = allTriplets(c, i); c[i] += 3; return ok; }
  return false;
}

/** 番种评估（Q1 口径表）：concealed = 胡牌时手里那副（3n+2），meldTiles = 副露全牌。 */
export function evalFan(concealed, melds) {
  let fan = 1; // 平胡
  const all = [...concealed, ...melds.flatMap((m) => (m.type === "chi" ? m.tiles : [m.tile, m.tile, m.tile, m.tile].slice(0, m.type === "pon" ? 3 : 4)))];
  const suitSet = new Set(all.filter((t) => !HONORS.includes(t)).map((t) => t[1]));
  const honorCount = all.filter((t) => HONORS.includes(t)).length;
  if (suitSet.size === 0 && honorCount > 0) fan += 8; // 字一色
  else if (suitSet.size === 1 && honorCount > 0) fan += 2; // 混一色
  else if (suitSet.size === 1 && honorCount === 0) fan += 4; // 清一色
  const c = countsOf(concealed);
  let hasPair = false;
  for (let i = 0; i < N_KINDS; i += 1) {
    if (c[i] >= 2) {
      c[i] -= 2;
      if (allTriplets(c)) { hasPair = true; }
      c[i] += 2;
      if (hasPair) break;
    }
  }
  const meldsAllTriplet = melds.every((m) => m.type !== "chi");
  if (hasPair && meldsAllTriplet) fan += 2; // 对对胡
  return fan;
}

/** 孤张价值（代走用）：字牌单张最孤；数牌按邻张数。 */
function tileIsolation(hand, tile) {
  if (HONORS.includes(tile)) return countsOf(hand)[tileIdx(tile)] >= 2 ? 2 : 0; // 字对/刻保
  const idx = tileIdx(tile);
  const suit0 = Math.floor(idx / 9) * 9;
  const c = countsOf(hand);
  const has = (i) => i >= suit0 && i < suit0 + 9 && c[i] > 0;
  let near = 0;
  for (let d = -2; d <= 2; d += 1) if (d !== 0 && has(idx + d)) near += 1;
  return near;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGuangdongGame({ seed = Date.now() % 2 ** 31 } = {}) {
  const rng = mulberry32(seed);
  const wall = fullWall();
  for (let i = wall.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const hands = [[], [], [], []];
  for (let s = 0; s < 4; s += 1) hands[s] = sortTiles(wall.splice(0, 13));
  const discards = [[], [], [], []];
  const melds = [[], [], [], []]; // {type:'chi'|'pon'|'kan'|'ankan'|'kakan', tiles?, tile?, from}
  const scores = [0, 0, 0, 0];
  let turn = 0;
  let drawn = null;
  let claimCtx = null;
  let events = [];
  let ended = null;

  const draw = () => (wall.length ? wall.pop() : null);

  // 庄家进第一摸（无定缺阶段，开局即补第 14 张）
  {
    const t0 = draw();
    if (!t0) ended = { over: true, ranks: [0, 0, 0, 0], scores: [...scores], draw: true, summary: "流局（异常空墙）" };
    else { hands[0] = sortTiles([...hands[0], t0]); drawn = t0; events = [{ t: "draw", seat: 0, tile: t0 }]; }
  }

  const canHora = (seat, tile) => isWinHand([...hands[seat], tile]);
  const canPon = (seat, tile) => hands[seat].filter((t) => t === tile).length >= 2;
  const canKan = (seat, tile) => hands[seat].filter((t) => t === tile).length >= 3;
  /** chi 候选（seat 只能是打牌者下家）：返回可组顺子的最小牌数组。
   *  校验口径：顺子 [low, low+1, low+2] 中除被打的那张（idx）外，其余两张
   *  都必须在手（2026-11-06 实锤：此前只查 low+1/low+2，吃中张/边张时漏查
   *  另一张 → 允许了不成立的吃，移除时只删一张、手牌多出一张）。 */
  const chiLows = (seat, tile) => {
    if (HONORS.includes(tile)) return [];
    const idx = tileIdx(tile);
    const suit0 = Math.floor(idx / 9) * 9;
    const c = countsOf(hands[seat]);
    const out = [];
    for (let low = idx - 2; low <= idx; low += 1) {
      if (low < suit0 || low % 9 > 6) continue;
      const need = [low, low + 1, low + 2].filter((x) => x !== idx);
      if (need.every((x) => c[x] > 0)) out.push(idxTile(low));
    }
    return out;
  };

  /** 打牌后表态轮询：胡优先，其次碰/杠（任意家），吃仅下家（一炮不多响）。 */
  const openClaims = (from, tile) => {
    const cands = [];
    for (let k = 1; k <= 3; k += 1) {
      const s = (from + k) % 4;
      const allows = [];
      if (canHora(s, tile)) allows.push("action:hora");
      if (canKan(s, tile)) allows.push("action:kan");
      if (canPon(s, tile)) allows.push("action:pon");
      if (k === 1) for (const low of chiLows(s, tile)) allows.push(`action:chi:${low}`);
      if (allows.length) cands.push({ seat: s, allows });
    }
    // 胡优先：先问胡家；胡家 pass 才轮到碰杠吃
    cands.sort((a, b) => (b.allows.includes("action:hora") ? 1 : 0) - (a.allows.includes("action:hora") ? 1 : 0));
    if (cands.length) claimCtx = { tile, from, candidates: cands, idx: 0 };
    else advanceTurn(from);
  };

  const advanceTurn = (from) => {
    if (ended) return;
    turn = (from + 1) % 4;
    const t = draw();
    if (!t) { finishRyuukyoku(); return; }
    hands[turn] = sortTiles([...hands[turn], t]);
    drawn = t;
    events = [...events, { t: "draw", seat: turn, tile: t }];
  };

  const canHoraSelf = (seat) => isWinHand(hands[seat]);

  const finishRyuukyoku = () => {
    // 广东推倒胡流局不查叫（主流口径）：无分差 → 四家并列
    ended = { over: true, ranks: [0, 0, 0, 0], scores: [...scores], draw: true, summary: "流局（推倒胡不查叫）：四家并列" };
  };

  /** 胡即终局：胡者第 1，其余按分排。 */
  const finishHora = (seat, why) => {
    const others = [0, 1, 2, 3].filter((s) => s !== seat).sort((a, b) => scores[b] - scores[a]);
    const ranks = new Array(4).fill(0);
    ranks[seat] = 0;
    others.forEach((s, i) => { ranks[s] = i + 1 > 1 && scores[s] === scores[others[i - 1]] ? ranks[others[i - 1]] : i + 1; });
    ended = { over: true, ranks, scores: [...scores], draw: false, summary: why };
  };

  const afterPlay = (seat, tile) => {
    discards[seat] = [...discards[seat], tile];
    events = [...events, { t: "discard", seat, tile }];
    drawn = null;
    openClaims(seat, tile);
  };

  const removeTiles = (seat, list) => {
    const rm = [...list];
    hands[seat] = hands[seat].filter((t) => { if (rm.includes(t)) { rm.splice(rm.indexOf(t), 1); return false; } return true; });
  };

  return {
    seats: () => 4,
    phase: () => (ended ? "over" : claimCtx ? "claim" : "play"),
    seatLabel: (s) => `${s + 1}号`,
    wallLeft: () => wall.length,
    pendingAction() {
      if (ended) return null;
      if (claimCtx) {
        const cand = claimCtx.candidates[claimCtx.idx];
        return { seat: cand.seat, kind: "claim", actions: ["action:pass", ...cand.allows] };
      }
      const acts = hands[turn].map((t) => `discard:${t}`);
      if (drawn) {
        if (canHoraSelf(turn)) acts.push("action:hora");
        const c = countsOf(hands[turn]);
        for (let i = 0; i < N_KINDS; i += 1) {
          if (c[i] === 4) acts.push(`action:ankan:${idxTile(i)}`);
        }
        for (const m of melds[turn]) {
          if (m.type === "pon" && hands[turn].includes(m.tile)) acts.push(`action:kakan:${m.tile}`);
        }
      }
      return { seat: turn, kind: drawn ? "self" : "discard", actions: acts };
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "对局已结束" };
      const pending = this.pendingAction();
      if (!pending) return { ok: false, reason: "当前无可执行动作" };
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim();
      if (claimCtx) {
        const cand = claimCtx.candidates[claimCtx.idx];
        if (s === "action:pass") {
          claimCtx.idx += 1;
          const ev = [{ t: "pass", seat }];
          if (claimCtx.idx >= claimCtx.candidates.length) {
            const { from } = claimCtx;
            claimCtx = null;
            advanceTurn(from);
          }
          return { ok: true, events: ev };
        }
        if (s === "action:hora") {
          if (!cand.allows.includes("action:hora") || !canHora(seat, claimCtx.tile)) {
            return { ok: false, reason: "你不能胡这张牌（未听）" };
          }
          const { tile, from } = claimCtx;
          hands[seat] = [...hands[seat], tile];
          const fan = evalFan(hands[seat], melds[seat]);
          scores[seat] += fan; scores[from] -= fan;
          claimCtx = null;
          const ev = [{ t: "hora", seat, from, tile, fan, hands: [...hands[seat]] }];
          events = [...events, ...ev];
          finishHora(seat, `${seat + 1}号 胡 ${from + 1}号 的 ${tileZh(tile)}（${fan} 番）`);
          return { ok: true, events: ev };
        }
        if (s === "action:pon" && cand.allows.includes("action:pon")) {
          const { tile, from } = claimCtx;
          removeTiles(seat, [tile, tile]);
          melds[seat] = [...melds[seat], { type: "pon", tile, from }];
          claimCtx = null;
          turn = seat; drawn = null;
          events = [...events, { t: "pon", seat, from, tile }];
          return { ok: true, events: [{ t: "pon", seat, from, tile }] };
        }
        if (s === "action:kan" && cand.allows.includes("action:kan")) {
          const { tile, from } = claimCtx;
          removeTiles(seat, [tile, tile, tile]);
          melds[seat] = [...melds[seat], { type: "kan", tile, from }];
          scores[from] -= 2; scores[seat] += 2; // 明杠：放杠者付 2（同血战价）
          claimCtx = null;
          events = [...events, { t: "kan", seat, from, tile }];
          turn = seat;
          const t = draw();
          if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kan", seat, from, tile }] }; }
          hands[seat] = sortTiles([...hands[seat], t]);
          drawn = t;
          events = [...events, { t: "draw", seat, tile: t }];
          return { ok: true, events: [{ t: "kan", seat, from, tile }] };
        }
        const chi = /^action:chi:(.+)$/.exec(s);
        if (chi && cand.allows.includes(s)) {
          const { tile, from } = claimCtx;
          const low = chi[1];
          const run = [low, idxTile(tileIdx(low) + 1), idxTile(tileIdx(low) + 2)];
          removeTiles(seat, run.filter((t) => t !== tile));
          melds[seat] = [...melds[seat], { type: "chi", tiles: run, from }];
          claimCtx = null;
          turn = seat; drawn = null;
          events = [...events, { t: "chi", seat, from, tile, run }];
          return { ok: true, events: [{ t: "chi", seat, from, tile, run }] };
        }
        return { ok: false, reason: `表态动作不在清单里（你可用的：${["action:pass", ...cand.allows].join(" ")}）` };
      }
      // 打牌轮（turn 家）
      if (s === "action:hora" || s.startsWith("action:hora")) {
        if (!canHoraSelf(seat)) return { ok: false, reason: "你的手牌不构成胡牌型（或未摸牌）" };
        const fan = evalFan(hands[seat], melds[seat]) + 1; // 自摸 +1
        for (let o = 0; o < 4; o += 1) if (o !== seat) { scores[o] -= fan; scores[seat] += fan; }
        const wonTile = drawn;
        drawn = null;
        const ev = [{ t: "hora", seat, from: -1, tile: wonTile, fan, hands: [...hands[seat]] }];
        events = [...events, ...ev];
        finishHora(seat, `${seat + 1}号 自摸 ${wonTile ? tileZh(wonTile) : ""}（${fan} 番，三家各付）`);
        return { ok: true, events: ev };
      }
      const ank = /^action:ankan:(.+)$/.exec(s);
      if (ank) {
        const tile = ank[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "暗杠只能在刚摸牌后进行" };
        const c = countsOf(hands[seat]);
        if (c[tileIdx(tile)] < 4) return { ok: false, reason: `你没有 4 张 ${tileZh(tile)}` };
        removeTiles(seat, [tile, tile, tile, tile]);
        melds[seat] = [...melds[seat], { type: "ankan", tile, from: seat }];
        for (let o = 0; o < 4; o += 1) if (o !== seat) { scores[o] -= 2; scores[seat] += 2; }
        events = [...events, { t: "ankan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "ankan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "ankan", seat, tile }] };
      }
      const kak = /^action:kakan:(.+)$/.exec(s);
      if (kak) {
        const tile = kak[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "补杠只能在刚摸牌后进行" };
        if (!melds[seat].some((m) => m.type === "pon" && m.tile === tile) || !hands[seat].includes(tile)) {
          return { ok: false, reason: `补杠需要已有 ${tileZh(tile)} 的碰且摸到第 4 张` };
        }
        removeTiles(seat, [tile]);
        melds[seat] = [...melds[seat], { type: "kakan", tile, from: seat }];
        for (let o = 0; o < 4; o += 1) if (o !== seat) { scores[o] -= 2; scores[seat] += 2; }
        events = [...events, { t: "kakan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kakan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "kakan", seat, tile }] };
      }
      const dm = /^discard:(.+)$/.exec(s);
      if (!dm) return { ok: false, reason: '动作格式："discard:5m" 打牌 / "action:hora" 自摸胡 / "action:ankan:2s" 暗杠 / "action:kakan:2s" 补杠 / "action:chi:4m" 吃' };
      const tile = dm[1];
      const valid = hands[seat].includes(tile);
      if (!valid) return { ok: false, reason: `你没有 ${HONORS.includes(tile) ? tileZh(tile) : tile} 这张牌（字牌用大写：E东 S南 W西 N北 C中 F发 B白）` };
      removeTiles(seat, [tile]);
      afterPlay(seat, tile);
      return { ok: true, events: [{ t: "discard", seat, tile }] };
    },
    result: () => ended,
    viewFor(seat) {
      const handText = hands[seat].map((t) => tileZh(t)).join(" ");
      const meldText = (s) => melds[s].map((m) => ({ chi: "吃", pon: "碰", kan: "明杠", ankan: "暗杠", kakan: "补杠" }[m.type]) + (m.type === "chi" ? m.tiles.map(tileZh).join("") : tileZh(m.tile))).join("、") || "无";
      const riverText = (s) => discards[s].map((t) => tileZh(t)).join("") || "空";
      const recent = events.slice(-24).map((e) => {
        const who = (x) => (x === seat ? "你" : `${x + 1}号`);
        switch (e.t) {
          case "draw": return `${who(e.seat)}摸牌${e.seat === seat ? `（${tileZh(e.tile)}）` : ""}`;
          case "discard": return `${who(e.seat)}打 ${tileZh(e.tile)}`;
          case "chi": return `${who(e.seat)}吃 ${tileZh(e.tile)}（${e.run.map(tileZh).join("")}）`;
          case "pon": return `${who(e.seat)}碰 ${tileZh(e.tile)}`;
          case "kan": return `${who(e.seat)}明杠 ${tileZh(e.tile)}`;
          case "ankan": return `${who(e.seat)}暗杠`;
          case "kakan": return `${who(e.seat)}补杠 ${tileZh(e.tile)}`;
          case "hora": return e.from === -1 || e.from == null ? `${who(e.seat)}自摸胡！（${e.fan} 番）` : `${who(e.seat)}胡 ${who(e.from)} 的 ${tileZh(e.tile)}（${e.fan} 番）`;
          case "pass": return `${who(e.seat)}过`;
          default: return e.t;
        }
      }).join("；");
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => `${s + 1}号（${hands[s].length}张）：副露 ${meldText(s)}，牌河 ${riverText(s)}`).join("\n");
      const waits = waitTiles(hands[seat]);
      const pend = this.pendingAction();
      return [
        `【广东推倒胡（鸡平胡）】136 张（万筒索+字牌东南西北中发白），可吃碰杠、无定缺、胡即终局。番种：平胡1/对对胡+2/混一色+2/清一色+4/字一色+8（可叠），自摸+1。你是 ${seat + 1} 号位，累计 ${scores[seat]} 分。`,
        "牌串写法：数牌=数字+小写花色（如 5m 五万、3s 三索）；字牌大写字母（E东 S南 W西 N北 C中 F发 B白）。",
        `你的手牌（${hands[seat].length} 张）：${handText}`,
        drawn && turn === seat && !claimCtx ? `你刚摸到：${tileZh(drawn)}` : "",
        waits.length ? `你已听牌，待牌：${waits.map((w) => tileZh(w)).join("、")}` : "",
        `其余三家：\n${others}`,
        `事件（最近）：${recent || "开局"}`,
        pend && pend.seat === seat ? `轮到你。可行动作：${pend.actions.join(" ")}` : "等待其他玩家…",
        '输出格式：{"move":"discard:5m","comment":"一句话思路"}（动作必须严格从上面清单里选）',
      ].filter(Boolean).join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      if (pend.kind === "claim") {
        if (pend.actions.includes("action:hora")) return "action:hora";
        if (pend.actions.some((a) => a.startsWith("action:chi:"))) {
          // 能吃：只在听牌改善或手顺≤1 搭子时吃？代走简化：不吃（吃会锁边张，
          // 弱代走宁可不鸣）——与血战「不表态自动过」同口径
        }
        return "action:pass";
      }
      if (pend.actions.includes("action:hora")) return "action:hora";
      const hand = hands[seat];
      // 听牌优先：打哪张后能听
      for (const t of new Set(hand)) {
        const rest = [...hand]; rest.splice(rest.indexOf(t), 1);
        if (waitTiles(rest).length > 0) return `discard:${t}`;
      }
      const worst = [...new Set(hand)].sort((a, b) => tileIsolation(hand, a) - tileIsolation(hand, b))[0];
      return `discard:${worst}`;
    },
    getState() {
      return {
        phase: this.phase(), wall: wall.length,
        hands: hands.map((h) => [...h]), melds: melds.map((m) => [...m]),
        discards: discards.map((d) => [...d]), scores: [...scores],
        // MahjongTable 均一渲染口径：alive 全真/won 全假/lacks 空（推倒胡无定缺不退场）
        alive: [true, true, true, true], won: [false, false, false, false], lacks: [null, null, null, null],
        turn, drawn,
      };
    },
    exportEvents: () => [...events],
  };
}

registerGame({
  id: "mahjong-guangdong",
  label: "广东推倒胡",
  short: "推倒胡",
  desc: "136 张可吃碰杠，番种计分，胡即终局",
  order: 8,
  cat: "mahjong",
  color: "#2f6fa8",
  boardKind: "mahjong",
  seats: 4,
  minSeats: 4,
  createGame: createGuangdongGame,
});
