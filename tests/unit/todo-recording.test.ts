import { afterEach, expect, test, vi } from 'vitest';
import { createAudioRecording, type RecordingSnapshot } from '@/modules/todos/recording';
import { attachmentType } from '@/modules/todos/validation';

class Recorder {
  state = 'inactive'; mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((e: {data: Blob}) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({data:new Blob([new Uint8Array([26,69,223,163,1,2])])}); this.onstop?.(); }
}
function fixture() {
  vi.useFakeTimers();
  let stopped = false;
  const track = {stop:()=>{stopped=true;}, addEventListener:()=>{}, removeEventListener:()=>{}};
  const stream = {getTracks:()=>[track]} as unknown as MediaStream;
  const recorder = new Recorder();
  let latest: RecordingSnapshot;
  const recording = createAudioRecording({getStream:async()=>stream, supports:t=>t.startsWith('audio/webm'), createRecorder:()=>recorder as unknown as MediaRecorder, onState:s=>{latest=s;}});
  return {recording,recorder,stream,get latest(){return latest!;},get stopped(){return stopped;}};
}
afterEach(()=>vi.useRealTimers());
test('录音停止后形成可提交文件并释放麦克风，尚未上传',async()=>{const f=fixture();await f.recording.start();expect(f.latest.phase).toBe('recording');vi.advanceTimersByTime(2000);f.recording.stop();expect(f.latest.phase).toBe('ready');expect(f.latest.file?.type).toBe('audio/webm');expect(f.latest.file?.size).toBe(6);expect(f.stopped).toBe(true);f.recording.dispose();});
test('达到5分钟自动停止，保留可试听文件',async()=>{const f=fixture();await f.recording.start();vi.advanceTimersByTime(300000);expect(f.latest.phase).toBe('ready');expect(f.latest.seconds).toBe(300);expect(f.stopped).toBe(true);});
test('超出8MB停止录音且不提供不可上传文件',async()=>{const f=fixture();await f.recording.start();f.recorder.ondataavailable?.({data:new Blob([new Uint8Array(8*1024*1024+1)])});expect(f.latest.phase).toBe('error');expect(f.latest.file).toBeUndefined();expect(f.stopped).toBe(true);});
test('离开页面后才获授权也立即释放麦克风',async()=>{const f=fixture();let resolve!:(s:MediaStream)=>void;const r=createAudioRecording({getStream:()=>new Promise<MediaStream>(done=>{resolve=done;}),supports:()=>true,createRecorder:()=>f.recorder as unknown as MediaRecorder,onState:()=>{}});const waiting=r.start();r.dispose();resolve(f.stream);await waiting;expect(f.stopped).toBe(true);});
test('拒绝权限或初始化失败都能退出请求状态',async()=>{const states:RecordingSnapshot[]=[];const r=createAudioRecording({getStream:async()=>{throw new DOMException('denied','NotAllowedError');},supports:()=>true,createRecorder:()=>{throw new Error('unused');},onState:s=>states.push(s)});await r.start();expect(states.at(-1)?.phase).toBe('error');expect(states.at(-1)?.message).toContain('麦克风');});
test('后台接受浏览器WebM与M4A录音，仍拒绝伪装音频',()=>{expect(attachmentType(new Uint8Array([26,69,223,163,1]),'audio/webm;codecs=opus')).toBe('audio/webm');expect(attachmentType(new Uint8Array([0,0,0,24,102,116,121,112,77,52,65,32]),'audio/mp4;codecs=mp4a.40.2')).toBe('audio/mp4');expect(()=>attachmentType(new TextEncoder().encode('fake'),'audio/webm')).toThrow('ATTACHMENT_TYPE');});
test('页面隐藏时取消待授权请求，迟到授权不能启动后台录音',async()=>{const f=fixture();let resolve!:(s:MediaStream)=>void;let latest:RecordingSnapshot|undefined;const r=createAudioRecording({getStream:()=>new Promise<MediaStream>(done=>{resolve=done;}),supports:()=>true,createRecorder:()=>f.recorder as unknown as MediaRecorder,onState:s=>{latest=s;}});const waiting=r.start();r.stop();resolve(f.stream);await waiting;expect(latest?.phase).toBe('idle');expect(f.stopped).toBe(true);});
