import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { ContentEntryForm } from "@/app/(parent)/parent/content/new/content-entry-form";

test("内容入口明确展示四种录入方式及 OCR 家长确认提示", () => {
  const html = renderToStaticMarkup(<ContentEntryForm />);

  expect(html).toContain("单条输入");
  expect(html).toContain("批量粘贴");
  expect(html).toContain("拍照识别");
  expect(html).toContain("内置教材");
  expect(html).toContain("上传后需要家长确认");
});

test("OCR 模式可上传私密图片并预留草稿确认区", () => {
  const html = renderToStaticMarkup(<ContentEntryForm initialMode="ocr" />);

  expect(html).toContain('type="file"');
  expect(html).toContain('accept="image/jpeg,image/png"');
  expect(html).toContain("上传并识别");
  expect(html).not.toContain("拍照识别将在下一任务接通");
});

test("OCR 进度中断后可用原草稿与任务继续查看", () => {
  const html = renderToStaticMarkup(
    <ContentEntryForm
      initialMode="ocr"
      initialOcrProgress={{
        draftId: "018f3b5d-3333-7333-8333-333333333333",
        jobId: "018f3b5d-4444-7444-8444-844444444444",
      }}
    />,
  );

  expect(html).toContain("继续查看识别结果");
});
