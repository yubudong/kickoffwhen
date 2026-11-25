import { parentWorkflowsGet } from '@/modules/engagement/parent-http';
export async function GET(request: Request) { return parentWorkflowsGet(request,'family'); }
