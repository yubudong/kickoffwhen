import { engagementHandler } from '@/modules/engagement/http';
export const GET=(request:Request)=>engagementHandler(request,'child');
export const POST=(request:Request)=>engagementHandler(request,'child');
