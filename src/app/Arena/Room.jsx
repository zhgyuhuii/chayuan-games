/**
 * 对局室（games-llm-arena-plan Q5 五件套之二；2026-11-04 视觉轮）：
 *  - 棋盘/牌桌 + 出招事件流 + {move,comment} 弹幕区 + 代走标记 + 云角标（Q6）
 *  - 匿名观战：对局中玩家A/B/C/D，终局揭晓（Q6 默认开）
 *  - 布局：右侧事件流可折叠；棋盘全屏模式（Esc 退出）；结果横幅流光
 *  - Q9 二期落地：终局「AI 赛后解说」——整盘棋谱批量喂给本局参战模型，
 *    生成胜负手/转折点/失误点评（Markdown 渲染）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { seatName } from "../../arena/registry.js";
import { GamePanel, MJ_SUIT_ZH } from "./boards.jsx";
import { useI18n } from "../../i18n/index.jsx";
import { gatewayProxyBase } from "../../settings/store.js";
import MarkdownText from "../../components/MarkdownText.jsx";

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/** move 串 → 人话（bid:2 → 叫2分；play:PASS → 不要；discard:5m → 打5筒…）。
 *  术语全部走 t()（arena.mv.*）；牌面/坐标串本体保留。 */
function moveText(e, t) {
  const m = e.move ?? "";
  if (e.resign) return t("arena.mv.resign");
  if (/^bid:\d$/.test(m)) return Number(m.slice(4)) === 0 ? t("arena.mv.bid0") : t("arena.mv.bidN", { n: m.slice(4) });
  if (m === "play:PASS") return t("arena.mv.passDdz");
  if (m.startsWith("play:")) return t("arena.mv.play", { cards: m.slice(5) });
  if (/^lack:[mps]$/.test(m)) return t("arena.mv.lack", { suit: MJ_SUIT_ZH[m.slice(5)] });
  if (m === "action:pass") return t("arena.mv.passMj");
  if (m.startsWith("action:chi:")) return t("arena.mv.chi", { tile: m.slice(11) });
  if (m === "action:pon") return t("arena.mv.pon");
  if (m === "action:kan") return t("arena.mv.kan");
  if (m === "action:hora") return t("arena.mv.hora");
  if (m.startsWith("action:ankan:")) return t("arena.mv.ankan", { tile: m.slice(13) });
  if (m.startsWith("action:kakan:")) return t("arena.mv.kakan", { tile: m.slice(13) });
  if (m.startsWith("discard:")) return t("arena.mv.discard", { tile: m.slice(8) });
  if (m === "fold") return t("arena.mv.pkFold");
  if (m === "check") return t("arena.mv.pkCheck");
  if (m === "call") return t("arena.mv.pkCall");
  if (m === "allin") return t("arena.mv.pkAllin");
  if (/^bet:\d+$/.test(m)) return t("arena.mv.pkBet", { n: m.slice(4) });
  if (/^raise:\d+$/.test(m)) return t("arena.mv.pkRaise", { n: m.slice(6) });
  if (/^flip:/.test(m)) return t("arena.mv.flip", { at: m.slice(5) });
  if (m === "pass") return t("arena.mv.goPass");
  return m;
}

/** 棋谱 → 解说输入文本（Q9：整盘批量一次调用；长局截尾）。 */
function recordToKifu(record) {
  const names = (record.players ?? []).map((p, i) => `${seatName(i)}=${p.label}${p.cloud ? "(云)" : ""}`);
  const moves = (record.events ?? []).filter((e) => e.t === "move").slice(-160)
    .map((e, i) => `${i + 1}. ${names[e.seat] ?? e.seat} ${e.move}${e.substituted ? "(代走)" : ""}`);
  return [
    `游戏：${record.gameId}；结果：${record.summary}；名次：${names.map((n, i) => `第${(record.ranks ?? []).indexOf(i) + 1} ${n}`).join("，")}`,
    `棋谱（最近 ${moves.length} 手）：`,
    moves.join("\n"),
  ].join("\n");
}

