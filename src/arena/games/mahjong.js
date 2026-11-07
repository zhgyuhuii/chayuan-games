/**
 * 四川血战到底麻将裁判（games-llm-arena-plan Q4：108 张万筒索、定缺、无吃、
 * 血战（胡家离场继续打）、流局查叫 → 1-4 名结算；出招协议格式学 mjai 事件流
 * ——抄格式不抄规则；幼麟 qipai（无标准许可）代码一行不搬、只参考规则流程）。
 *
 * 简化口径（对局摘要声明，评审可砍）：
 *  - 胡牌型只收「4 面子 + 1 对子」（七对/龙七对不收——LLM 对局引入七对会
 *    显著放大听牌分析复杂度，且川麻各家规则本就不一）；
 *  - 计分固定化：平胡 1 番（点炮者付 1），自摸 +1 番（其余每家付 2）；
 *    明杠放杠者付 2，暗杠/补杠三家各付 2（共 6）；流局查叫：花猪（缺门
 *    未清）赔其余每家 16，普通未听赔已听每家 8；
 *  - 无抢杠胡、无根/番种细分——积分只用于 1-4 名排序（Q7 名次喂 TrueSkill）；
 *  - 一炮多响不收：多家同时可胡时从点炮者下家起顺时针第一家胡。
 *
 * 牌串："1m".."9m" 万 / "1p".."9p" 筒 / "1s".."9s" 索。
 * 动作：定缺 "lack:m|p|s"；打牌 "discard:5m"；表态 "action:pass|pon|kan|hora"；
 * 自摸轮暗杠 "action:ankan:2s"、补杠 "action:kakan:2s"、自摸胡 "action:hora"。
 */
import { registerGame } from "../registry.js";

const SUITS = ["m", "p", "s"];
const SUIT_ZH = { m: "万", p: "筒", s: "索" };
export const tileIdx = (t) => SUITS.indexOf(t[1]) * 9 + (Number(t[0]) - 1);
export const idxTile = (i) => `${(i % 9) + 1}${SUITS[Math.floor(i / 9)]}`;
export const tileZh = (t) => `${t[0]}${SUIT_ZH[t[1]]}`;
export const sortTiles = (tiles) => [...tiles].sort((a, b) => tileIdx(a) - tileIdx(b));

export function fullWall() {
  const wall = [];
  for (let s = 0; s < 3; s += 1) for (let n = 1; n <= 9; n += 1) {
    for (let k = 0; k < 4; k += 1) wall.push(`${n}${SUITS[s]}`);
  }
  return wall;
}

export function countsOf(tiles) {
  const c = new Array(27).fill(0);
  for (const t of tiles) c[tileIdx(t)] += 1;
  return c;
}

