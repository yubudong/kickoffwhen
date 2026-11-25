import { homeworkHandler } from '@/modules/todos/homework-http';
export async function GET(request:Request){return homeworkHandler(request,'parent')}
