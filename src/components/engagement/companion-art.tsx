import Image from 'next/image';
import { speciesNames, stageNames, companionAsset } from '@/modules/engagement/companion-catalog';
export function CompanionArt({ species, stage, name, appearance = 'animal', humanStyle = 'girl', large = false }: {
    species: keyof typeof speciesNames;
    stage: number;
    name?: string;
    appearance?: string;
    humanStyle?: string;
    large?: boolean;
}) {
    const src = companionAsset(species, stage, appearance, humanStyle);
    return <Image className={`companion-art${large ? ' companion-art-large' : ''}`} src={src} alt={`${name ?? speciesNames[species]} · ${stageNames[stage]}`} width={large ? 360 : 180} height={large ? 360 : 180} priority={large}/>;
}
