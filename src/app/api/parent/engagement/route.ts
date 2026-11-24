import { engagementHandler } from '@/modules/engagement/http';
export const GET=(request:Request)=>engagementHandler(request,'parent');
export const POST=(request:Request)=>engagementHandler(request,'parent');
