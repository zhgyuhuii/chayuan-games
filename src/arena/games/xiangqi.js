/**
 * 中国象棋裁判（games-llm-arena-plan Q1：走子生成/校验、将军/将死/困毙
 * 检测 100% 归代码）。规则核心按中国象棋通则自写（原计划嵌入的
 * lengyanyu258/xiangqi.js (BSD-2) 最终未进包——接口需与 GameReferee 四件套
 * 1:1 对齐，自写反而零适配成本；象棋规则本身不受版权保护，第三方声明义务
 * 随之消失。GPL 的 chessgroundx 只作视觉参考未抄一行，棋盘组件自绘）。
 *
 * 坐标：内部 (row 0-9, col 0-8)，row0 = 黑方底线（棋盘上方）、row9 = 红方
 * 底线。对外动作用 ICCS 式串 <列a-i><行1-10>（行 1 = 红底），如 "h2e2" =
 * 炮二平五（红炮从 h2 到 e2）。棋子类型：K帅 A仕 B相 N马 R车 C炮 P兵。
 *
 * 简化口径（对局摘要声明）：不裁长将/长捉（重复局面 3 次直接判和，中国
 * 象棋竞赛规则 2020 的长打判罚对 LLM 对局过重）；半回合 250 上限判和。
 */
import { registerGame } from "../registry.js";

export const COLS = "abcdefghi";
// 黑方用传统字（車馬砲將）——红黑全部字符唯一，棋盘文本图无歧义
const PIECE_ZH = {
  rK: "帅", rA: "仕", rB: "相", rN: "马", rR: "车", rC: "炮", rP: "兵",
  bK: "將", bA: "士", bB: "象", bN: "馬", bR: "車", bC: "砲", bP: "卒",
};
const VALUE = { K: 10000, R: 900, C: 450, N: 400, P: 100, A: 200, B: 200 };
const HALF_MOVE_LIMIT = 250;

export const sq = (r, c) => `${COLS[c]}${10 - r}`;
export function parseSq(s) {
  if (typeof s !== "string" || s.length < 2) return null;
  const c = COLS.indexOf(s[0]);
  const n = parseInt(s.slice(1), 10);
  if (c < 0 || !Number.isInteger(n) || n < 1 || n > 10) return null;
  return { r: 10 - n, c };
}

/** 初始局面：row0 黑底线 … row9 红底线。 */
export function initialBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  const back = ["R", "N", "B", "A", "K", "A", "B", "N", "R"];
  back.forEach((t, c) => { b[0][c] = { side: "b", type: t }; b[9][c] = { side: "r", type: t }; });
  b[2][1] = { side: "b", type: "C" }; b[2][7] = { side: "b", type: "C" };
  b[7][1] = { side: "r", type: "C" }; b[7][7] = { side: "r", type: "C" };
  for (let c = 0; c < 9; c += 2) { b[3][c] = { side: "b", type: "P" }; b[6][c] = { side: "r", type: "P" }; }
  return b;
}

const inBoard = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const inPalace = (side, r, c) => c >= 3 && c <= 5 && (side === "r" ? r >= 7 : r <= 2);
const ownHalf = (side, r) => (side === "r" ? r >= 5 : r <= 4);
/** side 的兵是否已过河。 */
const crossed = (side, r) => (side === "r" ? r <= 4 : r >= 5);

