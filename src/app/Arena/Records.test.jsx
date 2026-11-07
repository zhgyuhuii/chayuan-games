// @vitest-environment jsdom
/**
 * 对局记录：协议筛选（Q13 承诺落地）与棋谱导出（内容资产落盘出口）。
 * loader mock 三局：cot / bare / 无 protocol 旧局。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false }) }));
vi.stubGlobal('fetch', fetchMock);

const rec = (id, protocol, startedAt = Date.now()) => ({
  id, gameId: 'gobang', mode: 'ai_vs_ai', protocol, startedAt, endedAt: startedAt + 65_000,
  durationMs: 65_000, summary: `s-${id}`,
  players: [{ seat: 0, label: 'A', cloud: true }, { seat: 1, label: 'B', cloud: false }],
  stats: [{ subs: 1, calls: 9 }], events: [], snapshots: [],
});
const rows = [rec('r1', 'cot'), rec('r2', 'bare'), rec('r3', undefined)];
const loader = { loadRecords: vi.fn(async () => rows) };

import Records, { downloadJson } from './Records.jsx';

async function render(el) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { root, container };
}
const ids = (container) => [...container.querySelectorAll('[data-arena-record]')].map((el) => el.getAttribute('data-arena-record'));

describe('Records 协议筛选（Q13）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockClear();
    loader.loadRecords.mockClear();
  });

  it('默认全部：3 条（含无 protocol 旧局）', async () => {
    const { container } = await render(<Records loader={loader} onReplay={() => {}} />);
    expect(ids(container)).toEqual(['r1', 'r2', 'r3']);
  });
  it('点 💭CoT 只剩 cot 局；点裸 JSON 只剩 bare 局', async () => {
    const { container } = await render(<Records loader={loader} onReplay={() => {}} />);
    await act(async () => { container.querySelector('[data-arena-records-proto="cot"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(ids(container)).toEqual(['r1']);
    await act(async () => { container.querySelector('[data-arena-records-proto="bare"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(ids(container)).toEqual(['r2']);
    await act(async () => { container.querySelector('[data-arena-records-proto="all"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(ids(container)).toEqual(['r1', 'r2', 'r3']);
  });
  it('明棋教学档徽章（📖）随 gameOpts.revealAll 显示', async () => {
    const l3 = { loadRecords: async () => [{ ...rec('r7', 'bare'), gameOpts: { revealAll: true } }] };
    const { container } = await render(<Records loader={l3} onReplay={() => {}} />);
    expect(container.querySelector('[data-arena-record="r7"]').textContent).toContain('📖');
  });
  it('筛选空结果显示空态文案', async () => {
    const l2 = { loadRecords: async () => [rec('r9', 'bare')] };
    const { container } = await render(<Records loader={l2} onReplay={() => {}} />);
    await act(async () => { container.querySelector('[data-arena-records-proto="cot"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('[data-arena-records]')?.textContent).toContain('该协议下暂无对局');
  });
});

describe('Records 棋谱导出（内容资产出口）', () => {
  let clicks; let lastAnchor;
  beforeEach(() => {
    document.body.innerHTML = '';
    fetchMock.mockClear();
    clicks = 0; lastAnchor = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks += 1; lastAnchor = this; });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() }));
  });

  it('单局 ⬇：下载锚点文件名含 gameId+id，blob JSON 含记录', async () => {
    const { container } = await render(<Records loader={loader} onReplay={() => {}} />);
    await act(async () => { container.querySelector('[data-arena-records-export="r1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(clicks).toBe(1);
    expect(lastAnchor.download).toBe('arena-gobang-r1.json');
    expect(lastAnchor.href).toBe('blob:mock');
  });
  it('导出全部：当前筛选集整体一份 JSON', async () => {
    const { container } = await render(<Records loader={loader} onReplay={() => {}} />);
    await act(async () => { container.querySelector('[data-arena-records-exportall]').dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(clicks).toBe(1);
    expect(lastAnchor.download).toMatch(/^arena-records-\d{8}-\d{4}\.json$/);
  });
  it('downloadJson 纯函数：空数组也可导出（revoke 延迟回收）', () => {
    downloadJson([], 'x.json');
    expect(clicks).toBe(1);
    expect(lastAnchor.download).toBe('x.json');
  });
});
