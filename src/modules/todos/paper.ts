export type TodoStatusFilter = 'all' | 'remaining' | 'submitted' | 'approved' | 'rejected';

const filterLabels: Record<TodoStatusFilter, string> = {
    all: '全部',
    rejected: '待订正',
    remaining: '待完成',
    submitted: '待审核',
    approved: '已通过',
};

export function todoFilterLabel(filter: TodoStatusFilter) {
    return filterLabels[filter];
}

export function filterTodoTasks<T extends { status: string }>(tasks: T[], filter: TodoStatusFilter) {
    if(filter==='rejected')return tasks.filter(task=>task.status==='rejected');
    if (filter === 'remaining') return tasks.filter(task => task.status === 'open' || task.status === 'rejected');
    if (filter === 'submitted') return tasks.filter(task => task.status === 'submitted');
    if (filter === 'approved') return tasks.filter(task => task.status === 'approved');
    return tasks;
}

function statusRank(status: string) {
    if(status==='rejected')return -1;
    if (status === 'open') return 0;
    if (status === 'submitted') return 1;
    if (status === 'approved') return 2;
    return 3;
}

export function sortTodoTasks<T extends { status: string; date: string }>(tasks: T[]) {
    return [...tasks].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.date.localeCompare(b.date));
}

export type PaperTask = { title: string; requirements: string };
export type PaperSection = { label: string; tasks: PaperTask[] };

export function paperSections<T extends { date: string; title: string; requirements: string }>(days: string[], tasks: T[], labelFor: (day: string) => string): PaperSection[] {
    return days.map(day => ({
        label: labelFor(day),
        tasks: tasks.filter(task => task.date === day).map(task => ({
            title: task.title,
            requirements: task.requirements.trim() || '按要求完成即可。',
        })),
    }));
}

export function pdfFromJpegs(pages: Array<{ jpeg: Uint8Array; pixelWidth: number; pixelHeight: number }>) {
    if (!pages.length) throw new Error('EMPTY_PDF');
    const pageWidth = 595;
    const pageHeight = 842;
    const chunks: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const offsets: number[] = [];
    let length = 0;
    const push = (data: Uint8Array | string) => {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        chunks.push(bytes);
        length += bytes.length;
    };
    const startObject = (id: number) => {
        offsets[id] = length;
        push(`${id} 0 obj\n`);
    };
    const endObject = () => push('\nendobj\n');
    push('%PDF-1.4\n');
    const pageIds = pages.map((_, index) => 3 + index * 3);
    startObject(1);
    push('<< /Type /Catalog /Pages 2 0 R >>');
    endObject();
    startObject(2);
    push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
    endObject();
    pages.forEach((page, index) => {
        const pageId = 3 + index * 3;
        const contentId = pageId + 1;
        const imageId = pageId + 2;
        const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`;
        startObject(pageId);
        push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        endObject();
        startObject(contentId);
        push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
        endObject();
        startObject(imageId);
        push(`<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
        push(page.jpeg);
        push('\nendstream');
        endObject();
    });
    const xref = length;
    const size = 3 + pages.length * 3;
    push(`xref\n0 ${size}\n`);
    push('0000000000 65535 f \n');
    for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const output = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) {
        output.set(chunk, cursor);
        cursor += chunk.length;
    }
    return output;
}
