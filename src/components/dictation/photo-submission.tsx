"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { childSessionViewSchema, type ChildSessionView } from "@/modules/dictation/child-view-types";

export function PhotoSubmission({ session, onSession, onActivityChange }: {
  session: ChildSessionView;
  onSession: (session: ChildSessionView) => void;
  onActivityChange: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ commandId: string; version: number; round: number } | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    queueMicrotask(() => setPreviews(urls));
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || busy.current) return;
    busy.current = true; setPending(true); onActivityChange(true); setError("");
    retry.current ??= { commandId: crypto.randomUUID(), version: session.version, round: session.roundNumber };
    const form = new FormData();
    form.set("commandId", retry.current.commandId);
    form.set("expectedVersion", String(retry.current.version));
    form.set("roundNumber", String(retry.current.round));
    files.forEach(file => form.append("photos", file));
    try {
      const response = await fetch(`/api/child/dictation/${session.sessionId}/submission`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "提交失败，请重试。");
      onSession(childSessionViewSchema.parse(data.session));
    } catch (e) { setError(e instanceof Error ? e.message : "网络中断，请重试提交。"); }
    finally { busy.current = false; setPending(false); onActivityChange(false); }
  }
  return <section className="dictation-card" aria-labelledby="photo-title">
    <p className="eyebrow">提交给家长批改</p><h1 id="photo-title">拍下听写，交给家长</h1>
    <p>请按题号写好，拍清楚全部答案。每张不超过8MB，最多4张。</p>
    <form onSubmit={event => void submit(event)} className="stack">
      <label>听写照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={event => {
        const selected = [...(event.target.files ?? [])];
        if (selected.length > 4 || selected.some(file => file.size === 0 || file.size > 8 * 1024 * 1024)) {
          setError("请选择1至4张照片，每张不超过8MB。"); event.target.value = ""; setFiles([]); return;
        }
        setFiles(selected); retry.current = null; setError("");
      }} /></label>
      <div className="dictation-photo-grid">{previews.map((url, index) => <Image key={url} src={url} unoptimized width={400} height={300} alt={`听写照片预览 ${index + 1}`} />)}</div>
      {error ? <p role="alert">{error}</p> : null}
      <button className="dictation-primary" disabled={pending || !files.length} type="submit">{pending ? "正在提交…" : "提交给家长批改"}</button>
    </form>
  </section>;
}
