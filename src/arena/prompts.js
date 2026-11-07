/**
 * 竞技场出招提示词模板（games-llm-arena-plan §三/§五）：观察序列化原则 =
 * 着法/事件历史优先于棋盘图示、合法步清单显式附上、多人游戏附合作上下文
 * （viewFor 已按此产出观察文本，这里只做通用系统提示包装）。
 *
 * Q9 协议级既定：出招 schema 从第一天就是 {move, comment} 双通道——move 走
 * 裁判解析，comment 是模型思路/垃圾话，显示对局室弹幕区。
 *
 * 二期 Q10（2026-11-06 裁定）：思维链出招协议全局默认开——允许模型先输出
 * 若干行推理再落末行 JSON（研究实锤推理质量强烈影响棋力，Carlini 象棋/13
 * 模型实测）；think=false 保留一期严纪律裸 JSON 模式（弱模型续写补全链的
 * 黄金协议，opts 可切）。两模式解析侧见 players.parseMoveOutput。
 */

const JSON_LINE = '{"move":"<严格取自清单的动作串>","comment":"不超过 40 字的一句话结论或垃圾话"}';

export function systemPrompt(gameDef, { personality, think = true } = {}) {
  const base = [
    `你是「察元竞技场」的${gameDef.label}选手，与另一位 AI（或人类）对弈。`,
    "规则真值由裁判代码掌握：你只能从「可行动作」清单中严格选择一个作为 move；胜负判定与你无关。",
    "非法动作会被驳回并告知原因，连续三次非法将由裁判代走并计入代走次数（单局超过 5 次判负）。",
  ];
  if (think) {
    base.push(
      `出招协议（思维链模式）：先简明推理再落结论——推理形式不限（自由分析，或「分析：…/答案：…」两段式皆可），最后单独一行输出且仅输出一个 JSON 对象：${JSON_LINE}`,
      "纪律：JSON 必须是整个输出的最后一行——推理写在前、结论落在 JSON 里；JSON 之后不要再输出任何文字。裁判只解析最后一个合法 JSON。",
    );
  } else {
    base.push(
      `每一步必须只输出一个 JSON 对象：${JSON_LINE}`,
      // 2026-11-06 rambling 实锤（弱模型复述局面/分析坐标，全文无 JSON）：
      // 协议纪律写死——思考可以在 comment 里说，正文只许 JSON 本体。
      "输出纪律：第一个字符必须是 {，最后一个字符必须是 }。禁止输出分析过程、思考、解释、局面复述、坐标讨论等任何非 JSON 文本——那会被判「无法解析」，直接浪费你一手；思路请写进 comment。",
    );
  }
  if (personality) base.push(`你的棋手人设：${personality}`);
  return base.join("\n");
}

/** 重试回喂（Q2：回喂合法步清单 + 上次错误原因；think 模式口径随局）。 */
export function retryPrompt(lastOutput, reason, actions, { think = true } = {}) {
  const lines = [
    `你上一次的输出 ${JSON.stringify(String(lastOutput).slice(0, 200))} 不被接受：${reason}`,
    `可行动作清单（必须严格从中选一个）：${actions.slice(0, 80).join(" ")}${actions.length > 80 ? ` …（共 ${actions.length} 个）` : ""}`,
  ];
  if (String(reason).includes("无法解析")) {
    if (think) {
      // 思维链模式下「无法解析」多半是推理写嗨了 JSON 忘收尾（或被 max_tokens
      // 掐尾）——压缩推理保 JSON，而不是禁思考（思考正是棋力来源）
      lines.push(`你上一次的输出里没找到可解析的 JSON。把推理压缩到 5 行以内，确保最后单独一行以 { 开头、} 结尾输出：${JSON_LINE}`);
    } else {
      // 无 JSON 场景单独加压（2026-11-06 rambling 实锤）：泛泛的「重新输出」
      // 拉不回复述型模型，要明说「别分析、以 { 开头」
      lines.push(`你上一次完全没有输出 JSON。不要再分析局面、不要复述历史、不要讨论坐标，直接一行输出：${JSON_LINE}，以 { 开头、} 结尾。`);
    }
  } else {
    lines.push(`请重新${think ? "推理后以最后一行 JSON 收尾" : "只输出 JSON"}：${JSON_LINE}`);
  }
  return lines.join("\n");
}