/** AI 赛后解说（Q9 二期）：胜者优先，走 chatop-models 代理。 */
async function fetchCommentary(record) {
  const proxyBase = await gatewayProxyBase();
  if (!proxyBase) throw new Error("模型代理不可用");
  const model = (record.players ?? []).filter((p) => p.kind === "llm")
    .sort((a, b) => (record.ranks ?? []).indexOf(record.players.indexOf(a)) - (record.ranks ?? []).indexOf(record.players.indexOf(b)))[0]?.modelRef;
  if (!model) throw new Error("本局没有可解说的模型");
  const res = await fetch(`${proxyBase}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 900,
      messages: [
        { role: "system", content: "你是专业棋牌解说员。根据棋谱写 200-300 字赛后解说：胜负关键手、局面转折点、双方各自的亮点与失误、给双方各一条改进建议。语言生动，直接输出正文。" },
        { role: "user", content: recordToKifu(record) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim();
}

/** games2 Q11 实时解说：本地小模型对关键事件流异步生成一句（观战可看性；
 *  本地模型零网关成本不限流、顺带展示察元OS 本地能力；挂事件钩子绝不阻塞
 *  对局主链，失败静默）。 */
async function fetchLiveLine(modelRef, contextText) {
  const proxyBase = await gatewayProxyBase();
  if (!proxyBase) throw new Error("no proxy");
  const res = await fetch(`${proxyBase}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelRef,
      temperature: 0.8,
      max_tokens: 120,
      messages: [
        { role: "system", content: "你是竞技场实时解说员。根据给定的一步事件，输出一句不超过 30 字的生动解说（惊叹/悬念/点评），直接输出正文，不要引号。" },
        { role: "user", content: contextText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content ?? "").trim().slice(0, 60);
}

const LIVE_KEYS = new Set(["hora", "battle", "flag", "riichi", "forfeit"]);

function LiveCommentary({ events, modelRef, seatNames, onPickModel }) {
  const { t } = useI18n();
  const [lines, setLines] = useState([]);
  const [on, setOn] = useState(true);
  const [open, setOpen] = useState(false); // 2026-11-07 用户裁定：默认折叠、高度可控
  const lastIdx = useRef(-1);
  const busy = useRef(false);
  useEffect(() => {
    if (!on || !modelRef) return undefined;
    // 关键事件钩子：胡/碰撞/扛旗/立直/判负 + 大摆动着法（|swing|≥150）
    const keyEvents = events.filter((e) => LIVE_KEYS.has(e.t) || (e.t === "move" && Math.abs(e.swing ?? 0) >= 150));
    const cur = keyEvents[keyEvents.length - 1];
    if (!cur || events.indexOf(cur) === lastIdx.current || busy.current) return undefined;
    lastIdx.current = events.indexOf(cur);
    const ctx = [
      `游戏事件：${JSON.stringify({ ...cur, scores: undefined, usage: undefined, think: undefined }).slice(0, 220)}`,
      `最近着法：${(events.filter((e) => e.t === "move").slice(-4).map((e) => `${seatNames?.[e.seat] ?? e.seat + 1} ${e.move}`).join("，")) || "开局"}`,
    ].join("\\n");
    busy.current = true;
    let alive = true;
    fetchLiveLine(modelRef, ctx)
      .then((text) => { if (alive && text) setLines((ls) => [...ls.slice(-8), { ts: Date.now(), text }]); })
      .catch(() => {})
      .finally(() => { busy.current = false; });
    return () => { alive = false; };
  }, [events, on, modelRef, seatNames]);
  if (!modelRef) return null;
  const last = lines[lines.length - 1];
  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-2" data-arena-live-commentary>
      <div className="flex items-center gap-1.5 min-w-0">
        <button className="text-[10px] opacity-60 hover:opacity-100 w-4 shrink-0" onClick={() => setOpen((v) => !v)} data-arena-live-fold title={open ? t("arena.room.liveFold") : t("arena.room.liveUnfold")}>{open ? "▾" : "▸"}</button>
        <span className="text-xs font-semibold shrink-0">📣 {t("arena.room.liveTitle")}</span>
        {onPickModel && (
          <button className="text-[10px] opacity-60 hover:opacity-100 underline underline-offset-2 truncate min-w-0 max-w-[9rem]" onClick={onPickModel} title={modelRef} data-arena-live-model>{modelRef.split("/").pop()} ⇄</button>
        )}
        <div className="flex-1" />
        <button className="text-[10px] opacity-50 hover:opacity-100 shrink-0 whitespace-nowrap" onClick={() => setOn((v) => !v)} data-arena-live-toggle>{on ? t("arena.room.liveOn") : t("arena.room.liveOff")}</button>
      </div>
      {open && (
        <div className="mt-1.5 max-h-40 overflow-y-auto flex flex-col gap-1" data-arena-live-body>
          {lines.length === 0 && <div className="text-[11px] opacity-50">{on ? t("arena.room.liveIdle") : t("arena.room.liveOff")}</div>}
          {lines.map((l, i) => (
            <div key={l.ts + i} className="text-[11px] leading-relaxed opacity-85">{l.text}</div>
          ))}
        </div>
      )}
      {!open && last && <div className="text-[11px] opacity-60 truncate mt-1" title={last.text}>{last.text}</div>}
    </div>
  );
}

function CommentaryPanel({ record, onClose }) {
  const { t } = useI18n();
  const [state, setState] = useState({ loading: true, text: "", error: "" });
  useEffect(() => {
    let alive = true;
    fetchCommentary(record)
      .then((text) => { if (alive) setState({ loading: false, text, error: "" }); })
      .catch((e) => { if (alive) setState({ loading: false, text: "", error: e?.message ?? String(e) }); });
    return () => { alive = false; };
  }, [record]);
  return (
    <div className="mt-3 rounded-2xl border border-purple-500/30 bg-purple-500/5 p-3" data-arena-commentary>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-semibold">🎙️ {t("arena.room.commentaryTitle")}</span>
        {state.loading && <span className="text-[10px] opacity-60 animate-pulse">{t("arena.room.commentaryBusy")}</span>}
        <div className="flex-1" />
        <button className="text-xs opacity-50 hover:opacity-100" onClick={onClose}>✕</button>
      </div>
      {state.error && <div className="text-xs text-red-500">{t("arena.room.commentaryFail", { msg: state.error })}</div>}
      {state.text && <div className="text-xs leading-relaxed opacity-90"><MarkdownText text={state.text} /></div>}
    </div>
  );
}

export default function Room({ running, finished, events, tournament, onReplay, onBackLobby, commentator, onPickCommentator, onResumeTournament, onRematch, onRequestTakeover, onTakebackHuman }) {
  const { t } = useI18n();
  const feedRef = useRef(null);
  const [feedOpen, setFeedOpen] = useState(true);
  const [fs, setFs] = useState(false);
  const [showCommentary, setShowCommentary] = useState(false);
  const [dismissedResult, setDismissedResult] = useState(null); // 已关闭的终局卡片（局 id；新一局自动重置）
  const [humanReject, setHumanReject] = useState(""); // 人类非法步醒目提示（3.5s）
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight; }, [events.length, feedOpen]);
  // 全屏模式 Esc 退出
  useEffect(() => {
    if (!fs) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setFs(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);
  // 人类非法步：醒目提示条——事件流小字用户看不见（真机实测「点了没反应」）
  const lastRejectTsRef = useRef(0);
  useEffect(() => {
    for (const e of events) {
      if (e.t === "reject" && e.human && e.ts !== lastRejectTsRef.current) {
        lastRejectTsRef.current = e.ts;
        setHumanReject(String(e.reason).slice(0, 120));
        const timer = setTimeout(() => setHumanReject(""), 3500);
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [events]);

  const revealed = !!finished;
  const playerMeta = useMemo(() => running?.playerMeta ?? finished?.players ?? [], [running, finished]);
  // 玩家名称改名覆盖（2026-11-07 用户裁定：棋盘/牌桌玩家名可改；双击名牌改，匿名观战下同样生效）
  const [nameOverrides, setNameOverrides] = useState({});
  const seatNames = useMemo(() => {
    const seats = playerMeta.length || 2;
    return Array.from({ length: seats }, (_, i) => nameOverrides[i]
      ?? ((revealed || !running?.anonymous) ? playerMeta[i]?.label ?? seatName(i) : seatName(i)));
  }, [playerMeta, revealed, running?.anonymous, nameOverrides]);
  // 名牌悬停详情（2026-11-07：模型引用/云本地/身份）
  const seatDetails = useMemo(() => playerMeta.map((p) => {
    if (p?.kind === "human") return `${p.label}｜人类挑战者`;
    return `${p.label}｜${p.modelRef ?? "?"}${p.cloud ? "｜☁ 云端模型" : "｜本机模型"}`;
  }), [playerMeta]);
  const renameSeat = (i) => {
    const next = window.prompt(t("arena.room.renamePlayer"), seatNames[i]);
    if (next != null && next.trim()) setNameOverrides((m) => ({ ...m, [i]: next.trim().slice(0, 24) }));
  };

  const state = running ? running.game.getState() : finished?.snapshots?.[finished.snapshots.length - 1]?.state ?? null;
  // 活态兜底缓存：终局快照缺失（异常中止等）时保住最后一帧盘面（2026-11-07「认输清空盘面」修复面之二）
  const lastLiveRef = useRef(null);
  if (running && state) lastLiveRef.current = state;
  const viewState = state ?? lastLiveRef.current;
  const pending = running ? running.game.pendingAction() : null;
  const lastMove = [...events].reverse().find((e) => e.t === "move") ?? null;
  const humanSeat = running?.mode === "human_vs_ai" ? 0 : null;
  const gameId = running?.gameDef?.id ?? finished?.gameId;
  const subsBySeat = useMemo(() => {
    const seats = playerMeta.length || 2;
    const arr = new Array(seats).fill(0);
    for (const e of events) if (e.t === "move" && e.substituted) arr[e.seat] = (arr[e.seat] ?? 0) + 1;
    return arr;
  }, [events, playerMeta.length]);
  const feed = events.filter((e) => e.t !== "start");

  if (!running && !finished) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm opacity-60" data-arena-room-empty>
        <div className="text-3xl">🏟️</div>
        <div>{t("arena.room.empty")}</div>
        <button className="px-4 py-1.5 rounded-lg text-xs bg-blue-500 text-white" onClick={onBackLobby}>{t("arena.room.goLobby")}</button>
      </div>
    );
  }

  // expand=全屏：棋盘本体放大（82vh），窗边距最小化（用户反馈：距边太大不丰满）
  const renderPanel = (expand) => (
    <GamePanel gameId={gameId} expand={expand} state={viewState} seatNames={seatNames} seatDetails={seatDetails} humanSeat={humanSeat} pending={pending} onHumanMove={(mv) => running?.humanPlayer?.submit?.(mv)} lastMove={lastMove} replay={!running && !!finished} />
  );
  const panel = renderPanel(false);

  return (
    <div className="h-full flex min-h-0" data-arena-room>
      {/* 左：主区 */}
      <div className="flex-1 min-w-0 flex flex-col p-3 gap-2.5 overflow-auto">
        {/* 玩家条 + 工具行 */}
        <div className="flex flex-wrap items-center gap-2" data-arena-seats>
          {playerMeta.map((p, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs border ${pending?.seat === i ? "border-blue-500 bg-blue-500/10 shadow-sm" : "border-black/8 dark:border-white/10 bg-white/50 dark:bg-white/5"}`}
              data-arena-seat={i}
            >
              <span className={`w-2 h-2 rounded-full ${i === 0 ? "bg-gray-800 dark:bg-gray-200" : "bg-gray-300"} ${pending?.seat === i ? "ring-2 ring-blue-400 animate-pulse" : ""}`} />
              <span
                className="font-medium cursor-text"
                title={seatDetails[i]}
                onDoubleClick={() => renameSeat(i)}
                data-arena-seat-name={i}
              >{seatNames[i]}</span>
              {p.cloud && <span className="px-1 rounded text-[10px] bg-sky-500/15 text-sky-600 dark:text-sky-400" title={t("arena.room.cloudTip")}>☁ {t("arena.room.cloud")}</span>}
              {p.kind === "human" && <span className="px-1 rounded text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">{t("arena.room.human")}</span>}
              {subsBySeat[i] > 0 && <span className="text-[10px] text-amber-500" title={t("arena.room.subsTip")}>代走×{subsBySeat[i]}</span>}
              {running && running.game.seatLabel?.(i) && <span className="text-[10px] opacity-50">{running.game.seatLabel(i)}</span>}
            </div>
          ))}
          <div className="flex-1" />
          {running?.humanPlayer && typeof running.game?.undoPlies === "function" && pending?.seat === 0 && events.filter((e) => e.t === "move").length >= 2 && (
            <button
              className="px-3 py-1 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-amber-500/80 hover:text-white transition-colors"
              onClick={() => running.humanPlayer.undo()}
              data-arena-undo
            >
              ↩️ {t("arena.room.undo")}
            </button>
          )}
          {running?.humanPlayer && (
            <>
              {onRequestTakeover && (
                <button
                  className="px-3 py-1 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-purple-500/80 hover:text-white transition-colors"
                  onClick={onRequestTakeover}
                  title={t("arena.room.takeoverTip")}
                  data-arena-takeover
                >
                  🤖 {t("arena.room.takeover")}
                </button>
              )}
              <button
                className="px-3 py-1 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-red-500/80 hover:text-white transition-colors"
                onClick={() => running.humanPlayer.cancel()}
                data-arena-resign
              >
                🏳️ {t("arena.mv.resign")}
              </button>
            </>
          )}
          {!running?.humanPlayer && running?.aiTookOver != null && onTakebackHuman && (
            <button
              className="px-3 py-1 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-emerald-500/80 hover:text-white transition-colors"
              onClick={onTakebackHuman}
              title={t("arena.room.takebackTip")}
              data-arena-takeback
            >
              👉 {t("arena.room.takeback")}
            </button>
          )}
          <button
            className="px-3 py-1 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
            onClick={() => setFs(true)}
            title={t("arena.room.focus")}
            data-arena-fullscreen
          >⛶ {t("arena.room.focus")}</button>
        </div>

        {humanReject && (
          <div className="px-3 py-2 rounded-xl text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-500/40 bg-amber-500/10 arena-anim-slide" data-arena-human-reject>
            ⚠️ {humanReject}
          </div>
        )}

        {/* 游戏面板：弹性占满列剩余高度（2026-11-07 用户裁定「宽度自适应了高度没自适应」
            ——固定 clamp 帽改 flex-1：窗口越高棋盘/牌桌越大；终局横幅改浮层压盘面底部，
            不再把面板往下挤。内部 SVG meet + FitScale 保证恒适配不溢出） */}
        <div className="relative flex-1 min-h-[340px] flex items-center justify-center overflow-hidden">
          {viewState && panel}

        {/* 终局横幅（浮层：盘面下层底部，玻璃拟态） */}
        {/* 终局卡（2026-11-07 终裁：全部悬浮窗口正中央——包裹层 inset-0 居中，卡片本体玻璃拟态） */}
        {finished && dismissedResult !== finished.id && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" data-arena-result-overlay-wrap>
          <div className="w-max max-w-[94%] rounded-2xl border border-amber-500/40 p-4 relative arena-shimmer backdrop-blur-md shadow-2xl" style={{ background: "linear-gradient(135deg, rgba(255,250,240,0.94), rgba(235,242,255,0.90))" }} data-arena-result data-arena-result-overlay>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🏆</span>
              <span className="text-sm font-semibold">{t("arena.room.over")}</span>
              {tournament && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">{tournament.label}{tournament.done ? t("arena.room.tourDone") : ""}</span>}
              {tournament?.partial && !running && (
                <button className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" onClick={() => onResumeTournament?.()} data-arena-tour-resume>{t("arena.tour.resume")}</button>
              )}
            </div>
            <div className="text-sm font-medium">{finished.summary}</div>
            <div className="text-xs opacity-70 mt-1" data-arena-reveal>
              {t("arena.room.reveal")}：{finished.players.map((p, i) => `${seatName(i)} = ${p.label}${p.cloud ? "☁" : ""}`).join("，")}
            </div>
            <div className="flex gap-2.5 mt-2.5 flex-wrap">
              {onRematch && (
                <button className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white shadow transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#43b581,#2c8a5f)" }} onClick={() => onRematch()} data-arena-rematch>🔄 {t("arena.room.rematch")}</button>
              )}
              <button className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white shadow transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#4f8cff,#3555c9)" }} onClick={() => onReplay(finished)} data-arena-watch-replay>{t("arena.btn.replay")}</button>
              <button className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white shadow transition-transform hover:scale-105" style={{ background: "linear-gradient(135deg,#9b6bef,#6f3fc9)" }} onClick={() => setShowCommentary((v) => !v)} data-arena-commentary-btn>🎙️ {t("arena.room.commentary")}</button>
              <button className="px-3.5 py-1.5 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15" onClick={onBackLobby}>{t("arena.room.backLobby")}</button>
            </div>
            <button className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/10 dark:bg-white/15 hover:bg-black/20 dark:hover:bg-white/25 text-xs leading-none flex items-center justify-center" onClick={() => setDismissedResult(finished.id)} title={t("arena.room.closeResult")} data-arena-result-close>✕</button>
          </div>
        </div>
        )}
        </div>

        {/* 解说面板与积分榜：常规流（终局浮层之下） */}
        {finished && showCommentary && <CommentaryPanel record={finished} onClose={() => setShowCommentary(false)} />}
        {finished && tournament?.standings?.length > 0 && (
              <div className="mt-3 rounded-2xl border border-blue-500/25 bg-blue-500/5 p-3" data-arena-tour-table>
                <div className="text-xs font-semibold mb-1.5">🏆 {t("arena.tour.standings")}{tournament.done ? t("arena.tour.final") : ""}</div>
                <div className="grid gap-0.5 text-[11px]">
                  <div className="grid grid-cols-[1.6fr_repeat(4,0.6fr)] opacity-50 px-1"><span>{t("arena.tour.player")}</span><span>积分</span><span>胜</span><span>平</span><span>负</span></div>
                  {tournament.standings.map((row, i) => (
                    <div key={row.ref} className={`grid grid-cols-[1.6fr_repeat(4,0.6fr)] px-1 rounded ${i === 0 ? "bg-amber-400/15" : ""}`}>
                      <span className="truncate" title={row.ref}>{i + 1}. {row.ref.split("/").pop()}</span><span className="font-semibold">{row.pts}</span><span>{row.w}</span><span>{row.d}</span><span>{row.l}</span>
                    </div>
                  ))}
                </div>
              </div>
        )}
      </div>

      {/* 右：事件流（可折叠） */}
      {feedOpen ? (
        <div className="w-80 shrink-0 border-l border-black/5 dark:border-white/10 flex flex-col min-h-0" data-arena-feed-wrap>
          <div className="px-3 py-2 text-xs font-medium border-b border-black/5 dark:border-white/10 flex items-center">
            <span className="flex-1">{t("arena.room.feed")}</span>
            <button className="opacity-50 hover:opacity-100 px-1" title={t("arena.room.hideFeed")} onClick={() => setFeedOpen(false)} data-arena-feed-toggle>»</button>
          </div>
          <div className="px-3 pt-2">
            <LiveCommentary events={events} modelRef={commentator ?? null} seatNames={undefined} onPickModel={onPickCommentator} />
          </div>
          <div ref={feedRef} className="flex-1 overflow-y-auto arena-feed px-3 py-2 flex flex-col gap-2">
            {feed.map((e, i) => {
              if (e.t === "move") {
                const who = seatNames[e.seat] ?? seatName(e.seat);
                // 着法标注（P1 #7）：行棋方形势摆动 → !!/?!/?/??（启发式口径）
                const mark = typeof e.swing === "number"
                  ? e.swing >= 400 ? "!!" : e.swing >= 150 ? "!?" : e.swing <= -400 ? "??" : e.swing <= -150 ? "?" : ""
                  : "";
                const markCls = mark === "!!" ? "text-emerald-500" : mark === "!?" ? "text-sky-500" : mark === "?" ? "text-amber-500" : "text-red-500";
                return (
                  <div key={i} className="text-xs flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{who}</span>
                      <span>{moveText(e, t)}</span>
                      {mark && <span className={`font-bold ${markCls}`} title={`形势 ${e.swing > 0 ? "+" : ""}${e.swing}`} data-arena-move-mark={mark}>{mark}</span>}
                      {e.substituted && <span className="px-1 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px]" title={t("arena.room.subTip")}>代走</span>}
                      <span className="opacity-40 text-[10px]">{fmtMs(e.ms ?? 0)}</span>
                      {e.usage && <span className="opacity-40 text-[10px]">{e.usage.pt}→{e.usage.ct} tok</span>}
                    </div>
                    {e.comment && (
                      <div className="ml-3 px-2 py-1 rounded-xl bg-black/[0.04] dark:bg-white/10 text-[11px] opacity-80 self-start max-w-[92%]" data-arena-danmaku>
                        💬 {e.comment}
                      </div>
                    )}
                    {e.think && (
                      <details className="ml-3 self-start max-w-[92%] text-[11px] opacity-70" data-arena-think>
                        <summary className="cursor-pointer select-none list-none">💭 {t("arena.feed.think")}</summary>
                        <div className="mt-1 px-2 py-1 rounded-xl bg-black/[0.03] dark:bg-white/5 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">{e.think}</div>
                      </details>
                    )}
                  </div>
                );
              }
              if (e.t === "reject") {
                return (
                  <div key={i} className="text-[11px] px-2 py-1 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400" data-arena-reject>
                    ⚠️ {seatNames[e.seat] ?? "?"} ·{e.attempt + 1}· {String(e.reason).slice(0, 90)}
                  </div>
                );
              }
              if (e.t === "forfeit") return <div key={i} className="text-[11px] px-2 py-1 rounded-lg bg-red-500/10 text-red-500">{seatNames[e.seat]} · {t("arena.mv.resign")} (×{e.subs})</div>;
              if (e.t === "note") return (
                <div key={i} className="text-[11px] px-2 py-1 rounded-lg bg-black/[0.04] dark:bg-white/5 opacity-70" data-arena-note>
                  {e.key ? t(e.key) : e.text}
                </div>
              );
              if (e.t === "end") return <div key={i} className="text-xs font-semibold pt-1">— {t("arena.room.over")} —</div>;
              if (e.t === "abort") return <div key={i} className="text-[11px] text-red-400">{t("arena.room.aborted")}</div>;
              return null;
            })}
            {running && <div className="text-[11px] opacity-50 animate-pulse pt-1">{t("arena.room.thinking", { who: seatNames[pending?.seat] ?? "?" })}</div>}
          </div>
        </div>
      ) : (
        <button
          className="w-7 shrink-0 border-l border-black/5 dark:border-white/10 flex items-center justify-center text-xs opacity-50 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => setFeedOpen(true)}
          title={t("arena.room.showFeed")}
          data-arena-feed-toggle
        >‹</button>
      )}

      {/* 全屏棋盘覆盖层：棋盘本体放大 + 贴边（不做整体 scale——牌桌/棋盘组件自适应） */}
      {fs && state && (
        <div className="fixed inset-0 z-[2147483000] bg-black/90 flex flex-col p-1.5" data-arena-fs>
          <div className="flex items-center gap-3 px-2 pb-1.5 shrink-0">
            <span className="text-white/90 text-sm font-semibold">🏟️ {seatNames.join(" vs ")}</span>
            {running && <span className="text-white/50 text-xs animate-pulse">{t("arena.room.thinking", { who: seatNames[pending?.seat] ?? "?" })}</span>}
            <div className="flex-1" />
            <button className="px-3 py-1.5 rounded-full text-xs text-white bg-white/10 hover:bg-white/20" onClick={() => setFs(false)} data-arena-fs-exit>✕ {t("arena.room.exitFocus")}</button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {renderPanel(true)}
          </div>
        </div>
      )}
    </div>
  );
}
