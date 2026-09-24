"use client";

import { useRef, useState, type FormEvent } from "react";

type TodoSubmission = { id: string; date: string; number: number };

export function DictationEvidenceSubmit({ todo, onSubmitted, disabled = false }: {
  todo: TodoSubmission;
  onSubmitted?: () => void;
  disabled?: boolean;
}) {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || disabled) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const formData = new FormData(event.currentTarget);
      formData.set("id", todo.id);
      formData.set("date", todo.date);
      formData.set("number", String(todo.number));
      const response = await fetch("/api/child/todos", { method: "POST", body: formData });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error ?? "提交失败，请重试。");
      }
      onSubmitted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "提交失败，请重试。");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form className="dictation-evidence-submit" onSubmit={submit}>
      <label>上传照片（可选）
        <input name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={pending || disabled} />
      </label>
      <p>可以拍下听写纸，也可以不上传照片直接提交。</p>
      <button className="dictation-primary" type="submit" disabled={pending || disabled}>
        {pending ? "正在提交…" : "提交家长审核"}
      </button>
      {error ? <p className="dictation-evidence-error" role="alert" aria-live="assertive">{error}</p> : null}
    </form>
  );
}
