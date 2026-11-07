// @vitest-environment jsdom
/**
 * JunqiBoard 自由布阵与复盘全亮（2026-11-07 军棋补全轮）：
 * 布阵态预填模板/两击交换/拖拽交换/违规即时标红+确认禁用/确认提交合法串/
 * replay 终局复盘全亮（对局中暗子不泄密）。坐标命中走 svgPoint（getBoundingClientRect
 * mock 成与 viewBox 同尺寸 → scale=1，格子中心 = (c*42, r*42) 客户端坐标）。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false }) }));
vi.stubGlobal('fetch', fetchMock);

import { JunqiBoard } from './boards.jsx';
import { templateSetup } from '../../arena/games/junqi.js';

const CELL = 42;
const tpl = templateSetup(0, 0); // 固定模板（seat 0）：D12 军旗、A12..E12 后排含雷

function setupPending() {
  return { seat: 0, kind: 'setup', actions: [`setup:${tpl}`] };
}

async function render(el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { root, container };
}

/** svg 内 draft 格子的 <g> 列表（顺序 = setupCells(0) 索引序）。 */
function draftGs(container) {
  return [...container.querySelectorAll('[data-arena-junqi] svg g')];
}

/** 格子中心客户端坐标（rect mock：left/top=0，scale=1）。 */
const cellXY = (i) => {
  const cells = [];
  for (const r of [6, 7, 8, 9, 10, 11]) for (let c = 0; c < 5; c += 1) {
    if ([[10, 1], [10, 3], [9, 2], [8, 1], [8, 3]].some(([a, b]) => a === r && b === c)) continue;
    cells.push([r, c]);
  }
  const [r, c] = cells[i];
  return { clientX: c * CELL, clientY: r * CELL };
};

const clickAt = (el, x, y) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const ptr = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

