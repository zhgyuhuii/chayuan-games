/**
 * TrueSkill 天梯积分（games-llm-arena-plan Q7：一套算法贯穿 1v1（五子棋/
 * 象棋）、2v1 队伍（斗地主，队伍=联合高斯）、4 人名次（血战））。
 *
 * 自实现 ~150 行（方案 §二：算法有公开论文（Herbrich/Kraft/ Graepel 2006）
 * 无版权问题）。实现口径：团队=成员高斯之和；排名相邻组两两比较（平局组
 * 用 draw 更新）一轮近似（不做完整因子图迭代——天梯展示精度足够）；更新按
 * σ² 权重分摊回成员。选 TrueSkill 而非 Glicko-2 的原因见方案 §六（原生
 * 支持队伍与多人名次）。
 *
 * 默认参数：μ0=25 σ0=25/3 β=25/6 τ=25/300（微软 Xbox Live 官方值）。
 * 段位映射（conservative = μ - 1σ）：青铜<15 <白银<20 <黄金<25 <铂金<30
 * <钻石<35 <大师<40 ≤王者。
 */

export const MU0 = 25;
export const SIGMA0 = 25 / 3;
export const BETA = 25 / 6;
export const TAU = 25 / 300;

// ---- 标准正态工具（erf 近似，Abramowitz & Stegun 7.1.26）----
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
const pdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const cdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const ppf = (p) => { // Acklam 逆正态（draw margin 用，精度 1e-9 内）
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) return -ppf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

function vWin(x) { const denom = cdf(x); return denom < 1e-12 ? -x : pdf(x) / denom; }
function vDraw(x, eps) {
  const denom = cdf(eps - x) - cdf(-eps - x);
  if (denom < 1e-12) return -x;
  return (pdf(-eps - x) - pdf(eps - x)) / denom;
}

/**
 * 按名次更新一批选手。teams = [[rating,...],...]（同组=一队）；ranks 与
 * teams 等长（数值小 = 名次高，允许并列）。返回新的 teams（同结构）。
 */
export function rate(teams, ranks, { beta = BETA, drawProbability = 0.1 } = {}) {
  const n = teams.length;
  if (n < 2) return teams.map((t) => t.map((p) => ({ ...p })));
  // 团队联合高斯
  const mu = teams.map((t) => t.reduce((s, p) => s + p.mu, 0));
  const sig2 = teams.map((t) => t.reduce((s, p) => s + p.sigma * p.sigma, 0));
  const dMu = new Array(n).fill(0);
  const dSig2 = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i += 1) {
    const draw = ranks[i] === ranks[i + 1];
    const iWins = ranks[i] < ranks[i + 1]; // rank 数值小 = 名次高
    const c2 = 2 * beta * beta + sig2[i] + sig2[i + 1];
    const sqrtC = Math.sqrt(c2);
    const e = (mu[i] + dMu[i] - mu[i + 1] - dMu[i + 1]) / sqrtC;
    const eps = draw ? ppf((1 + drawProbability) / 2) * sqrtC : 0;
    // 胜负方向归一：一律按「i 赢」算 v/w，再按真实方向施加符号
    const eAdj = iWins || draw ? e : -e;
    const v = draw ? vDraw(e, eps / sqrtC) : vWin(eAdj);
    const w = v * (v + eAdj);
    const sign = draw ? 1 : (iWins ? 1 : -1);
    dMu[i] += sign * sig2[i] / sqrtC * v;
    dMu[i + 1] -= sign * sig2[i + 1] / sqrtC * v;
    dSig2[i] -= sig2[i] * sig2[i] / c2 * w;
    dSig2[i + 1] -= sig2[i + 1] * sig2[i + 1] / c2 * w;
  }
  // 分摊回成员（σ² 权重一阶近似）
  return teams.map((t, i) => {
    const totalSig2 = sig2[i];
    return t.map((p) => {
      const share = (p.sigma * p.sigma) / totalSig2;
      return {
        mu: p.mu + share * dMu[i],
        sigma: Math.sqrt(Math.max(p.sigma * p.sigma + share * share * dSig2[i], 0.1)),
      };
    });
  });
}

/** 动态不确定性回弹（防 σ 无限缩小僵化；每局后调）。 */
export const expose = (p) => p.mu - p.sigma; // 保守分（段位基准）
export function oneMatch(p, { tau = TAU } = {}) {
  return { mu: p.mu, sigma: Math.sqrt(p.sigma * p.sigma + tau * tau) };
}

export const TIERS = [
  { name: "青铜", min: -Infinity, color: "#a0856b" },
  { name: "白银", min: 15, color: "#9aa4ad" },
  { name: "黄金", min: 20, color: "#e0b04b" },
  { name: "铂金", min: 25, color: "#5ec8c0" },
  { name: "钻石", min: 30, color: "#6b9bef" },
  { name: "大师", min: 35, color: "#a06bef" },
  { name: "王者", min: 40, color: "#e05555" },
];
export function tierOf(player) {
  const r = expose(player);
  let cur = TIERS[0];
  for (const t of TIERS) if (r >= t.min) cur = t;
  return cur;
}

/** 新选手档案。 */
export const newPlayer = () => ({ mu: MU0, sigma: SIGMA0 });
