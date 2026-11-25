import { homeworkHandler } from '@/modules/todos/homework-http';
export async function GET(request:Request,context:RouteContext<'/api/parent/homework/[todoId]'>){return homeworkHandler(request,'parent',(await context.params).todoId,false)}
export async function POST(request:Request,context:RouteContext<'/api/parent/homework/[todoId]'>){return homeworkHandler(request,'parent',(await context.params).todoId,false)}
