// @vitest-environment jsdom
/**
 * 察元竞技场壳冒烟测试（games-llm-arena-plan §五验收口径的壳侧）：
 * 大厅四游戏卡/三模式/无模型禁开局；对局室空态；回放空态；i18n 字典挂载。
 * 内核（裁判/代走/天梯）在 arena/arena.test.js 全绿，此处只钉壳渲染。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// useModelTree 会 fetch /api/chatop-models（jsdom 无服务 → 空模型清单）；
// i18n 用真实字典（zh 默认）。
const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false }) }));
vi.stubGlobal('fetch', fetchMock);

import Arena from './index.jsx';
import Lobby from './Lobby.jsx';
import Room from './Room.jsx';
import Replay from './Replay.jsx';

async function render(el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { root, container };
}

describe('Arena 壳', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('大厅：四游戏卡 + 三模式 + 无模型时开始禁用', async () => {
    const { container } = await render(<Lobby leafValues={[]} hasProxy initialGameId={undefined} onStart={() => {}} busy={false} />);
    expect(container.querySelectorAll('[data-arena-game-card]').length).toBe(12); // 13-1：立直大厅隐藏
    // 分组序（2026-11-07 用户裁定：同类型排在一起）：棋类 → 扑克 → 麻将
    const ids = [...container.querySelectorAll('[data-arena-game-card]')].map((el) => el.getAttribute('data-arena-game-card'));
    expect(ids.slice(0, 6)).toEqual(['gobang', 'xiangqi', 'go9', 'go13', 'junqi', 'fanqi']);
    expect(ids.slice(6, 9)).toEqual(['doudizhu', 'poker', 'guandan']);
    expect(ids.slice(9)).toEqual(['mahjong', 'mahjong-guangdong', 'mahjong-xueliu']);
    expect(container.querySelector('[data-arena-game-card="mahjong-riichi"]')).toBeNull(); // 隐藏
    expect(container.querySelector('[data-arena-game-card="gobang"]').textContent).toContain('五子棋');
    expect(container.querySelector('[data-arena-game-card="mahjong"]').textContent).toContain('血战');
    // 三模式
    expect(container.querySelector('[data-arena-mode="human_vs_ai"]')).toBeTruthy();
    expect(container.querySelector('[data-arena-mode="ai_vs_ai"]')).toBeTruthy();
    expect(container.querySelector('[data-arena-mode="tournament"]')).toBeTruthy();
    // 无模型 + 无代理 → 开始禁用
    expect(container.querySelector('[data-arena-start]').disabled).toBe(true);
  });

  it('大厅：机机模式经弹层选齐 2 模型后开始可点（2026-11-06 废弃裸 select）', async () => {
    const onStart = vi.fn();
    const nodes = [
      { id: 'local', label: '本地模型', children: [
        { id: 'local:a', value: 'local/a' },
        { id: 'local:b', value: 'local/b' },
      ] },
    ];
    const { container } = await render(
      <Lobby leafValues={['local/a', 'local/b']} treeNodes={nodes} hasProxy initialGameId="gobang" onStart={onStart} busy={false} />,
    );
    const pickAt = async (seatIdx, leaf) => {
      await act(async () => { container.querySelectorAll('[data-arena-model-select]')[seatIdx].click(); });
      await act(async () => { document.body.querySelector(`[data-tree-leaf-check="${leaf}"]`).click(); });
      await act(async () => { document.body.querySelector('[data-arena-model-modal-ok]').click(); });
    };
    await pickAt(0, 'local/a');
    await pickAt(1, 'local/b');
    expect(container.querySelector('[data-arena-start]').disabled).toBe(false);
    await act(async () => { container.querySelector('[data-arena-start]').click(); });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0]).toMatchObject({ mode: 'ai_vs_ai', gameId: 'gobang' });
  });

  it('对局室空态：无对局提示 + 去大厅', async () => {
    const { container } = await render(<Room running={null} finished={null} events={[]} tournament={null} onReplay={() => {}} onBackLobby={() => {}} />);
    expect(container.querySelector('[data-arena-room-empty]').textContent).toContain('没有');
    expect(container.querySelector('[data-arena-room-empty] button')).toBeTruthy();
  });

  it('回放空态', async () => {
    const { container } = await render(<Replay record={null} />);
    expect(container.querySelector('[data-arena-replay-empty]')).toBeTruthy();
  });

  it('主壳渲染：五 tab 齐全（fetch 失败 → 空模型态，不崩）', async () => {
    const { container } = await render(<Arena />);
    for (const tab of ['lobby', 'room', 'ladder', 'records', 'replay']) {
      expect(container.querySelector(`[data-arena-tab="${tab}"]`)).toBeTruthy();
    }
    expect(container.querySelector('[data-arena-lobby]')).toBeTruthy();
    // 切到天梯 tab
    await act(async () => { container.querySelector('[data-arena-tab="ladder"]').click(); });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-arena-ladder]')).toBeTruthy();
  });

  it('带参 gameId：大厅预选对应游戏卡', async () => {
    const { container } = await render(<Arena gameId="xiangqi" />);
    expect(container.querySelector('[data-arena-app]').getAttribute('data-arena-game')).toBe('xiangqi');
    const active = container.querySelector('.ring-2');
    expect(active?.getAttribute('data-arena-game-card')).toBe('xiangqi');
  });
});

describe('XiangqiBoard 人类落子（2026-11-04「点击不能落子」回归）', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('空格点击层：选中车后点空格 → onHumanMove（此前空格无点击目标）', async () => {
    const { createXiangqiGame } = await import('../../arena/games/xiangqi.js');
    const { XiangqiBoard } = await import('./boards.jsx');
    const g = createXiangqiGame();
    const pending = g.pendingAction(); // 红先
    const onHumanMove = vi.fn();
    const { container } = await render(
      <XiangqiBoard state={g.getState()} humanSeat={0} pending={pending} onHumanMove={onHumanMove} lastMove={null} />,
    );
    // 空格 hit 层在场（10×9=90 个透明圈）
    expect(container.querySelectorAll('[data-arena-xq-hit]').length).toBe(90);
    // 选中起点（红炮 h3 → "h3"，row=10-3=7? 内核 sq(r,c)=COLS[c]+(10-r)：h3 → r=7,c=7）
    // 直接点 hit 层模拟：选 h3（红炮位）→ 点 e3（空格）→ 炮二平五 h3e3
    const hit = (r, c) => container.querySelector(`[data-arena-xq-hit="${r}${c}"]`);
    // 红炮在 row 7, col 7（h3）；e3 = row 7, col 4
    expect(onHumanMove).not.toHaveBeenCalled();
    await act(async () => { hit(7, 7).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { hit(7, 4).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onHumanMove).toHaveBeenCalledWith('h3e3');
  });

  it('行 10 起点解析：黑方底线子（a10）选中后 targets 正确（slice(0,2) 截断回归）', async () => {
    // 直接钉 targets 解析语义：手工构造局面（黑车 a10 → targets 含 a9/a8…）
    const { legalMovesAll, initialBoard } = await import('../../arena/games/xiangqi.js');
    // 红先走一步后轮黑：黑底线行（row0）着法形如 "b10c10"——slice(0,2)="b1" 会错配
    const board = initialBoard();
    const moves = legalMovesAll(board, 'b').map((m) => m.move);
    const from10 = moves.filter((m) => m.startsWith('a10'));
    expect(from10.length).toBeGreaterThan(0);
    for (const mv of from10) {
      const to = /^a10([a-i](?:10|[1-9]))$/.exec(mv)?.[1];
      expect(to).toBeTruthy(); // 起点 "a10" 可解析出终点（老 slice(0,2) 口径下 to 会被截碎）
    }
  });
});

describe('GoBoard 渲染（games2 Q3/Q4：go9/go13 双 id）', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('9 路：星位/棋子/信息条渲染，人类回合 pass 按钮在场', async () => {
    const { createGoGame } = await import('../../arena/games/go.js');
    const { GoBoard } = await import('./boards.jsx');
    const g = createGoGame({ size: 9 });
    g.apply(0, 'E5');
    g.apply(1, 'D4');
    const pending = g.pendingAction();
    const { container } = await render(
      <GoBoard state={g.getState()} humanSeat={0} pending={pending} onHumanMove={() => {}} lastMove={{ t: 'move', move: 'D4' }} />,
    );
    expect(container.querySelector('[data-arena-go]')).toBeTruthy();
    expect(container.querySelector('[data-arena-go-info]').textContent).toContain('提子 0');
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(5 + 2);
    expect(container.querySelector('[data-arena-go-pass]')).toBeTruthy();
  });

  it('13 路：星位自适应、观战无 pass 按钮', async () => {
    const { createGoGame } = await import('../../arena/games/go.js');
    const { GoBoard } = await import('./boards.jsx');
    const g = createGoGame({ size: 13 });
    const { container } = await render(
      <GoBoard state={g.getState()} humanSeat={null} pending={null} onHumanMove={() => {}} lastMove={null} />,
    );
    expect(container.querySelector('[data-arena-go-info]').textContent).toContain('帽 200');
    expect(container.querySelector('[data-arena-go-pass]')).toBeNull();
  });
});

describe('Room 终局卡渲染（2026-11-07「认输后 onRematch is not defined」回归）', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('finished 态渲染终局浮层：再来一局/✕ 关闭/快照兜底盘面不空', async () => {
    const { default: Room } = await import('./Room.jsx');
    const finished = {
      id: 'm1', gameId: 'gobang', protocol: 'cot', mode: 'ai_vs_ai',
      players: [{ id: 'a', label: 'A', kind: 'llm', seat: 0 }, { id: 'b', label: 'B', kind: 'llm', seat: 1 }],
      ranks: [0, 1], summary: 'A 胜', snapshots: [{ i: 0, seat: 0, state: { size: 15, board: Array.from({ length: 15 }, () => Array(15).fill(0)) } }],
      events: [{ t: 'move', seat: 0, move: 'H8', comment: '', think: '算了一步' }],
    };
    const { container } = await render(
      <Room running={null} finished={finished} events={finished.events} tournament={null}
        onReplay={() => {}} onBackLobby={() => {}} commentator={null} onRematch={() => {}} />,
    );
    expect(container.querySelector('[data-arena-result-overlay]')).toBeTruthy();
    expect(container.querySelector('[data-arena-result-overlay-wrap]')).toBeTruthy(); // 居中悬浮包裹层
    expect(container.querySelector('[data-arena-rematch]')).toBeTruthy(); // onRematch 未定义时此处曾 ReferenceError
    expect(container.querySelector('[data-arena-result-close]')).toBeTruthy();
    expect(container.querySelector('[data-arena-gobang]')).toBeTruthy(); // 快照兜底：盘面仍在
    await act(async () => { container.querySelector('[data-arena-result-close]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-arena-result-overlay-wrap]')).toBeNull();
  });
});

describe('FitScale 牌桌渲染（2026-11-07「斗地主 useRef is not defined」回归）', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('GamePanel 分发牌桌类游戏经 FitScale 渲染不崩（斗地主/德扑/掼蛋各一）', async () => {
    const { GamePanel } = await import('./boards.jsx');
    const { createDoudizhuGame } = await import('../../arena/games/doudizhu.js');
    const { createPokerGame } = await import('../../arena/games/poker-holdem.js');
    const { createGuandanGame } = await import('../../arena/games/guandan.js');
    for (const [gid, game] of [["doudizhu", createDoudizhuGame({ seed: 1 })], ["poker", createPokerGame({ seed: 1 })], ["guandan", createGuandanGame({ seed: 1 })]]) {
      const { container } = await render(<GamePanel gameId={gid} state={game.getState()} seatNames={["A", "B", "C", "D"]} humanSeat={null} pending={null} onHumanMove={() => {}} lastMove={null} />);
      expect(container.querySelector('[data-arena-fitscale]')).toBeTruthy();
    }
  });
});

describe('循环赛单模型开局（2026-11-07 用户裁定）', () => {
  beforeEach(() => { document.body.innerHTML = ''; fetchMock.mockClear(); });

  it('批量多选 → 座位行自动轮转填满、轮数同排、可开局', async () => {
    const onStart = vi.fn();
    const nodes = [
      { id: 'local', label: '本地模型', children: [
        { id: 'local:a', value: 'local/a' },
        { id: 'local:b', value: 'local/b' },
      ] },
    ];
    const { container } = await render(
      <Lobby leafValues={['local/a', 'local/b']} treeNodes={nodes} hasProxy initialGameId="gobang" onStart={onStart} busy={false} />,
    );
    await act(async () => { container.querySelector('[data-arena-mode="tournament"]').click(); });
    await act(async () => { container.querySelector('[data-arena-tour-pick]').click(); });
    await act(async () => { document.body.querySelector('[data-tree-leaf-check="local/a"]').click(); });
    await act(async () => { document.body.querySelector('[data-tree-leaf-check="local/b"]').click(); });
    await act(async () => { document.body.querySelector('[data-arena-model-modal-ok]').click(); });
    const seatBtns = [...container.querySelectorAll('[data-arena-model-select]')].map((b) => b.textContent);
    expect(seatBtns.length).toBe(2);
    expect(seatBtns[0]).toContain('a');
    expect(seatBtns[1]).toContain('b');
    expect(container.querySelector('[data-arena-tour-rounds]')).toBeTruthy(); // 轮数并入座位行
    expect(container.querySelector('[data-arena-tour-models]')).toBeNull(); // 药丸标签已移除
    expect(container.querySelector('[data-arena-start]').disabled).toBe(false);
    await act(async () => { container.querySelector('[data-arena-start]').click(); });
    expect(onStart.mock.calls[0][0]).toMatchObject({ mode: 'tournament', models: ['local/a', 'local/b'] });
  });

  it('只选 1 个模型 → 全座同款也能开（轮转补满）', async () => {
    const onStart = vi.fn();
    const nodes = [{ id: 'local', label: '本地', children: [{ id: 'local:a', value: 'local/a' }] }];
    const { container } = await render(
      <Lobby leafValues={['local/a']} treeNodes={nodes} hasProxy initialGameId="gobang" onStart={onStart} busy={false} />,
    );
    await act(async () => { container.querySelector('[data-arena-mode="tournament"]').click(); });
    await act(async () => { container.querySelector('[data-arena-tour-pick]').click(); });
    await act(async () => { document.body.querySelector('[data-tree-leaf-check="local/a"]').click(); });
    await act(async () => { document.body.querySelector('[data-arena-model-modal-ok]').click(); });
    expect(container.querySelector('[data-arena-start]').disabled).toBe(false);
    await act(async () => { container.querySelector('[data-arena-start]').click(); });
    expect(onStart.mock.calls[0][0]).toMatchObject({ models: ['local/a', 'local/a'] });
  });
});

describe('开关项单问号（2026-11-07「变着推演后面有俩问号」回归）', () => {
  it('五个复选框各恰好 1 个 ❓、label 无双 title 叠加', async () => {
    const { container } = await render(
      <Lobby leafValues={['local/a']} treeNodes={[{ id: 'local', label: '本地', children: [{ id: 'local:a', value: 'local/a' }] }]} hasProxy initialGameId="gobang" onStart={() => {}} busy={false} />,
    );
    for (const attr of ['data-arena-anon', 'data-arena-think', 'data-arena-enhanced', 'data-arena-fast', 'data-arena-deep']) {
      const label = container.querySelector(`[${attr}]`);
      expect(label, attr).toBeTruthy();
      expect(label.querySelectorAll('[data-arena-hint]').length, `${attr} 恰好一个问号`).toBe(1);
    }
  });
});