/** 一枚棋子的伪合法走法（不含送将过滤）。 */
function pieceMoves(board, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const { side, type } = p;
  const foe = side === "r" ? "b" : "r";
  const out = [];
  const push = (rr, cc) => {
    if (!inBoard(rr, cc)) return false;
    const t = board[rr][cc];
    if (t && t.side === side) return false; // 己方子挡
    out.push([rr, cc]);
    return !t; // 空格可继续滑
  };
  if (type === "R") {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let rr = r + dr, cc = c + dc;
      while (inBoard(rr, cc)) { if (!push(rr, cc)) break; rr += dr; cc += dc; }
    }
  } else if (type === "C") {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let rr = r + dr, cc = c + dc, jumped = false;
      while (inBoard(rr, cc)) {
        const t = board[rr][cc];
        if (!jumped) {
          if (!t) out.push([rr, cc]); // 空位可移
          else jumped = true; // 越过炮架
        } else if (t) { // 炮架后第一个子
          if (t.side === foe) out.push([rr, cc]);
          break;
        }
        rr += dr; cc += dc;
      }
    }
  } else if (type === "N") {
    for (const [dr, dc] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]]) {
      const legR = r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
      const legC = c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
      if (inBoard(legR, legC) && !board[legR][legC]) push(r + dr, c + dc); // 蹩马腿
    }
  } else if (type === "B") {
    for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      const rr = r + dr, cc = c + dc;
      if (!inBoard(rr, cc) || !ownHalf(side, rr)) continue; // 不过河
      if (!board[r + dr / 2][c + dc / 2]) push(rr, cc); // 塞象眼
    }
  } else if (type === "A") {
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (inPalace(side, rr, cc)) push(rr, cc);
    }
  } else if (type === "K") {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (inPalace(side, rr, cc)) push(rr, cc);
    }
  } else if (type === "P") {
    const dy = side === "r" ? -1 : 1;
    push(r + dy, c);
    if (crossed(side, r)) { push(r, c - 1); push(r, c + 1); } // 过河可横
  }
  return out;
}

function findKing(board, side) {
  for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) {
    const p = board[r][c];
    if (p && p.side === side && p.type === "K") return { r, c };
  }
  return null;
}

/** side 是否被将军（含将帅对脸 = 任一方可直接"飞"吃对方帅）。 */
export function inCheck(board, side) {
  const k = findKing(board, side);
  if (!k) return true; // 无帅（不该发生）视为被将
  const foe = side === "r" ? "b" : "r";
  for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) {
    const p = board[r][c];
    if (!p || p.side !== foe) continue;
    for (const [rr, cc] of pieceMoves(board, r, c)) {
      if (rr === k.r && cc === k.c) return true;
    }
    // 飞将：敌帅与本帅同列且中间无子
    if (p.type === "K" && c === k.c) {
      let clear = true;
      for (let rr = Math.min(r, k.r) + 1; rr < Math.max(r, k.r); rr += 1) {
        if (board[rr][c]) { clear = false; break; }
      }
      if (clear) return true;
    }
  }
  return false;
}

/** 全部合法走法（走完不被将军、不对脸）。 */
export function legalMovesAll(board, side) {
  const out = [];
  for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) {
    const p = board[r][c];
    if (!p || p.side !== side) continue;
    for (const [rr, cc] of pieceMoves(board, r, c)) {
      const captured = board[rr][cc];
      board[rr][cc] = p; board[r][c] = null;
      const bad = inCheck(board, side);
      board[r][c] = p; board[rr][cc] = captured;
      if (!bad) out.push({ from: [r, c], to: [rr, cc], move: `${sq(r, c)}${sq(rr, cc)}`, piece: p, captured });
    }
  }
  return out;
}

/** 非法着法精准诊断（2026-11-06「大模型不守马走日」实锤：泛泛的「蹩腿/送将/
 *  越界」猜测回喂无法让弱模型自纠——指出具体哪个格子塞了哪颗子，重试回喂
 *  才有纠错信息量）。纯函数（board 显式传入），只诊断不放宽：文案拼进驳回
 *  原因，着法照拒。 */
