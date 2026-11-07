/**
 * 竞技场视觉资产（games-llm-arena-plan 视觉轮，2026-11-04 用户指令「要有真正
 * 的牌/真实的图像」）：纯 SVG 自绘、零外部图片、零版权负担。
 *  - PokerCard：真实扑克牌面（角标+花色+中央大花色；大小王彩绘；菱纹牌背）——
 *    对标 JJ斗地主/欢乐斗地主的经典白卡样式。
 *  - MjTileFace：麻将立体牌面（筒=同心圆阵、索=竹条阵、万=汉字+萬，象牙白
 *    牌体+底部厚度阴影）——对标雀魂的川麻风明亮配色。
 * 牌面几何：PIPS/STICKS 布局表（1-9 全排布），与真实麻将点阵一致。
 */
import { useMemo } from "react";

/* ================= 扑克 ================= */

const PK_SUITS = {
  S: { glyph: "♠", red: false },
  H: { glyph: "♥", red: true },
  D: { glyph: "♦", red: true },
  C: { glyph: "♣", red: false },
};
/** 牌值 ch → {rank 文案, 花色}；花色按 rank 轮转保持红黑相间（3♠4♥5♣…同真实发牌观感）。 */
const RANK_SUITS = ["S", "H", "C", "D"];
export function pkFace(ch) {
  if (ch === "X") return { rank: "JOKER", suit: null, red: false, joker: "small" };
  if (ch === "D") return { rank: "JOKER", suit: null, red: true, joker: "big" };
  if (ch === "T") return { rank: "10", suit: RANK_SUITS[1], red: true };
  const order = ["3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A", "2"];
  const idx = order.indexOf(ch);
  const s = RANK_SUITS[(idx + 1) % 4];
  return { rank: ch, suit: s, red: PK_SUITS[s].red };
}

/** 尺寸档：trick 中央出牌 lg、手牌 md、明牌/迷你 sm。 */
const PK_SIZE = {
  lg: { w: 64, h: 92, rank: 15, pip: 30, corner: 1 },
  md: { w: 52, h: 76, rank: 13, pip: 24, corner: 1 },
  sm: { w: 34, h: 48, rank: 9, pip: 15, corner: 0.6 },
  xs: { w: 26, h: 38, rank: 7, pip: 11, corner: 0.5 },
};

export function PokerBack({ size = "md" }) {
  const s = PK_SIZE[size] ?? PK_SIZE.md;
  return (
    <svg width={s.w} height={s.h} viewBox="0 0 52 76" className="arena-anim-pop" style={{ display: "block" }}>
      <rect x="1" y="1" width="50" height="74" rx="5" fill="#e8edf5" stroke="#9fb2cc" strokeWidth="1.5" />
      <rect x="4.5" y="4.5" width="43" height="67" rx="3" fill="#2b5aa6" />
      <g fill="#4d7ec9">
        {Array.from({ length: 5 }).map((_, r) => Array.from({ length: 4 }).map((_, c) => (
          <rect key={`${r}-${c}`} x={8 + c * 10.5} y={9 + r * 12.5} width="6" height="6" rx="1" transform={`rotate(45 ${11 + c * 10.5} ${12 + r * 12.5})`} />
        )))}
      </g>
      <rect x="4.5" y="4.5" width="43" height="67" rx="3" fill="none" stroke="#1d3f7d" strokeWidth="1.2" />
    </svg>
  );
}

