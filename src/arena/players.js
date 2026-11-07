/**
 * PlayerAdapter（games-llm-arena-plan §三）：统一接口 observe → {move, comment}。
 *  - HumanPlayer：UI 出招（Room 交互层 resolve Promise）
 *  - LlmPlayer：chatop-models 代理 /v1/chat/completions（PetChat 同款两段式
 *    端点发现：/api/chatop-models/proxy/status → http://127.0.0.1:<port>/v1/…；
 *    免 key 回环直连）。temperature 统一 0.6（Q6 公平三件套：低温诱发复读，
 *    本地模型有前科）；非流式拿 {move, comment}；engine_busy 503 自动重试；
 *    厂商 429 限流/远端并发护栏按 retry-after（缺席 3.5s→7s）退避重试。
 *
 * 解析容错（2026-11-06 deepseek 实锤加固）：剥 <think> 思维块（含未闭合
 * 截断）→ 剥 markdown 栅栏 → 整体 JSON → 抽第一个 {...} → 截断修复（max_tokens
 * 掐尾的 JSON 补 "}/} 收尾再试）→ 裸换行/制表符转空格（comment 带裸换行令
 * JSON.parse 失败）→ 正则抽 move（双引号 → 单引号：单引号 JSON 是小厂模型
 * 高频姿势）。重试语义在 MatchRunner（Q2：重试 2 次由跑者喂 retryPrompt，
 * 这里只负责单次调用成功/失败）。
 */

const MOVE_RES = [
  [/"move"\s*:\s*"([^"]+)"/, /"comment"\s*:\s*"([^"]*)"/],
  [/'move'\s*:\s*'([^']+)'/, /'comment'\s*:\s*'([^']*)'/],
];
import { getProtocolProfile, updateProtocolProfile } from "./protocol-profile.js";

/** 无 JSON 文本救援（2026-11-06 rambling 实锤：弱模型复述局面/分析坐标、
 *  全文无 JSON）——输出全文扫「当前合法动作串」的精确词命中（词边界防
 *  g4g5 撞 g4g55 前缀），取最靠文末的命中（模型结论一般在收尾）。只认
 *  合法清单成员，绝不产出非法串；命中不了返回 null 走原重试链。 */