export function illegalHint(board, raw, side) {
  const fromS = raw.length === 5 ? raw.slice(0, 3) : raw.slice(0, 2);
  const toS = raw.length === 5 ? raw.slice(3) : raw.slice(2);
  const from = parseSq(fromS);
  const to = parseSq(toS);
  if (!from || !to) return "";
  const p = board[from.r]?.[from.c];
  if (!p) return `：起点 ${fromS} 上没有棋子`;
  if (p.side !== side) return `：起点 ${fromS} 是对方棋子`;
  const dr = to.r - from.r, dc = to.c - from.c;
  if (p.type === "N" && ((Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2))) {
    const legR = from.r + (Math.abs(dr) === 2 ? Math.sign(dr) : 0);
    const legC = from.c + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
    const leg = board[legR]?.[legC];
    if (leg) return `：马腿被塞——${sq(legR, legC)} 上有 ${PIECE_ZH[`${leg.side}${leg.type}`]}，这步马走不了`;
    return `：这步马会送将/被将军`;
  }
  if (p.type === "B" && Math.abs(dr) === 2 && Math.abs(dc) === 2) {
    const eyeR = from.r + dr / 2, eyeC = from.c + dc / 2;
    const eye = board[eyeR]?.[eyeC];
    if (eye) return `：象眼被塞——${sq(eyeR, eyeC)} 上有 ${PIECE_ZH[`${eye.side}${eye.type}`]}`;
    return `：象不能过河`;
  }
  const cells = lineBlockers(board, from, to);
  const target = board[to.r]?.[to.c];
  if (p.type === "C") {
    if (target) return `：炮打子必须恰好隔一个炮架（此处 ${cells.length} 个）`;
    if (cells.length > 0) return `：路径被 ${PIECE_ZH[`${cells[0].piece.side}${cells[0].piece.type}`]}（${sq(cells[0].r, cells[0].c)}）挡住——炮不吃子时必须走直线通路`;
    return "";
  }
  if (p.type === "R" && !target && cells.length > 0) {
    return `：路径被 ${PIECE_ZH[`${cells[0].piece.side}${cells[0].piece.type}`]}（${sq(cells[0].r, cells[0].c)}）挡住`;
  }
  return `：该子走不到那里（或会送将/被将军）`;
}

/** 直线路径上的阻挡子（含坐标）；非直线/越界返回空。 */
function lineBlockers(board, from, to) {
  const cells = [];
  if (from.r !== to.r && from.c !== to.c) return cells;
  const dr = Math.sign(to.r - from.r), dc = Math.sign(to.c - from.c);
  for (let r = from.r + dr, c = from.c + dc; r !== to.r || c !== to.c; r += dr, c += dc) {
    if (board[r]?.[c]) cells.push({ piece: board[r][c], r, c });
  }
  return cells;
}

/** 中式记谱（2026-11-06「了解棋谱」需求，Carlini 国际象棋实验的同构迁移：
 *  模型预训练语料里的象棋棋谱全部是「炮二平五/马八进七」记法——历史行用
 *  棋谱母语书写才能唤醒存量开局/防御知识；坐标括号保留（裁判/回捞消费）。
 *  规则：红方纵线一~九（自红右 i→a）、黑方 1~9（自黑右 a→i）；直线子
 *  平=横移+终线、进/退=格数；斜行子（马象仕）进/退=终线；同线同型前/后
 *  消歧（三枚以上前/中/后，前=靠对方那头）。算不出回退 null（调用方用旧记法）。
 */
const NUM_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];
const fileOf = (side, c) => (side === "r" ? 9 - c : c + 1);
const numStr = (side, n) => (side === "r" ? NUM_CN[n - 1] : String(n));

/** 内置开局定式手册（2026-11-06 用户裁定「内置隐藏、不进知识库」）：纯代码
 *  数据随插件分发，仅拼进模型观察文本（不渲染任何 UI、不入 KB 列表）。
 *  五条主线全部经引擎 zhNotation 逐着验合法（arena.test.js 钉住）；开局
 *  阶段（前 20 半回合）注入，之后自动退场省 token。双方同一份=公平不变。 */
const OPENING_BOOK = {
  principles: [
    "出子优先：开局快出车马炮，车路要通、马路要活（避开蹩腿位）",
    "中枢攻防：当头炮直攻中卒，屏风马双马护中；中卒有失先补士相固防",
    "忌孤军深入：无支援的过河子易被捉死，推进需子力协同",
  ],
  lines: [
    { name: "当头炮对屏风马（攻防主线）", moves: "炮二平五 馬8进7 马二进三 車9平8 车一平二 卒7进1 车二进四 砲8平9" },
    { name: "顺炮直车对横车（对攻）", moves: "炮二平五 砲8平5 马二进三 馬8进7 车一平二 車9进1" },
    { name: "列炮（对攻另路）", moves: "炮二平五 砲2平5 马二进三 馬8进9 车一平二 車9平8" },
    { name: "飞相局（稳健）", moves: "相三进五 卒7进1 马八进七 馬8进7 车九进一" },
    { name: "仙人指路（缓攻）", moves: "兵七进一 卒7进1 马八进七 馬8进7 车九进一" },
  ],
};

