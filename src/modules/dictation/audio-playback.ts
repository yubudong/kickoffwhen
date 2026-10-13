export function preloadAudio(
  audio: HTMLAudioElement,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error("AUDIO_ABORTED")); return; }
    if (audio.readyState >= 4) {
      resolve();
      return;
    }
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
    if (signal.aborted) { aborted(); return; }
    audio.load();
  });
}

export function playAudioToEnd(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  // The audio already contains the task's requested synthesis speed.
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