export function PokerCard({ ch, onClick, picked, size = "md", dimmed = false }) {
  const s = PK_SIZE[size] ?? PK_SIZE.md;
  const face = useMemo(() => pkFace(ch), [ch]);
  const color = face.red ? "#d0342c" : "#1d2129";
  const suit = face.suit ? PK_SUITS[face.suit] : null;
  const wid = s.w, hei = s.h;
  if (face.joker) {
    // 大小王：竖排 JOKER + 星徽（大王红小王黑）
    return (
      <svg
        width={wid} height={hei} viewBox="0 0 52 76"
        className={`arena-pk ${onClick ? "is-click" : ""} ${picked ? "is-picked" : ""} ${dimmed ? "is-dim" : ""}`}
        onClick={onClick} style={{ display: "block" }}
      >
        <rect x="1" y="1" width="50" height="74" rx="6" fill="#fdfdfb" stroke="#c9c7bd" strokeWidth="1.5" />
        <text x="8" y="20" fontSize="11" fontWeight="800" fill={color} fontFamily="Georgia, serif" style={{ letterSpacing: 0.5 }}>J</text>
        <text x="8" y="32" fontSize="11" fontWeight="800" fill={color} fontFamily="Georgia, serif">O</text>
        <text x="8" y="44" fontSize="11" fontWeight="800" fill={color} fontFamily="Georgia, serif">K</text>
        <text x="8" y="56" fontSize="11" fontWeight="800" fill={color} fontFamily="Georgia, serif">E</text>
        <text x="8" y="68" fontSize="11" fontWeight="800" fill={color} fontFamily="Georgia, serif">R</text>
        {/* 星徽 */}
        <g transform="translate(36 30)">
          <circle r="11" fill={color} opacity="0.08" />
          <path d="M0 -8 L2.2 -2.4 L8.2 -2.4 L3.4 1.4 L5.2 7.4 L0 3.8 L-5.2 7.4 L-3.4 1.4 L-8.2 -2.4 L-2.2 -2.4 Z" fill={face.red ? "#d0342c" : "#3b4652"} />
        </g>
        <text x="26" y="62" fontSize="7" textAnchor="middle" fill={color} opacity="0.7">{face.red ? "大王" : "小王"}</text>
      </svg>
    );
  }
  const sg = suit?.glyph ?? "♠";
  return (
    <svg
      width={wid} height={hei} viewBox="0 0 52 76"
      className={`arena-pk ${onClick ? "is-click" : ""} ${picked ? "is-picked" : ""} ${dimmed ? "is-dim" : ""}`}
      onClick={onClick} style={{ display: "block" }}
    >
      <rect x="1" y="1" width="50" height="74" rx="6" fill="#fdfdfb" stroke="#c9c7bd" strokeWidth="1.5" />
      {/* 左上角标（rank+suit 竖排） */}
      <text x="6" y="17" fontSize="14" fontWeight="700" fill={color} fontFamily="Georgia, 'Times New Roman', serif">{face.rank}</text>
      <text x="6" y="30" fontSize="11" fill={color}>{sg}</text>
      {/* 右下倒置角标 */}
      <g transform="rotate(180 26 38)">
        <text x="6" y="17" fontSize="14" fontWeight="700" fill={color} fontFamily="Georgia, 'Times New Roman', serif">{face.rank}</text>
        <text x="6" y="30" fontSize="11" fill={color}>{sg}</text>
      </g>
      {/* 中央大花色 */}
      <text x="27" y="49" fontSize="30" textAnchor="middle" dominantBaseline="middle" fill={color}>{sg}</text>
    </svg>
  );
}

/* ================= 麻将 ================= */

const NUM_ZH = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
/** 筒（点阵）布局：与真实麻将点排布一致（0-1 相对坐标）。 */
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.5, 0.24], [0.5, 0.76]],
  3: [[0.24, 0.22], [0.5, 0.5], [0.76, 0.78]],
  4: [[0.3, 0.26], [0.7, 0.26], [0.3, 0.74], [0.7, 0.74]],
  5: [[0.27, 0.25], [0.73, 0.25], [0.5, 0.5], [0.27, 0.75], [0.73, 0.75]],
  6: [[0.3, 0.2], [0.7, 0.2], [0.3, 0.5], [0.7, 0.5], [0.3, 0.8], [0.7, 0.8]],
  7: [[0.22, 0.17], [0.5, 0.17], [0.78, 0.17], [0.3, 0.56], [0.7, 0.56], [0.3, 0.86], [0.7, 0.86]],
  8: [[0.3, 0.15], [0.7, 0.15], [0.3, 0.38], [0.7, 0.38], [0.3, 0.62], [0.7, 0.62], [0.3, 0.85], [0.7, 0.85]],
  9: [[0.24, 0.18], [0.5, 0.18], [0.76, 0.18], [0.24, 0.5], [0.5, 0.5], [0.76, 0.5], [0.24, 0.82], [0.5, 0.82], [0.76, 0.82]],
};
/** 索（竹条）布局。 */
const STICKS = PIPS;

