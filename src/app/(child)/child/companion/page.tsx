import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireChildActor } from '@/modules/devices/child-actor';
import { getChildProfile } from '@/modules/devices/service';
import { ChildHeader } from '@/components/child/child-header';
import { EngagementBoard } from '@/components/engagement/engagement-board';
export default async function CompanionPage(){let actor;try{actor=await requireChildActor(new Request('http://internal.local/child',{headers:await headers()}));}catch{redirect('/child/switch');}const child=await getChildProfile(actor);return <div className="child-shell"><ChildHeader avatarKey={child.avatarKey} nickname={child.nickname}/><main className="page-shell"><EngagementBoard role="child"/></main></div>;}
