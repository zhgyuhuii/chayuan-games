/**
 * 开局大厅（games-llm-arena-plan Q5/Q6）：选游戏（插件卡位）/ 选玩家
 * （chatop-models 全部已配置模型一视同仁上桌）/ 选模式（人机 / 机机观战 /
 * 循环赛挂机）。云模型「云」角标 + 局前调用量预估（Q6 透明性默认值）。
 *
 * 模型选择统一模型树（2026-11-06 用户裁定：废弃裸 <select> 平铺列表）——
 * 座位单选/循环赛多选都走 PetModelPicker 同款深色弹层 + ModelPicker
 * （厂商→分类→模型三级树、厂商 logo、折叠、选中高亮），全产品一个选模型样式。
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getGames, isCloudModelRef } from "../../arena/registry.js";
import { useI18n } from "../../i18n/index.jsx";
import { GAME_ICONS } from "./game-icons.js";
import ModelPicker from "../../components/ModelPicker.jsx";

/** 每局预计调用次数（Q6 费用预估口径：LLM 每步一次调用；go = 手数帽口径）。 */
const EST_CALLS = { gobang: 60, xiangqi: 120, doudizhu: 100, mahjong: 320, "mahjong-xueliu": 320, "mahjong-guangdong": 320, junqi: 300, fanqi: 300, "mahjong-riichi": 320, poker: 160, guandan: 400, go9: 120, go13: 200 };

/** 命名空间串 → 人读短名（deepseek/deepseek-chat → deepseek-chat）。 */
const shortName = (v) => String(v ?? "").split("/").pop() || String(v ?? "");

/** 深色模型树弹层（PetModelPicker 同款：标题栏/滚动树/底栏草稿+确定）。 */
export function ModelTreeModal({ title, treeNodes, leafValues, statusReady, selected, onChange, onClose, onOk, single, t }) {
  return createPortal(
    <div className="fixed inset-0 z-[100002] flex items-center justify-center bg-black/50" onClick={onClose} data-arena-model-modal-backdrop>
      <div
        className="w-[460px] max-h-[80vh] flex flex-col rounded-2xl border border-white/15 bg-[#1d1d1f]/95 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-arena-model-modal
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <h3 className="text-sm font-semibold flex-1">{title}</h3>
          <button type="button" onClick={onClose} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 text-white/70 text-xs" data-arena-model-modal-close>✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {leafValues.length > 0 ? (
            <ModelPicker
              isDark
              mode={single ? "single" : "multi"}
              nodes={treeNodes}
              selected={selected}
              onChange={onChange}
              defaultOpenDepth={1}
            />
          ) : (
            <p className="text-[11px] text-white/40 py-2" data-arena-model-empty>{statusReady ? t("arena.model.emptyTree") : t("arena.model.loadingTree")}</p>
          )}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          <span className="flex-1 text-[11px] text-white/60 truncate" data-arena-model-modal-draft>
            {single
              ? ([...selected][0] ? shortName([...selected][0]) : t("arena.model.pickedNone"))
              : t("arena.model.pickedCount", { n: selected.size })}
          </span>
          <button type="button" onClick={onClose} className="px-3 py-1 rounded-lg text-xs border border-white/10 bg-black/40">{t("arena.model.cancel")}</button>
          <button
            type="button"
            data-arena-model-modal-ok
            disabled={single ? ![...selected][0] : selected.size === 0}
            onClick={onOk}
            className={`px-3 py-1 rounded-lg text-xs ${(single ? [...selected][0] : selected.size > 0) ? "bg-blue-500 text-white" : "bg-white/10 text-white/40"}`}
          >
            {t("arena.model.ok")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 座位模型选择：按钮回显当前值，点击弹统一模型树（单选，确定才提交）。 */
function SeatModelPicker({ value, onCommit, treeNodes, leafValues, statusReady, t }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new Set());
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => { setDraft(new Set(value ? [value] : [])); setOpen(true); }}
        className="w-full px-2.5 py-2 rounded-lg text-xs bg-white dark:bg-neutral-800 border border-black/10 dark:border-white/15 hover:border-blue-400 dark:hover:border-blue-500 truncate text-left"
        data-arena-model-select
        title={value || undefined}
      >
        {value
          ? <span className="font-mono">{shortName(value)}{isCloudModelRef(value) ? " ☁" : ""}</span>
          : <span className="opacity-50">{t("arena.model.pick")}</span>}
      </button>
      {open && (
        <ModelTreeModal
          title={t("arena.model.pickTitle")}
          treeNodes={treeNodes}
          leafValues={leafValues}
          statusReady={statusReady}
          selected={draft}
          onChange={(next) => setDraft(new Set(next))}
          onClose={() => setOpen(false)}
          onOk={() => { onCommit([...draft][0] ?? null); setOpen(false); }}
          single
          t={t}
        />
      )}
    </div>
  );
}

