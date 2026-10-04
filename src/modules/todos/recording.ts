import { MAX_ATTACHMENT_BYTES } from './validation';

export type RecordingSnapshot = {
  phase: 'idle' | 'requesting' | 'recording' | 'stopping' | 'ready' | 'error';
  seconds: number;
  file?: File;
  message?: string;
};
type Dependencies = {
  getStream: () => Promise<MediaStream>;
  supports: (mime: string) => boolean;
  createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  onState: (snapshot: RecordingSnapshot) => void;
};
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];

export function createAudioRecording(deps: Dependencies) {
  let state: RecordingSnapshot = { phase: 'idle', seconds: 0 };
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let disposed = false;
  let startedAt = 0;
  let notice: string | undefined;
  const publish = (next: RecordingSnapshot) => { state = next; if (!disposed) deps.onState(next); };
  const elapsed = () => Math.min(300, Math.floor((Date.now() - startedAt) / 1000));
  const release = () => {
    clearInterval(timer);
    const previous = stream; stream = undefined;
    previous?.getTracks().forEach(track => track.stop());
  };
  function stop(message?: string) {
    if (state.phase === 'requesting') { cancel(); return; }
    if (state.phase !== 'recording') return;
    notice = message;
    publish({ phase: 'stopping', seconds: elapsed() });
    recorder?.stop();
    release();
  }
  function cancel() {
    generation++;
    if (recorder?.state === 'recording') recorder.stop();
    release(); recorder = undefined;
    publish({ phase: 'idle', seconds: 0 });
  }
  async function start() {
    if (disposed || ['requesting', 'recording', 'stopping'].includes(state.phase)) return;
    const current = ++generation;
    let failed = false;
    let chunks: Blob[] = [];
    let size = 0;
    notice = undefined;
    publish({ phase: 'requesting', seconds: 0 });
    const fail = (message: string) => {
      if (disposed || current !== generation) return;
      failed = true; chunks = [];
      if (recorder?.state === 'recording') recorder.stop();
      release(); publish({ phase: 'error', seconds: 0, message });
    };
    try {
      const mime = formats.find(deps.supports);
      if (!mime) { fail('当前浏览器不支持网页录音，请使用手机录音机录制后选择文件上传。'); return; }
      const granted = await deps.getStream();
      if (disposed || current !== generation) { granted.getTracks().forEach(t => t.stop()); return; }
      stream = granted;
      const active = deps.createRecorder(granted, { mimeType: mime, audioBitsPerSecond: 64000 });
      recorder = active;
      active.ondataavailable = event => {
        if (failed || disposed || current !== generation || !event.data.size) return;
        size += event.data.size;
        if (size > MAX_ATTACHMENT_BYTES) { fail('录音超过8MB，请缩短内容后重新录制。'); return; }
        chunks.push(event.data);
      };
      active.onerror = () => fail('录音中断，请检查麦克风后重新录制。');
      active.onstop = () => {
        if (disposed || current !== generation) return;
        release();
        if (failed) return;
        const type = (active.mimeType || mime).split(';')[0].trim().toLowerCase();
        const file = new File(chunks, `任务录音.${type === 'audio/mp4' ? 'm4a' : 'webm'}`, { type });
        chunks = [];
        if (!file.size) { fail('没有录到声音文件，请重新录制。'); return; }
        publish({ phase: 'ready', seconds: elapsed(), file, message: notice });
      };
      granted.getTracks().forEach(track => track.addEventListener('ended', () => { if (current === generation) stop('麦克风连接已结束，请试听后决定是否提交。'); }, { once: true }));
      startedAt = Date.now();
      active.start(1000);
      publish({ phase: 'recording', seconds: 0 });
      timer = setInterval(() => {
        if (Date.now() - startedAt >= 300000) stop('已达到5分钟，录音已自动停止。');
        else publish({ phase: 'recording', seconds: elapsed() });
      }, 250);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      fail(name === 'NotAllowedError' ? '未获得麦克风权限，请在浏览器的网站设置中允许麦克风，或选择录音文件上传。' : '无法启动麦克风，请检查设备或改用文件上传。');
    }
  }
  return { start, stop, cancel, dispose() { disposed = true; cancel(); } };
}