/** 筒点配色：1筒大红金边、5筒中红、7筒上排红，其余蓝绿相间（真实筒牌观感）。 */
function pipColor(n, i) {
  if (n === 1) return { fill: "#c0392b", ring: "#e6b35a" };
  if (n === 5 && i === 2) return { fill: "#c0392b", ring: "#d98a4a" };
  if (n === 7 && i < 3) return { fill: "#c0392b", ring: "#d98a4a" };
  return i % 2 === 0 ? { fill: "#2b6cb0", ring: "#7fa8d9" } : { fill: "#1f8f4d", ring: "#7cc39a" };
}

/** 单张筒点 SVG 片段（cx,cy 半径按 n 大小自适应）。 */
function Dot({ cx, cy, n, color }) {
  const r = n === 1 ? 12 : 5.4;
  if (n === 1) {
    // 1筒：大花芯（多层环）
    return (
      <g>
        <circle cx={cx} cy={cy} r={r} fill={color.fill} />
        <circle cx={cx} cy={cy} r={r - 3} fill="none" stroke={color.ring} strokeWidth="1.6" />
        <circle cx={cx} cy={cy} r={r - 6} fill={color.ring} opacity="0.9" />
        <circle cx={cx} cy={cy} r={r - 9} fill="#fff" opacity="0.85" />
      </g>
    );
  }
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color.fill} />
      <circle cx={cx} cy={cy} r={r - 1.6} fill="none" stroke={color.ring} strokeWidth="1" opacity="0.9" />
      <circle cx={cx} cy={cy} r={1.4} fill="#fff" opacity="0.75" />
    </g>
  );
}

/** 单根竹条。 */
function Stick({ x, y }) {
  return (
    <g>
      <rect x={x - 3} y={y - 8} width="6" height="16" rx="2.6" fill="#1f8f4d" />
      <rect x={x - 3} y={y - 8} width="6" height="6" rx="2.6" fill="#35b56b" />
      <rect x={x - 1.2} y={y - 6} width="1.4" height="12" rx="0.7" fill="#c9f2d9" opacity="0.65" />
    </g>
  );
}

const MJ_W = 40;
const MJ_H = 56;
const MJ_SIZE = {
  sm: { w: 22, h: 31 },
  md: { w: 34, h: 48 },
  lg: { w: 44, h: 62 },
};

/** 麻将牌面（雀魂风）：象牙白牌体+底部厚度，万=汉字+紅萬，筒=点阵，索=竹条。 */
/** 字牌面（games2 推倒胡/日麻 136 张）：大字 + 传统配色。 */
const HONOR_FACE = {
  E: ["東", "#1e3a8a"], S: ["南", "#1f8f4d"], W: ["西", "#b03028"], N: ["北", "#1e3a8a"],
  C: ["中", "#c0392b"], F: ["發", "#1f8f4d"], B: ["白", "#57606f"],
};

