#!/usr/bin/env node
/**
 * chayuan-game 双轨同步校验（2026-11-07 摘建审计裁决 #9）：
 * 引擎层同构镜像（双向同步纪律的机械护栏）——比对 harness 与 chayuan-game
 * 两仓「同构面」文件的 sha256，不一致即列出（双向同步遗漏/漂移）。
 *
 * 用法：node scripts/sync-check.mjs /path/to/chayuan-harness
 * （chayuan-game 侧路径 = 本仓根；OTHER = harness）
 * 退出码：0 同构完整 / 1 有漂移 / 2 目标仓或文件缺失。
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // chayuan-game 侧：本仓=镜像面
const OTHER = process.argv[2];
if (!OTHER || !existsSync(OTHER)) {
  console.error("用法：node scripts/sync-check.mjs /path/to/chayuan-harness");
  process.exit(2);
}

/** 同构面（2026-11-07 摘建共识冻结清单）——harness 路径 → chayuan-game 相对路径。
 *  前提（四裁决落地）：match-runner 依赖注入 openingsProvider（无宿主 import）、
 *  bookRag 两侧前缀匹配版、registry isCloudModelRef 参数化。 */
const SYNC_FILES = [
  ["src/arena/registry.js", "dsh-plugin/src/desktop/arena/registry.js"],
  ["src/arena/match-runner.js", "dsh-plugin/src/desktop/arena/match-runner.js"],
  ["src/arena/players.js", "dsh-plugin/src/desktop/arena/players.js"],
  ["src/arena/protocol-profile.js", "dsh-plugin/src/desktop/arena/protocol-profile.js"],
  ["src/arena/prompts.js", "dsh-plugin/src/desktop/arena/prompts.js"],
  ["src/arena/trueskill.js", "dsh-plugin/src/desktop/arena/trueskill.js"],
  ["src/arena/bookRag.js", "dsh-plugin/src/desktop/arena/bookRag.js"],
  ["src/arena/book-data.js", "dsh-plugin/src/desktop/arena/book-data.js"],
  ...[
    "doudizhu", "fanqi", "go", "gobang", "guandan", "junqi",
    "mahjong", "mahjong-guangdong", "mahjong-riichi", "poker-holdem", "xiangqi",
  ].map((g) => [`src/arena/games/${g}.js`, `dsh-plugin/src/desktop/arena/games/${g}.js`]),
];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
let drift = 0, missing = 0;
for (const [here, there] of SYNC_FILES) {
  const a = join(ROOT, here), b = join(OTHER, there);
  if (!existsSync(b)) { console.log(`✗ 缺失  ${there}`); missing += 1; continue; }
  if (sha(a) !== sha(b)) { console.log(`✗ 漂移  ${here}  ≠  ${there}`); drift += 1; }
}
const total = SYNC_FILES.length;
console.log(`\n同构面 ${total} 文件：漂移 ${drift} / 缺失 ${missing}`);
process.exit(drift + missing > 0 ? 1 : 0);
