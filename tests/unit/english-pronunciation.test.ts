import { expect, test, vi } from "vitest";
vi.mock("@/db/client",()=>({db:{}}));
import { buildSafeSsml } from "@/modules/learning-content/azure-tts-provider";
import { englishPronunciationSchema } from "@/modules/learning-content/english-pronunciation";
import { buildTtsDedupeKey, generateTtsJobPayloadSchema } from "@/modules/jobs/service";
const base={familyId:"018f3b5d-1111-7111-8111-111111111111",childId:"018f3b5d-2222-7222-8222-222222222222",cardId:"018f3b5d-3333-7333-8333-333333333333",text:"read. I read a book, not bread.",language:"en-US" as const,voice:"en-US-JennyNeural" as const,rate:1};
test("过去read的音素覆盖完整目标词，不误替换bread，也不能注入SSML",()=>{
 const pronunciation={kind:"ipa" as const,target:"read",ipa:"rɛd"};
 const ssml=buildSafeSsml({...base,pronunciation});
 expect(ssml.match(/<phoneme /g)).toHaveLength(2);
 expect(ssml).toContain('ph="rɛd">read</phoneme>');expect(ssml).toContain('not bread.');
 const escaped=buildSafeSsml({...base,text:'read <evil attr="x">',pronunciation});expect(escaped).toContain('&lt;evil');expect(escaped).not.toContain('<evil');
 expect(()=>englishPronunciationSchema.parse({...pronunciation,ipa:'rɛd"/><evil/>'})).toThrow();
});
test("缩写按字母朗读，a.m.中的点不会被读出",()=>{
 const ssml=buildSafeSsml({...base,text:"a.m.",pronunciation:{kind:"characters",target:"a.m.",letters:"AM"}});
 expect(ssml).toContain('<say-as interpret-as="characters">AM</say-as>');
 expect(()=>buildSafeSsml({...base,pronunciation:{kind:"ipa",target:"never",ipa:"nɛvɚ"}})).toThrow("TARGET_NOT_FOUND");
});
test("新增发音提示进入缓存身份，旧任务哈希及旧payload保持兼容",()=>{
 const old=buildTtsDedupeKey(base);expect(old.split(":" )).toHaveLength(8);
 const past={...base,pronunciation:{kind:"ipa" as const,target:"read",ipa:"rɛd"}};
 const present={...base,pronunciation:{kind:"ipa" as const,target:"read",ipa:"riːd"}};
 expect(buildTtsDedupeKey(past)).not.toBe(old);expect(buildTtsDedupeKey(past)).not.toBe(buildTtsDedupeKey(present));
 expect(generateTtsJobPayloadSchema.parse(base)).not.toHaveProperty("pronunciation");
 expect(buildTtsDedupeKey(generateTtsJobPayloadSchema.parse(past))).toBe(buildTtsDedupeKey(past));
});
