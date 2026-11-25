import { headers } from 'next/headers';
import { requireParentActor } from '@/modules/auth/parent-access';
import { FamilyRewardsBoard } from '@/components/engagement/family-rewards-board';
export default async function FamilyRewardsPage(){await requireParentActor(await headers());return <main className="page-shell"><FamilyRewardsBoard/></main>;}
