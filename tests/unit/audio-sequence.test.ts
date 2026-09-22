import { getEventListeners } from "node:events";
import { expect, test, vi } from "vitest";

import { playAudioToEnd, preloadAudio } from "@/components/dictation/audio-sequence";

class FakeAudio extends EventTarget {
  readyState = 0;
  load = vi.fn();
  pause = vi.fn();
  play = vi.fn<() => Promise<void>>(() => Promise.resolve());
}

test("preload在canplay缺失时超时且abort/unmount立即清理", async () => {
  vi.useFakeTimers();
  const audio = new FakeAudio();
  const controller = new AbortController();
  const timed = preloadAudio(audio as unknown as HTMLAudioElement, controller.signal, 100);
  const timedExpectation = expect(timed).rejects.toThrow("AUDIO_PRELOAD_TIMEOUT");
  await vi.advanceTimersByTimeAsync(100);
  await timedExpectation;

  const aborted = preloadAudio(audio as unknown as HTMLAudioElement, controller.signal, 5_000);
  controller.abort();
  await expect(aborted).rejects.toThrow("AUDIO_ABORTED");
  vi.useRealTimers();
});

test("play rejection变成可恢复错误且abort停止当前音频", async () => {
  const audio = new FakeAudio();
  audio.play.mockRejectedValueOnce(new Error("autoplay rejected"));
  await expect(playAudioToEnd(audio as unknown as HTMLAudioElement, new AbortController().signal))
    .rejects.toThrow("AUDIO_PLAY_FAILED");
  const controller = new AbortController();
  const pending = playAudioToEnd(audio as unknown as HTMLAudioElement, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("AUDIO_ABORTED");
  expect(getEventListeners(audio, "ended")).toEqual([]);
  expect(getEventListeners(audio, "error")).toEqual([]);
  expect(getEventListeners(controller.signal, "abort")).toEqual([]);
  expect(audio.pause).toHaveBeenCalledTimes(1);
  controller.abort();
  audio.dispatchEvent(new Event("ended"));
  expect(audio.pause).toHaveBeenCalledTimes(1);
});

test("已终止的预载即使已有缓存也拒绝，不留下事件监听", async () => {
  const audio = new FakeAudio();
  audio.readyState = 4;
  const controller = new AbortController();
  controller.abort();
  await expect(preloadAudio(audio as unknown as HTMLAudioElement, controller.signal)).rejects.toThrow("AUDIO_ABORTED");
  expect(audio.load).not.toHaveBeenCalled();
});
