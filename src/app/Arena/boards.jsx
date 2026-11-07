/**
 * 竞技场四游戏面板（games-llm-arena-plan Q5 五件套之「对局室」的面板层；
 * 2026-11-04 视觉轮：真实牌面 + 材质底 + 动画，对标市面产品布局）：
 *  - GobangBoard：木纹棋盘 + 云子质感棋子（径向渐变高光/瓷感）+ 落子弹入
 *  - XiangqiBoard：木纹棋盘 + 立体木棋子 + 炮兵位刻线 + 楚河汉界
 *  - DoudizhuTable：绿绒牌桌 + 真实扑克牌面 + 各家最近出牌就近展示 + 皇冠
 *  - MahjongTable：绿绒牌桌 + 雀魂风真实麻将牌 + 副露/牌河全真实牌面
 * 面板只管渲染 state + 人类交互；匿名观战由 Room 传 seatNames 决定。
 * props 契约：{ state, seatNames, humanSeat, pending, onHumanMove, lastMove }
 * （回放模式：只传 state/seatNames/lastMove，无 pending → 纯只读）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n/index.jsx";
import { toMove } from "../../arena/games/gobang.js";
import { COLS as XCOLS, sq as xsq } from "../../arena/games/xiangqi.js";
import { setupCells as jqSetupCells, templateSetup as jqTemplate, validateSetup as jqValidate, HQ as JQ_HQ_SEATS } from "../../arena/games/junqi.js";
import { sortCards } from "../../arena/games/doudizhu.js";
import { sortTiles as mjSort } from "../../arena/games/mahjong.js";
import { PokerCard, PokerBack, MjTileFace, MjBack } from "./cards.jsx";

/** 麻将花色字（游戏本体术语，跨语言保留；Room 的事件流文案从这里取）。 */
export const MJ_SUIT_ZH = { m: "万", p: "筒", s: "索" };

/* ================= 五子棋 ================= */

const GOBANG_SIZE = 15;


/** games2 通用自适应（2026-11-07 用户裁定：所有棋盘桌面随窗口大小自适应+居中）：
 *  FitScale：DOM 牌桌（斗地主/麻将/德扑）等比缩放容器（ResizeObserver，
 *  只缩不放，transform 不破坏 DOM 点击）；SVG 棋盘自带 meet 适配不经过它。 */
function FitScale({ children }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const apply = () => {
      inner.style.transform = "none";
      const w = inner.offsetWidth || 1;
      const h = inner.offsetHeight || 1;
      const sc = Math.min(1.5, outer.clientWidth / w, outer.clientHeight / h); // 只缩不放 → 放宽到 1.5×：高窗下牌桌也随窗口变大（2026-11-07 高度自适应裁定）
      inner.style.transform = `scale(${sc})`;
    };
    if (typeof ResizeObserver === "undefined") { apply(); return undefined; } // 无 RO 环境（jsdom/旧内核）降级：一次性应用
    const ro = new ResizeObserver(apply);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outerRef} className="w-full h-full flex items-center justify-center overflow-hidden" data-arena-fitscale>
      <div ref={innerRef} style={{ transformOrigin: "center center" }}>{children}</div>
    </div>
  );
}

/** SVG meet 布局下的点击坐标 → viewBox 坐标（letterbox 偏移修正）。
 *  2026-11-07「五子棋点击错位」根因修复：vbW/vbH 一律自读元素 viewBox.baseVal
 *  （此前调用方手传 dim+pad*2，而 dim 已含 pad → viewBox 被高估 → scale 偏小
 *  → 落点整体错位；五子棋/围棋/军棋三块 rect 数学点击棋盘全部中招，象棋
 *  命中圆不受影响）。返回值为「距 viewBox 左上角」的偏移（不含 viewBox 负原点）。 */
function svgPoint(svgEl, clientX, clientY) {
  const vb = svgEl.viewBox?.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const vbW = vb?.width || rect.width;
  const vbH = vb?.height || rect.height;
  const scale = Math.min(rect.width / vbW, rect.height / vbH);
  const offX = (rect.width - vbW * scale) / 2;
  const offY = (rect.height - vbH * scale) / 2;
  return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
}

export function GobangBoard({ state, humanSeat, pending, onHumanMove, lastMove, expand = false }) {
  const size = state?.size ?? GOBANG_SIZE;
  const board = state?.board ?? [];
  const last = lastMove && lastMove.t === "move" ? lastMove : null;
  const lastPos = useMemo(() => {
    if (!last) return null;
    const m = /^([A-O])(\d+)$/.exec(last.move ?? "");
    return m ? { c: m[1].charCodeAt(0) - 65, r: Number(m[2]) - 1 } : null;
  }, [last]);
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  const cell = 24;
  const pad = 18;
  const dim = (size - 1) * cell + pad * 2;
  const onClick = (e) => {
    if (!clickable) return;
    const { x, y } = svgPoint(e.currentTarget, e.clientX, e.clientY);
    const c = Math.round((x - pad) / cell);
    const r = Math.round((y - pad) / cell);
    if (r < 0 || r >= size || c < 0 || c >= size || board[r]?.[c]) return;
    onHumanMove?.(toMove(r, c));
  };
  const lines = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(<line key={`h${i}`} x1={0} y1={i * cell} x2={(size - 1) * cell} y2={i * cell} stroke="#7a5321" strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.7} opacity={0.75} />);
    lines.push(<line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={(size - 1) * cell} stroke="#7a5321" strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.7} opacity={0.75} />);
  }
  const stars = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
  return (
    <div className="w-full h-full flex items-center justify-center" data-arena-gobang>
     <div className="arena-wood rounded-2xl p-3 flex-1 h-full flex items-center justify-center max-w-full">
      <svg viewBox={`${-pad} ${-pad} ${dim} ${dim}`} style={{ width: "100%", height: "100%", display: "block", filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.35))" }} onClick={onClick} className="arena-board-svg">
        <defs>
          <radialGradient id="gobangBlack" cx="0.35" cy="0.3" r="0.95">
            <stop offset="0%" stopColor="#6b6f76" />
            <stop offset="28%" stopColor="#2e3238" />
            <stop offset="100%" stopColor="#0c0e11" />
          </radialGradient>
          <radialGradient id="gobangWhite" cx="0.35" cy="0.3" r="0.95">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="62%" stopColor="#f2f2ec" />
            <stop offset="100%" stopColor="#c9c9c0" />
          </radialGradient>
          <filter id="gobangShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0.8" dy="1.4" stdDeviation="0.9" floodColor="#3a2408" floodOpacity="0.4" />
          </filter>
        </defs>
        {lines}
        {stars.map(([r, c]) => <circle key={`s${r}${c}`} cx={c * cell} cy={r * cell} r={2.8} fill="#7a5321" />)}
        {board.map((row, r) => row.map((v, c) => {
          if (!v) return null;
          const isLast = lastPos && lastPos.r === r && lastPos.c === c;
          return (
            <g key={`p${r}${c}`} filter="url(#gobangShadow)" className={isLast ? "arena-anim-pop" : undefined}>
              <circle cx={c * cell} cy={r * cell} r={cell * 0.44} fill={v === 1 ? "url(#gobangBlack)" : "url(#gobangWhite)"} stroke={v === 1 ? "#000" : "#a9a99e"} strokeWidth={0.6} />
              {v === 2 && <ellipse cx={c * cell - cell * 0.12} cy={r * cell - cell * 0.14} rx={cell * 0.13} ry={cell * 0.09} fill="#fff" opacity="0.75" />}
            </g>
          );
        }))}
        {lastPos && (
          <g className="arena-anim-ring" pointerEvents="none">
            <circle cx={lastPos.c * cell} cy={lastPos.r * cell} r={4.2} fill="none" stroke="#e05555" strokeWidth="1.8" />
            <circle cx={lastPos.c * cell} cy={lastPos.r * cell} r={1.4} fill="#e05555" />
          </g>
        )}
      </svg>
     </div>
    </div>
  );
}


/* ================= 军棋暗棋（games2 Q2/Q6：12×5 陆战棋） ================= */

const JQ_CAMPS = [[10, 1], [10, 3], [9, 2], [8, 1], [8, 3], [1, 1], [1, 3], [2, 2], [3, 1], [3, 3]];
const JQ_HQ = [[11, 1], [11, 3], [0, 1], [0, 3]];
const JQ_RAIL_H = [1, 10]; // 横铁路行

