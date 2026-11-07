/**
 * 军棋翻翻棋（QQ 翻翻棋口径，games2 追加卡位 1/2）：全盘 12×5 混摆双方
 * 各 25 子（全暗），先翻先得（翻开即归翻者）；走法/吃子复用军棋引擎
 * （movementTargets + RANK 表——junqi.js 抽出的共享层）。
 *
 * 简化口径（对局摘要声明）：
 *  - 摆位：全盘 50 可摆位（60 格 − 10 行营）恰好填 50 子，双方混洗全暗；
 *  - 同级相拼：进攻方胜（翻棋特例，区别于暗棋同尽——QQ 主流口径）；
 *  - 工兵挖雷、炸弹与任何子同尽、司令>…>工兵、军旗不能动且最小（翻到=白得死子）；
 *  - 大本营格视为普通格（无扛旗、不锁死）；行营仍是安全区+8 向；
 *  - 一手 = 翻子 "flip:A7" 或走子 "move:A1-A2"；首手必须翻；
 *  - 胜负：对方全灭（无翻到且场上的活子）或无合法动作 → 胜；300 手帽按
 *    剩余子力价值（VALUE 表）排。
 */
import { registerGame } from "../registry.js";
import { RANK, VALUE, CAMPS, coordName, parseCoord, isRail, movementTargets, FULL_SET } from "./junqi.js";

const N_ROWS = 12;
const isCamp = (r, c) => CAMPS.some((side) => side.some(([rr, cc]) => rr === r && cc === c));

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 全盘 50 可摆位（去行营），从上到下、从左到右。 */
export function allCells() {
  const out = [];
  for (let r = 0; r < N_ROWS; r += 1) for (let c = 0; c < 5; c += 1) if (!isCamp(r, c)) out.push([r, c]);
  return out;
}

/** 翻棋走法：共享走法过滤掉未翻子（side=null）——未翻子是阻挡物不可攻击
 *  不可落子（QQ 口径：只能翻它，不能撞它）。 */
function fanqiTargets(board, r, c) {
  return movementTargets(board, r, c, { hqLock: false }).filter(([rr, cc]) => board[rr][cc]?.side !== null);
}