export function salvageMove(text, actions) {
  if (typeof text !== "string" || !text) return null;
  const list = (Array.isArray(actions) ? actions : []).filter((a) => typeof a === "string" && a);
  if (!list.length) return null;
  let best = null;
  for (const a of list) {
    const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![0-9A-Za-z:])${esc}(?![0-9A-Za-z:])`, "g");
    let m;
    while ((m = re.exec(text))) {
      if (!best || m.index > best.index) best = { index: m.index, move: a };
    }
  }
  return best ? best.move : null;
}

/** 从模型输出抽 {move, comment}；解析不出返回 null。
 *  两段思考（2026-11-06 P0 #2）：强模型允许「分析：…\n答案：{json}」——
 *  先在「答案：」段内跑全链解析（释放 CoT 推理），无标记再按整文走原链。 */
export function parseMoveOutput(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const mAns = /(?:答\s*案|ANSWER)\s*[:：]\s*/i.exec(text);
  if (mAns) {
    const seg = text.slice(mAns.index + mAns[0].length);
    const hit = parseMoveCore(seg);
    if (hit) return hit;
  }
  return parseMoveCore(text);
}

function parseMoveCore(rawText) {
  let t = typeof rawText === "string" ? rawText.trim() : "";
  if (!t) return null;
  // 推理型模型（deepseek-reasoner 等经 openai 兼容网关）常把思维链原样拼进
  // content：先剥 <think> 块再解析，否则思考里的 {…} 会把整体抽取带歪；
  // 预算烧穿截断在思维链中途（只有 <think> 没有闭合）时整段剥到尾。
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  t = t.replace(/<think>[\s\S]*$/i, "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  const core = first >= 0 && last > first ? t.slice(first, last + 1) : null;
  const truncated = first >= 0 && last < first ? t.slice(first) : null; // } 被掐尾
  // 候选升级：原样 → {...} 整体 → 截断补尾（先 " 再 }，覆盖 comment 掐在
  // 字符串中途的常见态）→ 全员再做一遍裸换行/制表符转空格（JSON 串外多空格
  // 合法；串内裸换行转空格语义无损）
  const tries = [t];
  if (core) tries.push(core);
  if (truncated) tries.push(`${truncated}"}`, `${truncated}}`);
  tries.push(...tries.map((c) => c.replace(/[\t\r\n]+/g, " ")));
  for (const candidate of tries) {
    try {
      const obj = JSON.parse(candidate);
      if (typeof obj?.move === "string" && obj.move.trim()) {
        return { move: obj.move.trim(), comment: typeof obj.comment === "string" ? obj.comment.trim().slice(0, 120) : "" };
      }
    } catch { /* 下一档 */ }
  }
  for (const [mv, cm] of MOVE_RES) {
    const re = new RegExp(mv.source, "g");
    let m;
    while ((m = re.exec(t))) {
      // 跳过以 {/[ 开头的「值」：续写补全被模型整体复读时（{"move":"{"move":"…），
      // 首个正则命中是嵌套头而非真着法。假命中的闭引号正是真键的开引号，
      // 连续 exec 永远错过——回退到假命中起点 +1 重扫。
      if (/^[{[]/.test(m[1])) { re.lastIndex = m.index + 1; continue; }
      const c = cm.exec(t);
      return { move: m[1].trim(), comment: c ? c[1].slice(0, 120) : "" };
    }
  }
  return null;
}

/** LLM 玩家。modelRef = 代理命名空间引用串（local/<id>、<vendor>/<model>）。
 *  thinkMode（games2 Q10/Q14 合流裁定，默认 true）：局级思维链总开关——
 *  false 时两段思考不启用（全员退回严格裸 JSON，供「快棋档」对照实验），
 *  与模型画像的强弱判定独立（画像照记，开关只管本局用不用）。 */
export function createLlmPlayer({ modelRef, proxyBase, personality = "", temperature = 0.6, timeoutMs = 120_000, maxTokens = 1200, thinkMode = true, sampleN = 1, deep = false }) {
  // 两段思考（P0 #2）：强模型先「分析：」（含对手应手推演）再「答案：{json}」，
  // 释放 CoT 推理力；未知模型首轮试探，失败即判弱（严格协议+降级梯），画像
  // 持久化（P0 #11）跨局免学费。判定一经作出本局与跨局生效（重置=清 os-data
  // arena_protocol 文档）。
  const TWO_PHASE_RULES = '\n【思考模式】本手请按两段输出、不得有第三行：\n分析：≤80字，必须包含你对对方下一步最可能应手的推演\n答案：{"move":"<合法清单动作串>","comment":"≤20字"}';
  // 伪搜索（2026-11-06「打伪搜索这张牌」）：把隐式直觉逼成显式树——要求
  // 推演 3 条变着线（含吃子线/防守线各一）+ 最强应手 + 优劣评估，再选着。
  // 对强模型有实测提升空间（ToT：显式多路径 > 单路径直觉）；弱模型不出
  // 两段格式自动落回严格协议（deep 指令随之失效，不额外伤害）。3 段格式
  // 的「答案：」段解析复用现有链；raw 上限放宽到 800 保推演全文进思考气泡。
  const DEEP_RULES = '\n【思考模式·变着推演】请严格按三段输出、不得有第四段：\n分析：推演 3 条候选着法线，每条一行「我走X → 对方最强应手Y → 评估(优/平/劣)」，其中至少 1 条吃子线、1 条防守线（针对「受威胁」清单），≤120字\n结论：一行指出选用哪条线与理由（≤30字）\n答案：{"move":"<合法清单动作串>","comment":"≤20字"}';
  let strongCapable = null; // null 未知 / true 强（两段思考成立）/ false 弱
  let profileLoaded = false;
  const stats = { calls: 0, promptTokens: 0, completionTokens: 0, errors: 0 };
  // 自适应续写补全（2026-11-06 象棋 rambling 玩家 B 实锤：逐回合复述局面/
  // 复述指令，全文无 JSON，重试也复述）——一次无 JSON 即判该模型不吃指令
  // 协议，本局后续请求把 {"move":" 作为 assistant 尾消息预填，模型只需
  // 「接完」而非「听懂」（弱模型/补全式模型的黄金招）。仅对已暴露问题的
  // 模型启用，好模型零影响。
  const MOVE_PRIMER = '{"move":"';
  // 严令尾注 + 行内续写（2026-11-06「总是文本回捞」实锤：坏模型不读 system
  // 提示词、输出全是接续正文的口吻——Chinese/English 双语防语言漂移）。
  // assistant 预填被网关拒（primeBroken）后的最后通道：用户消息正文停在半截
  // {"move":" 处，补全式模型的续写惯性会直接把它写完；指令式模型则回全量
  // JSON（响应侧按是否以 { 开头决定是否拼回预填头，两种形态都解析）。
  const STRICT_SUFFIX = '\n\n【最高优先级·输出协议 / OUTPUT PROTOCOL】你现在唯一要做的事：输出且仅输出一行 JSON（以 { 开头、以 } 结尾），禁止任何分析、解释或 JSON 以外的字符。Output ONE single line of JSON only — no analysis, no prose.\n现在直接从下一行的开头接续完成（不要重复它）：\n{"move":"';
  let primeMode = false;
  // 两个独立降级开关（2026-11-06 实锤：assistant 预填被网关拒 ≠ 行内续写
  // 不可用——同一局里 assistant 全空、行内却出过干净 JSON a9b7）：
  // primeBroken = assistant 预填不可用（400/422 或空回）→ 落到行内；
  // inlineBroken = 行内续写也不可用（持续空回）→ 落普通提问，回捞兜底。
  let primeBroken = false;
  let inlineBroken = false;
  async function call(system, user, extraUser, signal, { prime = false, strict = false } = {}) {
    let lastErr = null;
    let emptyRetried = false; // 瞬态空回同形态重试一次的记号
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const usePrime = prime && !primeBroken; // 每轮重算：primeBroken 可在中途置位
      const useInline = strict && !usePrime; // 行内续写：正文停在 {"move":" 半截处
      const userFull = `${extraUser ? `${user}\n\n${extraUser}` : user}${useInline ? STRICT_SUFFIX : ""}`;
      const messages = [
        { role: "system", content: system },
        { role: "user", content: userFull },
      ];
      if (usePrime) messages.push({ role: "assistant", content: MOVE_PRIMER });
      const ac = new AbortController();
      const onOuterAbort = () => ac.abort();
      signal?.addEventListener("abort", onOuterAbort, { once: true });
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        stats.calls += 1;
        const res = await fetch(`${proxyBase}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: ac.signal,
          body: JSON.stringify({ model: modelRef, temperature, max_tokens: maxTokens, messages }),
        });
        if (res.status === 503 && attempt < 2) {
          const busyBody = await res.text().catch(() => "");
          // 仅 engine_busy（本地并发闸/队列打满）自愈重试——厂商上游 503
          // （限流/网关故障，2026-11-06 agnes 实锤）不当本地忙干等，带原文
          // 快败（noRetry 标记越过下方网络抖动重试的 catch）。
          if (!busyBody.includes("engine_busy")) {
            const err = new Error(`HTTP 503: ${busyBody.slice(0, 300)}`);
            err.noRetry = true;
            throw err;
          }
          await new Promise((r) => setTimeout(r, 3500)); // engine_busy 自愈（PetChat 同口径）
          continue;
        }
        if (res.status === 429 && attempt < 2) {
          // 厂商限流 / DDS 远端模型并发护栏（忙时 429）——瞬态信号，退避后在
          // 本调用内重试（2026-11-06 nvidia 429 实锤：硬抛会把 MatchRunner 的
          // 2 次重试额度瞬间烧光连珠炮式打限流口，裁判代走接管整局）。优先信
          // retry-after（代理透传），缺席则 3.5s→7s 递增。
          const ra = Number(res.headers?.get?.("retry-after"));
          const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : 3500 * (attempt + 1);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        if (!res.ok) {
          const body = (await res.text().catch(() => "")).slice(0, 300);
          // 个别网关不接受 assistant 尾消息（400/422）：立即回退普通提问，
          // 不烧重试额度（primeBroken 置位后本轮即走普通提问）
          if (usePrime && (res.status === 400 || res.status === 422)) {
            primeBroken = true;
            try { updateProtocolProfile(modelRef, { primeBroken: true }); } catch { /* best-effort */ }
            attempt -= 1;
            continue;
          }
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        const data = await res.json();
        const usage = data?.usage ?? {};
        stats.promptTokens += usage.prompt_tokens ?? 0;
        stats.completionTokens += usage.completion_tokens ?? 0;
        const msg = data?.choices?.[0]?.message ?? {};
        const cont = msg.content ?? "";
        // 续写段为空（2026-11-06 玩家B 两次实锤：assistant 尾消息回 200+空、
        // 行内续写也间歇性回空——组装文本只剩预填头 {"move":" = 解析必败）：
        // 先当瞬态同形态重试一次，再空则只禁用当前形态（assistant 空 → 落
        // 行内；行内空 → 落普通提问），回捞兜底仍在。
        if ((usePrime || useInline) && !cont.trim()) {
          if (!emptyRetried) { emptyRetried = true; attempt -= 1; continue; }
          if (usePrime) { primeBroken = true; try { updateProtocolProfile(modelRef, { primeBroken: true }); } catch { /* best-effort */ } }
          else { inlineBroken = true; try { updateProtocolProfile(modelRef, { inlineBroken: true }); } catch { /* best-effort */ } }
          attempt -= 1;
          continue;
        }
        // max_tokens 给足（2026-11-06 deepseek 实锤）：推理型模型
        // （deepseek-reasoner/R1 系）思维链计入 max_tokens，400 会被思考
        // 烧穿 → content 空串/JSON 被掐尾 =「输出无法解析」；1200 对全员
        // 统一（Q6 公平口径不变，comment 落库本来就只留 120 字）。
        // 续写补全拼回头：assistant 预填恒拼；行内续写只在模型真接续时拼
        // （指令式模型会回全量 JSON，已以 { 开头则原样解析）。
        const needJoin = usePrime || (useInline && !/^\s*\{/.test(cont));
        // 个别网关会把预填头的闭引号也随续写段带回（""h3e3" 双引号）：拼回前剥掉
        const text = needJoin ? MOVE_PRIMER + cont.replace(/^\s*"/, "") : cont;
        const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
        return { text: text || reasoning, usage };
      } catch (e) {
        if (e?.noRetry) throw e; // 上游 5xx 人话快败：不进抖动重试
        lastErr = e;
        if (signal?.aborted) throw e; // 用户停赛不重试
        // 网络抖动（fetch failed / 连接重置）小退避再试（2026-11-06 实锤：
        // 零间隔三连抛只会把瞬断放大成整局代走）
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onOuterAbort);
      }
    }
    stats.errors += 1;
    throw lastErr ?? new Error("LLM 调用失败");
  }
  return {
    kind: "llm",
    modelRef,
    personality,
    stats,
    /** 观察文本 → {move, comment}；由 MatchRunner 提供 retry 语义。 */
    async act(view, system, retryText, signal) {
      // 画像水合（一次性）：跨局直接从最优通道起步
      if (!profileLoaded) {
        profileLoaded = true;
        try {
          const p = await getProtocolProfile(modelRef);
          if (p) {
            if (p.primeBroken) primeBroken = true;
            if (p.inlineBroken) inlineBroken = true;
            if (typeof p.strong === "boolean") strongCapable = p.strong;
          }
        } catch { /* 无画像开局 */ }
      }
      // 强/未知 → 两段思考（CoT 释放）；弱 → 严格协议 + 降级梯。
      // thinkMode=false（局级总开关关）→ 两段思考不启用（Q14 合流：开关统一、
      // 协议形态按画像自适应）；已知弱模型在 think 局只多担一手 ramble 风险，
      // salvage/prime 降级梯照常兜底、画像跨局生效。
      const useTwoPhase = thinkMode !== false && strongCapable !== false;
      const sysFull = useTwoPhase ? `${system}${deep ? DEEP_RULES : TWO_PHASE_RULES}` : system;
      const callOpts = { prime: primeMode && !primeBroken, strict: primeMode && !inlineBroken };
      // 自一致性采样（P2 #7）：N 路并行调用 → 合法解析多数票（强模型 CoT×
      // 投票双叠加；3× 调用成本由开局开关显式选定）。全灭取最长原文给回捞。
      if (sampleN > 1) {
        const results = await Promise.allSettled(Array.from({ length: sampleN }, () => call(sysFull, view, retryText, signal, callOpts)));
        const parsed = results.map((r) => (r.status === "fulfilled" ? parseMoveOutput(r.value.text) : null));
        const counts = new Map();
        for (const p of parsed) if (p) counts.set(p.move, (counts.get(p.move) ?? 0) + 1);
        if (counts.size > 0) {
          let bestMove = null;
          let bestN = 0;
          for (const [mv, n] of counts) if (n > bestN) { bestN = n; bestMove = mv; }
          const win = parsed.find((p) => p && p.move === bestMove);
          const winIdx = parsed.findIndex((p) => p && p.move === bestMove);
          const winText = winIdx >= 0 && results[winIdx].status === "fulfilled" ? results[winIdx].value.text : win.move;
          if (useTwoPhase && strongCapable !== true) {
            strongCapable = true;
            try { updateProtocolProfile(modelRef, { strong: true }); } catch { /* best-effort */ }
          }
          let pt = 0;
          let ct = 0;
          for (const r of results) if (r.status === "fulfilled") { pt += r.value.usage?.prompt_tokens ?? 0; ct += r.value.usage?.completion_tokens ?? 0; }
          return { move: win.move, comment: win.comment, usage: { prompt_tokens: pt, completion_tokens: ct }, raw: winText.slice(0, deep ? 800 : 400), sampled: sampleN, agreement: `${bestN}/${sampleN}` };
        }
        if (useTwoPhase && strongCapable !== true) {
          strongCapable = false;
          try { updateProtocolProfile(modelRef, { strong: false }); } catch { /* best-effort */ }
        }
        primeMode = true;
        let longest = "";
        for (const r of results) if (r.status === "fulfilled" && r.value.text.length > longest.length) longest = r.value.text;
        const err = new Error(`输出无法解析为 {"move","comment"}（${sampleN} 路采样全灭）：${longest.slice(0, 120)}`);
        err.rawText = longest;
        throw err;
      }
      const { text, usage } = await call(sysFull, view, retryText, signal, callOpts);
      const parsed = parseMoveOutput(text);
      if (!parsed) {
        if (useTwoPhase && strongCapable !== true) {
          strongCapable = false; // 两段试探失败 → 弱模型，本局+跨局严格协议
          try { updateProtocolProfile(modelRef, { strong: false }); } catch { /* best-effort */ }
        }
        // 一次无 JSON 即触发续写补全模式（本局内持续）；原文挂错误对象：
        // MatchRunner 据此做合法动作回捞（salvageMove）
        primeMode = true;
        const err = new Error(`输出无法解析为 {"move","comment"}：${String(text).slice(0, 160)}`);
        err.rawText = text;
        throw err;
      }
      if (useTwoPhase && strongCapable !== true) {
        strongCapable = true; // 两段思考成立 → 画像固化，跨局免试探
        try { updateProtocolProfile(modelRef, { strong: true }); } catch { /* best-effort */ }
      }
      return { ...parsed, usage, raw: text.slice(0, deep ? 800 : 400) };
    },
  };
}

/** 人类玩家：UI 交互层把 pendingAction 渲染成棋盘/按钮，resolve 本 Promise。
 *  abort 通道（P1 修复）：signal 触发即认输 resolve——停赛/关窗不挂死对局。 */
export function createHumanPlayer({ name = "人类挑战者" } = {}) {
  let resolver = null;
  let abortHandler = null;
  let queued = null; // UI 提前提交的步（回合未到时 submit 不丢，act 到场即消费）
  return {
    kind: "human",
    name,
    stats: { calls: 0, promptTokens: 0, completionTokens: 0, errors: 0 },
    /** MatchRunner 调用：等 UI resolve({move, comment})。 */
    act(_view, _sys, _retry, signal) {
      return new Promise((resolve) => {
        if (queued) { const q = queued; queued = null; resolve(q); return; } // 消费提前提交
        resolver = resolve;
        if (signal) {
          abortHandler = () => { if (resolver) { const r = resolver; resolver = null; r({ move: "__resign__", comment: "中止" }); } };
          signal.addEventListener("abort", abortHandler, { once: true });
        }
      });
    },
    /** UI 侧提交一步（回合未到先入队，防静默丢步）。 */
    submit(move, comment = "") {
      const out = { move, comment };
      if (resolver) { const r = resolver; resolver = null; r(out); }
      else queued = out;
    },
    /** 弃权（UI 认输按钮/关窗） */
    cancel() {
      if (resolver) { const r = resolver; resolver = null; r({ move: "__resign__", comment: "认输" }); }
    },
    /** 悔棋（2026-11-06 人机模式「回退上一步」）：resolve 哨兵 __undo__，由
     *  MatchRunner 回退一整轮（AI 应手 + 玩家这步）后重新等输入。 */
    undo() {
      if (resolver) { const r = resolver; resolver = null; r({ move: "__undo__", comment: "" }); }
    },
    detachAbort() {
      // 正常提交后解绑 abort 监听（防 resolver 已空时的悬挂 handler）
      if (abortHandler) { abortHandler = null; }
    },
    get pendingResolver() { return resolver; },
  };
}