export function JunqiBoard({ state, seatNames, humanSeat, pending, onHumanMove, lastMove, expand = false, replay = false }) {
  const { t } = useI18n();
  const board = state?.board ?? [];
  const revealAll = !!state?.revealAll;
  const [sel, setSel] = useState(null); // 选中己子 "A11"
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  // 12 行高板按高度定尺寸（宽随纵横比自适应）——Room 棋盘盒是 clamp(340px,58vh,680px)
  // 固定高度 + overflow-hidden（2026-11-07 军棋「顶行压标签条/底行被裁」实锤根因：
  // 旧写法按宽 380px 定尺寸 → 板高 ~900px 塞进 ~58vh 盒被裁上下），这里保证
  // 头部按钮+棋盘+图例合计恒小于盒高。
  const cell = 42;
  const pad = 20;
  const D = { w: 4 * cell + pad * 2, h: 11 * cell + pad * 2 };
  // ── 自由布阵（2026-11-07 用户裁定「两击+拖拽双通道」）：进布阵态预填模板阵，
  // 点两子交换 / 按住拖到目标格交换，违规即时标红，「重抽模板」一键重来，
  // 「确认布阵」过 validateSetup 才提交（引擎 apply 通道零改动）。
  const setupMode = clickable && pending?.kind === "setup";
  const jqCells = useMemo(() => (humanSeat != null ? jqSetupCells(humanSeat) : []), [humanSeat]); // 25 可摆位 [r,c]
  const cellIdx = useMemo(() => new Map(jqCells.map(([r, c], i) => [`${r},${c}`, i])), [jqCells]);
  const [draft, setDraft] = useState(null); // 25 项子名数组（草稿）
  const [selCell, setSelCell] = useState(null); // 布阵选中索引
  const [dragCell, setDragCell] = useState(null); // 拖拽起点索引
  const [dragHover, setDragHover] = useState(null); // 拖拽悬停索引
  const wasSetup = useRef(false); // setupMode 上升沿：跨局重置草稿
  useEffect(() => {
    if (setupMode && !wasSetup.current) {
      const tpl = pending?.actions?.[0] ?? `setup:${jqTemplate(0, humanSeat ?? 0)}`; // 引擎 pending 自带随机模板
      setDraft(tpl.slice("setup:".length).split(","));
      setSelCell(null); setDragCell(null); setDragHover(null);
    }
    wasSetup.current = setupMode;
  }, [setupMode, pending, humanSeat]);
  const swapDraft = (i, j) => {
    if (i == null || j == null || i === j || !draft) return;
    setDraft((d) => { const n = [...d]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setSelCell(null);
  };
  const redraft = () => {
    setDraft(jqTemplate(Math.floor(Math.random() * 4), humanSeat ?? 0).split(","));
    setSelCell(null); setDragCell(null); setDragHover(null);
  };
  const violSet = useMemo(() => { // 逐位约束违规（红框即时标；多重集错误由 validateSetup 兜底禁确认）
    const v = new Set();
    if (draft && humanSeat != null) {
      const backRows = humanSeat === 0 ? [10, 11] : [0, 1];
      const frontRow = humanSeat === 0 ? 6 : 5;
      draft.forEach((zh, i) => {
        const [r, c] = jqCells[i];
        if (zh === "军旗" && !JQ_HQ_SEATS[humanSeat].some(([rr, cc]) => rr === r && cc === c)) v.add(i);
        if (zh === "地雷" && !backRows.includes(r)) v.add(i);
        if (zh === "炸弹" && r === frontRow) v.add(i);
      });
    }
    return v;
  }, [draft, humanSeat, jqCells]);
  const draftValid = !!draft && humanSeat != null && violSet.size === 0 && jqValidate(humanSeat, draft).ok;
  const confirmSetup = () => { if (draftValid) onHumanMove?.(`setup:${draft.join(",")}`); };
  // 布阵态点格：两击交换通道
  const onSetupCell = (r, c) => {
    const i = cellIdx.get(`${r},${c}`);
    if (i == null) return;
    if (selCell != null) swapDraft(selCell, i);
    else setSelCell(i);
  };
  // 点选行棋：先点己子，再点目标
  const actsFrom = (from) => (pending?.actions ?? []).filter((a) => a.startsWith(`move:${from}-`));
  const targetsOfSel = sel ? new Set(actsFrom(sel).map((a) => a.split("-")[1])) : new Set();
  const onClickCell = (r, c) => {
    if (!clickable || pending.kind !== "move") return;
    const name = `${"ABCDE"[c]}${r + 1}`;
    if (sel) {
      if (targetsOfSel.has(name)) { onHumanMove?.(`move:${sel}-${name}`); setSel(null); return; }
    }
    const p = board[r]?.[c];
    if (p && p.side === humanSeat && actsFrom(name).length) setSel(name);
    else setSel(null);
  };
  const lastPos = useMemo(() => {
    const m = /^move:([A-E]\d+)-([A-E]\d+)$/.exec(lastMove?.move ?? "");
    return m ? { from: m[1], to: m[2] } : null;
  }, [lastMove]);
  const pos = (name) => ({ c: name.charCodeAt(0) - 65, r: Number(name.slice(1)) - 1 });
  // 布阵态格命中（行棋点击同款换算）；suppressClick：拖拽交换后吞掉紧跟的
  // click（否则换过去又换回来——pointer 系与 click 双通道并发经典坑）
  const suppressClick = useRef(false);
  const hitCell = (e) => {
    const pt = svgPoint(e.currentTarget, e.clientX, e.clientY);
    const c = Math.round((pt.x - pad) / cell);
    const r = Math.round((pt.y - pad) / cell);
    if (r < 0 || r > 11 || c < 0 || c > 4) return {};
    return { r, c };
  };
  // 铁路线（粗）：两竖 + 两横
  const railLines = [];
  for (const c of [0, 4]) railLines.push(<line key={`rv${c}`} x1={c * cell} y1={0} x2={c * cell} y2={11 * cell} stroke="#5a4632" strokeWidth={3.2} opacity={0.9} />);
  for (const r of JQ_RAIL_H) railLines.push(<line key={`rh${r}`} x1={0} y1={r * cell} x2={4 * cell} y2={r * cell} stroke="#5a4632" strokeWidth={3.2} opacity={0.9} />);
  // 公路细网格
  const roads = [];
  for (let i = 0; i < 5; i += 1) roads.push(<line key={`gh${i}`} x1={0} y1={i * cell} x2={4 * cell} y2={i * cell} stroke="#7a5321" strokeWidth={1} opacity={0.55} />);
  for (let i = 0; i < 12; i += 1) roads.push(<line key={`gv${i}`} x1={0} y1={i * cell} x2={4 * cell} y2={i * cell} stroke="#7a5321" strokeWidth={0} />);
  for (let c = 0; c < 5; c += 1) roads.push(<line key={`gvc${c}`} x1={c * cell} y1={0} x2={c * cell} y2={11 * cell} stroke="#7a5321" strokeWidth={1} opacity={0.55} />);
  return (
    <div className="w-full h-full flex flex-col items-center" data-arena-junqi>
      {setupMode && (
        <div className="flex items-center gap-3 text-[11px] pb-1.5 w-full justify-center flex-wrap" data-arena-jq-setupbar>
          <span className="opacity-60">{t("arena.junqi.setupSwapHint")}</span>
          {draftValid
            ? <span className="text-emerald-400" data-arena-jq-setupok>{t("arena.junqi.setupReady")}</span>
            : <span className="text-red-400" data-arena-jq-setupbad>{t("arena.junqi.setupInvalid")}</span>}
        </div>
      )}
     <div className="arena-wood rounded-2xl p-2 flex-1 w-full min-h-0 flex items-center justify-center">
      <svg viewBox={`${-pad} ${-pad} ${D.w} ${D.h}`} style={{ width: "100%", height: "100%", display: "block", touchAction: setupMode ? "none" : undefined }} className="arena-board-svg"
        onClick={(e) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          const { r, c } = hitCell(e);
          if (r == null) return;
          if (setupMode) { onSetupCell(r, c); return; }
          if (!clickable || pending.kind !== "move") return;
          onClickCell(r, c);
        }}
        onPointerDown={(e) => {
          if (!setupMode) return;
          const { r, c } = hitCell(e);
          const i = cellIdx.get(`${r},${c}`);
          if (i != null) { setDragCell(i); setDragHover(i); suppressClick.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); }
        }}
        onPointerMove={(e) => {
          if (!setupMode || dragCell == null) return;
          const { r, c } = hitCell(e);
          setDragHover(cellIdx.get(`${r},${c}`) ?? null);
        }}
        onPointerUp={(e) => {
          if (!setupMode || dragCell == null) return;
          const { r, c } = hitCell(e);
          const i = cellIdx.get(`${r},${c}`);
          if (i != null && i !== dragCell) { swapDraft(dragCell, i); suppressClick.current = true; } // 真拖拽：吞 click
          setDragCell(null); setDragHover(null);
        }}
      >
        {roads}
        {railLines}
        {JQ_CAMPS.map(([r, c]) => <circle key={`cp${r}${c}`} cx={c * cell} cy={r * cell} r={cell * 0.34} fill="#c9a253" opacity={0.35} />)}
        {JQ_HQ.map(([r, c]) => <rect key={`hq${r}${c}`} x={c * cell - cell * 0.36} y={r * cell - cell * 0.36} width={cell * 0.72} height={cell * 0.72} rx={4} fill="#b03028" opacity={0.28} />)}
        {setupMode ? draft?.map((zh, i) => {
          const [r, c] = jqCells[i];
          const isSel = selCell === i;
          const isDrag = dragCell === i;
          const isHover = dragHover === i && dragCell != null && dragCell !== i;
          const isViol = violSet.has(i);
          return (
            <g key={`jd${i}`} style={{ cursor: "grab" }}>
              <rect x={c * cell - 19} y={r * cell - 14} width={38} height={28} rx={5}
                fill={p2fill(humanSeat)}
                stroke={isViol ? "#ff5d5d" : isSel ? "#ffd34d" : isHover ? "#7ee08a" : isDrag ? "#8ecbff" : "rgba(255,255,255,0.35)"}
                strokeWidth={isViol || isSel || isHover || isDrag ? 2.4 : 1}
                strokeDasharray={isDrag ? "4 2" : undefined} opacity={isDrag ? 0.75 : 1} />
              <text x={c * cell} y={r * cell + 5} fontSize={13} fontWeight={700} textAnchor="middle"
                fill={isViol ? "#ffb1b1" : "#fff"} fontFamily="'Songti SC','STSong',serif" style={{ pointerEvents: "none" }}>
                {zh}
              </text>
            </g>
          );
        }) : board.map((row, r) => row.map((p, c) => {
          if (!p) return null;
          const isMine = humanSeat != null && p.side === humanSeat;
          const show = isMine || revealAll || p.revealed || replay; // replay：终局复盘全亮（看双方布阵）
          const name = `${"ABCDE"[c]}${r + 1}`;
          const isSel = sel === name;
          const isTarget = targetsOfSel.has(name);
          const isLastTo = lastPos && lastPos.to === name;
          const flagLit = p.type === "军旗" && state?.flagRevealed?.[p.side];
          return (
            <g key={`j${r}${c}`} className={isLastTo ? "arena-anim-pop" : undefined}>
              <rect x={c * cell - 19} y={r * cell - 14} width={38} height={28} rx={5}
                fill={show ? (p.side === 0 ? "#2f5a8f" : "#a83c30") : "#4a4438"}
                stroke={isSel ? "#ffd34d" : isTarget ? "#7ee08a" : "rgba(255,255,255,0.35)"} strokeWidth={isSel || isTarget ? 2.4 : 1} />
              <text x={c * cell} y={r * cell + 5} fontSize={13} fontWeight={700} textAnchor="middle"
                fill={show ? "#fff" : flagLit ? "#ffd34d" : "#c9c2b0"} fontFamily="'Songti SC','STSong',serif">
                {show ? p.type : flagLit ? "旗" : "暗"}
              </text>
            </g>
          );
        }))}
      </svg>
     </div>
      {setupMode ? (
        <div className="flex items-center gap-3 pt-1.5" data-arena-jq-setupactions>
          <button type="button" onClick={redraft} className="px-3 py-1 rounded-lg text-xs border border-white/15 bg-black/30 hover:bg-black/50 text-white/80" data-arena-jq-redraw>
            {t("arena.junqi.setupRedraw")}
          </button>
          <button type="button" onClick={confirmSetup} disabled={!draftValid}
            className={`px-5 py-1.5 rounded-full text-xs font-bold text-white shadow transition ${draftValid ? "hover:scale-105" : "opacity-40 cursor-not-allowed"}`}
            style={{ background: draftValid ? "linear-gradient(135deg,#5a6b3d,#3d4a28)" : "#3a3a3a" }} data-arena-jq-confirm>
            {t("arena.junqi.setupConfirm")}
          </button>
        </div>
      ) : (
        <div className="flex justify-between text-[10px] opacity-60 px-1 pt-1.5">
          <span>{t("arena.junqi.legend")}</span><span>{t("arena.junqi.legend2")}</span>
        </div>
      )}
    </div>
  );
}

