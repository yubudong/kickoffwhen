import { homeworkHandler } from '@/modules/todos/homework-http';
export async function POST(request:Request,context:RouteContext<'/api/child/homework/[todoId]/uploads'>){return homeworkHandler(request,'child',(await context.params).todoId,true)}
