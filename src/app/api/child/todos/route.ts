import { todosHandler } from '@/modules/todos/http';
export function GET(request: Request) { return todosHandler(request, 'child'); }
export function POST(request: Request) { return todosHandler(request, 'child'); }