/** 布阵态己方棋子底色（seat 0 蓝 / seat 1 红，与行棋亮子配色一致）。 */
function p2fill(seat) {
  return seat === 1 ? "#a83c30" : "#2f5a8f";
}


/* ================= 德州扑克（games2 追加卡位） ================= */

const ST_ZH = { active: "行动中", folded: "弃牌", allin: "全压", out: "出局" };

export function PokerTable({ state, seatNames, seatDetails, humanSeat, pending, onHumanMove, lastMove }) {
  const st = state ?? { stacks: [], community: [], committedStreet: [], status: [], holes: [[], [], [], []], pot: 0, phase: "idle" };
  const [betAmt, setBetAmt] = useState("");
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  const acts = pending?.actions ?? [];
  const isShowdown = st.phase === "showdown" || st.phase === "over" || st.phase === "idle";
  // 座位旋转（2026-11-07 用户裁定：人参与时名牌在下方、对手横排在上方）——
  // 人类恒居下位，其余三家按相对次序横排于上；观战（humanSeat=null）不旋转。
  const rot = humanSeat != null ? (s) => (s - humanSeat + 4) % 4 : (s) => s;
  const bottomSeat = humanSeat != null ? humanSeat : 0;
  const foes = humanSeat != null ? [1, 2, 3].map((k) => (humanSeat + k) % 4) : [1, 2, 3];
  const Seat = ({ s, pos }) => {
    const status = st.status?.[s] ?? "active";
    const hole = st.holes?.[s] ?? [];
    const reveal = isShowdown && status !== "folded" && status !== "out";
    const mine = s === humanSeat;
    return (
      <div className={`flex flex-col items-center gap-1 ${pos}`} data-arena-pk-seat={s}>
        <div className="flex gap-0.5 items-end">
          {hole.map((c, i) => (mine || reveal ? <PokerCard key={i} ch={c} size={mine ? "md" : "sm"} /> : <PokerBack key={i} size="sm" />))}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] ${pending?.seat === s ? "bg-amber-400/25 ring-1 ring-amber-400" : "bg-black/25"}`}>
          <span className="font-semibold text-white" title={seatDetails?.[s]}>{seatNames?.[s] ?? `${s + 1}号`}{s === st.button ? " ·BTN" : ""}</span>
          <span className="text-emerald-300 font-mono">{st.stacks?.[s] ?? 0}</span>
          {status !== "active" && <span className={`px-1 rounded text-[10px] ${status === "folded" ? "bg-white/15 text-white/50" : status === "allin" ? "bg-red-500/70 text-white" : "bg-black/40 text-white/40"}`}>{ST_ZH[status]}</span>}
          {(st.committedStreet?.[s] ?? 0) > 0 && <span className="text-sky-200 font-mono">投{st.committedStreet[s]}</span>}
        </div>
      </div>
    );
  };
  const numAct = acts.find((a) => /^((bet)|(raise)):(\d+)$/.exec(a));
  const submitBet = () => {
    if (!betAmt) return;
    onHumanMove?.(`${numAct.startsWith("bet") ? "bet" : "raise"}:${Number(betAmt)}`);
    setBetAmt("");
  };
  return (
    <div className="mx-auto rounded-2xl p-4 relative" style={{ background: "radial-gradient(ellipse at 50% 40%, #2a7d4f 0%, #1c5c39 60%, #14402a 100%)", width: "min(100%, 620px)" }} data-arena-poker>
      <div className="flex flex-col items-center gap-2" style={{ minHeight: 320 }}>
        {/* 对手三名牌横排（上位） */}
        <div className="flex justify-center gap-6" data-arena-pk-foes>
          {foes.map((s) => <Seat key={s} s={s} pos="" />)}
        </div>
        {/* 中央：公共牌 + 底池 */}
        <div className="flex flex-col items-center gap-1.5 px-4 py-2" data-arena-pk-center>
          <div className="flex gap-1 min-h-[54px] items-center" data-arena-pk-community>
            {(st.community ?? []).map((c, i) => <PokerCard key={i} ch={c} size="sm" />)}
          </div>
          <div className="px-3 py-0.5 rounded-full bg-black/30 text-white text-[11px] font-mono" data-arena-pk-pot>池 {st.pot ?? 0}{st.streetBet ? ` · 注 ${st.streetBet}` : ""} · 第 {st.handNo ?? 0}/8 手</div>
        </div>
        {/* 我（下位） */}
        <Seat s={bottomSeat} pos="" />
      </div>
      {clickable && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2" data-arena-pk-actions>
          {acts.includes("fold") && <button className="px-3 py-1 rounded-full text-xs font-bold text-white bg-neutral-700" onClick={() => onHumanMove?.("fold")}>弃牌</button>}
          {acts.includes("check") && <button className="px-3 py-1 rounded-full text-xs font-bold text-white bg-slate-500" onClick={() => onHumanMove?.("check")}>过牌</button>}
          {acts.includes("call") && <button className="px-3 py-1 rounded-full text-xs font-bold text-white bg-sky-600" onClick={() => onHumanMove?.("call")}>跟注</button>}
          {numAct && (
            <span className="flex items-center gap-1">
              <input className="w-20 px-2 py-1 rounded-lg text-xs text-black" value={betAmt} placeholder={numAct} onChange={(e) => setBetAmt(e.target.value)} data-arena-pk-amt />
              <button className="px-3 py-1 rounded-full text-xs font-bold text-white bg-amber-600" onClick={submitBet}>{numAct.startsWith("bet") ? "下注" : "加注到"}</button>
            </span>
          )}
          {acts.includes("allin") && <button className="px-3 py-1 rounded-full text-xs font-bold text-white bg-red-600" onClick={() => onHumanMove?.("allin")}>全压</button>}
        </div>
      )}
    </div>
  );
}


/* ================= 掼蛋（games2 追加卡位：升级赛到 A） ================= */

export function GuandanTable({ state, seatNames, seatDetails, humanSeat, pending, onHumanMove }) {
  const st = state ?? { hands: [[], [], [], []], levels: ["2", "2"], lastPlay: null, finishOrder: [], hist: [] };
  const [sel, setSel] = useState([]); // 选中的手牌（牌串，重复用出现次数区分——用索引）
  const [selIdx, setSelIdx] = useState([]); // 手牌索引
  const myHand = st.hands?.[humanSeat ?? 0] ?? [];
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  const teamOf = (s) => (s % 2 === 0 ? "A队" : "B队");
  const Seat = ({ s }) => {
    const fin = (st.finishOrder ?? []).indexOf(s);
    return (
      <div className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl ${pending?.seat === s ? "bg-amber-400/20 ring-1 ring-amber-400" : "bg-black/20"}`} data-arena-gd-seat={s}>
        <span className="text-white text-[11px] font-semibold" title={seatDetails?.[s]}>{seatNames?.[s] ?? `${s + 1}号`} · {teamOf(s)}·级{st.levels?.[s % 2] ?? "2"}{s === ((humanSeat ?? 0) + 2) % 4 ? "（队友）" : ""}</span>
        <span className="text-white/60 text-[10px]">{fin >= 0 ? ["头游", "二游", "三游", "末游"][fin] : `剩 ${st.hands?.[s]?.length ?? 0} 张`}</span>
      </div>
    );
  };
  const lastPlayCards = st.lastPlay?.cards ?? [];
  const submit = () => {
    if (!selIdx.length) return;
    onHumanMove?.(`play:${selIdx.map((i) => myHand[i]).join(" ")}`);
    setSelIdx([]);
  };
  return (
    <div className="mx-auto rounded-2xl p-4" style={{ background: "radial-gradient(ellipse at 50% 35%, #1c6b4a 0%, #134a34 65%, #0d3826 100%)", width: "min(100%, 680px)" }} data-arena-guandan>
      <div className="flex justify-center gap-2"><Seat s={1} /><Seat s={2} /><Seat s={3} /></div>
      <div className="flex items-center justify-center gap-3 py-3 min-h-[70px]" data-arena-gd-last>
        {lastPlayCards.length
          ? <div className="flex flex-col items-center gap-1">
              <span className="text-white/60 text-[10px]">{(st.lastPlay.seat ?? 0) + 1}号 出</span>
              <div className="flex gap-0.5">{lastPlayCards.map((c, i) => <PokerCard key={i} ch={c} size="sm" />)}</div>
            </div>
          : <span className="text-white/50 text-xs">新轮首出</span>}
      </div>
      <div className="flex justify-center"><Seat s={0} /></div>
      {/* 手牌区：人类可多选 */}
      <div className="flex flex-wrap gap-0.5 justify-center mt-3 pt-2 border-t border-white/15 min-h-[76px]" data-arena-gd-hand>
        {myHand.map((c, i) => (
          <div key={i} onClick={() => {
            if (!clickable) return;
            setSelIdx((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]));
          }} className={clickable ? "cursor-pointer" : ""}>
            <PokerCard ch={c} size="sm" picked={selIdx.includes(i)} />
          </div>
        ))}
      </div>
      {clickable && (
        <div className="flex justify-center gap-2 mt-2" data-arena-gd-actions>
          <button className="px-4 py-1 rounded-full text-xs font-bold text-white bg-emerald-600" disabled={!selIdx.length} onClick={submit}>出牌（{selIdx.length}）</button>
          <button className="px-4 py-1 rounded-full text-xs font-bold text-white bg-slate-600" onClick={() => { onHumanMove?.("pass"); setSelIdx([]); }}>过</button>
        </div>
      )}
    </div>
  );
}

