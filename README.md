# 察元竞技场 · Chayuan Arena

LLM 棋牌竞技场——让大模型同桌对弈、公开排位。**11 款玩法 × 70+ 厂商 × 真模型上桌**。

![license](https://img.shields.io/badge/license-MIT-green)

## 玩法（11 款）

| 类别 | 游戏 |
|---|---|
| 棋类 | 五子棋（15×15）· 中国象棋 · 围棋 9 路/13 路 · 军棋暗棋（自由布阵+明棋教学档）· 军棋翻翻棋 |
| 扑克 | 斗地主 · 德州扑克 · 掼蛋（升级赛到 A） |
| 麻将 | 四川血战 · 广东推倒胡 · 日麻立直（大厅隐藏，引擎可用） |

核心体验：思维链出招（CoT 气泡）· 形势曲线 · 复盘 ？! 标注 · AI 实时解说/赛后解说 ·
锦标赛循环赛积分榜 · TrueSkill 天梯 · 协议画像 · 开局记忆 · 军棋自由布阵（两击/拖拽）·
人机局 AI 接手 ↔ 人工接管 · 回放协议筛选 · 棋谱 JSON 导出。

## 快速开始

```bash
npm install
npm run dev:electron   # 桌面应用（vite build + electron）
npm test               # 全量测试
```

1. **模型配置**：设置 → 模型配置 → 从 85 家厂商目录点选 → 填 API Key（或本地
   Ollama 免 Key）→ 手填/预设模型名 → 「测试连接」
2. **开局**：大厅选游戏 → 人机 / 机机观战 / 锦标赛 → 上桌

所有模型调用经本机内置网关（`127.0.0.1` 随机端口 + token），Key 明文存本机
`userData/arena/config.json`（加密升级位已预留），不出本机。

## 架构

```
electron/   主进程：单实例 · 模型网关（OpenAI 兼容 + Anthropic 协议转换）· JSON 存档
src/arena/  引擎层：11 款游戏裁判（纯逻辑零 IO）· 对局引擎 · LLM 玩家 · TrueSkill
src/app/    UI：大厅 / 对局室 / 天梯 / 记录 / 回放（React 19 + Vite + Tailwind 4）
```

裁判只负责规则真值（胜负 100% 归代码）；LLM 玩家统一 OpenAI 协议出招
`{move, comment}`，解析容错链 + 无 JSON 回捞 + 429 退避 + 代走五级降级。

## 开发

```bash
npm run sync-check /path/to/chayuan-harness   # 引擎同构面校验（双仓开发时）
```

引擎层（`src/arena/`）与上游仓逐字节同构（`scripts/sync-check.mjs` 护栏）。

## License

MIT —— 见 [LICENSE](LICENSE)。各厂商 logo 仅为指代对应服务，商标归各自所有者。
