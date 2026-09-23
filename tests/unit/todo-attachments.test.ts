import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect,test} from 'vitest';
import {saveAttachment,attachmentResponse,removeAttachment} from '@/modules/todos/attachments';
test('附件私有保存及音视频Range响应，不接受伪造图片',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'todos-'));const prior=process.env.MEDIA_ROOT;process.env.MEDIA_ROOT=root;
 try{
 await expect(saveAttachment(new File(['<html>evil</html>'],'x.jpg',{type:'image/jpeg'}))).rejects.toThrow('ATTACHMENT_TYPE');
 const item=await saveAttachment(new File(['ID3testdata'],'voice.mp3',{type:'audio/mpeg'}));
 const response=await attachmentResponse(item.id,item.mimeType,'bytes=3-6');expect(response.status).toBe(206);expect(await response.text()).toBe('test');expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect((await attachmentResponse(item.id,item.mimeType,'bytes=999-')).status).toBe(416);
 const videoBytes=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]);
 const video=await saveAttachment(new File([videoBytes],'clip.mp4',{type:'video/mp4'}));
 const videoResponse=await attachmentResponse(video.id,video.mimeType,null);expect(videoResponse.headers.get('content-type')).toBe('video/mp4');expect(new Uint8Array(await videoResponse.arrayBuffer())).toEqual(videoBytes);
 await expect(saveAttachment(new File([new Uint8Array(8*1024*1024+1)],'large.mp4',{type:'video/mp4'}))).rejects.toThrow('ATTACHMENT_SIZE');
 await removeAttachment(item.id);await expect(attachmentResponse(item.id,item.mimeType,null)).rejects.toThrow();
 }finally{if(prior===undefined)delete process.env.MEDIA_ROOT;else process.env.MEDIA_ROOT=prior;await rm(root,{recursive:true,force:true});}
});
