import { todosHandler } from '@/modules/todos/http';
export function GET(request: Request) { return todosHandler(request, 'parent'); }
export function POST(request: Request) { return todosHandler(request, 'parent'); }
