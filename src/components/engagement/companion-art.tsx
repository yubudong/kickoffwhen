import Image from 'next/image';
import { speciesNames, stageNames } from '@/modules/engagement/rules';
export function CompanionArt({ species, stage, name, appearance = 'animal', humanStyle = 'girl', large = false }: {
    species: keyof typeof speciesNames;
    stage: number;
    name?: string;
    appearance?: string;
    humanStyle?: string;
    large?: boolean;
}) {
    const file = species === 'fox' && stage === 3 ? appearance === 'human' ? `fox-human-${humanStyle}` : 'fox-final' : `${species}-${stage}`;
    return <Image className={`companion-art${large ? ' companion-art-large' : ''}`} src={`/pets/${file}.webp`} alt={`${name ?? speciesNames[species]} · ${stageNames[stage]}`} width={large ? 360 : 180} height={large ? 360 : 180} priority={large}/>;
}