/** counts（27）能否全拆成面子（顺/刻，顺子不跨花色）。 */
function allMelds(c, min = 0) {
  let i = min;
  while (i < 27 && c[i] === 0) i += 1;
  if (i >= 27) return true;
  if (c[i] >= 3) { // 刻子
    c[i] -= 3;
    if (allMelds(c, i)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  const inSuit = i % 9 <= 6; // i,i+1,i+2 同花色（不跨 9）
  if (inSuit && c[i + 1] > 0 && c[i + 2] > 0) { // 顺子
    c[i] -= 1; c[i + 1] -= 1; c[i + 2] -= 1;
    if (allMelds(c, i)) { c[i] += 1; c[i + 1] += 1; c[i + 2] += 1; return true; }
    c[i] += 1; c[i + 1] += 1; c[i + 2] += 1;
  }
  return false;
}

/** tiles 是否为胡牌型（4 面子 + 1 对子）。 */
export function isWinHand(tiles) {
  if (tiles.length % 3 !== 2) return false;
  const c = countsOf(tiles);
  for (let i = 0; i < 27; i += 1) {
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
  for (let i = 0; i < 27; i += 1) {
    if (base[i] >= 4) continue;
    base[i] += 1;
    if (isWinHandCounts(base, tiles.length + 1)) waits.push(idxTile(i));
    base[i] -= 1;
  }
  return waits;
}
// counts 版胡牌判定（避免反复建数组）
function isWinHandCounts(c, total) {
  if (total % 3 !== 2) return false;
  const cc = [...c];
  for (let i = 0; i < 27; i += 1) {
    if (cc[i] >= 2) {
      cc[i] -= 2;
      if (allMelds(cc)) { cc[i] += 2; return true; }
      cc[i] += 2;
    }
  }
  return false;
}

/** 孤张价值：邻张越少价值越低（代走打缺门/孤张用）。 */
function tileIsolation(hand, tile) {
  const idx = tileIdx(tile);
  const suit0 = Math.floor(idx / 9) * 9;
  const has = (i) => i >= suit0 && i < suit0 + 9 && countsOf(hand)[i] > 0;
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

export function createMahjongGame({ seed = Date.now() % 2 ** 31, variant = "battle" } = {}) {
  const flow = variant === "flow"; // games2 Q5 血流成湖：胡家不清场（最小血流口径）
  const rng = mulberry32(seed);
  const wall = fullWall();
  for (let i = wall.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const hands = [[], [], [], []];
  for (let s = 0; s < 4; s += 1) hands[s] = sortTiles(wall.splice(0, 13));
  const discards = [[], [], [], []];
  const melds = [[], [], [], []]; // {type:'pon'|'kan'|'ankan'|'kakan', tile, from}
  const lacks = [null, null, null, null];
  const alive = [true, true, true, true];
  const won = [false, false, false, false]; // flow：胡过标记（血战恒 false，用 alive/finishedOrder）
  const scores = [0, 0, 0, 0];
  const finishedOrder = []; // 胡牌顺序（名次；battle 用）
  let phase = "lack"; // lack → play
  let turn = 0; // 庄家先
  let drawn = null; // 当前 turn 家刚摸的牌（未打出）
  let claimCtx = null; // { tile, from, candidates:[{seat, allows:[]}] }
  let events = [];
  let ended = null;

  /** flow 终局（Q5）：墙干或四家全胡 → 累计分排名（并列同名次）。 */
  const endFlow = (why) => {
    const order = [0, 1, 2, 3].sort((a, b) => scores[b] - scores[a]);
    const ranks = new Array(4);
    order.forEach((s, i) => { ranks[s] = i > 0 && scores[s] === scores[order[i - 1]] ? ranks[order[i - 1]] : i; });
    ended = { over: true, ranks, scores: [...scores], draw: false, summary: `${why}，按累计分排名（${order.map((s) => `${s + 1}号${scores[s]}分`).join("、")}）` };
  };

  const draw = () => (wall.length ? wall.pop() : null);
  const nextAlive = (from) => { for (let k = 1; k <= 4; k += 1) { const s = (from + k) % 4; if (alive[s]) return s; } return from; };
  const lackCleared = (seat) => !hands[seat].some((t) => t[1] === lacks[seat]);

  /** seat 能否胡 tile（含缺门约束）。 */
  const canHora = (seat, tile) => lackCleared(seat) && isWinHand([...hands[seat], tile]);
  /** seat 能否碰/杠 tile（含缺门约束：缺门未清一律不能碰杠胡）。 */
  const canPon = (seat, tile) => {
    if (!lackCleared(seat)) return false;
    if (tile[1] === lacks[seat]) return false; // 缺门牌不能碰杠
    return hands[seat].filter((t) => t === tile).length >= 2;
  };
  const canKan = (seat, tile) => {
    if (!lackCleared(seat)) return false;
    if (tile[1] === lacks[seat]) return false;
    return hands[seat].filter((t) => t === tile).length >= 3;
  };

  /** 打牌后进入表态轮询（Q4 简化：胡优先、下家起顺时针，一炮不多响；
   *  flow：已胡家不参与表态——只能自摸，不能荣和/碰/杠别家（Q5 口径）。 */
  const openClaims = (from, tile) => {
    const cands = [];
    for (let k = 1; k <= 3; k += 1) {
      const s = (from + k) % 4;
      if (!alive[s]) continue;
      if (flow && won[s]) continue;
      const allows = [];
      if (canHora(s, tile)) allows.push("action:hora");
      if (canKan(s, tile)) allows.push("action:kan");
      if (canPon(s, tile)) allows.push("action:pon");
      if (allows.length) cands.push({ seat: s, allows });
    }
    cands.sort((a, b) => (b.allows.includes("action:hora") ? 1 : 0) - (a.allows.includes("action:hora") ? 1 : 0)); // 胡优先
    if (cands.length) claimCtx = { tile, from, candidates: cands, idx: 0 };
    else advanceTurn(from);
  };

  /** 轮转到下一家摸牌；牌墙尽 → 流局。 */
  const advanceTurn = (from) => {
    if (ended) return;
    turn = nextAlive(from);
    const t = draw();
    if (!t) { finishRyuukyoku(); return; }
    hands[turn] = sortTiles([...hands[turn], t]);
    drawn = t;
    events = [...events, { t: "draw", seat: turn, tile: t }];
  };
  /** 自摸胡判定（含缺门）。 */
  const canHoraSelf = (seat) => lackCleared(seat) && isWinHand(hands[seat]);

  const finishRyuukyoku = () => {
    // flow：查叫只查从未胡过的家（胡过视同已听，Q5）；随后累计分终局
    if (flow) {
      const rest = [0, 1, 2, 3].filter((s) => !won[s]);
      const tenpai = rest.filter((s) => lackCleared(s) && waitTiles(hands[s]).length > 0);
      const noten = rest.filter((s) => !tenpai.includes(s));
      for (const s of noten) {
        const pig = !lackCleared(s);
        for (const o of [0, 1, 2, 3].filter((x) => x !== s)) {
          const pay = pig ? 16 : (won[o] || tenpai.includes(o) ? 8 : 0);
          scores[s] -= pay; scores[o] += pay;
        }
      }
      endFlow(`牌墙摸干（查叫：未胡未听 ${noten.map((s) => `${s + 1}号${lackCleared(s) ? "" : "（花猪）"}`).join("、") || "无"}）`);
      return;
    }
    // 查叫：花猪赔全场、未听赔已听（简化口径见头注）
    const rest = [0, 1, 2, 3].filter((s) => alive[s]);
    // 听牌判定带缺门约束（缺门未清=花猪，单列；待牌可为缺门牌不算听）
    const tenpai = rest.filter((s) => lackCleared(s) && waitTiles(hands[s]).length > 0);
    const noten = rest.filter((s) => !tenpai.includes(s));
    for (const s of noten) {
      const pig = !lackCleared(s);
      for (const o of [0, 1, 2, 3].filter((x) => x !== s && alive[x])) {
        const pay = pig ? 16 : (tenpai.includes(o) ? 8 : 0);
        scores[s] -= pay; scores[o] += pay;
      }
    }
    const restRank = [...rest].sort((a, b) => scores[b] - scores[a]);
    const places = [...finishedOrder, ...restRank]; // 按名次排的 seat
    const ranks = new Array(4).fill(3);
    places.forEach((seat, place) => { ranks[seat] = place; });
    ended = {
      over: true,
      ranks,
      scores: [...scores],
      draw: false,
      summary: `流局（查叫：听牌 ${tenpai.map((s) => `${s + 1}号`).join("、") || "无"}；未听 ${noten.map((s) => `${s + 1}号${lackCleared(s) ? "" : "（花猪）"}`).join("、") || "无"}）`,
    };
  };

  const afterPlay = (seat, tile) => {
    discards[seat] = [...discards[seat], tile];
    events = [...events, { t: "discard", seat, tile }];
    drawn = null;
    openClaims(seat, tile);
  };

  return {
    seats: () => 4,
    phase: () => (ended ? "over" : phase === "lack" ? "lack" : claimCtx ? "claim" : "play"),
    seatLabel: (s) => `${s + 1}号`,
    wallLeft: () => wall.length,
    pendingAction() {
      if (ended) return null;
      if (phase === "lack") {
        const seat = lacks.findIndex((l) => l == null);
        if (seat < 0) return null;
        return { seat, kind: "lack", actions: ["lack:m", "lack:p", "lack:s"] };
      }
      if (claimCtx) {
        const cand = claimCtx.candidates[claimCtx.idx];
        return { seat: cand.seat, kind: "claim", actions: ["action:pass", ...cand.allows] };
      }
      const acts = hands[turn].map((t) => `discard:${t}`);
      if (drawn && lackCleared(turn)) {
        if (canHoraSelf(turn)) acts.push("action:hora");
        // 杠类动作：flow 已胡家不杠（Q5 简化口径——只能摸/打/自摸胡）
        if (!(flow && won[turn])) {
          // 暗杠：手里 4 张同牌（含刚摸；缺门花色不可杠）
          const c = countsOf(hands[turn]);
          for (let i = 0; i < 27; i += 1) {
            const tile = idxTile(i);
            if (c[i] === 4 && tile[1] !== lacks[turn]) acts.push(`action:ankan:${tile}`);
          }
          // 补杠：已有碰 + 摸到第 4 张
          for (const m of melds[turn]) {
            if (m.type === "pon" && hands[turn].includes(m.tile) && m.tile[1] !== lacks[turn]) acts.push(`action:kakan:${m.tile}`);
          }
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
      if (phase === "lack") {
        const m = /^lack:([mps])$/.exec(s);
        if (!m) return { ok: false, reason: '定缺格式："lack:m" / "lack:p" / "lack:s"' };
        lacks[seat] = m[1];
        events = [...events, { t: "lack", seat, lack: m[1] }];
        if (lacks.every((l) => l != null)) {
          phase = "play";
          // 庄家进第一摸：把第 14 张补上
          turn = 0;
          const t = draw();
          if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "lack", seat, lack: m[1] }] }; }
          hands[0] = sortTiles([...hands[0], t]);
          drawn = t;
          events = [...events, { t: "draw", seat: 0, tile: t }];
        }
        return { ok: true, events: [{ t: "lack", seat, lack: m[1] }] };
      }
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
            return { ok: false, reason: "你不能胡这张牌（未听牌/缺门未清）" };
          }
          const { tile, from } = claimCtx;
          hands[seat] = [...hands[seat], tile];
          const fan = 1;
          scores[seat] += fan; scores[from] -= fan;
          if (flow) {
            // Q5 血流：胡家不清场——计分后手牌 3n+2，打一张继续；四家全胡即终局
            won[seat] = true;
            claimCtx = null;
            const ev = [{ t: "hora", seat, from, tile, hands: [...hands[seat]] }];
            events = [...events, ...ev];
            if (won.every(Boolean)) { endFlow("四家全胡"); return { ok: true, events: ev }; }
            turn = seat; drawn = null; // 胡家打一张（不离场）
            return { ok: true, events: ev };
          }
          alive[seat] = false;
          finishedOrder.push(seat);
          claimCtx = null;
          const ev = [{ t: "hora", seat, from, tile, hands: [...hands[seat]] }];
          const rest = [0, 1, 2, 3].filter((x) => alive[x]);
          if (rest.length <= 1) {
            const places = [...finishedOrder, ...rest];
            const ranks = new Array(4).fill(3);
            places.forEach((seat, place) => { ranks[seat] = place; });
            ended = { over: true, ranks, scores: [...scores], summary: `血战结束：${finishedOrder.map((x) => `${x + 1}号胡`).join("、")}` };
          } else {
            // 血战续局统一口径：从胡牌者（离场者）下家继续摸
            turn = nextAlive(seat);
            const t = draw();
            if (!t) { events = [...events, ...ev]; finishRyuukyoku(); return { ok: true, events: ev }; }
            hands[turn] = sortTiles([...hands[turn], t]);
            drawn = t;
            events = [...events, ...ev, { t: "draw", seat: turn, tile: t }];
          }
          return { ok: true, events: ev };
        }
        if (s === "action:pon" && cand.allows.includes("action:pon")) {
          const { tile, from } = claimCtx;
          const rm = [tile, tile];
          hands[seat] = hands[seat].filter((t) => { if (rm.includes(t)) { rm.splice(rm.indexOf(t), 1); return false; } return true; });
          melds[seat] = [...melds[seat], { type: "pon", tile, from }];
          claimCtx = null;
          turn = seat; drawn = null; // 碰后必须打一张（不摸）
          events = [...events, { t: "pon", seat, from, tile }];
          return { ok: true, events: [{ t: "pon", seat, from, tile }] };
        }
        if (s === "action:kan" && cand.allows.includes("action:kan")) {
          const { tile, from } = claimCtx;
          const rm = [tile, tile, tile];
          hands[seat] = hands[seat].filter((t) => { if (rm.includes(t)) { rm.splice(rm.indexOf(t), 1); return false; } return true; });
          melds[seat] = [...melds[seat], { type: "kan", tile, from }];
          scores[from] -= 2; scores[seat] += 2; // 明杠：放杠者付 2
          claimCtx = null;
          events = [...events, { t: "kan", seat, from, tile }];
          // 杠后摸岭上牌
          turn = seat;
          const t = draw();
          if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kan", seat, from, tile }] }; }
          hands[seat] = sortTiles([...hands[seat], t]);
          drawn = t;
          events = [...events, { t: "draw", seat, tile: t }];
          return { ok: true, events: [{ t: "kan", seat, from, tile }] };
        }
        return { ok: false, reason: `表态动作须为 pass/pon/kan/hora（你可用的：${["action:pass", ...cand.allows].join(" ")}）` };
      }
      // 打牌轮（turn 家）
      if (s.startsWith("action:hora")) {
        if (!canHoraSelf(seat)) return { ok: false, reason: "你的手牌不构成胡牌型（或缺门未清/未摸牌）" };
        if (flow) {
          // Q5 血流：自摸计分（其余三家各付 2）后打一张继续；四家全胡即终局
          won[seat] = true;
          const fan = 2;
          for (let o = 0; o < 4; o += 1) if (o !== seat) { scores[o] -= fan; scores[seat] += fan; }
          const wonTile = drawn;
          drawn = null;
          const ev = [{ t: "hora", seat, from: -1, tile: wonTile, hands: [...hands[seat]] }];
          events = [...events, ...ev];
          if (won.every(Boolean)) { endFlow("四家全胡"); return { ok: true, events: ev }; }
          turn = seat; // 胡家打一张（不离场）
          return { ok: true, events: ev };
        }
        const fan = 2; // 自摸 1+1
        for (let o = 0; o < 4; o += 1) if (o !== seat && alive[o]) { scores[o] -= fan; scores[seat] += fan; }
        alive[seat] = false;
        finishedOrder.push(seat);
        const wonTile = drawn;
        drawn = null;
        const ev = [{ t: "hora", seat, from: -1, tile: wonTile, hands: [...hands[seat]] }];
        const rest = [0, 1, 2, 3].filter((x) => alive[x]);
        if (rest.length <= 1) {
          const places = [...finishedOrder, ...rest];
          const ranks = new Array(4).fill(3);
          places.forEach((seat, place) => { ranks[seat] = place; });
          ended = { over: true, ranks, scores: [...scores], summary: `血战结束：${finishedOrder.map((x) => `${x + 1}号自摸`).join("、")}` };
        } else {
          turn = nextAlive(seat); // 自摸者离场，下家摸
          const td = draw();
          if (!td) { events = [...events, ...ev]; finishRyuukyoku(); return { ok: true, events: ev }; }
          hands[turn] = sortTiles([...hands[turn], td]);
          drawn = td;
          events = [...events, ...ev, { t: "draw", seat: turn, tile: td }];
        }
        return { ok: true, events: ev };
      }
      const ank = /^action:ankan:(\d[mps])$/.exec(s);
      if (ank) {
        const tile = ank[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "暗杠只能在刚摸牌后进行" };
        if (!lackCleared(seat) || tile[1] === lacks[seat]) return { ok: false, reason: `缺门未清或缺门牌，不能杠 ${tileZh(tile)}` };
        const rm = [tile, tile, tile, tile];
        const c = countsOf(hands[seat]);
        if (c[tileIdx(tile)] < 4) return { ok: false, reason: `你没有 4 张 ${tileZh(tile)}` };
        hands[seat] = hands[seat].filter((t) => { if (rm.includes(t)) { rm.splice(rm.indexOf(t), 1); return false; } return true; });
        melds[seat] = [...melds[seat], { type: "ankan", tile, from: seat }];
        for (let o = 0; o < 4; o += 1) if (o !== seat && alive[o]) { scores[o] -= 2; scores[seat] += 2; } // 三家各付 2
        events = [...events, { t: "ankan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "ankan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "ankan", seat, tile }] };
      }
      const kak = /^action:kakan:(\d[mps])$/.exec(s);
      if (kak) {
        const tile = kak[1];
        if (!drawn || turn !== seat) return { ok: false, reason: "补杠只能在刚摸牌后进行" };
        if (!lackCleared(seat) || tile[1] === lacks[seat]) return { ok: false, reason: `缺门未清或缺门牌，不能杠 ${tileZh(tile)}` };
        if (!melds[seat].some((m) => m.type === "pon" && m.tile === tile) || !hands[seat].includes(tile)) {
          return { ok: false, reason: `补杠需要已有 ${tileZh(tile)} 的碰且摸到第 4 张` };
        }
        hands[seat] = hands[seat].filter((t, i) => !(t === tile && i === hands[seat].indexOf(tile)));
        melds[seat] = [...melds[seat], { type: "kakan", tile, from: seat }];
        for (let o = 0; o < 4; o += 1) if (o !== seat && alive[o]) { scores[o] -= 2; scores[seat] += 2; }
        events = [...events, { t: "kakan", seat, tile }];
        turn = seat;
        const t = draw();
        if (!t) { finishRyuukyoku(); return { ok: true, events: [{ t: "kakan", seat, tile }] }; }
        hands[seat] = sortTiles([...hands[seat], t]);
        drawn = t;
        events = [...events, { t: "draw", seat, tile: t }];
        return { ok: true, events: [{ t: "kakan", seat, tile }] };
      }
      const dm = /^discard:(\d[mps])$/.exec(s);
      if (!dm) return { ok: false, reason: '动作格式："discard:5m" 打牌 / "action:hora" 自摸胡 / "action:ankan:2s" 暗杠 / "action:kakan:2s" 补杠' };
      const tile = dm[1];
      if (!hands[seat].includes(tile)) return { ok: false, reason: `你没有 ${tileZh(tile)} 这张牌` };
      if (lacks[seat] && tile[1] !== lacks[seat] && hands[seat].some((t) => t[1] === lacks[seat])) {
        return { ok: false, reason: `你还没打完缺门（${SUIT_ZH[lacks[seat]]}），必须先打缺门牌` };
      }
      hands[seat] = hands[seat].filter((t, i) => !(t === tile && i === hands[seat].indexOf(tile)));
      afterPlay(seat, tile);
      return { ok: true, events: [{ t: "discard", seat, tile }] };
    },
    result: () => ended,
    viewFor(seat) {
      const handText = hands[seat].map((t) => tileZh(t)).join(" ");
      const meldText = (s) => melds[s].map((m) => ({ pon: "碰", kan: "明杠", ankan: "暗杠", kakan: "补杠" }[m.type]) + tileZh(m.tile)).join("、") || "无";
      const riverText = (s) => discards[s].map((t) => tileZh(t)).join("") || "空";
      const recent = events.slice(-24).map((e) => {
        const who = (x) => (x === seat ? "你" : `${x + 1}号`);
        switch (e.t) {
          case "draw": return `${who(e.seat)}摸牌${e.seat === seat ? `（${tileZh(e.tile)}）` : ""}`;
          case "discard": return `${who(e.seat)}打 ${tileZh(e.tile)}`;
          case "pon": return `${who(e.seat)}碰 ${tileZh(e.tile)}（来自${who(e.from)}）`;
          case "kan": return `${who(e.seat)}明杠 ${tileZh(e.tile)}`;
          case "ankan": return `${who(e.seat)}暗杠`;
          case "kakan": return `${who(e.seat)}补杠 ${tileZh(e.tile)}`;
          case "hora": return e.from === -1 || e.from == null ? `${who(e.seat)}自摸胡！` : `${who(e.seat)}胡 ${who(e.from)} 的 ${tileZh(e.tile)}`;
          case "pass": return `${who(e.seat)}过`;
          case "lack": return `${who(e.seat)}定缺${SUIT_ZH[e.lack]}`;
          default: return e.t;
        }
      }).join("；");
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => {
        const st = flow
          ? `${hands[s].length}张${won[s] ? `，已胡（继续在打，累计 ${scores[s]} 分）` : ""}`
          : alive[s] ? `${hands[s].length}张` : "已胡离场";
        return `${s + 1}号（${st}${lacks[s] ? `，缺${SUIT_ZH[lacks[s]]}` : ""}）：副露 ${meldText(s)}，牌河 ${riverText(s)}`;
      }).join("\n");
      const waits = (flow || alive[seat]) && lackCleared(seat) ? waitTiles(hands[seat]) : [];
      const pend = this.pendingAction();
      return [
        flow
          ? `【四川血流成湖】108 张（万筒索），定缺、无吃、可碰杠、血流成湖：胡了不清场继续打可多次胡；已胡家只能自摸（不能碰杠/荣和）。你是 ${seat + 1} 号位，累计 ${scores[seat]} 分。`
          : `【四川血战麻将】108 张（万筒索），定缺、无吃、可碰杠、血战到底（胡家离场继续）。你是 ${seat + 1} 号位。`,
        flow && won[seat] ? `你已胡过——继续摸打，只能自摸再胡` : "",
        lacks[seat] ? `你的缺门：${SUIT_ZH[lacks[seat]]}${lackCleared(seat) ? "（已清）" : "（未清：碰杠胡不可用，打牌必须先打缺门）"}` : "",
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
      if (pend.kind === "lack") {
        // 缺手里最少的那门（Q4：缺门价值最低代打的反面——定缺选张数最少的门）
        const c = { m: 0, p: 0, s: 0 };
        for (const t of hands[seat]) c[t[1]] += 1;
        return `lack:${["m", "p", "s"].sort((a, b) => c[a] - c[b])[0]}`;
      }
      if (pend.kind === "claim") {
        if (pend.actions.includes("action:hora")) return "action:hora"; // 能胡就胡
        return "action:pass"; // Q4：碰/杠/胡不表态 → 自动过
      }
      if (pend.actions.includes("action:hora")) return "action:hora";
      // 打牌：缺门未清 → 缺门里价值最低；否则听牌打法；否则最孤张
      const hand = hands[seat];
      if (!lackCleared(seat)) {
        const lacksTiles = hand.filter((t) => t[1] === lacks[seat]);
        const best = [...lacksTiles].sort((a, b) => tileIsolation(hand, a) - tileIsolation(hand, b))[0];
        return `discard:${best}`;
      }
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
      phase: this.phase(), lacks: [...lacks], wall: wall.length,
      hands: hands.map((h) => [...h]), melds: melds.map((m) => [...m]),
      discards: discards.map((d) => [...d]), alive: [...alive], won: [...won], scores: [...scores],
      finishedOrder: [...finishedOrder], turn, drawn,
      };
    },
    // 棋谱导出（mjai 式事件全量）
    exportEvents: () => [...events],
  };
}

registerGame({
  id: "mahjong",
  label: "四川血战麻将",
  short: "血战麻将",
  desc: "108 张万筒索，定缺无吃血战到底，流局查叫",
  order: 4,
  cat: "mahjong",
  color: "#3aa675",
  boardKind: "mahjong",
  seats: 4,
  minSeats: 4,
  createGame: createMahjongGame,
});

// games2 Q5：血流成湖（最小血流）——同引擎 variant=flow（胡家不清场/多次计胡/
// 墙干或四家全胡终局/查叫只查未胡家），共享渲染与协议，TrueSkill 独立分桶。
registerGame({
  id: "mahjong-xueliu",
  label: "四川血流成湖",
  short: "血流成湖",
  desc: "108 张定缺无吃，胡了不清场继续血拼，可多次胡",
  order: 9,
  color: "#b0483a",
  boardKind: "mahjong",
  seats: 4,
  minSeats: 4,
  createGame: ({ seed }) => createMahjongGame({ seed, variant: "flow" }),
});
