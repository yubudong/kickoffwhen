import { expect, test } from "vitest";
import { checkEnglishSpelling, normalizeEnglishSpelling } from "@/modules/learning-content/english-spelling";
import type { EnglishSpellingRules } from "@/modules/learning-content/english-types";
const normal:EnglishSpellingRules={caseRule:"initial_optional",acceptedAnswers:[]};
test.each([
 [" apple ","apple",true],["Apple","apple",true],["APPLE","apple",false],
 ["I","I",true],["i","I",false],["Monday","Monday",true],["monday","Monday",false],
 ["the Great Wall","the Great Wall",true],["The Great Wall","the Great Wall",true],["the great wall","the Great Wall",false],
 ["ice  cream","ice cream",true],["icecream","ice cream",false],["ice-cream","ice cream",false],
 ["cats","cat",false],["go","went",false],["playing","play",false],["have","has",false],
 ["twenty‑first","twenty-first",true],["twenty first","twenty-first",false],["21st","twenty-first",false],
 ["o’clock","o'clock",true],["ａｐｐｌｅ","apple",true],
])("拼写 %s 对照 %s，结果%s",(actual,target,correct)=>expect(checkEnglishSpelling(actual,target,normal).correct).toBe(correct));
test("缩写和英美写法只接受每卡明确配置的形式",()=>{
 const mr:EnglishSpellingRules={caseRule:"required",acceptedAnswers:["Mr."]};
 expect(checkEnglishSpelling("Mr.","Mr",mr).correct).toBe(true);
 expect(checkEnglishSpelling("mr","Mr",mr).correct).toBe(false);
 expect(checkEnglishSpelling("mister","Mr",mr).correct).toBe(false);
 expect(checkEnglishSpelling("meter","metre",{...normal,acceptedAnswers:["meter"]}).correct).toBe(true);
 expect(checkEnglishSpelling("color","colour",normal)).toMatchObject({correct:false});
 expect(checkEnglishSpelling("color","colour",normal).message).toContain("另一种规范写法");
 expect(checkEnglishSpelling("AM","a.m.",{caseRule:"required",acceptedAnswers:["AM","A.M."]}).correct).toBe(true);
 expect(normalizeEnglishSpelling("  ice\tcream  ")).toBe("ice cream");
});