export function MjTileFace({ t, size = "md", onClick, lack = false, drawn = false, glow = false, pop = false, dim = false, delay = 0 }) {
  const s = MJ_SIZE[size] ?? MJ_SIZE.md;
  const n = Number(t[0]);
  const suit = t[1];
  let body = null;
  if (t.length === 1 && HONOR_FACE[t]) {
    const [zh, color] = HONOR_FACE[t];
    body = (
      <g>
        <text x={MJ_W / 2} y={42} fontSize="30" fontWeight="700" textAnchor="middle" fill={color} fontFamily="'Songti SC','STSong',serif">{zh}</text>
        {t === "B" && <rect x={12} y={14} width={16} height={22} rx={2} fill="none" stroke="#57606f" strokeWidth={1.2} />}
      </g>
    );
  } else if (suit === "m") {
    body = (
      <g>
        <text x={MJ_W / 2} y={26} fontSize="24" fontWeight="700" textAnchor="middle" fill="#1e3a8a" fontFamily="'Songti SC','STSong',serif">{NUM_ZH[n]}</text>
        <text x={MJ_W / 2} y={48} fontSize="17" fontWeight="700" textAnchor="middle" fill="#c0392b" fontFamily="'Songti SC','STSong',serif">萬</text>
      </g>
    );
  } else if (suit === "p") {
    body = PIPS[n].map(([px, py], i) => {
      const c = pipColor(n, i);
      return <Dot key={i} cx={10 + px * 20} cy={8 + py * 40} n={n} color={c} />;
    });
  } else {
    body = n === 1
      ? (
        <g>
          <circle cx="20" cy="26" r="11" fill="#1f8f4d" />
          <circle cx="20" cy="26" r="7.5" fill="#e8f7ee" />
          <circle cx="17.5" cy="24" r="2.2" fill="#1d2129" />
          <path d="M20 18 q6 -4 9 1" stroke="#c0392b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <text x="20" y="49" fontSize="8" textAnchor="middle" fill="#1f8f4d" fontFamily="'Songti SC','STSong',serif">索</text>
        </g>
      )
      : STICKS[n].map(([px, py], i) => <Stick key={i} x={10 + px * 20} y={10 + py * 38} />);
  }
  return (
    <svg
      width={s.w} height={s.h} viewBox={`0 0 ${MJ_W} ${MJ_H + 4}`}
      className={`arena-mj ${lack ? "is-lack" : ""} ${dim ? "is-dim" : ""} ${onClick ? "is-click" : ""} ${drawn ? "is-drawn" : ""} ${glow ? "is-glow" : ""} ${pop ? "arena-anim-pop" : ""}`}
      onClick={onClick} style={{ display: "block", animationDelay: delay ? `${delay}ms` : undefined }}
      data-arena-mj-tile={t}
    >
      {/* 牌体：面 + 底厚度 */}
      <rect x="1.5" y="1.5" width={MJ_W - 3} height={MJ_H + 1} rx="5" fill="#b9ad91" opacity="0.55" />
      <rect x="1" y="0.5" width={MJ_W - 2} height={MJ_H - 1} rx="5" fill="#fdfcf5" stroke="#d8d2bd" strokeWidth="1" />
      <rect x="1" y="0.5" width={MJ_W - 2} height={MJ_H * 0.42} rx="5" fill="#ffffff" opacity="0.55" />
      {body}
    </svg>
  );
}

/** 迷你牌背（对手手牌/牌墙）。 */
export function MjBack({ size = "sm", tilt = false }) {
  const s = MJ_SIZE[size] ?? MJ_SIZE.sm;
  return (
    <svg width={s.w} height={s.h} viewBox={`0 0 ${MJ_W} ${MJ_H}`} style={{ display: "block", transform: tilt ? "rotate(90deg)" : undefined }}>
      <rect x="1.5" y="1.5" width={MJ_W - 3} height={MJ_H - 2} rx="4" fill="#8fa99f" />
      <rect x="1" y="0.5" width={MJ_W - 2} height={MJ_H - 3} rx="4" fill="#2f6e57" />
      <rect x="1" y="0.5" width={MJ_W - 2} height={MJ_H * 0.4} rx="4" fill="#3d8a6e" opacity="0.6" />
      <circle cx={MJ_W / 2} cy={MJ_H / 2} r="7" fill="none" stroke="#cfe8dd" strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}
