import { headers } from 'next/headers';
import { requireParentActor } from '@/modules/auth/parent-access';
import { listChildren } from '@/modules/families/service';
import { EngagementBoard } from '@/components/engagement/engagement-board';
export default async function GrowthPage(){const actor=await requireParentActor(await headers());const children=await listChildren(actor);return <main className="page-shell"><EngagementBoard role="parent" childOptions={children}/></main>;}
