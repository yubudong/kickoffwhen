"use client";

import { useEffect, useRef, useState } from "react";
import type { ListeningSessionView } from "@/modules/dictation/child-view-types";
import { preloadAudio } from "@/modules/dictation/audio-playback";
import { DictationAudioController, type PlaybackView } from "@/modules/dictation/audio-controller";
import { SessionProgress } from "./session-progress";
export { playAudioToEnd, preloadAudio } from "@/modules/dictation/audio-playback";

export function AudioSequence({ session, pending, onPlayback, onRestart }: {
  session: ListeningSessionView;
  pending: boolean;
  onPlayback: (itemId: string, sequenceFinished: boolean, expectedVersion: number) => Promise<boolean>;
  onRestart: (expectedVersion: number) => Promise<boolean>;
}) {
  const [view, setView] = useState<PlaybackView>({ state: "ready", index: session.playedItemIds.length, currentIndex: session.playedItemIds.length });
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const controller = useRef<DictationAudioController | null>(null);
  const callbacks = useRef({ onPlayback, onRestart });
  const latestSession = useRef(session);
  const resumeAfterCancel = useRef(false);
  const restartButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const signature = session.items.map(item => `${item.itemId}:${item.audioUrl}`).join("|");
  useEffect(() => { callbacks.current = { onPlayback, onRestart }; }, [onPlayback, onRestart]);
  useEffect(() => { latestSession.current = session; controller.current?.sync(session); }, [session]);
  useEffect(() => {
    const abort = new AbortController();
    const audios = new Map(latestSession.current.items.map(item => [item.itemId, new Audio(item.audioUrl)]));
    for (const audio of audios.values()) audio.preload = "auto";
    const player = new DictationAudioController(latestSession.current, audios, {
      onChange: setView,
      onPlayback: (...args) => callbacks.current.onPlayback(...args),
      onRestart: (...args) => callbacks.current.onRestart(...args),
    }, controller.current?.snapshot.currentIndex);
    controller.current = player;
    void Promise.all([...audios.values()].map(audio => preloadAudio(audio, abort.signal))).then(() => {
      if (!abort.signal.aborted) { setLoading(false); setView(player.snapshot); }
    }, () => {
      if (!abort.signal.aborted) { setLoading(false); setView({ ...player.snapshot, state: "failed", error: "音频还没准备好，请重新准备后再试。" }); }
    });
    return () => {
      abort.abort(); player.dispose();
      for (const audio of audios.values()) { audio.pause(); audio.removeAttribute("src"); }
    };
  }, [signature, attempt]);

  useEffect(() => { const pause = () => controller.current?.pause(); window.addEventListener('offline',pause); return () => window.removeEventListener('offline',pause); }, []);
  useEffect(() => { if (confirmRestart) cancelButton.current?.focus(); }, [confirmRestart]);
  function requestRestart() {
    resumeAfterCancel.current = view.state === "playing" || view.state === "waiting";
    controller.current?.pause();
    setConfirmRestart(true);
  }
  function cancelRestart() {
    setConfirmRestart(false);
    if (resumeAfterCancel.current) controller.current?.resume();
    restartButton.current?.focus();
  }
  const ready = view.state === "ready" || view.state === "failed";
  const currentItem = session.items[view.currentIndex];
  const canReplayCurrent = currentItem && session.playedItemIds.includes(currentItem.itemId)
    && (view.state === "waiting" || view.state === "ready" || view.state === "paused");
  return <section aria-labelledby="listening-title" className="dictation-card">
    <p className="eyebrow">{session.roundNumber > 1 ? `再听一次，共 ${session.itemCount} 题` : "准备纸和笔"}</p>
    <h1 id="listening-title">听清楚，再写下来</h1>
    <SessionProgress current={Math.min(view.currentIndex + 1, session.itemCount)} roundNumber={session.roundNumber} total={session.itemCount} />
    <div className="dictation-cue" aria-live="polite">
      {currentItem?.writingHint && <p className="english-writing-hint">{currentItem.writingHint}</p>}
      {currentItem?.englishHints && <div className="english-listening-hints">
        {currentItem.englishHints.meaningZh && <p>释义：{currentItem.englishHints.meaningZh}</p>}
        {currentItem.englishHints.exampleWithBlank && <p lang="en">{currentItem.englishHints.exampleWithBlank}</p>}
        {currentItem.englishHints.exampleTranslation && <p>{currentItem.englishHints.exampleTranslation}</p>}
        {currentItem.englishHints.notice && <p>{currentItem.englishHints.notice}</p>}
      </div>}
      {currentItem?.pinyinText ? <p className="dictation-pinyin">{currentItem.pinyinText}</p> : null}
      {currentItem?.contextText ? <p>语境：{currentItem.contextText}</p> : null}
    </div>
    {session.allowManualReplay ? (
      <button className="dictation-replay" aria-label="重听当前词语" disabled={pending || loading || confirmRestart || !canReplayCurrent}
        onClick={() => void controller.current?.replayCurrent()} type="button">
        <span className="dictation-replay-icon" aria-hidden="true">▶</span>
        <span>重听当前词语</span>
      </button>
    ) : null}
    {loading ? <p role="status">正在准备全部音频…</p> : null}
    {view.error ? <p role="alert">{view.error}</p> : null}
    <div className="dictation-actions">
      {ready ? <button className="dictation-primary" disabled={pending || loading || confirmRestart || !!view.error} onClick={() => void controller.current?.start()} type="button">{view.index === 0 ? "开始听写" : "继续听写"}</button> : null}
      {view.state === "failed" ? <button disabled={pending} onClick={() => { setLoading(true); setAttempt(v => v + 1); }} type="button">重新准备</button> : null}
      {view.state === "playing" || view.state === "waiting" ? <button disabled={pending || confirmRestart} onClick={() => controller.current?.pause()} type="button">暂停</button> : null}
      {view.state === "paused" ? <button disabled={pending || confirmRestart} onClick={() => controller.current?.resume()} type="button">继续</button> : null}
      {session.allowManualReplay ? <button disabled={pending || loading || confirmRestart || view.index < 1} onClick={() => void controller.current?.replayPrevious()} type="button">回听上一个词</button> : null}
      <button ref={restartButton} disabled={pending || loading || confirmRestart} onClick={requestRestart} type="button">从头重新听写</button>
    </div>
    <p className="answer-secret-note">{session.gradingMode === "parent" ? "听完后拍照，提交给家长批改。" : "全部听完后，点一下查看答案并自己批改。"}</p>
    {confirmRestart ? <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="restart-title" onKeyDown={event => {
      if (event.key === "Escape" && !pending) cancelRestart();
      if (event.key === "Tab") {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        if (buttons.length && ((event.shiftKey && document.activeElement === buttons[0]) || (!event.shiftKey && document.activeElement === buttons.at(-1)))) {
          event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
        }
      }
    }}><section className="confirm-card"><h2 id="restart-title">从本轮第一个词重新开始？</h2><p>准备好纸和笔后，再点击“开始听写”。已有的批改记录会保留。</p><div className="dictation-actions"><button ref={cancelButton} disabled={pending} onClick={cancelRestart} type="button">取消</button><button disabled={pending} onClick={() => { void controller.current?.restart().then(() => { setConfirmRestart(false); restartButton.current?.focus(); }); }} type="button">确认重新开始</button></div></section></div> : null}
  </section>;
}
