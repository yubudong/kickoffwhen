import { expect, test, vi } from "vitest";
import { DictationAudioController } from "@/modules/dictation/audio-controller";
import type { ListeningSessionView } from "@/modules/dictation/child-view-types";

const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const session: ListeningSessionView = {
  sessionId: crypto.randomUUID(), taskId: crypto.randomUUID(), familyId: crypto.randomUUID(), childId: crypto.randomUUID(),
  phase: "listening", mode: "continuous_batch", gradingMode: "self", version: 0, roundNumber: 1, itemCount: 3,
  playedItemIds: [], intervalSeconds: 2, repeatCount: 1, speechRate: 1, allowManualReplay: true,
  items: ids.map((itemId, position) => ({ itemId, position, audioUrl: `/api/private-media/${crypto.randomUUID()}`, pinyinText: null, contextText: null })),
};
class AudioDouble extends EventTarget {
  currentTime = 0;
  ended = false;
  pauses = 0;
  pause() { this.pauses++; }
  constructor(private log: number[], private index: number) { super(); }
  async play() { this.ended = false; this.log.push(this.index); }
  end() { this.ended = true; this.dispatchEvent(new Event("ended")); }
}
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
type Callbacks = ConstructorParameters<typeof DictationAudioController>[2];
function fixture(overrides: Partial<Callbacks> = {}, options: Partial<ListeningSessionView> = {}) {
  const log: number[] = [];
  const audios = ids.map((_, index) => new AudioDouble(log, index));
  const commands: Array<{ id: string; version: number }> = [];
  const controller = new DictationAudioController({ ...session, ...options }, new Map(ids.map((id, index) => [id, audios[index] as unknown as HTMLAudioElement])), {
    onChange: () => undefined,
    onPlayback: async (id, _finished, version) => { commands.push({ id, version }); return true; },
    onRestart: async () => true,
    ...overrides,
  });
  return { controller, audios, log, commands };
}
test("播放第二个词时回听第一个词，停止原音轨，继续时重播被打断的第二词", async () => {
  vi.useFakeTimers();
  try {
    const { controller, audios, log, commands } = fixture();
    const run = controller.start();
    await flush(); audios[0].end(); await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(log).toEqual([0, 1]);
    const replay = controller.replayPrevious(); await flush();
    expect(log).toEqual([0, 1, 0]);
    audios[0].end(); await replay; await run;
    expect(commands).toEqual([{ id: ids[0], version: 0 }, { id: ids[0], version: 1 }]);
    const resumed = controller.start(); await flush();
    expect(log).toEqual([0, 1, 0, 1]);
    controller.dispose(); await resumed;
  } finally { vi.useRealTimers(); }
});

test("词间停顿和暂停保留刚听完词的提示，下一词实际播放时才推进", async () => {
  vi.useFakeTimers();
  try {
    const { controller, audios, log } = fixture();
    const run = controller.start(); await flush();
    audios[0].end(); await flush();
    expect(controller.snapshot).toMatchObject({ state: "waiting", index: 1, currentIndex: 0 });
    controller.pause();
    await vi.advanceTimersByTimeAsync(3000);
    expect(controller.snapshot).toMatchObject({ state: "paused", currentIndex: 0 });
    expect(log).toEqual([0]);
    controller.resume(); await vi.advanceTimersByTimeAsync(2050);
    expect(controller.snapshot).toMatchObject({ state: "playing", index: 1, currentIndex: 1 });
    controller.dispose(); await run;
  } finally { vi.useRealTimers(); }
});

test("重听已完成的当前词保留原入口，取消旧间隔且只保存一次回听", async () => {
  vi.useFakeTimers();
  try {
    const { controller, audios, log, commands } = fixture();
    const run = controller.start(); await flush(); audios[0].end(); await flush();
    const replay = controller.replayCurrent(); await flush();
    expect(log).toEqual([0, 0]);
    controller.pause(); await vi.advanceTimersByTimeAsync(3000);
    expect(commands).toEqual([{ id: ids[0], version: 0 }]);
    controller.resume(); audios[0].end(); await replay; await run;
    expect(commands).toEqual([{ id: ids[0], version: 0 }, { id: ids[0], version: 1 }]);
    expect(controller.snapshot).toMatchObject({ state: "ready", index: 1, currentIndex: 0 });
    expect(log).toEqual([0, 0, 0]);
    controller.dispose();
  } finally { vi.useRealTimers(); }
});

test("ended与暂停继续同一帧发生时不额外重放结束的音轨", async () => {
  const { controller, audios, log } = fixture({}, { repeatCount: 2 });
  const run = controller.start(); await flush();
  audios[0].end(); controller.pause(); controller.resume(); await flush();
  expect(log).toEqual([0, 0]);
  controller.dispose(); await run;
});

test("保存完成前发起回听会等待写入，再用更新后的版本保存", async () => {
  let accept!: (value: boolean) => void;
  const commands: Array<[string, boolean, number]> = [];
  const { controller, audios, log } = fixture({ onPlayback: (id, finished, version) => {
    commands.push([id, finished, version]);
    if (commands.length === 1) return new Promise(resolve => { accept = resolve; });
    return Promise.resolve(true);
  } });
  const run = controller.start(); await flush(); audios[0].end(); await flush();
  const replay = controller.replayPrevious(); await flush();
  expect(log).toEqual([0]);
  expect(commands).toEqual([[ids[0], false, 0]]);
  accept(true); await flush();
  expect(log).toEqual([0, 0]);
  audios[0].end(); await replay; await run;
  expect(commands).toEqual([[ids[0], false, 0], [ids[0], false, 1]]);
  controller.dispose();
});

