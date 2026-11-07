/**
 * 棋谱库开局检索（2026-11-06 用户裁定「塞进向量库、不在知识库显示」；
 * 2026-11-07 chayuan-game 摘建审计裁决：**两侧统一为着法前缀匹配版**——
 * 原 KB 向量检索（/api/chatop-kb/search，1.5s 超时静默降级）换成本地
 * 最长公共前缀匹配：24 文档量级下着法序列精确匹配比向量相似度更准，
 * 零网络零依赖（chayuan-game 侧无 chatop-kb），fetchBookHint 签名不变
 * （kbId 语义化为棋谱库标识，match-runner/游戏裁判调用点零改动）。
 *
 * 语料口径（book-data.js 快照）：与 zhNotation 产出同构——红方简体+
 * 中文数字、黑方繁体+阿拉伯数字；繁简归一只作鲁棒性保险。
 * viewFor 内置定式手册恒兜底，检索零命中/非开局静默返回 null。
 */
import { arenaBookDocs } from "./book-data.js";

const cache = new Map(); // "kbId|query" → hint（同局面重试不重复计算）

/** 着法 token 提取（前中后缀多字着法一并捕获）。 */
const MOVE_RE = /[前中后]?[車车馬马砲炮相象士仕帥帅將将兵卒][一二三四五六七八九1-9]{1,2}[平进退][一二三四五六七八九1-9]{0,2}/g;
/** 繁简归一（鲁棒性保险：语料手写偏差不破对齐）。 */
const SIMPLIFY = { "車": "车", "馬": "马", "砲": "炮", "將": "将", "帥": "帅", "仕": "士", "象": "相" };
const norm = (t) => t.replace(/[車馬砲將帥仕象]/g, (ch) => SIMPLIFY[ch]);
const tokenize = (text) => (String(text ?? "").match(MOVE_RE) ?? []).map(norm);

/** 语料预解析（模块级一次）：{ name, tokens, content }。 */
const BOOK_LINES = arenaBookDocs()
  .map((d) => ({ name: d.name.replace(/\.md$/, ""), content: d.content, tokens: tokenize(d.content) }))
  .filter((d) => d.tokens.length > 0);

/** 清空检索缓存（测试用）。 */
export function clearBookCache() {
  cache.clear();
}

/** 语料自检（测试消费）：每条定式的可匹配 token 序列。 */
export function bookLinesForTest() {
  return BOOK_LINES.map((d) => ({ name: d.name, tokens: d.tokens }));
}

/** 最长公共前缀匹配：返回 { doc, plies } 或 null（minPlies 起配）。 */
export function matchBookLine(qTokens, { minPlies = 2 } = {}) {
  let best = null;
  for (const doc of BOOK_LINES) {
    let n = 0;
    while (n < qTokens.length && n < doc.tokens.length && qTokens[n] === doc.tokens[n]) n += 1;
    if (n >= minPlies && (!best || n > best.plies)) best = { doc, plies: n };
  }
  return best;
}

/** 检索最相似定式片段；签名与 KB 版兼容（kbId=棋谱库标识，query=中式记谱
 *  棋史串）；零命中/空查询返回 null（调用方静默降级）。async 保签名。 */
export async function fetchBookHint(kbId, query, opts = {}) {
  const key = `${kbId}|${query}`;
  if (cache.has(key)) return cache.get(key);
  let hint = null;
  const qTokens = tokenize(query);
  if (qTokens.length) {
    const hit = matchBookLine(qTokens, opts);
    if (hit) hint = `${hit.doc.name}（开局前 ${hit.plies} 手吻合）：${hit.doc.content}`.replace(/\s+/g, " ").slice(0, 180);
  }
  cache.set(key, hint);
  return hint;
}
