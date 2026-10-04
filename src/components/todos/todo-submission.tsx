'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createAudioRecording, type RecordingSnapshot } from '@/modules/todos/recording';

type Props = {
  taskId: string;
  disabled: boolean;
  onSubmit: (data: FormData) => Promise<boolean>;
  onActivityChange: (taskId: string, busy: boolean) => void;
};

export function TodoSubmission({ taskId, disabled, onSubmit, onActivityChange }: Props) {
  const [mode, setMode] = useState<'file' | 'record' | 'none'>('file');
  const [recording, setRecording] = useState<RecordingSnapshot>({ phase: 'idle', seconds: 0 });
  const [preview, setPreview] = useState('');
  const [sending, setSending] = useState(false);
  const controller = useRef<ReturnType<typeof createAudioRecording> | null>(null);
  const uploading = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);
  const busy = ['requesting', 'recording', 'stopping'].includes(recording.phase);

  useEffect(() => {
    let previewUrl = "";
    const recorder = createAudioRecording({
      getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      supports: type => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && MediaRecorder.isTypeSupported(type),
      createRecorder: (stream, options) => new MediaRecorder(stream, options),
      onState: value => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = value.file ? URL.createObjectURL(value.file) : "";
        setPreview(previewUrl);
        setRecording(value);
        onActivityChange(taskId, ['requesting', 'recording', 'stopping'].includes(value.phase));
      },
    });
    controller.current = recorder;
    const stopWhenHidden = () => { if (document.hidden) recorder.stop('已离开录音页面，录音已停止，请试听后提交。'); };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', stopWhenHidden);
      recorder.dispose();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      controller.current = null; onActivityChange(taskId, false);
    };
  }, [taskId, onActivityChange]);

  function changeMode(next: typeof mode) {
    if (next === mode) return;
    audio.current?.pause(); controller.current?.cancel(); setPreview(''); setMode(next);
  }
  function start() {
    audio.current?.pause(); setPreview(''); void controller.current?.start();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled || uploading.current || (mode === 'record' && !recording.file)) return;
    uploading.current = true; setSending(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    if (mode === 'record' && recording.file) data.set('file', recording.file);
    if (mode === 'none') data.delete('file');
    try {
      if (await onSubmit(data)) { audio.current?.pause(); controller.current?.cancel(); form.reset(); }
    } finally { uploading.current = false; setSending(false); }
  }
  const time = `${Math.floor(recording.seconds / 60).toString().padStart(2, '0')}:${(recording.seconds % 60).toString().padStart(2, '0')}`;
  return <form className="todo-submission" onSubmit={submit}>
    <div className="todo-evidence-modes" aria-label="提交资料方式">
      <button type="button" aria-pressed={mode === 'record'} disabled={disabled || busy || sending} onClick={() => changeMode('record')}>直接录音</button>
      <button type="button" aria-pressed={mode === 'file'} disabled={disabled || busy || sending} onClick={() => changeMode('file')}>选择文件</button>
      <button type="button" aria-pressed={mode === 'none'} disabled={disabled || busy || sending} onClick={() => changeMode('none')}>不上传</button>
    </div>
    {mode === 'file' && <label>提交资料（可选）<input disabled={disabled || sending} name="file" type="file" accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/webm,video/mp4,video/webm,video/quicktime"/></label>}
    {mode === 'record' && <div className="todo-recorder">
      <p>讲讲你完成了什么、有哪些收获。最多录制5分钟。</p>
      {recording.phase === 'requesting' ? <><p role="status">请允许浏览器使用麦克风…</p><button type="button" onClick={() => controller.current?.cancel()}>取消录音</button></> : recording.phase === 'recording' ? <><p role="timer" className="recording-clock">● 录音中 {time} / 05:00</p><button type="button" onClick={() => controller.current?.stop()}>停止录音</button></> : recording.phase === 'stopping' ? <p role="status">正在准备试听…</p> : <>
        {recording.file && preview && <><p>录音时长 {time} · 可以先试听</p><audio ref={audio} controls preload="metadata" src={preview}/></>}
        <button type="button" disabled={disabled || sending} onClick={start}>{recording.file ? '重新录制' : '开始录音'}</button>
      </>}
      {recording.message && <p role={recording.phase === 'error' ? 'alert' : 'status'}>{recording.message}</p>}
      <small>点击提交才会上传。录音时请保持页面打开；重新录制会替换本次录音。</small>
    </div>}
    <small>图片、音频或视频，最多一份、8MB；也可以不上传。</small>
    <button type="submit" disabled={disabled || busy || sending || (mode === 'record' && !recording.file)}>{sending ? '提交中…' : mode === 'record' ? '使用录音并提交' : '完成并提交'}</button>
  </form>;
}
