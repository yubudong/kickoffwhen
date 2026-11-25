import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { requireParentActor } from '@/modules/auth/parent-access';
import { createHomeworkService } from '@/modules/todos/homework-service';
import { HomeworkWorkspace } from '@/components/todos/homework-workspace';
export default async function ParentHomeworkPage({params}:PageProps<'/parent/homework/[todoId]'>){const actor=await requireParentActor(await headers());const {todoId}=await params;let view;try{view=await createHomeworkService().view(actor,todoId)}catch{notFound()}return <HomeworkWorkspace role="parent" initialView={view}/>}