/* ================= 围棋（games2 Q3/Q4：go9/go13 双 id 共引擎） ================= */

/** 9/13 路星位（天元居中；9 路 4+1，13 路 4+1）。 */
const GO_STARS = {
  9: [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]],
  13: [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]],
};

export function GoBoard({ state, humanSeat, pending, onHumanMove, lastMove, expand = false }) {
  const size = state?.size ?? 9;
  const board = state?.board ?? [];
  const last = lastMove && lastMove.t === "move" ? lastMove : null;
  const lastPos = useMemo(() => {
    if (!last) return null;
    const m = /^([A-Z])(\d{1,2})$/.exec(last.move ?? "");
    return m ? { c: m[1].charCodeAt(0) - 65, r: Number(m[2]) - 1 } : null;
  }, [last]);
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  const cell = size === 9 ? 28 : 22;
  const pad = 20;
  const dim = (size - 1) * cell + pad * 2;
  const onClick = (e) => {
    if (!clickable) return;
    const pt = svgPoint(e.currentTarget, e.clientX, e.clientY);
    const c = Math.round((pt.x - pad) / cell);
    const r = Math.round((pt.y - pad) / cell);
    if (r < 0 || r >= size || c < 0 || c >= size || board[r]?.[c]) return;
    onHumanMove?.(String.fromCharCode(65 + c) + (r + 1));
  };
  const lines = [];
  for (let i = 0; i < size; i += 1) {
    lines.push(<line key={`h${i}`} x1={0} y1={i * cell} x2={(size - 1) * cell} y2={i * cell} stroke="#7a5321" strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.7} opacity={0.75} />);
    lines.push(<line key={`v${i}`} x1={i * cell} y1={0} x2={i * cell} y2={(size - 1) * cell} stroke="#7a5321" strokeWidth={i === 0 || i === size - 1 ? 1.5 : 0.7} opacity={0.75} />);
  }
  const stars = GO_STARS[size] ?? [];
  const caps = state?.captures ?? [0, 0];
  return (
    <div className="w-full h-full flex flex-col items-center relative" data-arena-go>
      <div className="flex items-center justify-between text-[11px] opacity-70 px-1 pb-2" data-arena-go-info>
        <span>⚫ 提子 {caps[0]}</span>
        <span>{state?.passes ? `连续 pass ${state.passes}/2` : `第 ${(state?.moveCount ?? 0) + 1} 手 / 帽 ${state?.cap ?? "-"}`}</span>
        <span>提子 {caps[1]} ⚪</span>
      </div>
     <div className="arena-wood rounded-2xl p-2 flex-1 w-full min-h-0 flex items-center justify-center">
      <svg viewBox={`${-pad} ${-pad} ${dim} ${dim}`} style={{ width: "100%", height: "100%", display: "block", filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.35))" }} onClick={onClick} className="arena-board-svg">
        <defs>
          <radialGradient id="goBlack" cx="0.35" cy="0.3" r="0.95">
            <stop offset="0%" stopColor="#6b6f76" />
            <stop offset="55%" stopColor="#2f3237" />
            <stop offset="100%" stopColor="#101216" />
          </radialGradient>
          <radialGradient id="goWhite" cx="0.35" cy="0.3" r="0.95">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#e8e6dc" />
            <stop offset="100%" stopColor="#b9b6a8" />
          </radialGradient>
          <filter id="goShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0.8" dy="1.2" stdDeviation="0.9" floodOpacity="0.35" />
          </filter>
        </defs>
        {lines}
        {stars.map(([r, c]) => <circle key={`s${r}${c}`} cx={c * cell} cy={r * cell} r={2.6} fill="#7a5321" />)}
        {board.map((row, r) => row.map((v, c) => {
          if (!v) return null;
          const isLast = lastPos && lastPos.r === r && lastPos.c === c;
          return (
            <g key={`p${r}${c}`} filter="url(#goShadow)" className={isLast ? "arena-anim-pop" : undefined}>
              <circle cx={c * cell} cy={r * cell} r={cell * 0.46} fill={v === 1 ? "url(#goBlack)" : "url(#goWhite)"} stroke={v === 1 ? "#000" : "#a9a99e"} strokeWidth={0.6} />
            </g>
          );
        }))}
        {lastPos && (
          <g className="arena-anim-ring" pointerEvents="none">
            <circle cx={lastPos.c * cell} cy={lastPos.r * cell} r={4.2} fill="none" stroke="#e05555" strokeWidth={1.8} />
            <circle cx={lastPos.c * cell} cy={lastPos.r * cell} r={1.4} fill="#e05555" />
          </g>
        )}
      </svg>
     </div>
      {clickable && (
        <button
          className="absolute top-2 right-3 px-2.5 py-1 rounded-lg text-[11px] bg-black/10 dark:bg-white/15 hover:bg-black/20 dark:hover:bg-white/25"
          onClick={() => onHumanMove?.("pass")}
          data-arena-go-pass
        >
          🤚 pass
        </button>
      )}
    </div>
  );
}

