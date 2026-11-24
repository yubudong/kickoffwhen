import type { ListeningSessionView } from "./child-view-types";
import { playAudioToEnd } from "./audio-playback";

export type PlaybackView = {
  state: "ready" | "playing" | "waiting" | "paused" | "failed";
  index: number;
  currentIndex: number;
  error?: string;
};
type Callbacks = {
  onChange: (view: PlaybackView) => void;
  onPlayback: (id: string, finished: boolean, version: number) => Promise<boolean>;
  onRestart: (version: number) => Promise<boolean>;
};
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}

// Owns one audio run at a time. A control action cancels sound/timers, then
// waits for any server write before issuing a command with the next version.
export class DictationAudioController {
  snapshot: PlaybackView;
  private abort = new AbortController();
  private version: number;
  private played: string[];
  private recording: Promise<boolean> | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioSignal: AbortSignal | null = null;
  private paused = false;
  private beforePause: PlaybackView["state"] = "playing";
  private disposed = false;
  private controlling = false;

  constructor(
    private session: ListeningSessionView,
    private audios: Map<string, HTMLAudioElement>,
    private callbacks: Callbacks,
    currentIndex = session.playedItemIds.length,
  ) {
    this.version = session.version;
    this.played = [...session.playedItemIds];
    this.snapshot = { state: "ready", index: this.played.length, currentIndex };
  }
  sync(session: ListeningSessionView) {
    if (session.version < this.version) return;
    if (session.version > this.version && !this.recording) {
      this.abort.abort();
      this.currentAudio?.pause();
      this.change("ready", session.playedItemIds.length, undefined, session.playedItemIds.length);
    }
    this.session = session;
    this.version = session.version;
    this.played = [...session.playedItemIds];
  }
  private change(state: PlaybackView["state"], index = this.snapshot.index, error?: string, currentIndex = this.snapshot.currentIndex) {
    this.snapshot = { state, index, currentIndex, error };
    if (!this.disposed) this.callbacks.onChange(this.snapshot);
  }
  private async stop() {
    this.abort.abort();
    this.currentAudio?.pause();
    this.paused = false;
    await this.recording;
    this.abort = new AbortController();
  }
  private async record(id: string, finished: boolean) {
    const version = this.version;
    const operation = this.callbacks.onPlayback(id, finished, version);
    this.recording = operation;
    try {
      const accepted = await operation;
      if (accepted) {
        this.version = Math.max(this.version, version + 1);
        if (!this.played.includes(id)) this.played.push(id);
      }
      return accepted;
    } finally { if (this.recording === operation) this.recording = null; }
  }
  private async play(index: number, signal: AbortSignal) {
    const audio = this.audios.get(this.session.items[index]!.itemId)!;
    this.currentAudio = audio;
    this.currentAudioSignal = signal;
    audio.currentTime = 0;
    try {
      await playAudioToEnd(audio, signal);
    } finally {
      if (this.currentAudioSignal === signal) {
        this.currentAudio = null;
        this.currentAudioSignal = null;
      }
    }
  }
  private async waitWhilePaused(signal: AbortSignal) {
    while (this.paused && !signal.aborted) await delay(50, signal);
  }
  async start() {
    if (this.controlling || this.disposed) return;
    this.controlling = true;
    await this.stop();
    this.controlling = false;
    if (this.disposed) return;
    const signal = this.abort.signal;
    try {
      for (let index = this.played.length; index < this.session.items.length; index++) {
        if (signal.aborted || this.disposed) return;
        this.change("playing", index, undefined, index);
        for (let repeat = 0; repeat < this.session.repeatCount; repeat++) {
          await this.waitWhilePaused(signal);
          if (signal.aborted) return;
          await this.play(index, signal);
        }
        await this.waitWhilePaused(signal);
        if (signal.aborted) return;
        const finished = this.session.mode === "item_by_item"
          ? !this.session.markedItemIds?.includes(this.session.items[index]!.itemId)
          : index === this.session.items.length - 1;
        this.change("waiting", index + 1);
        if (!await this.record(this.session.items[index]!.itemId, finished)) {
          if (!signal.aborted) this.change("ready", this.played.length);
          return;
        }
        if (finished || signal.aborted || this.disposed) return;
        let remaining = this.session.intervalSeconds * 1000;
        while (remaining > 0 && !signal.aborted) {
          await delay(50, signal);
          if (!this.paused) remaining -= 50;
        }
      }
    } catch {
      if (!signal.aborted) this.change("failed", this.played.length, "播放中断了，请检查网络后重试。");
    }
  }
  async replayPrevious() {
    if (this.controlling || this.disposed || !this.session.allowManualReplay || this.snapshot.index < 1) return;
    await this.replay(this.snapshot.index - 1);
  }
  async replayCurrent() {
    if (this.controlling || this.disposed || !this.session.allowManualReplay) return;
    if (!["waiting", "ready", "paused"].includes(this.snapshot.state)) return;
    if (!this.played.includes(this.session.items[this.snapshot.currentIndex]?.itemId)) return;
    await this.replay(this.snapshot.currentIndex);
  }
  private async replay(target: number) {
    this.controlling = true;
    await this.stop();
    this.controlling = false;
    if (this.disposed || !this.played.includes(this.session.items[target]?.itemId)) return;
    const signal = this.abort.signal;
    this.change("playing", target, undefined, target);
    try {
      await this.play(target, signal);
      await this.waitWhilePaused(signal);
      if (signal.aborted) return;
      await this.record(this.session.items[target]!.itemId, false);
      if (!signal.aborted) this.change("ready", this.played.length);
    } catch {
      if (!signal.aborted) this.change("failed", this.played.length, "回听失败，请重试。");
    }
  }
  async restart() {
    if (this.controlling || this.disposed) return;
    this.controlling = true;
    try {
      await this.stop();
      if (this.disposed) return;
      const version = this.version;
      if (await this.callbacks.onRestart(version)) {
        this.version = Math.max(this.version, version + 1);
        this.played = [];
      }
      this.change("ready", this.played.length, undefined, this.played.length);
    } finally { this.controlling = false; }
  }
  pause() {
    if (this.snapshot.state !== "playing" && this.snapshot.state !== "waiting") return;
    this.beforePause = this.snapshot.state;
    this.paused = true;
    if (this.beforePause === "playing") this.currentAudio?.pause();
    this.change("paused");
  }
  resume() {
    if (this.snapshot.state !== "paused") return;
    const run = this.abort;
    this.paused = false;
    this.change(this.beforePause);
    if (this.beforePause === "playing" && this.currentAudio && !this.currentAudio.ended) void this.currentAudio.play().catch(() => {
      if (run !== this.abort || run.signal.aborted || this.disposed) return;
      run.abort();
      this.change("failed", this.played.length, "播放中断了，请重试。");
    });
  }
  dispose() { this.disposed = true; this.abort.abort(); this.currentAudio?.pause(); }
}
