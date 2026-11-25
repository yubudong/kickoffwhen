import { headers } from 'next/headers';
import { notFound,redirect } from 'next/navigation';
import { requireChildActor } from '@/modules/devices/child-actor';
import { createHomeworkService } from '@/modules/todos/homework-service';
import { HomeworkWorkspace } from '@/components/todos/homework-workspace';
export default async function ChildHomeworkPage({params}:PageProps<'/child/homework/[todoId]'>){let actor;try{actor=await requireChildActor(new Request('http://internal.local/child/homework',{headers:await headers()}))}catch{redirect('/child/switch')}const {todoId}=await params;let view;try{view=await createHomeworkService().view(actor,todoId)}catch{notFound()}return <HomeworkWorkspace role="child" initialView={view}/>}