/* ================= 象棋 ================= */

const PIECE_FACE = {
  rK: ["帥", "#b03028"], rA: ["仕", "#b03028"], rB: ["相", "#b03028"], rN: ["馬", "#b03028"], rR: ["車", "#b03028"], rC: ["炮", "#b03028"], rP: ["兵", "#b03028"],
  bK: ["將", "#22303f"], bA: ["士", "#22303f"], bB: ["象", "#22303f"], bN: ["馬", "#22303f"], bR: ["車", "#22303f"], bC: ["砲", "#22303f"], bP: ["卒", "#22303f"],
};
/** 炮位/兵位刻线坐标（col,row）。 */
const MARKS = [[1, 2], [7, 2], [1, 7], [7, 7], [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [0, 6], [2, 6], [4, 6], [6, 6], [8, 6]];

function posMark(cx, cy, cell) {
  // 四角短折线刻标（炮位/兵位）
  return (
    <g key={`m${cx}-${cy}`} opacity="0.8">
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => (
        <path key={`${sx}${sy}`} d={`M ${cx + sx * 3.4} ${cy + sy * (3.4 + 5)} V ${cy + sy * 3.4} H ${cx + sx * (3.4 + 5)}`} stroke="#7a5321" strokeWidth="0.9" fill="none" transform={cx === 0 * cell && sx < 0 ? "" : undefined} />
      ))}
    </g>
  );
}

export function XiangqiBoard({ state, humanSeat, pending, onHumanMove, lastMove, expand = false }) {
  const board = state?.board ?? [];
  const cell = 36;
  const pad = 26;
  const W = 8 * cell + pad * 2;
  const H = 9 * cell + pad * 2;
  const mySide = humanSeat === 0 ? "r" : "b";
  const clickable = humanSeat != null && pending?.seat === humanSeat;
  const [sel, setSel] = useState(null);
  const targets = useMemo(() => {
    if (!sel || !pending?.actions) return new Set();
    const from = xsq(sel.r, sel.c);
    // ICCS 行 10 是两位数（"a10"）：起点匹配必须按着法解析（slice(0,2) 会把
    // "a10b10" 截成 "a1"——黑方底线落子全错的根因之一）
    const out = new Set();
    for (const a of pending.actions) {
      const m = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(a);
      if (m && m[1] === from) out.add(m[2]);
    }
    return out;
  }, [sel, pending]);
  const lastPos = useMemo(() => {
    const m = lastMove?.t === "move" ? /^([a-i])(\d+)([a-i])(\d+)$/.exec(lastMove.move ?? "") : null;
    if (!m) return null;
    return { from: { c: XCOLS.indexOf(m[1]), r: 10 - Number(m[2]) }, to: { c: XCOLS.indexOf(m[3]), r: 10 - Number(m[4]) } };
  }, [lastMove]);
  const onCell = (r, c) => {
    if (!clickable) return;
    const piece = board[r][c];
    const toSq = xsq(r, c);
    if (sel && targets.has(toSq)) {
      onHumanMove?.(pending.actions.find((a) => a === `${xsq(sel.r, sel.c)}${toSq}`));
      setSel(null);
      return;
    }
    if (piece?.side === mySide) setSel({ r, c });
    else setSel(null);
  };
  // ---- 拖动走子（市面象棋标配；pointer 事件 + 指针捕获，点击不受影响）----
  const [drag, setDrag] = useState(null); // {r, c, x, y, moved}（x/y 为 SVG 坐标）
  const svgPt = (e) => {
    // viewBox = (-pad, -pad, W, H)：clientX → 用户坐标（-pad 偏移）
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W - pad, y: ((e.clientY - rect.top) / rect.height) * H - pad };
  };
  const onPiecePointerDown = (e, r, c) => {
    if (!clickable) return;
    e.stopPropagation();
    const piece = board[r][c];
    if (piece?.side !== mySide) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pt = svgPt(e);
    setDrag({ r, c, x: pt.x, y: pt.y, moved: false });
  };
  const onSvgPointerMove = (e) => {
    if (!drag) return;
    const pt = svgPt(e);
    setDrag((d) => (d ? { ...d, x: pt.x, y: pt.y, moved: d.moved || Math.hypot(pt.x - d.x, pt.y - d.y) > 4 || d.moved } : d));
  };
  const onSvgPointerUp = (e) => {
    if (!drag) return;
    const { r, c, moved } = drag;
    setDrag(null);
    if (!moved) { onCell(r, c); return; } // 未位移 = 点击选中
    const pt = svgPt(e);
    const cc = Math.round(pt.x / cell);
    const rr = Math.round(pt.y / cell);
    if (rr < 0 || rr > 9 || cc < 0 || cc > 8) return;
    const toSq = xsq(rr, cc);
    const mv = pending?.actions?.find((a) => a === `${xsq(r, c)}${toSq}`);
    if (mv) { onHumanMove?.(mv); setSel(null); }
    else if (board[rr]?.[cc]?.side === mySide) setSel({ r: rr, c: cc }); // 拖到己方子上 = 换选
  };
  const gridLines = [];
  for (let r = 0; r < 10; r += 1) gridLines.push(<line key={`h${r}`} x1={0} y1={r * cell} x2={8 * cell} y2={r * cell} stroke="#7a5321" strokeWidth={r === 0 || r === 9 ? 1.7 : 0.8} opacity={0.8} />);
  for (let c = 0; c < 9; c += 1) {
    if (c === 0 || c === 8) gridLines.push(<line key={`v${c}`} x1={c * cell} y1={0} x2={c * cell} y2={9 * cell} stroke="#7a5321" strokeWidth={1.7} opacity={0.8} />);
    else {
      gridLines.push(<line key={`vt${c}`} x1={c * cell} y1={0} x2={c * cell} y2={4 * cell} stroke="#7a5321" strokeWidth={0.8} opacity={0.8} />);
      gridLines.push(<line key={`vb${c}`} x1={c * cell} y1={5 * cell} x2={c * cell} y2={9 * cell} stroke="#7a5321" strokeWidth={0.8} opacity={0.8} />);
    }
  }
  const palaces = [
    <line key="p1" x1={3 * cell} y1={0} x2={5 * cell} y2={2 * cell} stroke="#7a5321" strokeWidth={0.9} opacity={0.8} />,
    <line key="p2" x1={5 * cell} y1={0} x2={3 * cell} y2={2 * cell} stroke="#7a5321" strokeWidth={0.9} opacity={0.8} />,
    <line key="p3" x1={3 * cell} y1={7 * cell} x2={5 * cell} y2={9 * cell} stroke="#7a5321" strokeWidth={0.9} opacity={0.8} />,
    <line key="p4" x1={5 * cell} y1={7 * cell} x2={3 * cell} y2={9 * cell} stroke="#7a5321" strokeWidth={0.9} opacity={0.8} />,
  ];
  return (
    <div className="w-full h-full flex items-center justify-center" data-arena-xiangqi>
      <div className="arena-wood rounded-2xl p-4 flex-1 h-full flex items-center justify-center">
      <svg
        viewBox={`${-pad} ${-pad} ${W} ${H}`}
        style={expand ? { height: "min(82vh, 92vw)", width: "auto", display: "block", touchAction: "none" } : { width: "min(100%, 520px)", maxHeight: "70vh", display: "block", touchAction: "none" }}
        className="arena-board-svg"
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
      >
        <defs>
          <radialGradient id="xqPieceR" cx="0.38" cy="0.32" r="0.95">
            <stop offset="0%" stopColor="#fffdf4" />
            <stop offset="55%" stopColor="#f7ecd2" />
            <stop offset="100%" stopColor="#dcc08a" />
          </radialGradient>
          <filter id="xqShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.4" floodColor="#4a2c08" floodOpacity="0.42" />
          </filter>
        </defs>
        <rect x={-pad / 2} y={-pad / 2} width={W - pad} height={H - pad} fill="none" stroke="#6b4517" strokeWidth={2.2} rx={6} opacity={0.9} />
        <rect x={-pad / 2 + 4} y={-pad / 2 + 4} width={W - pad - 8} height={H - pad - 8} fill="none" stroke="#6b4517" strokeWidth={0.9} rx={4} opacity={0.65} />
        {gridLines}
        {palaces}
        {MARKS.map(([c, r]) => posMark(c * cell, r * cell, cell))}
        {/* 空格点击层（2026-11-04 用户实测「点击不能落子」根因）：此前只有棋子
            <g> 有 onClick——选中后点空格落子永远无响应（吃子才有）。透明
            hit 圈画在棋子层之下，棋子点击照常由 <g> 接管（stopPropagation）。 */}
        {clickable && Array.from({ length: 10 }, (_, r) => Array.from({ length: 9 }, (_, c) => (
          <circle
            key={`xhit${r}${c}`}
            cx={c * cell}
            cy={r * cell}
            r={cell * 0.48}
            fill="transparent"
            data-arena-xq-hit={`${r}${c}`}
            onClick={(e) => { e.stopPropagation(); onCell(r, c); }}
            style={{ cursor: clickable ? "pointer" : "default" }}
          />
        )))}
        <text x={2 * cell} y={4.62 * cell} textAnchor="middle" fontSize={cell * 0.52} fill="#7a5321" opacity={0.85} fontFamily="'Songti SC','STSong',serif" fontWeight={600} letterSpacing={4}>楚 河</text>
        <text x={6 * cell} y={4.62 * cell} textAnchor="middle" fontSize={cell * 0.52} fill="#7a5321" opacity={0.85} fontFamily="'Songti SC','STSong',serif" fontWeight={600} letterSpacing={4}>汉 界</text>
        {board.map((row, r) => row.map((p, c) => {
          if (!p) return null;
          const [face, color] = PIECE_FACE[`${p.side}${p.type}`];
          const isSel = sel?.r === r && sel?.c === c;
          const isDragging = drag && drag.r === r && drag.c === c;
          const isLastTo = lastPos?.to && lastPos.to.r === r && lastPos.to.c === c;
          const draggable = clickable && p.side === mySide;
          return (
            <g
              key={`x${r}${c}`}
              onPointerDown={draggable ? (e) => onPiecePointerDown(e, r, c) : undefined}
              onClick={(e) => { if (!isDragging) { e.stopPropagation(); onCell(r, c); } }}
              style={{ cursor: draggable ? "grab" : clickable ? "pointer" : "default", opacity: isDragging ? 0.25 : undefined }}
              filter="url(#xqShadow)"
              className={isLastTo ? "arena-anim-pop" : undefined}
            >
              <circle cx={c * cell} cy={r * cell} r={cell * 0.455} fill="url(#xqPieceR)" stroke={isSel ? "#4f8cff" : "#b98d4e"} strokeWidth={isSel ? 2.4 : 1.4} />
              <circle cx={c * cell} cy={r * cell} r={cell * 0.375} fill="none" stroke={color} strokeWidth={0.8} opacity={0.55} />
              <text x={c * cell} y={r * cell + cell * 0.185} textAnchor="middle" fontSize={cell * 0.52} fill={color} fontWeight={700} fontFamily="'Songti SC','STSong','SimSun',serif">{face}</text>
            </g>
          );
        }))}
        {/* 拖动 ghost：跟手的大号棋子 */}
        {drag && drag.moved && (() => {
          const p = board[drag.r]?.[drag.c];
          if (!p) return null;
          const [face, color] = PIECE_FACE[`${p.side}${p.type}`];
          return (
            <g pointerEvents="none" filter="url(#xqShadow)" style={{ transform: `translate(${drag.x}px, ${drag.y}px)` }} className="arena-drag-ghost">
              <circle cx={0} cy={0} r={cell * 0.5} fill="url(#xqPieceR)" stroke="#4f8cff" strokeWidth={2} />
              <circle cx={0} cy={0} r={cell * 0.4} fill="none" stroke={color} strokeWidth={0.9} opacity={0.6} />
              <text x={0} y={cell * 0.2} textAnchor="middle" fontSize={cell * 0.56} fill={color} fontWeight={700} fontFamily="'Songti SC','STSong','SimSun',serif">{face}</text>
            </g>
          );
        })()}
        {[...targets].map((t) => {
          const c = XCOLS.indexOf(t[0]);
          const r = 10 - Number(t.slice(1));
          return (
            <g key={`t${t}`} className="arena-anim-ring" pointerEvents="none">
              <circle cx={c * cell} cy={r * cell} r={6.5} fill="#4f8cff" opacity={0.28} />
              <circle cx={c * cell} cy={r * cell} r={3.2} fill="#4f8cff" opacity={0.9} />
            </g>
          );
        })}
        {lastPos?.from && <circle cx={lastPos.from.c * cell} cy={lastPos.from.r * cell} r={cell * 0.5} fill="none" stroke="#d98a2b" strokeWidth={1.8} pointerEvents="none" strokeDasharray="4 3" />}
        {lastPos?.to && !board[lastPos.to.r]?.[lastPos.to.c] && <circle cx={lastPos.to.c * cell} cy={lastPos.to.r * cell} r={cell * 0.5} fill="none" stroke="#e05555" strokeWidth={1.8} pointerEvents="none" />}
      </svg>
      </div>
    </div>
  );
}