test("回听音轨结束后若已暂停，继续前不保存回听", async () => {
  vi.useFakeTimers();
  try {
    const { controller, audios, commands } = fixture({}, { version: 1, playedItemIds: [ids[0]] });
    const replay = controller.replayPrevious(); await flush();
    audios[0].end(); controller.pause(); await flush();
    expect(commands).toEqual([]);
    controller.resume(); await vi.advanceTimersByTimeAsync(50); await replay;
    expect(commands).toEqual([{ id: ids[0], version: 1 }]);
    controller.dispose();
  } finally { vi.useRealTimers(); }
});

test("旧音轨继续播放的延迟拒绝不能中断重新开始后的新播放", async () => {
  const { controller, audios, commands } = fixture();
  const oldRun = controller.start(); await flush(); controller.pause();
  let rejectResume!: (error: Error) => void;
  audios[0].play = () => new Promise<void>((_resolve, reject) => { rejectResume = reject; });
  controller.resume();
  await controller.restart(); await oldRun;
  audios[0].play = async () => undefined;
  const newRun = controller.start(); await flush();
  rejectResume(new Error("late rejection")); await flush();
  expect(controller.snapshot).toMatchObject({ state: "playing", index: 0 });
  expect(commands).toEqual([]);
  controller.dispose(); await newRun;
});

test("当前词尚未听完时重听入口不能取消被暂停的音轨", async () => {
  const { controller, audios, log } = fixture();
  const run = controller.start(); await flush(); controller.pause();
  const pauses = audios[0].pauses;
  await controller.replayCurrent();
  expect(audios[0].pauses).toBe(pauses);
  controller.resume(); await flush();
  expect(log).toEqual([0, 0]);
  controller.dispose(); await run;
});

test("重新开始等待当前保存结束，用最新版本重置且不会自动播放", async () => {
  let accept!: (value: boolean) => void;
  const versions: number[] = [];
  const { controller, audios, log } = fixture({
    onPlayback: () => new Promise(resolve => { accept = resolve; }),
    onRestart: async version => { versions.push(version); return true; },
  });
  const run = controller.start(); await flush(); audios[0].end(); await flush();
  const restart = controller.restart(); await flush();
  expect(versions).toEqual([]);
  accept(true); await restart; await run;
  expect(versions).toEqual([1]);
  expect(controller.snapshot).toMatchObject({ state: "ready", index: 0, currentIndex: 0 });
  expect(log).toEqual([0]);
  controller.dispose();
});

test("更新的服务端进度停止旧音轨，过期同步不能倒退位置或版本", async () => {
  const { controller, audios, log, commands } = fixture();
  const oldRun = controller.start(); await flush();
  controller.sync({ ...session, version: 2, playedItemIds: [ids[0], ids[1]] });
  controller.sync({ ...session, version: 1, playedItemIds: [ids[0]] });
  audios[0].end(); await oldRun;
  expect(controller.snapshot).toMatchObject({ state: "ready", index: 2, currentIndex: 2 });
  const run = controller.start(); await flush();
  expect(log).toEqual([0, 2]);
  audios[2].end(); await run;
  expect(commands).toEqual([{ id: ids[2], version: 2 }]);
  controller.dispose();
});

test("重新准备音频后保留提示所在词，仍能重听已完成的当前词", async () => {
  const log: number[] = [];
  const audio = new AudioDouble(log, 0);
  const commands: Array<[string, boolean, number]> = [];
  const controller = new DictationAudioController({ ...session, version: 1, playedItemIds: [ids[0]] },
    new Map([[ids[0], audio as unknown as HTMLAudioElement]]), {
      onChange: () => undefined, onRestart: async () => true,
      onPlayback: async (...args) => { commands.push(args); return true; },
    }, 0);
  expect(controller.snapshot).toMatchObject({ index: 1, currentIndex: 0 });
  const replay = controller.replayCurrent(); await flush();
  expect(log).toEqual([0]);
  audio.end(); await replay;
  expect(commands).toEqual([[ids[0], false, 1]]);
  controller.dispose();
});
test("第一个词播放中重新开始会停止播放并回到准备页，等待孩子主动开始", async () => {
  const { controller, log, commands } = fixture();
  const run = controller.start(); await flush();
  await controller.restart(); await run;
  expect(controller.snapshot).toMatchObject({ state: "ready", index: 0 });
  expect(log).toEqual([0]);
  expect(commands).toEqual([]);
  const next = controller.start(); await flush();
  expect(log).toEqual([0, 0]);
  controller.dispose(); await next;
});

test("逐题从头听写时已批词只播放，未批词才请求批改", async () => {
  vi.useFakeTimers();
  try {
    const log: number[] = [];
    const audios = ids.map((_, index) => new AudioDouble(log, index));
    const finishes: boolean[] = [];
    const controller = new DictationAudioController({ ...session, mode: "item_by_item", markedItemIds: [ids[0]] },
      new Map(ids.map((id, index) => [id, audios[index] as unknown as HTMLAudioElement])), {
        onChange: () => undefined, onRestart: async () => true,
        onPlayback: async (_id, finished) => { finishes.push(finished); return true; },
      });
    const run = controller.start(); await flush(); audios[0].end(); await flush();
    expect(finishes).toEqual([false]);
    await vi.advanceTimersByTimeAsync(2000); audios[1].end(); await run;
    expect(finishes).toEqual([false, true]);
    expect(log).toEqual([0, 1]);
    controller.dispose();
  } finally { vi.useRealTimers(); }
});