export function createFanqiGame({ seed = Date.now() % 2 ** 31 } = {}) {
  const rng = mulberry32(seed);
  // 双方 50 子混洗摆全盘（type + 归属=翻开者；side 初始 null=未翻）
  const pieces = [...FULL_SET, ...FULL_SET].map((type) => ({ type, side: null, revealed: false }));
  for (let i = pieces.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  const cells = allCells();
  const board = Array.from({ length: N_ROWS }, () => new Array(5).fill(null));
  cells.forEach(([r, c], i) => { board[r][c] = pieces[i]; });
  const deadBy = [[], []];
  let turn = 0; // seat 0 先手（首手必须翻）
  let moveCount = 0;
  const hist = [];
  let ended = null;
  let lastDetail = null;
  const CAP = 300;

  const pieceAt = (r, c) => board[r][c];
  const liveValue = (seat) => {
    let v = 0;
    for (let r = 0; r < N_ROWS; r += 1) for (let c = 0; c < 5; c += 1) {
      const p = pieceAt(r, c);
      if (p && p.side === seat) v += VALUE[p.type] ?? 0;
    }
    return v;
  };

  /** 翻棋裁决：复用军棋表 + 同级进攻方胜特例。 */
  function resolveAttack(from, to, mover, victim) {
    const at = coordName(...to);
    let moverDies = false, victimDies = false, note = "";
    if (mover.type === "炸弹" || victim.type === "炸弹") { moverDies = true; victimDies = true; note = "炸弹同归于尽"; }
    else if (victim.type === "地雷") {
      if (mover.type === "工兵") { victimDies = true; note = "工兵挖雷成功"; }
      else { moverDies = true; note = "撞上地雷阵亡"; }
    } else {
      const a = RANK[mover.type] ?? 0;
      const b = RANK[victim.type] ?? 0; // 军旗无 RANK=最小
      if (a > b) { victimDies = true; note = `${mover.type}吃掉${victim.type}`; }
      else if (a < b) { moverDies = true; note = `进攻失败，${victim.type}吃掉${mover.type}`; }
      else { victimDies = true; note = `${mover.type}同级相拼，进攻方胜（翻棋口径）`; }
    }
    if (victimDies) { deadBy[victim.side].push(victim.type); board[to[0]][to[1]] = null; }
    if (moverDies) { deadBy[mover.side].push(mover.type); board[from[0]][from[1]] = null; }
    if (!moverDies && victimDies) board[to[0]][to[1]] = mover;
    return { t: "battle", seat: mover.side, at, mover: mover.type, moverDies, victimDies, victimRevealed: victimDies ? victim.type : null, note };
  }

  const finish = (why) => {
    // 排名：先按存活价值（全灭=0），再按歼灭价值
    const stat = [0, 1].map((s) => ({ s, live: liveValue(s), kill: deadBy[1 - s].reduce((a, t) => a + (VALUE[t] ?? 0), 0) }));
    stat.sort((a, b) => (b.live + b.kill) - (a.live + a.kill));
    const ranks = [0, 0];
    ranks[stat[0].s] = 0; ranks[stat[1].s] = 1;
    ended = { over: true, ranks, draw: false, summary: why };
  };

  const hasAnyAction = (seat) => {
    if (cells.some(([r, c]) => pieceAt(r, c) && pieceAt(r, c).side === null)) return true; // 还有未翻子（谁都可翻）
    for (let r = 0; r < N_ROWS; r += 1) for (let c = 0; c < 5; c += 1) {
      const p = pieceAt(r, c);
      if (p && p.side === seat && fanqiTargets(board, r, c).length) return true;
    }
    return false;
  };

  return {
    seats: () => 2,
    phase: () => (ended ? "over" : "play"),
    seatLabel: (s) => (s === 0 ? "红方" : "蓝方"),
    pendingAction() {
      if (ended) return null;
      const acts = [];
      for (const [r, c] of cells) {
        const p = pieceAt(r, c);
        if (p && p.side === null) acts.push(`flip:${coordName(r, c)}`);
        else if (p && p.side === turn) {
          for (const [rr, cc] of fanqiTargets(board, r, c)) acts.push(`move:${coordName(r, c)}-${coordName(rr, cc)}`);
        }
      }
      if (!acts.length) { finish(`${turn === 0 ? "红方" : "蓝方"}无合法动作，判负`); return null; }
      return { seat: turn, kind: "play", actions: acts };
    },
    apply(seat, action) {
      if (ended) return { ok: false, reason: "对局已结束" };
      const pending = this.pendingAction();
      if (!pending) return { ok: false, reason: "当前无可执行动作" };
      if (pending.seat !== seat) return { ok: false, reason: "还没轮到你" };
      const s = String(action).trim();
      const fl = /^flip:([A-E](?:[1-9]|1[0-2]))$/i.exec(s);
      if (fl) {
        const p = parseCoord(fl[1]);
        const target = pieceAt(p.r, p.c);
        if (!target) return { ok: false, reason: `${fl[1]} 上没有棋子` };
        if (target.side !== null) return { ok: false, reason: `${fl[1]} 已翻开（归属${target.side === 0 ? "红" : "蓝"}方），只能走子或翻别的` };
        target.side = seat;
        target.revealed = true;
        hist.push({ seat, move: `翻${fl[1].toUpperCase()}=${target.type}` });
        lastDetail = { t: "flip", seat, at: fl[1].toUpperCase(), piece: target.type };
        moveCount += 1;
        turn = 1 - turn;
        if (moveCount >= CAP) finish("手数上限强制结算");
        return { ok: true, events: [lastDetail] };
      }
      const mm = /^move:([A-E](?:[1-9]|1[0-2]))-([A-E](?:[1-9]|1[0-2]))$/i.exec(s);
      if (!mm) return { ok: false, reason: '动作格式："flip:A7" 翻子 / "move:A1-A2" 走子' };
      const from = parseCoord(mm[1]);
      const to = parseCoord(mm[2]);
      const p = pieceAt(from.r, from.c);
      if (!p || p.side !== seat) return { ok: false, reason: `${mm[1].toUpperCase()} 上没有你翻开的棋子` };
      if (p.type === "地雷" || p.type === "军旗") return { ok: false, reason: `${p.type}不能移动` };
      const legal = fanqiTargets(board, from.r, from.c).some(([rr, cc]) => rr === to.r && cc === to.c);
      if (!legal) return { ok: false, reason: `${mm[1].toUpperCase()}→${mm[2].toUpperCase()} 不是合法着法（行营内不可被攻击、铁路直线不可越子、工兵可铁路转弯）` };
      const victim = pieceAt(to.r, to.c);
      let ev;
      if (victim) ev = resolveAttack([from.r, from.c], [to.r, to.c], p, victim);
      else {
        board[to.r][to.c] = p;
        board[from.r][from.c] = null;
        ev = { t: "move", seat, from: mm[1].toUpperCase(), to: mm[2].toUpperCase() };
      }
      hist.push({ seat, move: `${mm[1].toUpperCase()}-${mm[2].toUpperCase()}` });
      lastDetail = ev;
      moveCount += 1;
      // 全灭判定：对方场上无活子且无未翻子可翻（未翻子谁都可得——全灭只在无未翻时成立）
      const foe = 1 - seat;
      const unflipped = cells.some(([r, c]) => pieceAt(r, c)?.side === null);
      const foeAlive = cells.some(([r, c]) => pieceAt(r, c)?.side === foe);
      if (!foeAlive && !unflipped) finish(`${seat === 0 ? "红方" : "蓝方"}全歼对方获胜`);
      else if (moveCount >= CAP) finish("手数上限强制结算");
      else turn = 1 - turn;
      return { ok: true, events: [ev] };
    },
    result: () => ended,
    viewFor(seat) {
      const lines = [];
      lines.push(`【军棋翻翻棋】全盘混摆 50 子全暗，先翻先得（翻开即归你）；同级相拼进攻方胜、工兵挖雷、炸弹同尽、军旗不能动且最小。铁路粗线=直线滑行不可越子（工兵可转弯）、圆圈=行营安全区。${ended ? "对局已结束" : `轮到${turn === seat ? "你" : "对方"}`}。`);
      lines.push(`     A    B    C    D    E`);
      for (let r = 0; r < N_ROWS; r += 1) {
        const cellsTxt = [];
        for (let c = 0; c < 5; c += 1) {
          const p = pieceAt(r, c);
          const tag = isCamp(r, c) ? "营" : "　";
          if (!p) cellsTxt.push(`··${tag}`);
          else if (p.side === null) cellsTxt.push(`暗${tag}暗`);
          else cellsTxt.push(`${p.side === 0 ? "红" : "蓝"}${p.type}${tag}`);
        }
        lines.push(`${String(r + 1).padStart(2, " ")} ${cellsTxt.join(" ")}`);
      }
      const mine = cells.filter(([r, c]) => pieceAt(r, c)?.side === seat).map(([r, c]) => pieceAt(r, c).type);
      const dead = deadBy[seat];
      lines.push(`你已翻开 ${mine.length} 子：${mine.join("、") || "无"}｜已损失：${dead.join("、") || "无"}｜未翻子余 ${cells.filter(([r, c]) => pieceAt(r, c)?.side === null).length}`);
      const recent = hist.slice(-8).map((h) => `${h.seat === 0 ? "红" : "蓝"}${h.move}`).join("，");
      if (recent) lines.push(`最近（旧→新）：${recent}`);
      const pend = this.pendingAction();
      if (pend && pend.seat === seat) lines.push(`轮到你。可行动作 ${pend.actions.length} 个（示例：${pend.actions.slice(0, 8).join(" ")}${pend.actions.length > 8 ? " …" : ""}）。`);
      return lines.join("\n");
    },
    suggestAction(seat) {
      const pend = this.pendingAction();
      if (!pend) return null;
      // 前几手先翻（占地）；有确定吃子（身份公开）优先吃
      const attacks = pend.actions.filter((a) => {
        if (!a.startsWith("move:")) return false;
        const to = parseCoord(/-([A-E]\d+)$/i.exec(a)[1]);
        const v = board[to.r][to.c];
        if (!v || v.side === null) return false;
        const from = parseCoord(/^move:([A-E]\d+)/i.exec(a)[1]);
        const m = board[from.r][from.c];
        const win = m.type === "炸弹" ? false : v.type === "地雷" ? m.type === "工兵" : (RANK[m.type] ?? 0) > (RANK[v.type] ?? 0);
        return win;
      });
      if (attacks.length) return attacks[Math.floor(rng() * attacks.length)];
      const flips = pend.actions.filter((a) => a.startsWith("flip:"));
      const mine = cells.filter(([r, c]) => board[r][c]?.side === seat).length;
      if (flips.length && (mine < 5 || rng() < 0.4)) return flips[Math.floor(rng() * flips.length)];
      const moves = pend.actions.filter((a) => a.startsWith("move:"));
      const pool = moves.length ? moves : flips;
      return pool.length ? pool[Math.floor(rng() * pool.length)] : pend.actions[0];
    },
    getState() {
      return {
        phase: this.phase(), turn, moveCount, cap: CAP,
        board: board.map((row) => row.map((p) => (p ? { side: p.side, type: p.type, revealed: p.revealed } : null))),
        deadBy: deadBy.map((d) => [...d]),
        hist: hist.slice(-20), lastMove: lastDetail,
        revealAll: false,
      };
    },
  };
}

registerGame({
  id: "fanqi",
  label: "军棋翻翻棋",
  short: "翻翻棋",
  desc: "全盘 50 子混摆全暗，先翻先得，翻棋吃子军棋裁决",
  order: 11,
  cat: "board",
  color: "#7a5321",
  boardKind: "junqi",
  seats: 2,
  minSeats: 2,
  createGame: createFanqiGame,
});