/* ================= 斗地主 ================= */

/** 单个座位头像章（字母 + 渐变底）。 */
function SeatBadge({ label, tone = "blue", crown = false, active = false, small = false }) {
  const tones = {
    blue: "linear-gradient(135deg,#5b8def,#3f5fd0)",
    green: "linear-gradient(135deg,#43b581,#2c8a5f)",
    amber: "linear-gradient(135deg,#e8b04b,#c9803a)",
    slate: "linear-gradient(135deg,#8a95a5,#5b6675)",
  };
  return (
    <div className="relative" style={{ width: small ? 34 : 42, height: small ? 34 : 42 }}>
      <div
        className={`w-full h-full rounded-full flex items-center justify-center text-white font-bold shadow-lg ${active ? "arena-anim-gold" : ""}`}
        style={{ background: tones[tone] ?? tones.blue, fontSize: small ? 13 : 15 }}
      >
        {(label ?? "?").slice(0, 2)}
      </div>
      {crown && <span className="absolute -top-2.5 -right-1.5 text-[15px] drop-shadow" title="地主">👑</span>}
    </div>
  );
}

export function DoudizhuTable({ state, seatNames, seatDetails, humanSeat, pending, onHumanMove, expand: _expand = false }) {
  // picked 存手牌实例索引（按实例增删，重复点数可选多张）
  const [picked, setPicked] = useState([]);
  const st = state ?? { phase: "bid", hands: [[], [], []], bottom: [], plays: [] };
  const myHand = humanSeat != null ? sortCards(st.hands?.[humanSeat] ?? []) : [];
  const isMyTurn = humanSeat != null && pending?.seat === humanSeat;
  const landlord = st.landlord;
  const toggle = (i) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  const canPass = !!(pending?.actions ?? []).includes("play:PASS");

  // 各座位最近一次动作（出牌/不要/叫分）——就近展示
  const lastBySeat = useMemo(() => {
    const out = {};
    for (const p of st.plays ?? []) out[p.seat] = p; // 后写覆盖 = 最近
    return out;
  }, [st.plays]);
  const toneOf = (s) => (s === landlord ? "amber" : s % 2 === 0 ? "blue" : "green");
  // 观战模式（humanSeat==null）三个座位全部上顶排；人机模式只上两个对手
  const opponents = humanSeat != null ? [0, 1, 2].filter((s) => s !== humanSeat) : [0, 1, 2];

  const seatLastAction = (s) => {
    const p = lastBySeat[s];
    if (!p) return null;
    if (p.pass) return <span className="px-2 py-0.5 rounded-full bg-black/25 text-white/90 text-[11px]" data-arena-ddz-pass={s}>不要</span>;
    if (p.cards?.length) return (
      <div className="flex arena-anim-slide" data-arena-ddz-last={s}>
        {p.cards.map((c, i) => <PokerCard key={i} ch={c} size="sm" />)}
      </div>
    );
    return null;
  };

  return (
    <div className="relative h-full min-h-0 w-full arena-felt rounded-2xl overflow-hidden flex flex-col" data-arena-ddz>
      {/* 绒面高光装饰 */}
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(ellipse 46% 32% at 50% 44%, rgba(255,255,255,0.12), transparent 70%)" }} />

      {/* 上排：座位（人机=两个对手左右；观战=0左/1中/2右） */}
      <div className="relative flex items-start justify-between px-6 pt-3 z-10">
        {opponents.map((s, idx) => (
          <div key={s} className={`flex flex-col items-center gap-1.5 ${idx === opponents.length - 1 ? "items-end" : ""}`} style={{ maxWidth: "34%" }}>
            <div className="flex items-center gap-2">
              <SeatBadge label={seatNames?.[s] ?? `${s + 1}号`} tone={toneOf(s)} crown={s === landlord} active={pending?.seat === s} />
              <div className="flex flex-col">
                <span className="text-white text-xs font-semibold drop-shadow" title={seatDetails?.[s]}>{seatNames?.[s] ?? `${s + 1}号`}</span>
                <span className="text-white/70 text-[10px]">{(st.hands?.[s] ?? []).length} 张</span>
              </div>
            </div>
            <div className="flex -space-x-6 h-9 items-center">
              {Array.from({ length: Math.min((st.hands?.[s] ?? []).length, 14) }).map((_, i) => <PokerBack key={i} size="xs" />)}
            </div>
            {seatLastAction(s)}
          </div>
        ))}
      </div>

      {/* 中央：底牌 + 出牌区 */}
      <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center gap-2 z-10">
        {st.phase === "play" && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/25" data-arena-ddz-bottom>
            <span className="text-white/70 text-[10px] mr-1">底牌</span>
            {(st.bottom ?? []).map((c, i) => <PokerCard key={i} ch={c} size="xs" />)}
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-wrap justify-center max-w-[80%] min-h-[68px]" data-arena-ddz-trick>
          {(() => {
            // 本墩即时显示（用户实测反馈：出牌要立即上桌，不等一圈）：从 plays 尾部
            // 回溯到最后一个非 pass = 本墩领出牌，其后的 pass 一并陈列
            const plays = st.plays ?? [];
            let i = plays.length - 1;
            while (i >= 0 && plays[i].pass) i -= 1;
            if (i >= 0) {
              const lead = plays[i];
              const passes = plays.slice(i + 1);
              return (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap justify-center">
                    <span className="text-white/80 text-[10px] px-2 py-0.5 rounded-full bg-black/30">{seatNames?.[lead.seat] ?? lead.seat + 1}</span>
                    {lead.cards.map((c, k) => <PokerCard key={k} ch={c} size="lg" />)}
                  </div>
                  {passes.length > 0 && (
                    <div className="flex gap-1.5">
                      {passes.map((p, k) => <span key={k} className="text-white/70 text-[10px] px-2 py-0.5 rounded-full bg-black/25">{seatNames?.[p.seat] ?? p.seat + 1} 不要</span>)}
                    </div>
                  )}
                </div>
              );
            }
            return <span className="text-white/55 text-xs">{st.phase === "bid" ? "叫牌中…" : "等待出牌"}</span>;
          })()}
        </div>
        {isMyTurn && pending.kind === "bid" && (
          <div className="flex gap-2" data-arena-ddz-bid>
            {[0, 1, 2, 3].map((n) => (
              <button
                key={n}
                className="w-12 h-12 rounded-full text-white text-sm font-bold shadow-lg transition-transform hover:scale-105 active:scale-95"
                style={{ background: n === 0 ? "radial-gradient(circle at 35% 30%,#8a95a5,#4a5568)" : `radial-gradient(circle at 35% 30%, ${["#e8b04b","#e08a3a","#d05a3a","#c0392b"][n - 1]}, #8a3220)` }}
                onClick={() => onHumanMove?.(`bid:${n}`)}
              >
                <span className="block leading-none">{n === 0 ? "不叫" : n}</span>
                {n > 0 && <span className="block text-[9px] opacity-80 leading-none mt-0.5">分</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部：我的手牌（真实牌面扇形排布） */}
      {humanSeat != null ? (
        <div className="relative z-10 px-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <SeatBadge label={seatNames?.[humanSeat] ?? "我"} tone={toneOf(humanSeat)} crown={humanSeat === landlord} active={isMyTurn} small />
              <span className="text-white text-xs font-semibold drop-shadow">{seatNames?.[humanSeat] ?? "你"}{humanSeat === landlord ? " · 地主" : ""}</span>
              <span className="text-white/70 text-[10px]">{myHand.length} 张</span>
            </div>
            {isMyTurn && pending.kind !== "bid" && (
              <div className="flex gap-2">
                <button
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  style={{ background: "linear-gradient(135deg,#e8b04b,#d08030)" }}
                  disabled={!picked.length}
                  onClick={() => { onHumanMove?.(`play:${[...picked].sort((a, b) => a - b).map((i) => myHand[i]).join("")}`); setPicked([]); }}
                  data-arena-ddz-play
                >出牌</button>
                <button
                  className="px-4 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                  style={{ background: "linear-gradient(135deg,#7a8ba0,#4a5a70)" }}
                  disabled={!canPass}
                  onClick={() => { onHumanMove?.("play:PASS"); setPicked([]); }}
                >不要</button>
              </div>
            )}
          </div>
          <div className="flex justify-center pt-4" data-arena-ddz-hand>
            {myHand.map((ch, i) => (
              <div key={i} className="arena-anim-deal" style={{ marginLeft: i === 0 ? 0 : -16, zIndex: i, animationDelay: `${Math.min(i * 22, 700)}ms` }}>
                <PokerCard ch={ch} size="md" picked={picked.includes(i)} onClick={isMyTurn && pending.kind !== "bid" ? () => toggle(i) : null} />
              </div>
            ))}
            {myHand.length === 0 && <span className="text-white/60 text-xs py-4">已出完</span>}
          </div>
        </div>
      ) : <div className="h-1" />}
    </div>
  );
}

/* ================= 麻将 ================= */

function MjMeld({ meld, size = "sm" }) {
  // 副露可视化：碰/明杠 3+1 张（来源牌转色），暗杠背面，补杠 3+翻
  const tiles = [];
  if (meld.type === "ankan") {
    for (let i = 0; i < 4; i += 1) tiles.push(<MjBack key={i} size={size} />);
  } else {
    const cnt = meld.type === "kan" || meld.type === "kakan" ? 4 : 3;
    for (let i = 0; i < cnt; i += 1) {
      tiles.push(<MjTileFace key={i} t={meld.tile} size={size} glow={meld.type === "kakan" && i === cnt - 1} />);
    }
  }
  return <div className="flex -space-x-1.5 rounded-md" data-arena-mj-meld>{tiles}</div>;
}

export function MahjongTable({ state, seatNames, seatDetails, humanSeat, pending, onHumanMove, expand: _expand = false }) {
  const st = state ?? { phase: "lack", hands: [[], [], [], []], melds: [[], [], [], []], discards: [[], [], [], []], lacks: [null, null, null, null], alive: [true, true, true, true], wall: 108 };
  const isMyTurn = humanSeat != null && pending?.seat === humanSeat;
  const myHand = humanSeat != null ? mjSort(st.hands?.[humanSeat] ?? []) : [];
  const myLack = humanSeat != null ? st.lacks?.[humanSeat] : null;
  const acts = pending?.actions ?? [];
  const top = 2;
  const left = 3;
  const right = 1;

  const Discards = ({ s, vertical = false }) => (
    <div className={`flex flex-wrap gap-0.5 ${vertical ? "flex-col max-h-full" : "max-w-[150px]"}`} data-arena-mj-river={s}>
      {(st.discards?.[s] ?? []).slice(-12).map((t, i, arr) => (
        <MjTileFace key={i} t={t} size="sm" pop={i === arr.length - 1} lack={st.lacks?.[s] && t[1] === st.lacks[s]} />
      ))}
      {(st.discards?.[s] ?? []).length === 0 && <span className="text-white/40 text-[10px]">—</span>}
    </div>
  );

  const Opponent = ({ s, vertical = false }) => (
    <div className={`flex ${vertical ? "flex-col items-center gap-1.5" : "items-center gap-2"} ${!st.alive?.[s] ? "opacity-55" : ""}`}>
      <SeatBadge label={seatNames?.[s] ?? `${s + 1}号`} tone={s % 2 === 0 ? "blue" : "green"} active={pending?.seat === s} small />
      <div className={`flex flex-col gap-1 items-center`}>
        <div className="flex items-center gap-1">
          <span className="text-white text-[11px] font-semibold drop-shadow" title={seatDetails?.[s]}>{seatNames?.[s] ?? `${s + 1}号`}</span>
          <span className="text-white/60 text-[9px]">{(st.hands?.[s] ?? []).length}</span>
          {st.lacks?.[s] && <span className="text-white/60 text-[9px] px-1 rounded bg-black/25">缺{MJ_SUIT_ZH[st.lacks[s]]}</span>}
          {!st.alive?.[s] && <span className="text-[9px] px-1.5 rounded-full text-white font-bold arena-anim-gold" style={{ background: "linear-gradient(135deg,#e8b04b,#c9821f)" }} data-arena-mj-won={s}>胡</span>}
          {st.alive?.[s] && st.won?.[s] && <span className="text-[9px] px-1.5 rounded-full text-white font-bold arena-anim-gold" style={{ background: "linear-gradient(135deg,#e8b04b,#c9821f)" }} data-arena-mj-won={s}>胡{(st.scores?.[s] ?? 0) > 0 ? `+${st.scores[s]}` : ""}</span>}
        </div>
        <div className="flex -space-x-3">
          {Array.from({ length: Math.min((st.hands?.[s] ?? []).length, 13) }).map((_, i) => <MjBack key={i} size="sm" />)}
        </div>
        {(st.melds?.[s] ?? []).length > 0 && <div className="flex gap-1">{(st.melds?.[s] ?? []).map((m, i) => <MjMeld key={i} meld={m} />)}</div>}
        {!vertical && <Discards s={s} />}
      </div>
      {vertical && <Discards s={s} />}
    </div>
  );

  return (
    <div className="relative h-full min-h-0 w-full arena-felt rounded-2xl overflow-hidden" data-arena-mj>
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(ellipse 48% 34% at 50% 46%, rgba(255,255,255,0.10), transparent 72%)" }} />
      <div className="relative h-full grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] gap-1 p-2 z-10" style={{ minHeight: 300 }}>
        {/* 顶：上家 */}
        <div className="col-start-2 row-start-1 flex justify-center pt-1">
          <Opponent s={top} />
        </div>
        {/* 左 */}
        <div className="col-start-1 row-start-2 flex items-center pl-1">
          <Opponent s={left} vertical />
        </div>
        {/* 中央：牌墙信息 + 对阵 */}
        <div className="col-start-2 row-start-2 flex flex-col items-center justify-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/30 text-white/90 text-[10px]">
            <span>🀄 牌墙 {st.wall ?? 0}</span>
            <span className="opacity-60">|</span>
            <span>{st.phase === "lack" ? "定缺阶段" : "血战进行中"}</span>
          </div>
          <div className="text-white/60 text-[10px] text-center">
            {seatNames ? [0, 1, 2, 3].map((s) => seatNames[s]).join(" · ") : ""}
          </div>
          {/* 牌河（四家合并尾流，最近 8 张） */}
          <div className="flex flex-wrap gap-0.5 justify-center max-w-[260px]">
            {[0, 1, 2, 3].flatMap((s) => (st.discards?.[s] ?? []).slice(-3).map((t, i) => <MjTileFace key={`${s}-${i}`} t={t} size="sm" />))}
          </div>
        </div>
        {/* 右 */}
        <div className="col-start-3 row-start-2 flex items-center pr-1">
          <Opponent s={right} vertical />
        </div>
        {/* 底：我 */}
        <div className="col-span-3 row-start-3 flex flex-col items-center gap-1.5 pb-1">
          {humanSeat != null ? (
            <>
              {isMyTurn && pending.kind === "lack" && (
                <div className="flex gap-2" data-arena-mj-lack>
                  {["m", "p", "s"].map((su) => (
                    <button key={su} className="px-4 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#4f8cff,#3555c9)" }} onClick={() => onHumanMove?.(`lack:${su}`)}>
                      定缺{MJ_SUIT_ZH[su]}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                {isMyTurn && acts.includes("action:hora") && (
                  <button className="px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-lg arena-anim-gold transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#f0b429,#d08020)" }} onClick={() => onHumanMove?.("action:hora")} data-arena-mj-hora>🎉 胡！</button>
                )}
                {isMyTurn && acts.includes("action:pon") && (
                  <button className="px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#4f8cff,#3555c9)" }} onClick={() => onHumanMove?.("action:pon")} data-arena-mj-pon>碰</button>
                )}
                {isMyTurn && acts.some((a) => a.startsWith("action:chi:")) && acts.filter((a) => a.startsWith("action:chi:")).map((a) => (
                  <button key={a} className="px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#9b6bef,#6f3fc9)" }} onClick={() => onHumanMove?.(a)} data-arena-mj-chi={a}>吃{a.slice(11)}</button>
                ))}
                {isMyTurn && (acts.some((a) => a.startsWith("action:ankan:")) || acts.some((a) => a.startsWith("action:kakan:"))) && acts.filter((a) => a.startsWith("action:ankan") || a.startsWith("action:kakan")).map((a) => (
                  <button key={a} className="px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-lg transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#43b581,#2c8a5f)" }} onClick={() => onHumanMove?.(a)}>{a.includes("ankan") ? "暗杠" : "补杠"}</button>
                ))}
                {isMyTurn && acts.includes("action:pass") && (
                  <button className="px-5 py-1.5 rounded-full text-xs font-bold text-white shadow-lg" style={{ background: "linear-gradient(135deg,#7a8ba0,#4a5a70)" }} onClick={() => onHumanMove?.("action:pass")}>过</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <SeatBadge label={seatNames?.[humanSeat] ?? "我"} tone="amber" active={isMyTurn} small />
                <span className="text-white text-[11px] font-semibold drop-shadow">{seatNames?.[humanSeat] ?? "你"}{myLack && ` · 缺${MJ_SUIT_ZH[myLack]}${(myHand ?? []).some((t) => t[1] === myLack) ? "（未清）" : "（已清）"}`}</span>
              </div>
              <div className="flex justify-center items-end pt-1" data-arena-mj-hand>
                {myHand.map((t, i) => {
                  const isDrawn = st.drawn === t && i === myHand.lastIndexOf(t);
                  // 可出性前置：缺门未清时只能打缺门牌（与裁判 apply 校验同口径）——
                  // 不可出的牌灰化无 click，杜绝「点了没反应」（裁判拒绝只在事件流小字）
                  const lackLocked = isMyTurn && myLack && myHand.some((x) => x[1] === myLack) && t[1] !== myLack;
                  const myDiscardTurn = isMyTurn && acts.some((a) => a.startsWith("discard:"));
                  // 灰牌也可点：照发动作，裁判给「必须先打缺门」人话拒绝（Room 提示条
                  // 显示）——静默无反应 = 用户感知「不能出牌」（真机实锤）
                  return (
                    <div key={i} className="arena-anim-deal" style={{ marginLeft: i === 0 ? 0 : -6, zIndex: i, animationDelay: `${Math.min(i * 14, 500)}ms` }}>
                      <MjTileFace
                        t={t} size="md"
                        lack={myLack && t[1] === myLack}
                        dim={lackLocked}
                        drawn={isDrawn}
                        glow={isDrawn}
                        onClick={myDiscardTurn ? () => onHumanMove?.(`discard:${t}`) : null}
                      />
                    </div>
                  );
                })}
                {myHand.length === 0 && <span className="text-white/60 text-xs py-4">{st.alive?.[humanSeat] === false ? "已胡离场" : ""}</span>}
              </div>
              {isMyTurn && myLack && myHand.some((x) => x[1] === myLack) && (
                <div className="text-[10px] text-amber-300/90">缺门未清：先打金框脉动的 {MJ_SUIT_ZH[myLack]} 牌</div>
              )}
            </>
          ) : <div />}
        </div>
      </div>
    </div>
  );
}

/** 面板分派器：按 gameId 选面板（expand=全屏模式：棋盘本体随屏扩展）。 */
export function GamePanel({ gameId, expand, ...props }) {
  props.expand = expand;
  // games2 通用自适应（2026-11-07）：SVG 棋盘内部已 width/height 100% + meet 等比
  // （随窗口缩放且恒居中）；DOM 牌桌统一包 FitScale（ResizeObserver 等比缩放）。
  if (gameId === "gobang") return <GobangBoard {...props} />;
  if (gameId === "junqi" || gameId === "fanqi") return <JunqiBoard {...props} />;
  if (gameId === "poker") return <FitScale><PokerTable {...props} /></FitScale>;
  if (gameId === "guandan") return <FitScale><GuandanTable {...props} /></FitScale>;
  if (gameId === "go9" || gameId === "go13") return <GoBoard {...props} />;
  if (gameId === "xiangqi") return <XiangqiBoard {...props} />;
  if (gameId === "doudizhu") return <FitScale><DoudizhuTable {...props} /></FitScale>;
  if (gameId === "mahjong" || gameId === "mahjong-xueliu" || gameId === "mahjong-guangdong" || gameId === "mahjong-riichi") return <FitScale><MahjongTable {...props} /></FitScale>;
  return <div className="text-center text-sm opacity-50 py-8">面板未注册：{gameId}</div>;
}
