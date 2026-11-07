/**
 * 察元竞技场主壳（games-llm-arena-plan Q5：单应用五件套共享壳——开局大厅/
 * 对局室/天梯榜/对局记录/回放室；游戏插件注册表驱动，新游戏不动壳）。
 * 单例守卫：PetChat 参数化先例——openArena() 找已开窗则 focus + arena:params
 * 事件热更新（gameId 直达大厅对应游戏卡），否则开新窗（builtin-apps 注册）。
 *
 * Q6 公平三件套：统一 temperature 0.6（LlmPlayer 内）、匿名观战默认开
 * （对局中玩家A/B，终局揭晓）、玩家配置=模型 id+提示词模板（人设留空默认）。
 * Q7 补充裁定：机机进天梯；人机不动模型 rating、人类战绩单列（storage）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGame, isCloudModelRef } from "../../arena/registry.js";
import "../../arena/games/gobang.js";
import "../../arena/games/xiangqi.js";
import "../../arena/games/doudizhu.js";
import "../../arena/games/mahjong.js";
import "../../arena/games/mahjong-guangdong.js"; // games2 Q1：广东推倒胡
import "../../arena/games/go.js"; // games2 Q4：go9/go13 双 id 注册
import "../../arena/games/junqi.js"; // games2 Q2/Q6：军棋暗棋
import "../../arena/games/mahjong-riichi.js"; // games2 Q1/Q7：日麻立直
import "../../arena/games/fanqi.js"; // games2 追加：军棋翻翻棋
import "../../arena/games/poker-holdem.js"; // games2 追加：德州扑克
import "../../arena/games/guandan.js"; // games2 追加：掼蛋升级赛
import { createLlmPlayer, createHumanPlayer } from "../../arena/players.js";
import { runMatch } from "../../arena/match-runner.js";
import { applyMatchResult, loadRecords, loadRatings, loadHumans, loadOpenings } from "../../arena/storage.js";
import { setProtocolProfileStore } from "../../arena/protocol-profile.js";
import { loadData, saveData } from "../../lib/dataClient.js";
import appIcon from "../../assets/app-icon.png";

// 协议画像存储注入（os-data 桥；chayuan-game 侧注入 IPC 版同款接口）
setProtocolProfileStore({ load: loadData, save: saveData });
import { useModelRegistry } from "../../settings/store.js";
import { useI18n } from "../../i18n/index.jsx";
import Lobby, { ModelTreeModal } from "./Lobby.jsx";
import { systemPrompt } from "../../arena/prompts.js";
import Room from "./Room.jsx";
import Ladder from "./Ladder.jsx";
import Records from "./Records.jsx";
import Replay from "./Replay.jsx";
import ArenaFooter from "./Footer.jsx";

export default function Arena(props = {}) {
  const { t } = useI18n();
  const gameIdParam = props.gameId ?? props.params?.gameId;
  const [view, setView] = useState("lobby");
  const [events, setEvents] = useState([]); // 当前局实时事件
  const [running, setRunning] = useState(null); // { game, gameDef, players, abort, mode, anonymous, humanPlayer, playerMeta }
  const [finished, setFinished] = useState(null); // 终局 record
  const [error, setError] = useState("");
  const [replayRecord, setReplayRecord] = useState(null);
  const [tournament, setTournament] = useState(null); // { queue, idx, results, stop, label }
  const { leafValues, treeNodes, statusReady, proxyBase } = useModelRegistry();
  const runningRef = useRef(null);
  runningRef.current = running;
  const tourStopRef = useRef(false);
  const lastMatchCfgRef = useRef(null); // 再来一局（终局卡 🔄：同配置重开）
  // Q11 解说员（零网关成本默认本地首个；2026-11-07 用户裁定可换任意模型）
  const [commentator, setCommentator] = useState(null);
  useEffect(() => { setCommentator((c) => c ?? (leafValues.find((v) => v?.startsWith("local/")) ?? null)); }, [leafValues]);
  const [commentatorPicker, setCommentatorPicker] = useState(false);
  const [pickDraft, setPickDraft] = useState(() => new Set()); // 弹层选中暂存（onOk 不带参——2026-11-07「换解说模型无反应」根因）

  // 带参直达：大厅预选游戏（含热更新事件）
  useEffect(() => {
    const onParams = (e) => { if (e.detail?.gameId) { setView("lobby"); window.dispatchEvent(new CustomEvent("arena:pick-game", { detail: { gameId: e.detail.gameId } })); } };
    window.addEventListener("arena:params", onParams);
    return () => window.removeEventListener("arena:params", onParams);
  }, []);

  const startMatch = useCallback(async (config) => {
    setError("");
    lastMatchCfgRef.current = config;
    const gameDef = getGame(config.gameId);
    if (!gameDef) { setError(t("arena.err.noGame")); return; }
    if (!proxyBase) { setError(t("arena.err.noProxy")); return; }
    const seats = gameDef.seats;
    const think = config.think !== false; // Q10：局级思维链总开关（默认开；Lobby 可关=快棋档）
    const players = [];
    const playerMeta = [];
    let humanPlayer = null;
    const seatsList = Array.from({ length: seats }, (_, i) => i);
    for (const seat of seatsList) {
      const conf = config.seatPlayers[seat];
      if (conf?.kind === "human") {
        humanPlayer = createHumanPlayer({ name: conf.name || t("arena.human.default") });
        players.push(humanPlayer);
        playerMeta.push({ id: `human:${conf.name || "me"}`, label: conf.name || t("arena.human.default"), kind: "human", modelRef: null, cloud: false });
      } else {
        const ref = conf?.modelRef;
        if (!ref) { setError(t("arena.err.noModel", { seat: seat + 1 })); return; }
        // 厂商命名空间兜底（2026-11-06 nvidia 404 实锤，PetChat/群聊同款）：
        // 模型树会列「已启用未入路由」的厂商，路由缺席开赛即 404 未知命名
        // 空间——按需幂等补建；失败不拦开赛，赛内 404 人话自然透出。
        if (ref.includes("/") && !ref.startsWith("local/") && !ref.startsWith("remote/")) {
          }
        // think 局给足推理预算（Q10：两段思考/自由推理计入 max_tokens，deepseek
        // 思考烧穿前科）；快棋档维持一期 1200 公平口径不变。
        // P2 开关（enhanced/fast 与 think 合成）：fast=快进（压缩输出 320、关
        // 两段思考）；enhanced=每步 3 采样多数票（3× 调用，Lobby 与 fast 互斥）。
        // deep=伪搜索（变着推演：3 条候选线×对方最强应手×优劣评估再选着），
        // 依赖两段协议（隐式开思考），与 fast 互斥。
        const fast = config.fast === true;
        const deep = config.deep === true && !fast;
        players.push(createLlmPlayer({
          modelRef: ref, proxyBase, personality: conf.personality ?? "",
          thinkMode: (think && !fast) || deep,
          maxTokens: fast ? 320 : (think || deep ? 2000 : 1200),
          sampleN: config.enhanced && !fast ? 3 : 1,
          deep,
        }));
        playerMeta.push({ id: ref, label: ref.split("/").pop(), kind: "llm", modelRef: ref, cloud: isCloudModelRef(ref) });
      }
    }
    const game = gameDef.createGame({ seed: config.seed, opts: config.gameOpts ?? undefined }); // 军棋明棋档等游戏级开关（Lobby opts 区下发）
    const abort = new AbortController();
    const ctx = { game, gameDef, players, playerMeta, abort, mode: config.mode, anonymous: config.anonymous !== false, humanPlayer, think }; // think 存 ctx：AI 接手沿用同协议
    setEvents([]);
    setFinished(null);
    setRunning(ctx);
    setView("room");
    try {
      const record = await runMatch({
        game, gameDef, players, playerMeta,
        mode: config.mode,
        signal: abort.signal,
        think,
        gameOpts: config.gameOpts ?? null,
        openingsProvider: loadOpenings, // 跨局开局记忆（宿主桥供给；chayuan-game 侧传自有实现或省略）
        onEvent: (e) => setEvents((prev) => [...prev, e]),
      });
      if (!abort.signal.aborted) {
        await applyMatchResult(record);
      }
      setFinished(record);
      return record;
    } catch (e) {
      setError(e?.message ?? String(e));
      return null;
    } finally {
      setRunning((r) => (r === ctx ? null : r));
    }
  }, [proxyBase, t]);

  /** 人机局 AI 接手（2026-11-07 用户裁定：人参与的游戏可中途让大模型接手出牌/下棋）：
   *  换 players[seat] 为 LLM 玩家（runner 持同数组引用，即刻生效）；若恰轮到人类且
   *  挂着待决议，用接手模型对当前局面先出这步再代交（humanPlayer.submit），
   *  之后轮次全部由接手模型行棋；接手后人类按钮（认输/接手）退场。
   *  2026-11-07 追加（用户裁定）：接手后可「人工接管」切回——下一手生效语义；
   *  humanMeta/humanBench 存档人工身份与原 HumanPlayer 实例（复用避免幽灵
   *  queued），aiTookOver 驱动 Room 切换按钮；首步 submit 前守卫（期间被切回
   *  则丢弃），切回时若 resolver 仍挂着 submit("__skip__") 放行 runner。 */
  const [takeoverPicker, setTakeoverPicker] = useState(false);
  const takeoverSeat = useCallback(async (modelRef) => {
    const ctx = runningRef.current;
    if (!ctx?.humanPlayer || ctx.aiTookOver != null) return;
    const seat = ctx.playerMeta.findIndex((p) => p.kind === "human");
    if (seat < 0) return;
    const llm = createLlmPlayer({ modelRef, proxyBase, personality: "", thinkMode: ctx.think !== false, maxTokens: ctx.think !== false ? 2000 : 1200 });
    const hp = ctx.humanPlayer;
    ctx.humanSeat = seat;
    ctx.humanMeta = { ...(ctx.playerMeta[seat] ?? { kind: "human", label: t("arena.human.default"), id: `human:${t("arena.human.default")}` }), seat };
    ctx.humanBench = hp; // 原实例存档：切回复用（旧 queued 随实例丢弃）
    ctx.players[seat] = llm; // runner 持同数组引用——即刻生效
    ctx.playerMeta[seat] = { id: modelRef, label: modelRef.split("/").pop(), kind: "llm", modelRef, cloud: isCloudModelRef(modelRef) };
    ctx.aiTookOver = seat;
    const pend = ctx.game.pendingAction();
    if (pend && pend.seat === seat && hp.pendingResolver) {
      // 恰轮到人类：接手模型对当前局面出这步（不预 apply——submit 后由 runner 落子）
      try {
        const sys = systemPrompt(ctx.gameDef, { personality: null, think: ctx.think !== false });
        const out = await llm.act(ctx.game.viewFor(seat), sys, null, ctx.abort.signal);
        if (ctx.humanPlayer === hp) hp.submit(out?.move ?? ctx.game.suggestAction(seat) ?? "__resign__", out?.comment ?? t("arena.room.takeoverFirst"));
        return;
      } catch { /* 落到启发式代交 */ }
      if (ctx.humanPlayer === hp) hp.submit(ctx.game.suggestAction(seat) ?? "__resign__", t("arena.room.takeoverSub"));
    }
    ctx.humanPlayer = null; // 人类退场（认输/接手按钮消失，换「人工接管」）
    setRunning({ ...ctx });
  }, [proxyBase, t]);

  /** 人工接管（2026-11-07 用户裁定）：AI 接手后切回人工——下一手生效：
   *  players[seat]/humanPlayer 换回原 HumanPlayer 实例（AI 在途思考的这手
   *  走完落子，下一手起等人工）；若接手首步仍挂着人类 resolver（runner 正
   *  await 旧 hp.act），submit("__skip__") 放行 runner 弃本轮重取。 */
  const takebackHuman = useCallback(() => {
    const ctx = runningRef.current;
    if (!ctx || ctx.aiTookOver == null || !ctx.humanBench) return;
    const seat = ctx.aiTookOver;
    const hp = ctx.humanBench;
    ctx.players[seat] = hp;
    if (ctx.humanMeta) ctx.playerMeta[seat] = { ...ctx.humanMeta, seat };
    ctx.aiTookOver = null;
    ctx.humanPlayer = hp;
    setRunning({ ...ctx });
    if (hp.pendingResolver) hp.submit("__skip__", ""); // 放行 runner（players 已换好，重取即人工）
  }, []);

  /** 循环赛挂机（Q8 一期：自动连续对局，营销素材生产线）。 */
  const startTournament = useCallback(async (config) => {
    const picked = config.models.filter(Boolean);
    if (!picked.length) { setError(t("arena.err.needTwo")); return; } // 2026-11-07 裁定：≥1 模型即可开
    const gameId = config.gameId;
    const gameDef = getGame(gameId);
    // 轮转补满到座位数（Lobby 已补满，此处保险批量重选/异常路径）
    const models = Array.from({ length: Math.max(gameDef.seats, picked.length) }, (_, i) => picked[i % picked.length]);
    // 轮转配对（不足 seats 的游戏循环补位；1v1 逐对）
    const queue = [];
    for (let round = 0; round < config.rounds; round += 1) {
      if (gameDef.seats === 2) {
        if (models.length === 1) { queue.push([models[0], models[0]]); } // 单模型自战
        for (let i = 0; i < models.length; i += 1) for (let j = i + 1; j < models.length; j += 1) {
          queue.push(round % 2 === 0 ? [models[i], models[j]] : [models[j], models[i]]); // 双局换先（Gomocup 制）
        }
      } else {
        for (let i = 0; i + gameDef.seats <= models.length; i += gameDef.seats) {
          queue.push(models.slice(i, i + gameDef.seats));
        }
        if (models.length < gameDef.seats) { setError(t("arena.err.needSeats", { n: gameDef.seats })); return; }
      }
    }
    // games2 Q12：循环赛 2 局制 + 名次积分榜（双人 1/½/0、四人 3-1-0-0）；
    // 断点续赛＝停止后保留内存态（done:false），Room 出「续赛」按钮从 idx 续跑
    //（跨窗重启不保留——离线单机口径声明）
    const seatPoints = gameDef.seats === 2 ? [1, 0.5, 0] : [3, 1, 0, 0];
    const standings = {}; // modelRef → { pts, w, d, l }
    const bump = (ref, pts) => {
      const cur = standings[ref] ?? { pts: 0, w: 0, d: 0, l: 0 };
      if (pts >= 1) cur.w += 1;
      else if (pts > 0) cur.d += 1;
      else cur.l += 1;
      cur.pts += pts;
      standings[ref] = cur;
    };
    const tour = { queue, idx: 0, results: [], stop: false, gameId, standings: {}, partial: false };
    tourStopRef.current = false;
    setTournament(tour);
    setView("room");
    for (let k = 0; k < tour.queue.length && !tourStopRef.current; k += 1) {
      const group = tour.queue[k];
      setTournament((s) => (s ? { ...s, idx: k, label: t("arena.room.tourProgress", { cur: k + 1, total: tour.queue.length }) } : s));
      const seatPlayers = group.map((ref) => ({ kind: "llm", modelRef: ref }));
      const rec = await startMatch({ gameId, mode: "ai_vs_ai", seatPlayers, anonymous: config.anonymous !== false, think: config.think !== false, seed: Date.now() % 2 ** 31 + k, gameOpts: config.gameOpts }); // 明棋档等游戏级开关随锦标赛逐局透传
      // startMatch 返回 record（终局）——按名次积分入榜；明棋教学档不入榜
      // （口径与天梯一致：信息量不同的对局不混记，2026-11-07 审计裁定，
      // UI 侧锦标赛模式已隐藏明棋开关，此处双保险）
      if (rec?.ranks && !config.gameOpts?.revealAll) {
        group.forEach((ref, seat) => bump(ref, seatPoints[rec.ranks[seat]] ?? 0));
      }
      const table = Object.entries(standings)
        .map(([ref, v]) => ({ ref, ...v }))
        .sort((a, b) => b.pts - a.pts);
      setTournament((s) => (s ? { ...s, results: [...s.results, k], standings: table } : s));
    }
    setTournament((s) => (s ? { ...s, done: !tourStopRef.current, partial: tourStopRef.current, standings: s?.standings ?? [] } : s));
  }, [startMatch, t]);
  // 循环赛全部结束或用户回大厅再开新局时解锁 Lobby（busy 不再永久卡死）
  useEffect(() => {
    if (view === "lobby" && tournament?.done) setTournament(null);
  }, [view, tournament?.done]);

  /** 断点续赛（Q12）：从 tournament.idx+1 续跑剩余队列（积分榜延续内存态）。 */
  const resumeTournament = useCallback(async () => {
    const cur = tournament;
    if (!cur || cur.done) return;
    const gameDef = getGame(cur.gameId);
    const seatPoints = gameDef.seats === 2 ? [1, 0.5, 0] : [3, 1, 0, 0];
    tourStopRef.current = false;
    setTournament((s) => (s ? { ...s, partial: false, stop: false } : s));
    for (let k = cur.idx + 1; k < cur.queue.length && !tourStopRef.current; k += 1) {
      const group = cur.queue[k];
      setTournament((s) => (s ? { ...s, idx: k, label: t("arena.room.tourProgress", { cur: k + 1, total: cur.queue.length }) } : s));
      const seatPlayers = group.map((ref) => ({ kind: "llm", modelRef: ref }));
      const rec = await startMatch({ gameId: cur.gameId, mode: "ai_vs_ai", seatPlayers, anonymous: true, think: true, seed: Date.now() % 2 ** 31 + k });
      if (rec?.ranks) {
        setTournament((s) => {
          if (!s) return s;
          const table = [...(s.standings ?? [])];
          group.forEach((ref, seat) => {
            const pts = seatPoints[rec.ranks[seat]] ?? 0;
            let row = table.find((r) => r.ref === ref);
            if (!row) { row = { ref, pts: 0, w: 0, d: 0, l: 0 }; table.push(row); }
            if (pts >= 1) row.w += 1; else if (pts > 0) row.d += 1; else row.l += 1;
            row.pts += pts;
          });
          table.sort((a, b) => b.pts - a.pts);
          return { ...s, results: [...s.results, k], standings: table };
        });
      } else {
        setTournament((s) => (s ? { ...s, results: [...s.results, k] } : s));
      }
    }
    setTournament((s) => (s ? { ...s, done: !tourStopRef.current, partial: tourStopRef.current } : s));
  }, [tournament, startMatch, t]);

  const stopAll = useCallback(() => {
    tourStopRef.current = true; // 循环赛队列退出标志（ref 防闭包过期）
    setTournament((s) => (s ? { ...s, stop: true } : s));
    runningRef.current?.abort?.abort();
  }, []);

  const goReplay = useCallback((rec) => { setReplayRecord(rec); setView("replay"); }, []);

  const tabs = useMemo(() => ([
    { id: "lobby", label: t("arena.tab.lobby") },
    { id: "room", label: t("arena.tab.room") },
    { id: "ladder", label: t("arena.tab.ladder") },
    { id: "records", label: t("arena.tab.records") },
    { id: "replay", label: t("arena.tab.replay") },
  ]), [t]);

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-[#f7f7f5] dark:bg-neutral-900 text-gray-900 dark:text-white" data-arena-app {...(gameIdParam ? { "data-arena-game": gameIdParam } : {})}>
      {/* 顶栏：五件套 tab */}
      <div className="flex items-center gap-1 px-4 h-11 border-b border-black/5 dark:border-white/10 shrink-0">
        <span className="text-sm font-semibold mr-3 flex items-center gap-1.5"><img src={appIcon} alt="" className="w-4 h-4 rounded" /> {t("arena.app.title")}</span>
        {tabs.map((tb) => (
          <button
            key={tb.id}
            className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${view === tb.id ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium" : "hover:bg-black/5 dark:hover:bg-white/5 opacity-70"}`}
            onClick={() => setView(tb.id)}
            data-arena-tab={tb.id}
          >
            {tb.label}
          </button>
        ))}
        <div className="flex-1" />
        {running && (
          <button className="px-3 py-1 rounded-lg text-xs bg-red-500/90 text-white hover:bg-red-500" onClick={stopAll} data-arena-stop>
            {tournament ? t("arena.btn.stopTour") : t("arena.btn.stop")}
          </button>
        )}
      </div>
      {error && <div className="px-4 py-1.5 text-xs text-red-500 border-b border-red-500/20 bg-red-500/5" data-arena-error>{error}</div>}
      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "lobby" && (
          <Lobby
            leafValues={leafValues}
            treeNodes={treeNodes}
            statusReady={statusReady}
            hasProxy={!!proxyBase}
            initialGameId={gameIdParam}
            onStart={(cfg) => (cfg.mode === "tournament" ? void startTournament(cfg) : void startMatch(cfg))}
            busy={!!running || (!!tournament && !tournament.done)}
          />
        )}
        {view === "room" && (
          <Room
            running={running}
            finished={finished}
            events={events}
            tournament={tournament}
            onReplay={goReplay}
            onBackLobby={() => setView("lobby")}
            commentator={commentator}
            onResumeTournament={resumeTournament}
            onRematch={!tournament ? () => { if (lastMatchCfgRef.current) void startMatch(lastMatchCfgRef.current); } : null}
            onRequestTakeover={() => setTakeoverPicker(true)}
            onTakebackHuman={takebackHuman}
            onPickCommentator={() => setCommentatorPicker(true)}
          />
        )}
        {view === "ladder" && <Ladder loader={{ loadRatings, loadHumans, loadRecords }} />}
        {view === "records" && <Records loader={{ loadRecords }} onReplay={goReplay} />}
        {view === "replay" && <Replay record={replayRecord} />}
        {commentatorPicker && (
          <ModelTreeModal
            title={t("arena.room.livePickTip")}
            treeNodes={treeNodes}
            leafValues={leafValues}
            statusReady={statusReady}
            selected={pickDraft}
            onChange={(next) => setPickDraft(new Set(next))}
            onClose={() => setCommentatorPicker(false)}
            onOk={() => { const ref = [...pickDraft][0]; setCommentatorPicker(false); setPickDraft(new Set()); if (ref) setCommentator(ref); }}
            single
            t={t}
          />
        )}
        {takeoverPicker && (
          <ModelTreeModal
            title={t("arena.room.takeoverTitle")}
            treeNodes={treeNodes}
            leafValues={leafValues}
            statusReady={statusReady}
            selected={pickDraft}
            onChange={(next) => setPickDraft(new Set(next))}
            onClose={() => setTakeoverPicker(false)}
            onOk={() => { const ref = [...pickDraft][0]; setTakeoverPicker(false); setPickDraft(new Set()); if (ref) void takeoverSeat(ref); }}
            single
            t={t}
          />
        )}
      </div>
      {/* 家族页脚：五件套共用一处（出品方/家族应用/GitHub 点赞/关注我们二维码） */}
      <ArenaFooter />
    </div>
  );
}
