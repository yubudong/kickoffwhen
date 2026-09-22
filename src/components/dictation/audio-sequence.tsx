"use client";

import { useEffect, useRef, useState } from "react";
import type { ListeningSessionView } from "@/modules/dictation/child-view-types";
import { AudioPlayback, preloadAudio, type PlaybackState } from "./audio-playback";
import { SessionProgress } from "./session-progress";

export { playAudioToEnd, preloadAudio } from "./audio-playback";

export function AudioSequence({ session, pending, onPlayback }: {
  session: ListeningSessionView;
  pending: boolean;
  onPlayback: (itemId: string, sequenceFinished: boolean, expectedVersion: number) => Promise<boolean>;
}) {
  const [state, setState] = useState<PlaybackState | "preloading">("preloading");
  const [error, setError] = useState("");
  const [preloadAttempt, setPreloadAttempt] = useState(0);
  const [activeIndex, setActiveIndex] = useState(session.playedItemIds.length);
  const playback = useRef<AudioPlayback | null>(null);
  const save = useRef(onPlayback);
  useEffect(() => { save.current = onPlayback; }, [onPlayback]);
  const mediaSignature = session.items.map((item) => `${item.itemId}:${item.audioUrl}`).join("|");

  useEffect(() => {
    const controller = new AbortController();
    const audios = new Map(session.items.map((item) => {
      const audio = new Audio(item.audioUrl);
      audio.preload = "auto";
      return [item.itemId, audio] as const;
    }));
    const player = new AudioPlayback(audios, {
      state: (next) => {
        setState(next);
        if (next === "failed") setError("播放中断了，请检查网络后重试。");
      },
      index: setActiveIndex,
      save: (...args) => save.current(...args),
    }, activeIndex);
    playback.current = player;
    void Promise.all([...audios.values()].map((audio) => preloadAudio(audio, controller.signal))).then(
      () => { if (!controller.signal.aborted) setState("ready"); },
      () => {
        if (!controller.signal.aborted) {
          setState("failed");
          setError("音频还没准备好，请让家长准备音频后再试。");
        }
      },
    );
    return () => {
      controller.abort();
      player.dispose();
      for (const audio of audios.values()) {
        audio.pause();
        audio.removeAttribute("src");
      }
    };
  // Server version/prefix updates must not replace the currently playing element.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature, preloadAttempt]);

  const currentItem = session.items[activeIndex];
  const canReplay = currentItem && session.playedItemIds.includes(currentItem.itemId)
    && (state === "waiting" || state === "ready" || state === "paused");

  function retryPreload() {
    playback.current?.dispose();
    setState("preloading");
    setError("");
    setPreloadAttempt(value => value + 1);
  }

  return (
    <section aria-labelledby="listening-title" className="dictation-card">
      <p className="eyebrow">{session.roundNumber > 1 ? `再听一次，共 ${session.itemCount} 题` : "准备纸和笔"}</p>
      <h1 id="listening-title">听清楚，再写下来</h1>
      <SessionProgress current={Math.min(activeIndex + 1, session.itemCount)} roundNumber={session.roundNumber} total={session.itemCount} />
      <div className="dictation-cue" aria-live="polite">
        {currentItem?.pinyinText ? <p className="dictation-pinyin">{currentItem.pinyinText}</p> : null}
        {currentItem?.contextText ? <p>语境：{currentItem.contextText}</p> : null}
      </div>
      {state === "preloading" ? <p role="status">正在准备全部音频…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {session.allowManualReplay ? (
        <button className="dictation-replay" aria-label="重听当前词语" disabled={pending || !canReplay} onClick={() => void playback.current?.replay(session)} type="button">
          <span className="dictation-replay-icon" aria-hidden="true">▶</span>
          <span>重听当前词语</span>
        </button>
      ) : null}
      <div className="dictation-actions">
        {state === "ready" || state === "failed" ? (
          <button className="dictation-primary" disabled={pending || state !== "ready"} onClick={() => { setError(""); void playback.current?.start(session); }} type="button">
            {session.playedItemIds.length === 0 ? "开始听写" : "继续听写"}
          </button>
        ) : null}
        {state === "failed" ? <button onClick={retryPreload} type="button">重新准备</button> : null}
        {state === "playing" || state === "waiting" ? <button onClick={() => playback.current?.pause()} type="button">暂停</button> : null}
        {state === "paused" ? <button onClick={() => playback.current?.resume()} type="button">继续</button> : null}
      </div>
      <p className="answer-secret-note">答案会在全部听完后显示。</p>
    </section>
  );
}
