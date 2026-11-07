/**
 * 围棋裁判（games-llm-arena-games2 Q3/Q4/Q9，docs/games-llm-arena-games2-plan.md）：
 * go9/go13 双 game id 共引擎（TrueSkill 分桶需要，Q4——同一份 createGame 工厂
 * 参数化 size，未来 19 路 = go19 第三个 id，引擎零改动）。
 *
 * 自写内核（2026-11-06 spike 裁定）：原计划收割 tenuki（npm MIT 0 依赖），实测
 * ①本环境 npm 注册表不可达装不进；②tenuki 无 movegen（本契约每回合要合法点
 * 清单，得逐点试落）、positional superko 与死子启发反正要自写、CJS beta API
 * 与 vite 打包有互操作风险——xiangqi 先例（原计划嵌 BSD 库、终因四件套对齐
 * 成本自写）二次成立。规则核心 ~200 行，围棋规则不受版权保护。
 *
 * 规则口径（Q3/Q9，对局摘要声明，评审可砍）：
 *  - positional superko：禁重现本局任意既往局面（含空盘初始局面）——防三劫
 *    循环刷手数，比 simple ko 更严；
 *  - 禁自杀（落子后己方棋群无气且未提对方子 = 非法）；
 *  - 中国数子法（区域计分：活子 + 只与己方相邻的空域），白贴 7.5 目；
 *  - 双 pass 终局；手数帽 9 路 120 / 13 路 200，到帽强制走同一结算函数
 *    （弱 LLM 永不 pass 的兜底，Q9）；两条终局路收敛到同一个 areaScore；
 *  - 死子启发式：结算前迭代移除 ≤1 气棋群（至多两轮；双活等复杂死活不深究，
 *    LLM 对局水平下结算精度要求本就不高）；
 *  - 座位 0 = 黑（黑先行），座位 1 = 白。
 *
 * 坐标（五子棋同族惯例）："E5" = 列 E 行 5；A1 = 左上角，行号向下递增。
 * 动作：落子坐标串 或 "pass"。
 */
import { registerGame } from "../registry.js";

const KOMI = 7.5;
const CAPS = { 9: 120, 13: 200 };
const COLS = "ABCDEFGHIJKLMNO";

export function coordOf(i, N) {
  return `${COLS[i % N]}${Math.floor(i / N) + 1}`;
}

export function parseCoord(text, N) {
  if (typeof text !== "string") return null;
  const m = /^([A-Z])([0-9]{1,2})$/.exec(text.trim().toUpperCase());
  if (!m) return null;
  const c = m[1].charCodeAt(0) - 65;
  const r = Number(m[2]) - 1;
  if (c < 0 || c >= N || r < 0 || r >= N) return null;
  return { i: r * N + c };
}

