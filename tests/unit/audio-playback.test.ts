import { afterEach, expect, test, vi } from "vitest";
import { AudioPlayback } from "@/components/dictation/audio-playback";
import type { ListeningSessionView } from "@/modules/dictation/child-view-types";

class AudioFixture extends EventTarget {
  ended = false;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  play = vi.fn(async () => { this.ended = false; });
  pause = vi.fn();
  end() { this.ended = true; this.dispatchEvent(new Event("ended")); }
}

function setup(repeatCount = 1) {
  vi.useFakeTimers();
  const audios = [new AudioFixture(), new AudioFixture()];
  const completed: Array<[string, boolean, number]> = [];
  const states: string[] = [];
  const indices: number[] = [];
  const session = { version: 0, mode: "continuous_batch", repeatCount, intervalSeconds: 2, speechRate: 1.25, playedItemIds: [], items: [{ itemId: "one" }, { itemId: "two" }] } as unknown as ListeningSessionView;
  const playback = new AudioPlayback(new Map([ ["one", audios[0] as unknown as HTMLAudioElement], ["two", audios[1] as unknown as HTMLAudioElement] ]), {
    state: s => states.push(s), index: i => indices.push(i),
    save: async (...args) => { completed.push(args); return true; },
  });
  return { audios, completed, states, indices, session, playback };
}
afterEach(() => vi.useRealTimers());
const flush = () => vi.advanceTimersByTimeAsync(0);

test("暂停播放恢复同一个音频，词间暂停不推进提示或新增完成记录", async () => {
  const f = setup();
  const run = f.playback.start(f.session);
  await flush();
  f.playback.pause();
  expect(f.audios[0]!.pause).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2500);
  expect(f.completed).toEqual([]);
  f.playback.resume();
  expect(f.audios[0]!.play).toHaveBeenCalledTimes(2);
  f.audios[0]!.end();
  await flush();
  expect(f.completed).toEqual([["one", false, 0]]);
  expect(f.indices).toEqual([0]);
  f.playback.pause();
  await vi.advanceTimersByTimeAsync(2500);
  expect(f.audios[1]!.play).not.toHaveBeenCalled();
  f.playback.resume();
  await vi.advanceTimersByTimeAsync(2050);
  expect(f.indices).toEqual([0, 1]);
  f.audios[1]!.end();
  await run;
  expect(f.completed).toEqual([["one", false, 0], ["two", true, 1]]);
});

test("已按任务语速合成的音频始终用正常倍率播放", async () => {
  const f = setup();
  const run = f.playback.start(f.session);
  await flush();
  expect(f.audios[0]!.playbackRate).toBe(1);
  expect(f.audios[0]!.defaultPlaybackRate).toBe(1);
  f.playback.dispose();
  await run;
});

test("暂停在重复轮次边界时不启动下一遍", async () => {
  const f = setup(2);
  const run = f.playback.start(f.session);
  await flush();
  f.audios[0]!.end();
  f.playback.pause();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.audios[0]!.play).toHaveBeenCalledTimes(1);
  expect(f.completed).toEqual([]);
  f.playback.resume();
  await vi.advanceTimersByTimeAsync(50);
  expect(f.audios[0]!.play).toHaveBeenCalledTimes(2);
  f.playback.dispose();
  await run;
});

test("重听中暂停继续仅保存一次replay，旧等待run不能继续下一词", async () => {
  const f = setup();
  const run = f.playback.start(f.session);
  await flush();
  f.audios[0]!.end();
  await flush();
  const replay = f.playback.replay({ ...f.session, version: 1, playedItemIds: ["one"] });
  await flush();
  f.playback.pause();
  await vi.advanceTimersByTimeAsync(3000);
  expect(f.completed).toEqual([["one", false, 0]]);
  f.playback.resume();
  f.audios[0]!.end();
  await replay;
  await run;
  expect(f.completed).toEqual([["one", false, 0], ["one", false, 1]]);
  expect(f.audios[1]!.play).not.toHaveBeenCalled();
  expect(f.indices).toEqual([0, 0]);
  expect(f.states.at(-1)).toBe("ready");
});

test("取消旧播放后其ended及play rejection不能保存或覆盖新run状态", async () => {
  const f = setup();
  let reject!: (e: Error) => void;
  f.audios[0]!.play.mockImplementationOnce(() => new Promise((_r, no) => { reject = no; }));
  const old = f.playback.start(f.session);
  await flush();
  const next = f.playback.start({ ...f.session, version: 1, playedItemIds: ["one"] });
  await flush();
  reject(new Error("late rejection"));
  f.audios[0]!.end();
  await flush();
  expect(f.completed).toEqual([]);
  expect(f.states.at(-1)).toBe("playing");
  f.playback.dispose();
  f.audios[1]!.end();
  await Promise.all([old, next]);
  expect(f.completed).toEqual([]);
});

test("重新预载后仍能重听已完成的当前词", async () => {
  const f = setup();
  f.playback.dispose();
  const player = new AudioPlayback(new Map([["one", f.audios[0] as unknown as HTMLAudioElement]]), {
    state: state => f.states.push(state), index: index => f.indices.push(index),
    save: async (...args) => { f.completed.push(args); return true; },
  }, 0);
  const replay = player.replay({ ...f.session, playedItemIds: ["one"], version: 1 });
  await flush();
  expect(f.audios[0]!.play).toHaveBeenCalledTimes(1);
  f.audios[0]!.end();
  await replay;
  expect(f.completed).toEqual([["one", false, 1]]);
});

test("ended回调与暂停继续同一帧发生时，不把结束的音频额外重放", async () => {
  const f = setup(2);
  const run = f.playback.start(f.session);
  await flush();
  f.audios[0]!.end();
  f.playback.pause();
  f.playback.resume();
  await flush();
  expect(f.audios[0]!.play).toHaveBeenCalledTimes(2);
  f.playback.dispose();
  await run;
});