describe('JunqiBoard 自由布阵', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockClear();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 208, bottom: 502, width: 208, height: 502, x: 0, y: 0,
    });
  });

  it('布阵态：预填模板 25 子、确认可用、违规提示为绿', async () => {
    const { container } = await render(
      <JunqiBoard state={null} humanSeat={0} pending={setupPending()} onHumanMove={() => {}} />,
    );
    const gs = draftGs(container);
    expect(gs.length).toBe(25);
    expect(gs.map((g) => g.textContent).join(',')).toBe(tpl);
    expect(container.querySelector('[data-arena-jq-confirm]').disabled).toBe(false);
    expect(container.querySelector('[data-arena-jq-setupok]')).toBeTruthy();
  });

  it('两击交换：A7↔D12 后军旗违规（红标+确认禁用），再换回来恢复', async () => {
    const onHumanMove = vi.fn();
    const { container } = await render(
      <JunqiBoard state={null} humanSeat={0} pending={setupPending()} onHumanMove={onHumanMove} />,
    );
    const svg = container.querySelector('svg');
    const a = cellXY(0);  // A7
    const d = cellXY(23); // D12（模板 0 军旗位）
    await act(async () => { clickAt(svg, a.clientX, a.clientY); });
    await act(async () => { clickAt(svg, d.clientX, d.clientY); });
    const names = draftGs(container).map((g) => g.textContent);
    expect(names[0]).toBe('军旗'); // A7 现在是军旗
    expect(names[23]).toBe('排长'); // D12 换来了原 A7 的排长
    expect(container.querySelector('[data-arena-jq-setupbad]')).toBeTruthy(); // 违规红标
    expect(container.querySelector('[data-arena-jq-confirm]').disabled).toBe(true);
    await act(async () => { onHumanMove.mock; }); // no-op 分隔
    // 换回来：D12 选中 → A7 落
    await act(async () => { clickAt(svg, d.clientX, d.clientY); });
    await act(async () => { clickAt(svg, a.clientX, a.clientY); });
    expect(draftGs(container).map((g) => g.textContent).join(',')).toBe(tpl);
    expect(container.querySelector('[data-arena-jq-confirm]').disabled).toBe(false);
  });

  it('拖拽交换：按住 A7 拖到 A8 松手即互换，且吞掉紧跟 click（不回弹）', async () => {
    const { container } = await render(
      <JunqiBoard state={null} humanSeat={0} pending={setupPending()} onHumanMove={() => {}} />,
    );
    const svg = container.querySelector('svg');
    const a = cellXY(0), b = cellXY(5); // A7 / A8
    const before = draftGs(container).map((g) => g.textContent);
    await act(async () => { ptr(svg, 'pointerdown', a.clientX, a.clientY); }); // 真实时序：down/move/up 分帧到达，状态逐帧提交
    await act(async () => { ptr(svg, 'pointermove', b.clientX, b.clientY); });
    await act(async () => { ptr(svg, 'pointerup', b.clientX, b.clientY); });
    const after = draftGs(container).map((g) => g.textContent);
    expect(after[0]).toBe(before[5]);
    expect(after[5]).toBe(before[0]);
    // pointerup 后浏览器还会派发 click：必须被抑制（否则换过去又换回来）
    await act(async () => { clickAt(svg, b.clientX, b.clientY); });
    expect(draftGs(container).map((g) => g.textContent)[5]).toBe(before[0]);
  });

  it('确认布阵：合法草稿提交 setup: 串（25 项、与模板同多重集）', async () => {
    const onHumanMove = vi.fn();
    const { container } = await render(
      <JunqiBoard state={null} humanSeat={0} pending={setupPending()} onHumanMove={onHumanMove} />,
    );
    const confirm = container.querySelector('[data-arena-jq-confirm]');
    await act(async () => { confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onHumanMove).toHaveBeenCalledTimes(1);
    const sent = onHumanMove.mock.calls[0][0];
    expect(sent.startsWith('setup:')).toBe(true);
    const list = sent.slice(6).split(',');
    expect(list.length).toBe(25);
    expect([...list].sort().join(',')).toBe([...tpl.split(',')].sort().join(','));
  });

  it('重抽模板：草稿仍是合法 25 子、确认可用', async () => {
    const { container } = await render(
      <JunqiBoard state={null} humanSeat={0} pending={setupPending()} onHumanMove={() => {}} />,
    );
    const btn = container.querySelector('[data-arena-jq-redraw]');
    for (let k = 0; k < 6; k += 1) { // 多抽几次覆盖 4 选 1 随机
      await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      const names = draftGs(container).map((g) => g.textContent);
      expect(names.length).toBe(25);
      expect(names.filter((x) => x === '军旗').length).toBe(1);
      expect(container.querySelector('[data-arena-jq-confirm]').disabled).toBe(false);
    }
  });
});

describe('JunqiBoard 复盘全亮', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockClear();
  });

  const state = {
    board: [
      Array.from({ length: 5 }, () => null),
      Array.from({ length: 5 }, () => null),
      Array.from({ length: 5 }, (_, c) => (c === 2 ? { side: 1, type: '司令', revealed: false } : null)),
    ],
  };
  const texts = (container) => [...container.querySelectorAll('[data-arena-junqi] svg text')].map((t) => t.textContent).join('|');

  it('对局中（无 replay）：对方暗子显示「暗」不泄密', async () => {
    const { container } = await render(
      <JunqiBoard state={state} humanSeat={0} pending={null} onHumanMove={() => {}} />,
    );
    expect(texts(container)).toContain('暗');
    expect(texts(container)).not.toContain('司令');
  });

  it('replay（终局复盘/回放）：全亮显示真实身份', async () => {
    const { container } = await render(
      <JunqiBoard state={state} humanSeat={null} pending={null} onHumanMove={() => {}} replay />,
    );
    expect(texts(container)).toContain('司令');
    expect(texts(container)).not.toContain('暗');
  });
});
