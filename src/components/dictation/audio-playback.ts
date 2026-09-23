import type { ListeningSessionView } from "@/modules/dictation/child-view-types";

export type PlaybackState = "ready" | "playing" | "waiting" | "paused" | "failed";

export function preloadAudio(audio: HTMLAudioElement, signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("AUDIO_ABORTED")); return; }
    if (audio.readyState >= 4) { resolve(); return; }
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("AUDIO_PRELOAD_FAILED")); };
    const aborted = () => { cleanup(); reject(new Error("AUDIO_ABORTED")); };
    const timer = globalThis.setTimeout(() => { cleanup(); reject(new Error("AUDIO_PRELOAD_TIMEOUT")); }, timeoutMs);
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      audio.removeEventListener("canplaythrough", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    audio.addEventListener("canplaythrough", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    audio.load();
  });
}

export function playAudioToEnd(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  // Azure has already synthesized the requested task speed into the media.
  audio.defaultPlaybackRate = 1;
  audio.playbackRate = 1;
  return new Promise((resolve, reject) => {
    const ended = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("AUDIO_PLAY_FAILED")); };
    const aborted = () => { audio.pause(); cleanup(); reject(new Error("AUDIO_ABORTED")); };
    const cleanup = () => {
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    audio.addEventListener("ended", ended, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    void audio.play().catch(failed);
  });
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { cleanup(); reject(new Error("AUDIO_ABORTED")); };
    const timer = globalThis.setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const cleanup = () => { globalThis.clearTimeout(timer); signal.removeEventListener("abort", aborted); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/** Owns one cancellable playback run. The server still owns completed/replay facts. */
export class AudioPlayback {
  private run: AbortController | null = null;
  private paused = false;
  private disposed = false;
  private state: PlaybackState = "ready";
  private previousState: PlaybackState = "playing";
  private playingAudio: HTMLAudioElement | null = null;

  constructor(
    private readonly audios: Map<string, HTMLAudioElement>,
    private readonly callbacks: {
      state: (state: PlaybackState) => void;
      index: (index: number) => void;
      save: (itemId: string, finished: boolean, version: number) => Promise<boolean>;
    },
    private activeIndex: number | null = null,
  ) {}

  private setState(state: PlaybackState) {
    this.state = state;
    this.callbacks.state(state);
  }

  private begin() {
    this.run?.abort();
    this.run = new AbortController();
    this.paused = false;
    this.playingAudio = null;
    this.setState("playing");
    return this.run;
  }

  private active(run: AbortController) {
    return !this.disposed && this.run === run && !run.signal.aborted;
  }

  private async unpaused(run: AbortController) {
    while (this.paused && this.active(run)) await delay(25, run.signal);
    if (!this.active(run)) throw new Error("AUDIO_ABORTED");
  }

  private async play(index: number, session: ListeningSessionView, run: AbortController) {
    await this.unpaused(run);
    if (!this.active(run)) return;
    const audio = this.audios.get(session.items[index]!.itemId);
    if (!audio) throw new Error("AUDIO_NOT_READY");
    this.activeIndex = index;
    this.callbacks.index(index);
    audio.currentTime = 0;
    this.playingAudio = audio;
    try {
      await playAudioToEnd(audio, run.signal);
    } finally {
      if (this.active(run)) this.playingAudio = null;
    }
    await this.unpaused(run);
  }

  async start(session: ListeningSessionView) {
    if (this.disposed) return;
    const run = this.begin();
    try {
      let version = session.version;
      for (let index = session.playedItemIds.length; index < session.items.length; index += 1) {
        for (let repeat = 0; repeat < session.repeatCount; repeat += 1) {
          await this.play(index, session, run);
        }
        await this.unpaused(run);
        if (!this.active(run)) return;
        const finished = session.mode === "item_by_item" || index === session.items.length - 1;
        const accepted = await this.callbacks.save(session.items[index]!.itemId, finished, version);
        if (!this.active(run)) return;
        if (!accepted || finished) { this.setState("ready"); return; }
        version += 1;
        if (this.paused) this.previousState = "waiting";
        else this.setState("waiting");
        let remaining = session.intervalSeconds * 1000;
        while (remaining > 0) {
          await this.unpaused(run);
          await delay(25, run.signal);
          if (!this.paused) remaining -= 25;
        }
        await this.unpaused(run);
        this.setState("playing");
      }
    } catch {
      if (this.active(run)) this.setState("failed");
    }
  }

  async replay(session: ListeningSessionView) {
    const index = this.activeIndex;
    const item = index === null ? undefined : session.items[index];
    if (this.disposed || !item || !session.playedItemIds.includes(item.itemId)) return;
    const run = this.begin();
    try {
      await this.play(index!, session, run);
      await this.unpaused(run);
      if (!this.active(run)) return;
      await this.callbacks.save(item.itemId, false, session.version);
      if (this.active(run)) this.setState("ready");
    } catch {
      if (this.active(run)) this.setState("failed");
    }
  }

  pause() {
    if (this.state !== "playing" && this.state !== "waiting") return;
    this.previousState = this.state;
    this.paused = true;
    this.playingAudio?.pause();
    this.setState("paused");
  }

  resume() {
    if (!this.paused || !this.run) return;
    const run = this.run;
    this.paused = false;
    this.setState(this.previousState);
    if (this.playingAudio && !this.playingAudio.ended) {
      void this.playingAudio.play().catch(() => {
        if (this.active(run)) {
          run.abort();
          this.setState("failed");
        }
      });
    }
  }

  dispose() {
    this.disposed = true;
    this.run?.abort();
    this.playingAudio = null;
  }
}