/** 问号悬停徽标（2026-11-07 用户裁定：长文收敛为 ❓，悬停显示全文）。 */
function Hint({ text, className = "" }) {
  if (!text) return null;
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full border border-black/15 dark:border-white/25 text-[10px] font-bold opacity-50 hover:opacity-100 cursor-help shrink-0 ${className}`}
      title={text}
      data-arena-hint
    >?</span>
  );
}

/** 循环赛参赛模型：按钮回显已选个数，点击弹统一模型树（多选勾选，确定整组提交）。 */
function TourModelPicker({ values, onCommit, treeNodes, leafValues, statusReady, t }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new Set());
  return (
    <div className="flex flex-col gap-2 shrink-0">
      {/* 2026-11-07 用户裁定：去已选药丸标签（座位框已展示模型），按钮并入座位行排头 */}
      <button
        type="button"
        onClick={() => { setDraft(new Set(values)); setOpen(true); }}
        className={`px-2.5 py-2 rounded-lg text-xs border whitespace-nowrap ${values.length > 0 ? "bg-blue-500/10 border-blue-500/40 text-blue-600 dark:text-blue-400" : "bg-white dark:bg-neutral-800 border-black/10 dark:border-white/15"}`}
        data-arena-tour-pick
      >
        {values.length > 0 ? t("arena.model.pickedCount", { n: values.length }) : t("arena.model.pick")}
      </button>
      {open && (
        <ModelTreeModal
          title={t("arena.model.pickTourTitle")}
          treeNodes={treeNodes}
          leafValues={leafValues}
          statusReady={statusReady}
          selected={draft}
          onChange={(next) => setDraft(new Set(next))}
          onClose={() => setOpen(false)}
          onOk={() => { onCommit([...draft]); setOpen(false); }}
          single={false}
          t={t}
        />
      )}
    </div>
  );
}

export default function Lobby({ leafValues, treeNodes = [], statusReady = true, hasProxy, initialGameId, onStart, busy }) {
  const { t } = useI18n();
  const games = useMemo(() => getGames().filter((g) => !g.hidden), []); // hidden 不进大厅（registry 分组序：棋→扑克→麻将）
  const [gameId, setGameId] = useState(initialGameId ?? games[0]?.id);
  const [mode, setMode] = useState("ai_vs_ai");
  const [anonymous, setAnonymous] = useState(true);
  const [humanName, setHumanName] = useState(t("arena.human.default"));
  const [seatModels, setSeatModels] = useState(["", "", "", ""]);
  const [tourModels, setTourModels] = useState([]);
  const [tourRounds, setTourRounds] = useState(2);
  const [enhanced, setEnhanced] = useState(false); // P2 #7：每步 3 采样多数票（3× 调用）
  const [fast, setFast] = useState(false); // P2 #10：快进（精简输出提速）
  const [deep, setDeep] = useState(false); // 伪搜索：变着推演（3 候选线显式树）
  const [think, setThink] = useState(true); // games2 Q10：思维链出招（默认开；关=快棋档对照）
  const [jqReveal, setJqReveal] = useState(false); // 军棋明棋教学档：双方布阵全程亮明（不计天梯）

  useEffect(() => {
    const onPick = (e) => { if (e.detail?.gameId) setGameId(e.detail.gameId); };
    window.addEventListener("arena:pick-game", onPick);
    return () => window.removeEventListener("arena:pick-game", onPick);
  }, []);
  useEffect(() => { if (initialGameId) setGameId(initialGameId); }, [initialGameId]);

  const gameDef = games.find((g) => g.id === gameId) ?? games[0];
  const seats = gameDef?.seats ?? 2;
  const cloudCount = (mode === "tournament" ? tourModels : seatModels.slice(0, seats).filter((_, i) => !(mode === "human_vs_ai" && i === 0))).filter((ref) => isCloudModelRef(ref)).length; // 显式箭头：filter 直传会把 index 当 localPrefixes（参数化签名坑）

  const canStart = (() => {
    if (!hasProxy || busy || !gameDef) return false;
    if (mode === "tournament") return seatModels.slice(0, gameDef.seats).every(Boolean); // 轮转补满后逐座确认（1 个模型也可开）
    if (mode === "human_vs_ai") return seatModels.slice(1, seats).every(Boolean);
    return seatModels.slice(0, seats).every(Boolean);
  })();

  const doStart = () => {
    const opts = { anonymous, think, enhanced: enhanced && !fast, fast, deep: deep && !fast,
      gameOpts: gameId === "junqi" && jqReveal ? { revealAll: true } : undefined }; // 游戏级开局面（军棋明棋档）
    if (mode === "tournament") {
      onStart({ mode: "tournament", gameId, models: seatModels.slice(0, seats).filter(Boolean), rounds: tourRounds, ...opts }); // 座位表（批量选+逐座覆盖后的最终阵容）
      return;
    }
    const seatPlayers = [];
    for (let i = 0; i < seats; i += 1) {
      seatPlayers.push(mode === "human_vs_ai" && i === 0
        ? { kind: "human", name: humanName || t("arena.human.default") }
        : { kind: "llm", modelRef: seatModels[i] });
    }
    onStart({ mode, gameId, seatPlayers, ...opts });
  };

  const modes = [
    { id: "human_vs_ai", label: t("arena.mode.human") },
    { id: "ai_vs_ai", label: t("arena.mode.watch") },
    { id: "tournament", label: t("arena.mode.tour") },
  ];

  return (
    <div className="h-full overflow-y-auto p-6" data-arena-lobby>
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        {/* 游戏卡位（2026-11-06 用户裁定：小而精致、Agnes 生成图标、横排紧凑） */}
        <section>
          <h2 className="text-base font-semibold mb-2.5">{t("arena.lobby.pickGame")}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {games.map((g) => {
              const icon = GAME_ICONS[g.id];
              return (
                <button
                  key={g.id}
                  onClick={() => setGameId(g.id)}
                  className={`arena-lobby-card text-left p-2.5 rounded-xl border flex items-center gap-2.5 ${gameId === g.id ? "border-blue-500 ring-2 ring-blue-500/25 shadow-md" : "border-black/8 dark:border-white/10 hover:border-black/20 dark:hover:border-white/25"}`}
                  style={{ background: `linear-gradient(135deg, ${g.color}18, transparent 70%)` }}
                  data-arena-game-card={g.id}
                >
                  {icon ? (
                    <img src={icon} alt={g.label} className="w-9 h-9 rounded-lg object-cover shrink-0 shadow-sm" />
                  ) : (
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ background: `linear-gradient(135deg, ${g.color}66, ${g.color}bb)` }}
                    >
                      {g.id === "gobang" ? "⚫" : g.id === "xiangqi" ? "♟️" : g.id === "doudizhu" ? "🃏" : g.id.startsWith("go") ? "◍" : "🀄"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{g.label}</div>
                    <div className="text-[11px] opacity-55 truncate">{g.desc}</div>
                  </div>
                  <span className="text-[10px] opacity-40 shrink-0">{t("arena.lobby.seats", { n: g.seats })}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 模式 */}
        <section>
          <h2 className="text-base font-semibold mb-2.5">{t("arena.lobby.pickMode")}</h2>
          <div className="flex gap-2.5">
            {modes.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-5 py-2.5 rounded-xl text-[13px] ${mode === m.id ? "bg-blue-500 text-white shadow" : "bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"}`}
                data-arena-mode={m.id}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs opacity-60 mt-2" data-arena-mode-hint>
            {mode === "human_vs_ai" ? t("arena.lobby.hintHuman") : mode === "ai_vs_ai" ? t("arena.lobby.hintWatch") : t("arena.lobby.hintTour")}
          </p>
        </section>

        {/* 选手（横向等高卡片：座位数/模式切换不改变整块高度，杜绝上下跳动） */}
        <section>
          <h2 className="text-base font-semibold mb-2.5">{t("arena.lobby.pickPlayers")}</h2>
          {/* 座位行（全部模式统一：循环赛批量选后自动轮转补满、逐座可改——2026-11-07 裁定） */}
          {(
            <div className="flex flex-row flex-wrap items-center gap-2" data-arena-seats-row>
              {mode !== "human_vs_ai" && (
                /* 2026-11-07 用户裁定：机机观战与循环赛同享批量选——按钮排头、多选、
                   不足座自动轮转补满（统一写 seatModels，座位框逐座可改） */
                <TourModelPicker
                  values={tourModels}
                  onCommit={(pool) => {
                    setTourModels(pool);
                    if (pool.length) {
                      // 轮转补满：1 个模型 → 全座同款；2 个 → 依次循环分配
                      setSeatModels((ms) => ms.map((x, j) => (j < (gameDef?.seats ?? 2) ? pool[j % pool.length] : x)));
                    }
                  }}
                  treeNodes={treeNodes}
                  leafValues={leafValues}
                  statusReady={statusReady}
                  t={t}
                />
              )}
              {Array.from({ length: seats }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 flex-1 min-w-0"
                  data-arena-seat-card={i}
                >
                  <span className="text-xs w-16 shrink-0 opacity-70">{t("arena.lobby.seat", { n: i + 1 })}</span>
                  {mode === "human_vs_ai" && i === 0 ? (
                    <input
                      value={humanName}
                      onChange={(e) => setHumanName(e.target.value)}
                      className="px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-neutral-800 border border-black/10 dark:border-white/15 flex-1 min-w-0"
                      data-arena-human-name
                    />
                  ) : (
                    <div className="flex-1 min-w-0">
                      <SeatModelPicker
                        value={seatModels[i]}
                        onCommit={(v) => setSeatModels((ms) => ms.map((x, j) => (j === i ? v : x)))}
                        treeNodes={treeNodes}
                        leafValues={leafValues}
                        statusReady={statusReady}
                        t={t}
                      />
                    </div>
                  )}
                </div>
              ))}
              {mode === "tournament" && (
                <div className="flex items-center gap-1.5 text-xs shrink-0" data-arena-tour-rounds>
                  <span className="opacity-70">{t("arena.lobby.rounds")}</span>
                  <input
                    type="number" min={1} max={20} value={tourRounds}
                    onChange={(e) => setTourRounds(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-14 px-2 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-black/10 dark:border-white/15"
                  />
                </div>
              )}
            </div>
          )}
        </section>

        {/* 开局 */}
        <section className="flex items-center gap-4 flex-wrap">
          <button
            disabled={!canStart}
            onClick={doStart}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-blue-500 text-white shadow hover:bg-blue-600 disabled:opacity-40 disabled:shadow-none"
            data-arena-start
          >
            {t("arena.btn.start")}
          </button>
          {/* 2026-11-07 用户裁定：长文收敛为问号悬停——复选框留短名，说明全文挂 ❓ */}
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" data-arena-anon>
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            <span className="flex items-center gap-1">{t("arena.lobby.anonShort")}<Hint text={t("arena.lobby.anon")} /></span>
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" data-arena-think>
            <input type="checkbox" checked={think} onChange={(e) => setThink(e.target.checked)} />
            <span className="flex items-center gap-1">{t("arena.lobby.think")}<Hint text={t("arena.lobby.thinkTip")} /></span>
          </label>
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${fast ? "opacity-40 pointer-events-none" : ""}`} data-arena-enhanced>
            <input type="checkbox" checked={enhanced} disabled={fast} onChange={(e) => setEnhanced(e.target.checked)} />
            <span className="flex items-center gap-1">{t("arena.lobby.enhanced")}<Hint text={t("arena.lobby.enhancedTip")} /></span>
          </label>
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${enhanced ? "opacity-40 pointer-events-none" : ""}`} data-arena-fast>
            <input type="checkbox" checked={fast} disabled={enhanced} onChange={(e) => setFast(e.target.checked)} />
            <span className="flex items-center gap-1">{t("arena.lobby.fast")}<Hint text={t("arena.lobby.fastTip")} /></span>
          </label>
          <label className={`flex items-center gap-1.5 text-xs cursor-pointer select-none ${fast ? "opacity-40 pointer-events-none" : ""}`} data-arena-deep>
            <input type="checkbox" checked={deep} disabled={fast} onChange={(e) => setDeep(e.target.checked)} />
            <span className="flex items-center gap-1">{t("arena.lobby.deep")}<Hint text={t("arena.lobby.deepTip")} /></span>
          </label>
          {gameId === "junqi" && mode !== "tournament" && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" data-arena-jq-reveal>
              <input type="checkbox" checked={jqReveal} onChange={(e) => setJqReveal(e.target.checked)} />
              <span className="flex items-center gap-1">{t("arena.junqi.revealAll")}<Hint text={t("arena.junqi.revealAllTip")} /></span>
            </label>
          )}
          <span data-arena-estimate><Hint text={`${t("arena.lobby.estimate", { n: EST_CALLS[gameId] ?? 100 })}${cloudCount > 0 ? t("arena.lobby.cloudN", { n: cloudCount }) : ""}`} /></span>
        </section>
      </div>
    </div>
  );
}
