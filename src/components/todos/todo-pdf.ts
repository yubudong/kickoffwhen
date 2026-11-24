import { pdfFromJpegs, type PaperSection } from '@/modules/todos/paper';

const pageWidth = 794;
const pageHeight = 1123;
const scale = 2;
const margin = 54;
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
    const lines: string[] = [];
    let line = '';
    for (const character of text) {
        const next = line + character;
        if (context.measureText(next).width > width && line) {
            lines.push(line);
            line = character;
        }
        else line = next;
    }
    return lines.length ? lines : [''];
}

export async function renderTodoPdf(input: { childName: string; rangeLabel: string; filterLabel: string; sections: PaperSection[] }) {
    const pages: HTMLCanvasElement[] = [];
    let page = document.createElement('canvas');
    let pen = page.getContext('2d');
    let y = margin;
    const fresh = () => {
        page = document.createElement('canvas');
        page.width = pageWidth * scale;
        page.height = pageHeight * scale;
        pen = page.getContext('2d');
        if (!pen) throw new Error('PDF_CANVAS_UNAVAILABLE');
        pen.scale(scale, scale);
        pen.fillStyle = '#ffffff';
        pen.fillRect(0, 0, pageWidth, pageHeight);
        y = margin;
        pages.push(page);
    };
    const ensure = (height: number) => {
        if (y + height > pageHeight - margin && y > margin + 80) fresh();
    };
    const paint = (action: (context: CanvasRenderingContext2D) => void) => {
        if (!pen) throw new Error('PDF_CANVAS_UNAVAILABLE');
        action(pen);
    };
    fresh();
    paint(context => {
        context.fillStyle = '#172033';
        context.font = `700 28px ${font}`;
        context.fillText(`${input.childName}的待办清单`, margin, y + 28);
    });
    y += 42;
    paint(context => {
        context.font = `16px ${font}`;
        context.fillStyle = '#334155';
        context.fillText(`${input.rangeLabel} · ${input.filterLabel}`, margin, y + 16);
    });
    y += 28;
    paint(context => {
        context.font = `15px ${font}`;
        context.fillStyle = '#334155';
        for (const line of wrap(context, '请在纸上勾选。完成后回到电脑提交对应任务，家长审核通过后才记录完成和积分。', pageWidth - margin * 2)) {
            context.fillText(line, margin, y + 16);
            y += 22;
        }
    });
    y += 8;
    const drawTask = (title: string, requirements: string) => {
        if (!pen) throw new Error('PDF_CANVAS_UNAVAILABLE');
        pen.font = `700 16px ${font}`;
        const titleLines = wrap(pen, title, pageWidth - margin * 2 - 28);
        pen.font = `14px ${font}`;
        const requirementLines = wrap(pen, requirements, pageWidth - margin * 2 - 28);
        const height = 12 + titleLines.length * 22 + requirementLines.length * 20;
        ensure(height);
        paint(context => {
            context.strokeStyle = '#111827';
            context.lineWidth = 1.5;
            context.strokeRect(margin, y + 2, 14, 14);
            context.fillStyle = '#111827';
            context.font = `700 16px ${font}`;
            titleLines.forEach((line, index) => context.fillText(line, margin + 28, y + 16 + index * 22));
            context.fillStyle = '#374151';
            context.font = `14px ${font}`;
            const top = y + 18 + titleLines.length * 22;
            requirementLines.forEach((line, index) => context.fillText(line, margin + 28, top + index * 20));
        });
        y += height + 8;
    };
    for (const section of input.sections) {
        ensure(34);
        paint(context => {
            context.fillStyle = '#111827';
            context.font = `700 18px ${font}`;
            context.fillText(section.tasks.length ? section.label : `${section.label} · 无任务`, margin, y + 18);
        });
        y += 30;
        for (const task of section.tasks) drawTask(task.title, task.requirements);
    }
    if (!input.sections.some(section => section.tasks.length)) {
        ensure(28);
        paint(context => {
            context.fillStyle = '#374151';
            context.font = `16px ${font}`;
            context.fillText('当前筛选下没有待办。', margin, y + 16);
        });
    }
    const jpegs = await Promise.all(pages.map(async item => {
        const blob = await new Promise<Blob>((resolve, reject) => item.toBlob(value => value ? resolve(value) : reject(new Error('PDF_IMAGE_FAILED')), 'image/jpeg', 0.92));
        return { jpeg: new Uint8Array(await blob.arrayBuffer()), pixelWidth: item.width, pixelHeight: item.height };
    }));
    return pdfFromJpegs(jpegs);
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
    const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