export function zhNotation(board, from, to) {
  const p = board[from.r]?.[from.c];
  if (!p) return null;
  const forward = p.side === "r" ? -1 : 1; // 红向行10（r 减小）推进
  const dr = Math.sign(to.r - from.r);
  const dist = Math.abs(to.r - from.r);
  const same = [];
  if (p.type !== "K") {
    for (let r = 0; r < 10; r += 1) {
      const q = board[r][from.c];
      if (q && q.side === p.side && q.type === p.type) same.push(r);
    }
  }
  let prefix = "";
  if (same.length > 1) {
    same.sort((a, b) => (p.side === "r" ? a - b : b - a)); // 靠对方那头在前
    const idx = same.indexOf(from.r);
    prefix = same.length === 2 ? (idx === 0 ? "前" : "后")
      : idx === 0 ? "前" : idx === same.length - 1 ? "后" : "中";
  }
  const name = PIECE_ZH[`${p.side}${p.type}`];
  const head = prefix ? `${prefix}${name}` : `${name}${numStr(p.side, fileOf(p.side, from.c))}`;
  const diagonal = p.type === "N" || p.type === "B" || p.type === "A";
  const verb = to.r === from.r ? "平" : dr === forward ? "进" : "退";
  const arg = to.r === from.r || diagonal
    ? numStr(p.side, fileOf(p.side, to.c))
    : numStr(p.side, dist);
  return `${head}${verb}${arg}`;
}

/** 子力评估（代走/形势条共用）：side 视角子力和（将帅计入——被将死即巨差）。 */
export function materialOf(board, side) {
  let s = 0;
  for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) {
    const p = board[r]?.[c];
    if (!p) continue;
    const v = VALUE[p.type] ?? 0;
    s += p.side === side ? v : -v;
  }
  return s;
}

/** 2 层极小极大（2026-11-06 P0 #5）：我方每候选着 → 对方最优（材料最大化）
 *  应手 → 取「对方最优应对后我方仍最好」的着。make/unmake 原地复用棋盘，
 *  40×40 组合 × 90 格扫描，毫秒级。返回最佳 move 串；无着返回 null。 */
export function alphaBeta2(board, side, genMoves, val) {
  const foe = side === "r" ? "b" : "r";
  let best = null;
  let bestScore = -Infinity;
  for (const m of genMoves(board, side)) {
    const cap = board[m.to[0]][m.to[1]];
    board[m.to[0]][m.to[1]] = m.piece;
    board[m.from[0]][m.from[1]] = null;
    let worst = Infinity;
    for (const f of genMoves(board, foe)) {
      const cap2 = board[f.to[0]][f.to[1]];
      board[f.to[0]][f.to[1]] = f.piece;
      board[f.from[0]][f.from[1]] = null;
      const s = val(board, side);
      board[f.from[0]][f.from[1]] = f.piece;
      board[f.to[0]][f.to[1]] = cap2;
      if (s < worst) worst = s;
    }
    if (worst === Infinity) worst = val(board, side) + 5000; // 对方无着=将死/困毙，重奖
    board[m.from[0]][m.from[1]] = m.piece;
    board[m.to[0]][m.to[1]] = cap;
    const score = worst + Math.random() * 1e-6; // 平分时随机破平（代走不死板）
    if (score > bestScore) { bestScore = score; best = m.move; }
  }
  return best;
}

/** 合法着法 → 模型观察文本（2026-11-06「模型不吃子」实锤：裸坐标清单要求
 *  模型心算网格交叉比对才能发现吃子机会——那是 OCR 技能不是棋力；带 (吃X)
 *  标注后吃子机会成为清单显式信息。只标注不排序，不代模型做决策；move 串
 *  保持裸坐标（裁判 apply / salvage 匹配消费的是它）。 */
