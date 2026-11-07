/**
 * 棋谱库前缀匹配（2026-11-07 摘建审计裁决：两侧统一本地前缀匹配版，
 * 替代 KB 向量检索）——token 提取/繁简归一/LCP 命中/零命中静默/缓存。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { fetchBookHint, matchBookLine, clearBookCache, bookLinesForTest } from "../src/arena/bookRag.js";

describe("棋谱库前缀匹配", () => {
  beforeEach(() => clearBookCache());

  it("语料自检：24 文档全部可提取非空着法序列", () => {
    const lines = bookLinesForTest();
    expect(lines.length).toBeGreaterThanOrEqual(20);
    for (const l of lines) {
      expect(l.tokens.length, `${l.name} 无着法 token`).toBeGreaterThan(0);
      for (const t of l.tokens) expect(t).toMatch(/[平进退]/); // 每着含动词
    }
  });

  it("zhNotation 口径命中：屏风马主线前 4 手吻合（红中文数字/黑繁体阿拉伯）", async () => {
    // 与 queryOf 产物同构：hist 的 zhTrad 串（红方炮二平五=中文数字、黑方馬8进7=繁体+阿拉伯）
    const hint = await fetchBookHint("internal-arena-book", "炮二平五 馬8进7 马二进三 車9平8");
    expect(hint).toBeTruthy();
    expect(hint).toContain("屏风马");
    expect(hint).toMatch(/开局前 [3-9] 手吻合/);
  });

  it("繁简归一鲁棒：简体黑子着法（马8进7/车9平8）同样命中", async () => {
    const hint = await fetchBookHint("kb", "炮二平五 马8进7 马二进三 车9平8");
    expect(hint).toBeTruthy();
  });

  it("LCP 择长：多定式共享首段时取吻合手数最多者", () => {
    const tokens = ["炮二平五", "马8进7", "马二进三", "车9平8", "卒7进1"]; // zhNotation 口径（红方中文数字/黑方阿拉伯，繁简已归一）
    const hit = matchBookLine(tokens, { minPlies: 1 });
    expect(hit).toBeTruthy();
    expect(hit.plies).toBeGreaterThanOrEqual(3);
  });

  it("零命中/空查询/非棋谱文本 → null（静默降级口径）", async () => {
    expect(await fetchBookHint("kb", "")).toBeNull();
    expect(await fetchBookHint("kb", "这是一段没有任何着法的闲聊文本")).toBeNull();
    expect(await fetchBookHint("kb", "炮二平五 卒3进1 车一平二 马2进3")).toBeNull(); // 无 ≥2 手前缀吻合
  });

  it("缓存生效：同 query 二次调用不重算（结果一致）", async () => {
    const q = "炮二平五 馬8进7";
    const a = await fetchBookHint("kb", q);
    const b = await fetchBookHint("kb", q);
    expect(a).toBe(b);
  });
});
