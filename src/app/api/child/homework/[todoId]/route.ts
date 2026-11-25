import { homeworkHandler } from '@/modules/todos/homework-http';
export async function GET(request:Request,context:RouteContext<'/api/child/homework/[todoId]'>){return homeworkHandler(request,'child',(await context.params).todoId,false)}
export async function POST(request:Request,context:RouteContext<'/api/child/homework/[todoId]'>){return homeworkHandler(request,'child',(await context.params).todoId,false)}