export function formatActions(moves) {
  return (moves ?? []).map((m) => (m.captured
    ? `${m.move}(吃${PIECE_ZH[`${m.captured.side}${m.captured.type}`]})`
    : m.move));
}

export function boardText(board) {
  const rows = [];
  for (let r = 0; r < 10; r += 1) {
    let line = "";
    for (let c = 0; c < 9; c += 1) {
      const p = board[r][c];
      line += p ? (p.side === "r" ? PIECE_ZH[`r${p.type}`] : PIECE_ZH[`b${p.type}`]) : "·";
    }
    rows.push(`${10 - r} ${line}`);
  }
  rows.push("  abcdefghi");
  return rows.join("\n");
}

export function createXiangqiGame({ seatOrder } = {}) {
  const board = initialBoard();
  const hist = []; // { seat, move, zh }
  const repMap = new Map(); // 局面串 → 出现次数（判重复和棋）
  let turn = seatOrder?.[0] ?? 0; // seat0 = 红
  const sideOf = (s) => (s === 0 ? "r" : "b");
  let halfMoves = 0;

  const posKey = () => board.map((row) => row.map((p) => (p ? `${p.side}${p.type}` : ".")).join("")).join("/") + `|${sideOf(turn)}`;

  return {
    seats: () => 2,
    phase: () => "play",
    seatLabel: (s) => (s === 0 ? "红" : "黑"),
    pendingAction() {
      if (this.result()) return null;
      return { seat: turn, kind: "move", actions: legalMovesAll(board, sideOf(turn)).map((m) => m.move) };
    },
    apply(seat, action) {
      if (this.result()) return { ok: false, reason: "对局已结束" };
      if (seat !== turn) return { ok: false, reason: "还没轮到你" };
      const raw = String(action).toLowerCase();
      const fmtOk = /^[a-i](10|[1-9])[a-i](10|[1-9])$/.test(raw.trim());
      const mv = legalMovesAll(board, sideOf(turn)).find((m) => m.move === raw.trim());
      if (!mv) return { ok: false, reason: fmtOk
        ? `着法 ${raw.trim()} 不合法${illegalHint(board, raw.trim(), sideOf(turn))}，请从合法着法清单里重选`
        : `着法 ${JSON.stringify(action)} 格式不对（应为起点+终点，如 "h2e2"）` };
      const zh = `${PIECE_ZH[`${mv.piece.side}${mv.piece.type}`]} ${mv.move.slice(0, 2)}→${mv.move.slice(2)}`;
      const zhTrad = zhNotation(board, { r: mv.from[0], c: mv.from[1] }, { r: mv.to[0], c: mv.to[1] });
      board[mv.to[0]][mv.to[1]] = mv.piece;
      board[mv.from[0]][mv.from[1]] = null;
      hist.push({ seat, move: mv.move, zh, zhTrad, captured: mv.captured ? PIECE_ZH[`${mv.captured.side}${mv.captured.type}`] : null, capturedPiece: mv.captured ?? null, from: [...mv.from], to: [...mv.to] });
      halfMoves += 1;
      turn = 1 - turn;
      const key = posKey();
      repMap.set(key, (repMap.get(key) ?? 0) + 1);
      hist[hist.length - 1].keyAfter = key;
      return { ok: true, events: [{ t: "move", seat, move: mv.move, zh }] };
    },
    result() {
      const side = sideOf(turn);
      const moves = legalMovesAll(board, side);
      if (moves.length === 0) {
        const checked = inCheck(board, side);
        const winner = 1 - turn;
        return {
          over: true,
          ranks: [winner, turn],
          winner,
          summary: checked ? `${side === "r" ? "红" : "黑"}方被将死` : `${side === "r" ? "红" : "黑"}方困毙（无子可动）`,
        };
      }
      if (halfMoves >= HALF_MOVE_LIMIT) return { over: true, ranks: [0, 0], draw: true, summary: `超过 ${HALF_MOVE_LIMIT} 半回合上限，判和` };
      if ((repMap.get(posKey()) ?? 0) >= 3) return { over: true, ranks: [0, 0], draw: true, summary: "同一局面第三次出现，判和" };
      return null;
    },
    viewFor(seat) {
      const side = sideOf(seat);
      const histText = hist.map((m, i) => `${i + 1}.${m.zhTrad ?? m.zh}(${m.move})${m.captured ? `吃${m.captured}` : ""}`).join(" ") || "（空盘，你先走）";
      const acts = formatActions(legalMovesAll(board, side));
      // 局面态势层（2026-11-06「了解棋谱、全方位防御与布局」需求）：只给
      // 引擎算得出的客观事实（子力/受威胁/吃子机会/将军），不给策略指令——
      // 防守与布局的判断仍是模型的棋力。受威胁 = 敌方全部合法吃子的落点。
      const scoreOf = (sd) => board.flat().reduce((s, p) => (p && p.side === sd && p.type !== "K" ? s + (VALUE[p.type] ?? 0) : s), 0);
      const redScore = scoreOf("r"), blackScore = scoreOf("b");
      const diff = (side === "r" ? redScore - blackScore : blackScore - redScore);
      const foeSide = side === "r" ? "b" : "r";
      const threatMap = new Map(); // 己方被捉子坐标 → [攻击者描述]
      for (const m of legalMovesAll(board, foeSide)) {
        if (!m.captured) continue;
        const tsq = m.move.length === 5 ? m.move.slice(3) : m.move.slice(2);
        if (!threatMap.has(tsq)) threatMap.set(tsq, []);
        threatMap.get(tsq).push(`${PIECE_ZH[`${m.piece.side}${m.piece.type}`]}${m.move.slice(0, m.move.length === 5 ? 3 : 2)}`);
      }
      const threatParts = [];
      for (let r = 0; r < 10; r += 1) for (let c = 0; c < 9; c += 1) {
        const p = board[r][c];
        if (!p || p.side !== side) continue;
        const s = sq(r, c);
        if (threatMap.has(s)) threatParts.push(`${PIECE_ZH[`${p.side}${p.type}`]}(${s}) ← ${threatMap.get(s).join(",")}`);
      }
      const caps = acts.filter((a) => a.includes("(吃"));
      // 开局阶段注入内置定式手册（隐藏资产：只进观察文本，UI/KB 均不露面）
      const bookBlock = hist.length <= 20
        ? [`开局定式参考（借鉴布局，非强制）：${OPENING_BOOK.lines.map((l) => `${l.name}——${l.moves}`).join("；")}`,
          `要领：${OPENING_BOOK.principles.join("；")}。`]
        : [];
      return [
        `【中国象棋】你执${side === "r" ? "红（先手，下方）" : "黑（后手，上方）"}。`,
        `着法历史：${histText}`,
        `当前局面（行1=红底，行10=黑底；黑方=將士象馬車砲卒，红方=帅仕相马车炮兵）：\n${boardText(board)}`,
        ...bookBlock,
        `子力对比：红 ${redScore} / 黑 ${blackScore}（你${diff > 0 ? `领先 ${diff}` : diff < 0 ? `落后 ${-diff}` : "持平"}）`,
        ...(threatParts.length ? [`⚠️ 受威胁（对方下一手可吃）：${threatParts.join("；")}`] : []),
        `本轮吃子机会：${caps.length ? caps.join("、") : "无"}`,
        ...(inCheck(board, side) ? ["你正被将军！清单中的着法全部是应将着法，必须从中选一。"] : []),
        `布局思路：先解除「受威胁」棋子的危机，再把握「吃子机会」，结合子力对比决定攻防。`,
        `轮到你。合法着法清单（起点坐标+终点坐标，标(吃X)者为吃子着法，必须严格从中选一）：${acts.join(" ")}`,
        '输出格式：{"move":"h2e2","comment":"一句话思路"}',
      ].join("\n");
    },
    suggestAction(seat) {
      const side = sideOf(seat);
      const moves = legalMovesAll(board, side);
      if (!moves.length) return null;
      // Q2 升级（2026-11-06 P0 #5，借鉴 ElephantEye/经典博弈架构）：2 层
      // 极小极大 + 子力评估取代贪心「能吃就吃」——贪心会做一子换亏的坏交换
      // （吃有根子被反吃），代走不再是白送。评估只认子力（K 计入将死即巨差）；
      // 异常回退旧贪心（能吃就吃 → 大子逃离 → 随机）。
      try {
        const mv = alphaBeta2(board, side, legalMovesAll, materialOf);
        if (mv) return mv;
      } catch { /* 回退旧启发式 */ }
      const byCapture = [...moves].sort((a, b) => (b.captured ? VALUE[b.captured.type] : -1) - (a.captured ? VALUE[a.captured.type] : -1));
      if (byCapture[0].captured) return byCapture[0].move;
      const foe = side === "r" ? "b" : "r";
      const attacked = (r, c) => legalMovesAll(board, foe).some((m) => m.to[0] === r && m.to[1] === c);
      const escape = moves
        .filter((m) => VALUE[m.piece.type] >= 400 && attacked(m.from[0], m.from[1]) && !attacked(m.to[0], m.to[1]))
        .sort((a, b) => VALUE[b.piece.type] - VALUE[a.piece.type]);
      if (escape.length) return escape[0].move;
      return moves[Math.floor(Math.random() * moves.length)].move;
    },
    getState: () => ({ board: board.map((row) => row.map((p) => (p ? { ...p } : null))), turn, hist: [...hist], halfMoves }),
    /** 悔棋（2026-11-06 人机模式「回退上一步」）：逆序回退 n 着——子归原位、
     *  被吃子复活、行棋方翻转、重复计数回滚（keyAfter 逐着记录）。逆向不变
     *  式：回退时终点格上的子必是当着走子。快照/事件由 MatchRunner 配合裁剪。 */
    undoPlies(n) {
      const count = Math.max(0, Math.min(n | 0, hist.length));
      for (let i = 0; i < count; i += 1) {
        const e = hist[hist.length - 1];
        const piece = board[e.to[0]][e.to[1]];
        board[e.from[0]][e.from[1]] = piece;
        board[e.to[0]][e.to[1]] = e.capturedPiece ?? null;
        if (e.keyAfter) {
          const c = repMap.get(e.keyAfter) ?? 1;
          if (c <= 1) repMap.delete(e.keyAfter); else repMap.set(e.keyAfter, c - 1);
        }
        halfMoves = Math.max(0, halfMoves - 1);
        turn = 1 - turn;
        hist.pop();
      }
      return count;
    },
    /** 形势分（2026-11-06 P1 #6 观战形势条/着法标注数据源）：子力差 + 35%
     *  受威胁差（双方全部合法吃子的被吃子值）——启发式口径，观战呈现专用，
     *  不进入模型观察（公平）。 */
    scoreFor(seat) {
      const side = sideOf(seat);
      const foe = side === "r" ? "b" : "r";
      const threatOf = (sd) => legalMovesAll(board, sd === "r" ? "b" : "r")
        .reduce((s, m) => s + (m.captured ? VALUE[m.captured.type] : 0), 0);
      return materialOf(board, side) + Math.round(0.35 * (threatOf(foe) - threatOf(side)));
    },
  };
}

registerGame({
  id: "xiangqi",
  label: "中国象棋",
  short: "象棋",
  desc: "9×10 楚河汉界，将死或困毙获胜",
  order: 2,
  cat: "board",
  color: "#c9553f",
  boardKind: "xiangqi",
  seats: 2,
  minSeats: 2,
  createGame: createXiangqiGame,
  scored: true, // 有 scoreFor（形势条/着法标注启用）
  // 棋谱库 RAG（2026-11-06 用户裁定「塞进向量库、不在知识库显示」）：
  // 开局阶段（前 20 半回合）以中式记谱棋史检索 chatop-kb 隐藏库
  // internal-arena-book，最相似定式附到观察尾部；KB 不可用静默降级，
  // viewFor 内置手册兜底。其他游戏日后挂各自棋谱库即可复用该通道。
  book: {
    kbId: "internal-arena-book",
    openingPlies: 20,
    queryOf: (game) => (game.getState()?.hist ?? []).map((h) => h.zhTrad ?? h.zh ?? "").join(" "),
  },
});
