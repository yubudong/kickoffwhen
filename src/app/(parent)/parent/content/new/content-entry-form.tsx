"use client";

import { type FormEvent, useState } from "react";

type EntryMode = "single" | "bulk" | "ocr" | "builtin";
type OcrDraftLine = {
  id: string;
  sourceText: string;
  answerText: string;
  broadcastText: string;
  hintText: string;
  selected: boolean;
};
type OcrProgress = { draftId: string; jobId: string };

const entries: Array<{ mode: EntryMode; title: string; description: string }> = [
  { mode: "single", title: "单条输入", description: "为一个易错词或听写点单独录入答案与朗读文本。" },
  { mode: "bulk", title: "批量粘贴", description: "每行一条，系统会去掉空行和重复项。" },
  { mode: "ocr", title: "拍照识别", description: "上传后需要家长确认，并逐项检查；未选项不会生成卡片。" },
  { mode: "builtin", title: "内置教材", description: "已建立五年级上册教材容器，待核对教材资料后再填充。" },
];

export function ContentEntryForm({
  initialMode = "single",
  initialOcrProgress = null,
}: {
  initialMode?: EntryMode;
  initialOcrProgress?: OcrProgress | null;
} = {}) {
  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [draftId, setDraftId] = useState("");
  const [ocrLines, setOcrLines] = useState<OcrDraftLine[]>([]);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(initialOcrProgress);

  async function loadOcrDraft(createdDraftId: string, jobId: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(
        `/api/parent/content/ocr?draftId=${encodeURIComponent(createdDraftId)}&jobId=${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("OCR_STATUS_FAILED");
      const data = (await response.json()) as {
        status: "provider_disabled" | "queued" | "running" | "ready" | "empty" | "failed" | "finalized";
        lines: Array<{ id: string; sourceText: string }>;
      };
      if (data.status === "provider_disabled") {
        setMessage("OCR 服务尚未配置，当前不会调用外部识别服务。");
        return;
      }
      if (data.status === "failed") {
        setMessage("这次识别失败，未生成任何学习卡片。");
        return;
      }
      if (data.status === "finalized") {
        setOcrProgress(null);
        setOcrLines([]);
        setMessage("这份识别草稿已完成确认，不会重复生成卡片。");
        return;
      }
      if (data.status === "empty") {
        setOcrProgress(null);
        setOcrLines([]);
        setMessage("未识别到可用文字，这次不会生成学习卡片。");
        return;
      }
      if (data.status === "ready") {
        setDraftId(createdDraftId);
        setOcrLines(data.lines.map((line) => ({
          id: line.id,
          sourceText: line.sourceText,
          answerText: line.sourceText,
          broadcastText: line.sourceText,
          hintText: "",
          selected: true,
        })));
        setMessage("识别完成，请逐项检查后确认。");
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    setMessage("识别仍在排队，请稍后再试。");
  }

  async function resumeOcr() {
    if (!ocrProgress) return;
    setPending(true);
    setMessage("");
    try {
      await loadOcrDraft(ocrProgress.draftId, ocrProgress.jobId);
    } catch {
      setMessage("无法读取识别进度，可稍后使用原任务继续查看。");
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "builtin") return;
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const subject = String(form.get("subject"));
    if (mode === "ocr") {
      try {
        const response = await fetch("/api/parent/content/ocr", {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setMessage(data?.error === "OCR_PROVIDER_DISABLED"
            ? "OCR 服务尚未配置，图片未上传，也不会调用外部服务。"
            : "图片未能上传，请确认为 10MB 以内的 JPG 或 PNG。");
          return;
        }
        const created = (await response.json()) as { draftId: string; jobId: string };
        setOcrProgress(created);
        await loadOcrDraft(created.draftId, created.jobId);
      } catch {
        setMessage("上传或进度读取中断，若已创建任务，可稍后继续查看。");
      } finally {
        setPending(false);
      }
      return;
    }
    const payload =
      mode === "single"
        ? {
            mode,
            subject,
            answerText: String(form.get("answerText")),
            broadcastText: String(form.get("broadcastText")) || String(form.get("answerText")),
            hintText: String(form.get("hintText")) || undefined,
          }
        : { mode, subject, text: String(form.get("text")) };
    const response = await fetch("/api/parent/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setPending(false);
    if (!response.ok) {
      setMessage("暂时未能保存，请检查输入后重试。");
      return;
    }
    const data = (await response.json()) as { cards: unknown[] };
    event.currentTarget.reset();
    setMessage(`已加入 ${data.cards.length} 张学习卡片。`);
  }

  async function confirmOcr() {
    if (!draftId || ocrLines.length === 0) return;
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/parent/content/ocr", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draftId,
          lines: ocrLines.map((line) => line.selected ? {
            lineId: line.id,
            selected: true,
            answerText: line.answerText,
            broadcastText: line.broadcastText,
            hintText: line.hintText || undefined,
          } : { lineId: line.id, selected: false }),
        }),
      });
      if (!response.ok) {
        setMessage("暂时未能确认草稿，未重复生成卡片，请重试。");
        return;
      }
      const data = (await response.json()) as { cards: unknown[] };
      setOcrLines([]);
      setDraftId("");
      setOcrProgress(null);
      setMessage(`已确认并加入 ${data.cards.length} 张学习卡片。`);
    } catch {
      setMessage("确认请求中断，可直接重试；后端不会重复生成卡片。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="page-shell content-shell">
      <section className="hero-card content-card">
        <p className="eyebrow">内容管理</p>
        <h1>添加学习内容</h1>
        <p>每张卡片只保存在当前家庭。先从最容易开始的一种录入方式开始即可。</p>
        <form className="auth-form" onSubmit={submit}>
          <div className="content-entry-grid">
            {entries.map((entry) => (
              <label className={`content-entry ${mode === entry.mode ? "selected" : ""}`} key={entry.mode}>
                <input checked={mode === entry.mode} name="entryMode" onChange={() => setMode(entry.mode)} type="radio" value={entry.mode} />
                <strong>{entry.title}</strong>
                <span>{entry.description}</span>
              </label>
            ))}
          </div>
          <label>学科<select defaultValue="chinese" name="subject"><option value="chinese">语文</option><option value="english">英语</option></select></label>
          {mode === "single" ? <><label>答案<input name="answerText" required /></label><label>朗读文本（留空时使用答案）<input name="broadcastText" /></label><label>提示（可选）<input name="hintText" /></label></> : null}
          {mode === "bulk" ? <label>每行一条<textarea name="text" required rows={8} /></label> : null}
          {mode === "ocr" ? <><label>教材图片（JPG 或 PNG，最大 10MB）<input accept="image/jpeg,image/png" name="image" required type="file" /></label><p role="status">上传后需要家长确认，确认前不会生成学习卡片。</p></> : null}
          {mode === "ocr" && ocrLines.length > 0 ? <fieldset><legend>逐项确认识别草稿</legend>{ocrLines.map((line, index) => <div className="ocr-draft-line" key={line.id}><p>识别原文：{line.sourceText}</p><label><input checked={line.selected} onChange={(event) => setOcrLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} type="checkbox" />保留这一项</label><label>答案<input disabled={!line.selected} onChange={(event) => setOcrLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, answerText: event.target.value } : item))} required={line.selected} value={line.answerText} /></label><label>朗读文本<input disabled={!line.selected} onChange={(event) => setOcrLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, broadcastText: event.target.value } : item))} required={line.selected} value={line.broadcastText} /></label><label>提示（可选）<input disabled={!line.selected} onChange={(event) => setOcrLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, hintText: event.target.value } : item))} value={line.hintText} /></label></div>)}</fieldset> : null}
          {mode === "builtin" ? <p role="status">两本教材仅含准确版次和空单元容器；收到自有教材照片或已核实词表后，才会逐条填入。</p> : null}
          {message ? <p role={message.startsWith("已") ? "status" : "alert"}>{message}</p> : null}
          {mode === "ocr" && ocrLines.length > 0 ? <button disabled={pending} onClick={confirmOcr} type="button">{pending ? "确认中…" : "确认选中项并生成卡片"}</button> : null}
          {mode === "ocr" && ocrProgress && ocrLines.length === 0 ? <button disabled={pending} onClick={resumeOcr} type="button">{pending ? "查看中…" : "继续查看识别结果"}</button> : null}
          <button disabled={pending || mode === "builtin"} type="submit">
            {pending ? "处理中…" : mode === "ocr" ? "上传并识别" : mode === "builtin" ? "暂不可录入" : "加入学习卡片"}
          </button>
        </form>
      </section>
    </main>
  );
}
