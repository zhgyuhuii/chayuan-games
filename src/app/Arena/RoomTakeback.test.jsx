// @vitest-environment jsdom
/**
 * 人机局「AI 接手 ↔ 人工接管」切换按钮（2026-11-07 用户裁定）：
 * 人工回合显示 🤖AI接手；AI 接手后（humanPlayer=null + aiTookOver）显示
 * 👉人工接管；点击回调触发；普通机机局两按钮皆不出现。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false }) }));
vi.stubGlobal('fetch', fetchMock);

import Room from './Room.jsx';
import { createGobangGame } from '../../arena/games/gobang.js';

const hpStub = {
  kind: 'human', name: '测试人类', pendingResolver: null,
  act: async () => ({ move: 'pass', comment: '' }),
  submit: () => {}, cancel: () => {}, undo: () => {},
};

function fakeRunning({ withHuman, tookOver }) {
  const game = createGobangGame({ seed: 1 });
  const players = withHuman ? [hpStub, { kind: 'llm', act: async () => ({ move: 'H8', comment: '' }) }] : [hpStub, hpStub];
  return {
    game, gameDef: { id: 'gobang', label: '五子棋' },
    players, playerMeta: [
      { seat: 0, id: 'human:me', label: '我', kind: 'human', cloud: false },
      { seat: 1, id: 'm/b', label: 'B', kind: 'llm', cloud: true },
    ],
    mode: 'human_vs_ai', anonymous: false, humanPlayer: withHuman ? hpStub : null,
    aiTookOver: tookOver ? 0 : null, think: true, abort: new AbortController(),
  };
}

async function render(el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { root, container };
}

describe('Room 接手/接管切换按钮', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockClear();
  });

  it('人工回合：显示 AI 接手，不显示人工接管', async () => {
    const onTakeback = vi.fn();
    const { container } = await render(
      <Room running={fakeRunning({ withHuman: true, tookOver: false })} finished={null} events={[]} tournament={null}
        onReplay={() => {}} onBackLobby={() => {}} commentator={null} onRematch={() => {}}
        onRequestTakeover={() => {}} onTakebackHuman={onTakeback} />,
    );
    expect(container.querySelector('[data-arena-takeover]')).toBeTruthy();
    expect(container.querySelector('[data-arena-takeback]')).toBeNull();
    expect(container.querySelector('[data-arena-resign]')).toBeTruthy();
  });

  it('AI 接手后：显示人工接管（认输/接手退场），点击触发回调', async () => {
    const onTakeback = vi.fn();
    const { container } = await render(
      <Room running={fakeRunning({ withHuman: false, tookOver: true })} finished={null} events={[]} tournament={null}
        onReplay={() => {}} onBackLobby={() => {}} commentator={null} onRematch={() => {}}
        onRequestTakeover={() => {}} onTakebackHuman={onTakeback} />,
    );
    expect(container.querySelector('[data-arena-takeover]')).toBeNull();
    expect(container.querySelector('[data-arena-resign]')).toBeNull();
    expect(container.querySelector('[data-arena-takeback]')).toBeTruthy();
    await act(async () => { container.querySelector('[data-arena-takeback]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onTakeback).toHaveBeenCalledTimes(1);
  });

  it('未接手的机机局：两按钮皆不出现', async () => {
    const { container } = await render(
      <Room running={fakeRunning({ withHuman: false, tookOver: false })} finished={null} events={[]} tournament={null}
        onReplay={() => {}} onBackLobby={() => {}} commentator={null} onRematch={() => {}}
        onRequestTakeover={() => {}} onTakebackHuman={() => {}} />,
    );
    expect(container.querySelector('[data-arena-takeover]')).toBeNull();
    expect(container.querySelector('[data-arena-takeback]')).toBeNull();
  });
});
