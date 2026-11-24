"use client";
import Image from "next/image";
import { EnglishAnswerSupport } from "./english-answer-support";
import { useRef, useState } from "react";
import type { ParentDictationReview } from "@/modules/dictation/grading-types";

export function ParentReviewBoard({ initialReviews }: { initialReviews: ParentDictationReview[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true); setError("");
    try {
      const response = await fetch("/api/parent/dictation-reviews", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "读取失败。");
      setReviews(data.reviews);
    } catch (e) { setError(e instanceof Error ? e.message : "网络中断，请重试。"); }
    finally { setRefreshing(false); }
  }
  return <section className="stack">
    <button className="dictation-switch" disabled={refreshing} onClick={() => void refresh()} type="button">{refreshing ? "正在刷新…" : "刷新待批听写"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {reviews.length === 0 ? <p>暂无待批听写。孩子提交照片后会显示在这里。</p> : null}
    {reviews.map(review => <ReviewCard key={`${review.sessionId}:${review.version}`} review={review} onSaved={() => setReviews(current => current.filter(item => item.sessionId !== review.sessionId))} />)}
  </section>;
}
function ReviewCard({ review, onSaved }: { review: ParentDictationReview; onSaved: () => void }) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retryLocked, setRetryLocked] = useState(false);
  const retry = useRef<{ serialized: string; commandId: string } | null>(null);
  const busy = useRef(false);
  const complete = review.items.every(item => typeof marks[item.itemId] === "boolean");
  async function submit() {
    if (!complete || busy.current) return;
    busy.current = true; setPending(true); setError("");
    const body = { sessionId: review.sessionId, expectedVersion: review.version, roundNumber: review.roundNumber,
      marks: review.items.map(item => ({ itemId: item.itemId, correct: marks[item.itemId] })) };
    const serialized = JSON.stringify(body);
    if (retry.current && retry.current.serialized !== serialized) { setError("请先重试保存刚才的批改结果。"); busy.current = false; setPending(false); return; }
    retry.current ??= { serialized, commandId: crypto.randomUUID() };
    setRetryLocked(true);
    try {
      const response = await fetch("/api/parent/dictation-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, commandId: retry.current.commandId }) });
      const data = await response.json();
      if (!response.ok) { retry.current = null; setRetryLocked(false); throw new Error(data.error ?? "保存失败，请重试。"); }
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "网络中断，请重试保存。"); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="dictation-review-card stack" aria-labelledby={`review-${review.sessionId}`}>
    <h2 id={`review-${review.sessionId}`}>{review.childName} · 第 {review.roundNumber} 轮听写</h2>
    <p>对照照片逐词标记；错词会回到孩子的听写任务中，首轮结果会保留。</p>
    <div className="dictation-review-layout"><div className="dictation-photo-grid">{review.photos.map((photo, index) => {
      const url = `/api/dictation-photos/${photo.id}`;
      return <a key={photo.id} href={url} target="_blank" rel="noreferrer"><Image src={url} unoptimized width={800} height={600} alt={`${review.childName}的听写照片 ${index + 1}`} /><span>打开原图查看</span></a>;
    })}</div>
    <div className="answer-list">{review.items.map(item => <fieldset key={item.itemId}>
      <legend>第 {item.position + 1} 题：<strong>{item.answerText}</strong></legend>{item.english && <EnglishAnswerSupport answer={item.answerText} details={item.english} disabled={pending || retryLocked} onSuggest={correct=>setMarks(current=>({...current,[item.itemId]:correct}))}/>}<div className="mark-actions">
        <button type="button" aria-pressed={marks[item.itemId] === true} className={marks[item.itemId] === true ? "selected-correct" : ""} disabled={pending || retryLocked} onClick={() => setMarks(current => ({ ...current, [item.itemId]: true }))}>正确</button>
        <button type="button" aria-pressed={marks[item.itemId] === false} className={marks[item.itemId] === false ? "selected-wrong" : ""} disabled={pending || retryLocked} onClick={() => setMarks(current => ({ ...current, [item.itemId]: false }))}>错了</button>
      </div></fieldset>)}</div></div>
    {error ? <p role="alert">{error}</p> : null}
    <button className="dictation-primary" disabled={!complete || pending} onClick={() => void submit()} type="button">{pending ? "正在保存…" : complete ? "保存逐词批改" : "请先标记全部词语"}</button>
  </section>;
}