export function createGoGame({ size = 9, seed = 0, opts = {} } = {}) {
  if (size !== 9 && size !== 13) throw new Error(`createGoGame: 暂只支持 9/13 路（收到 ${size}）`);
  const N = size;
  const cap = Number.isFinite(opts?.cap) ? opts.cap : CAPS[N];
  let board = new Int8Array(N * N); // 0 空 / 1 黑(seat0) / 2 白(seat1)
  let turn = 0;
  let passes = 0; // 连续 pass 计数（双 pass 终局）
  let moveCount = 0;
  const captures = [0, 0]; // 各座位累计提子数
  const hist = []; // { seat, move, caps }
  let lastDetail = null;
  let final = null;
  let forcedNote = "";
  const seen = new Set([keyOf(board)]); // 既往局面集合（positional superko）
  const undoStack = []; // 悔棋快照栈（2026-11-07 补齐：每成功一手 push，undoPlies 弹栈复原）

  function keyOf(b) {
    let s = "";
    for (let i = 0; i < b.length; i += 1) s += b[i];
    return s;
  }

  function neighbors(i) {
    const r = Math.floor(i / N), c = i % N, out = [];
    if (r > 0) out.push(i - N);
    if (r < N - 1) out.push(i + N);
    if (c > 0) out.push(i - 1);
    if (c < N - 1) out.push(i + 1);
    return out;
  }

  /** 棋群与气（BFS）：{ stones:[idx], libs:Set<idx> }。 */
  function groupAt(b, i) {
    const color = b[i];
    const stones = [i];
    const libs = new Set();
    const vis = new Set([i]);
    for (let k = 0; k < stones.length; k += 1) {
      for (const nb of neighbors(stones[k])) {
        if (b[nb] === 0) libs.add(nb);
        else if (b[nb] === color && !vis.has(nb)) { vis.add(nb); stones.push(nb); }
      }
    }
    return { stones, libs };
  }

  /** 试落（在副本上裁决）：合法 → { ok, board, key, caps }；非法 → { ok:false, reason }。 */
  function tryPlay(i, color) {
    if (board[i] !== 0) return { ok: false, reason: "该点已有棋子" };
    const b = Int8Array.from(board);
    b[i] = color;
    const foe = color === 1 ? 2 : 1;
    let caps = 0;
    for (const nb of neighbors(i)) {
      if (b[nb] === foe) {
        const g = groupAt(b, nb);
        if (g.libs.size === 0) { for (const s of g.stones) b[s] = 0; caps += g.stones.length; }
      }
    }
    if (groupAt(b, i).libs.size === 0) return { ok: false, reason: "自杀点：落子后己方棋群无气且未提对方子" };
    const key = keyOf(b);
    if (seen.has(key)) return { ok: false, reason: "禁着点：打劫/全局同形（positional superko，禁重现本局任意既往局面）" };
    return { ok: true, board: b, key, caps };
  }

  function legalPoints() {
    const out = [];
    const color = turn + 1;
    for (let i = 0; i < N * N; i += 1) if (board[i] === 0 && tryPlay(i, color).ok) out.push(i);
    return out;
  }

  /** 区域计分（内部 b 可先做过死子清理）：活子 + 单色空域，dame（双色空点）不计。 */
  function areaOf(b) {
    let black = 0, white = 0;
    const vis = new Set();
    for (let i = 0; i < b.length; i += 1) {
      if (b[i] === 1) { black += 1; continue; }
      if (b[i] === 2) { white += 1; continue; }
      if (vis.has(i)) continue;
      const region = [i];
      vis.add(i);
      let touchB = false, touchW = false;
      for (let k = 0; k < region.length; k += 1) {
        for (const nb of neighbors(region[k])) {
          if (b[nb] === 1) touchB = true;
          else if (b[nb] === 2) touchW = true;
          else if (!vis.has(nb)) { vis.add(nb); region.push(nb); }
        }
      }
      if (touchB && !touchW) black += region.length;
      else if (touchW && !touchB) white += region.length;
    }
    return { black, white };
  }

  /** 终局结算：死子启发（两轮移除 ≤1 气棋群）→ 区域计分 → 贴目定胜负。
   *  双 pass 与手数帽共用（Q9：两条终局路收敛到同一函数，无第二套逻辑）。 */
  function finish(forced) {
    const b = Int8Array.from(board);
    for (let round = 0; round < 2; round += 1) {
      const dead = new Set();
      for (let i = 0; i < b.length; i += 1) {
        if (b[i] !== 0 && !dead.has(i)) {
          const g = groupAt(b, i);
          if (g.libs.size <= 1) for (const s of g.stones) dead.add(s);
        }
      }
      if (!dead.size) break;
      for (const d of dead) b[d] = 0;
    }
    const { black, white } = areaOf(b);
    const lead = black - white - KOMI; // >0 黑胜
    const winner = lead > 0 ? 0 : 1;
    final = {
      over: true,
      ranks: [winner === 0 ? 0 : 1, winner === 1 ? 0 : 1],
      draw: false,
      scores: [black, white + KOMI],
      summary: `${forced ? "手数上限强制结算" : "双 pass 终局"}：黑 ${black} 子 vs 白 ${white}+${KOMI}（贴目），${lead > 0 ? "黑" : "白"}胜 ${Math.abs(lead)} 目（死子判定=简单启发式，口径见对局摘要）`,
    };
  }

  const game = {
    seats: () => 2,
    phase: () => (final ? "over" : "play"),
    seatLabel: (seat) => (seat === 0 ? "黑" : "白"),
    pendingAction() {
      if (final) return null;
      const acts = legalPoints().map((i) => coordOf(i, N));
      acts.push("pass");
      return { seat: turn, kind: "play", actions: acts };
    },
    apply(seat, action) {
      if (final) return { ok: false, reason: "对局已结束" };
      if (seat !== turn) return { ok: false, reason: "还没轮到你" };
      if (action === "pass") {
        undoStack.push({ key: null, board: Int8Array.from(board), captures: [...captures], passes, moveCount, lastDetail }); // 落子前快照（弹栈即复原到本手前）
        passes += 1;
        moveCount += 1;
        hist.push({ seat, move: "pass" });
        lastDetail = { t: "pass", seat };
        turn = 1 - turn;
        if (passes >= 2) finish(false);
        else if (moveCount >= cap) finish(true);
        return { ok: true, events: [lastDetail] };
      }
      const p = parseCoord(action, N);
      if (!p) return { ok: false, reason: `坐标 ${JSON.stringify(action)} 不合法：格式如 "E5"（列 A-${COLS[N - 1]} + 行 1-${N}，A1=左上角、行号向下递增）` };
      const r = tryPlay(p.i, seat + 1);
      if (!r.ok) return { ok: false, reason: r.reason };
      undoStack.push({ key: r.key, board: Int8Array.from(board), captures: [...captures], passes, moveCount, lastDetail }); // 落子前快照
      board = r.board;
      seen.add(r.key);
      captures[seat] += r.caps;
      passes = 0;
      moveCount += 1;
      hist.push({ seat, move: action.toUpperCase(), caps: r.caps });
      lastDetail = { t: "move", seat, move: action.toUpperCase(), caps: r.caps };
      turn = 1 - turn;
      if (moveCount >= cap) finish(true);
      return { ok: true, events: [lastDetail] };
    },
    result: () => final,
    /** 悔棋（2026-11-07 补齐：五子棋/象棋同款契约，MatchRunner 人类回合消费）：
     *  弹快照栈复原盘面/提子/连续 pass/手数，superko seen 删除被撤手的局面 key
     *  （superko 保证每手 key 唯一，删除安全；pass 不入 seen 无需删）。撤销后
     *  轮转按手数奇偶重算（黑先），终局态清空（双 pass 被撤即复活对局）。 */
    undoPlies(n) {
      let count = 0;
      for (let i = 0; i < (n | 0) && undoStack.length && hist.length; i += 1) {
        const s = undoStack.pop();
        hist.pop();
        if (s.key) seen.delete(s.key);
        board = s.board;
        captures[0] = s.captures[0]; captures[1] = s.captures[1];
        passes = s.passes; moveCount = s.moveCount;
        lastDetail = s.lastDetail;
        final = null; forcedNote = "";
        count += 1;
      }
      turn = hist.length % 2; // 黑先（seat0），pass 占手
      return count;
    },
    /** 观察序列化（LLM 工程共识：事件历史优先于棋盘图示、合法清单显式附上）。 */
    viewFor(seat) {
      const lines = [];
      lines.push(`【围棋 ${N} 路】你执${seat === 0 ? "黑" : "白"}（黑先行）。手数 ${moveCount}/${cap}｜提子：黑 ${captures[0]} 白 ${captures[1]}｜贴目：白 +${KOMI}｜连续 pass ${passes}/2`);
      lines.push(`规则：坐标 = 列字母(${COLS.slice(0, N)}) + 行号(1-${N})，A1=左上角、行向下递增；"pass"=虚着；禁自杀；禁打劫/全局同形；双 pass 或手数到帽终局，中国数子法（子+围空）计分。`);
      lines.push("棋盘（上=第 1 行）：");
      lines.push(`   ${COLS.slice(0, N).split("").join(" ")}`);
      for (let r = 0; r < N; r += 1) {
        let row = `${String(r + 1).padStart(2, " ")} `;
        for (let c = 0; c < N; c += 1) {
          const v = board[r * N + c];
          row += v === 1 ? " ●" : v === 2 ? " ○" : " ·";
        }
        lines.push(row);
      }
      const recent = hist.slice(-12).map((h) => `${h.seat === 0 ? "黑" : "白"}${h.move}${h.caps ? `(提${h.caps})` : ""}`).join("，");
      if (recent) lines.push(`最近着法（旧→新）：${recent}`);
      if (!final) {
        const acts = legalPoints();
        lines.push(`轮到你（${seat === 0 ? "黑" : "白"}）。合法落点共 ${acts.length} 个${acts.length ? `（示例：${acts.slice(0, 10).map((i) => coordOf(i, N)).join(" ")}${acts.length > 10 ? " …" : ""}）` : ""}，或 "pass"。`);
      }
      return lines.join("\n");
    },
    /** 代走启发式（Q2 B：非纯随机）：能提就提 → 能救就救 → 邻接触点的随机合法点。 */
    suggestAction(seat) {
      if (final) return null;
      const color = seat + 1;
      const foe = color === 1 ? 2 : 1;
      // 1) 提子：对方 1 气群 → 打其气（先扫到的群先提，群的气点试落合法才用）
      for (let i = 0; i < board.length; i += 1) {
        if (board[i] === foe) {
          const g = groupAt(board, i);
          if (g.libs.size === 1) {
            const lib = [...g.libs][0];
            if (tryPlay(lib, color).ok) return coordOf(lib, N);
          }
        }
      }
      // 2) 救子：己方 1 气群 → 在其气点长气（能救自己优先于随机）
      for (let i = 0; i < board.length; i += 1) {
        if (board[i] === color) {
          const g = groupAt(board, i);
          if (g.libs.size === 1) {
            const lib = [...g.libs][0];
            if (tryPlay(lib, color).ok) return coordOf(lib, N);
          }
        }
      }
      // 3) 随机合法点，偏好邻接已有棋子的点（接触战优先于天马行空）
      const pts = legalPoints();
      if (!pts.length) return "pass";
      const near = pts.filter((i) => neighbors(i).some((nb) => board[nb] !== 0));
      const pool = near.length ? near : pts;
      return coordOf(pool[Math.floor(Math.random() * pool.length)], N);
    },
    getState: () => ({
      size: N,
      board: Array.from({ length: N }, (_, r) => Array.from(board.slice(r * N, r * N + N))),
      turn, passes, moveCount,
      captures: [...captures],
      hist: hist.slice(-30),
      lastMove: lastDetail,
      komi: KOMI, cap,
    }),
    /** 形势分（观战条/着法标注数据源）：原始区域估计（不做死子清理——中途
     *  清死子会误伤刚落的新子），黑白差含贴目，×10 对齐象棋摆动阈值量级。 */
    scoreFor(seat) {
      const { black, white } = areaOf(board);
      const est = black - white - KOMI;
      return Math.round((seat === 0 ? est : -est) * 10);
    },
  };
  return game;
}

registerGame({
  id: "go9",
  label: "围棋 9 路",
  short: "围棋9",
  desc: "9 路快棋 · 数子法贴 7.5 · 双 pass 或 120 手帽结算",
  order: 5,
  cat: "board",
  color: "#3d5a3d",
  boardKind: "go",
  seats: 2,
  minSeats: 2,
  createGame: ({ seed, opts }) => createGoGame({ size: 9, seed, opts }),
  scored: true, // 有 scoreFor（形势条/着法标注启用）
});

registerGame({
  id: "go13",
  label: "围棋 13 路",
  short: "围棋13",
  desc: "13 路中盘 · 数子法贴 7.5 · 双 pass 或 200 手帽结算",
  order: 6,
  cat: "board",
  color: "#2f4f2f",
  boardKind: "go",
  seats: 2,
  minSeats: 2,
  createGame: ({ seed, opts }) => createGoGame({ size: 13, seed, opts }),
  scored: true,
});
