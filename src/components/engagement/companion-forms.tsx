'use client';

import { canTransform, humanStylesFor, type HumanStyle, type Species } from '@/modules/engagement/companion-catalog';
export type CompanionForm = 'animal' | HumanStyle;
export function CompanionFormChoices({ species, value, onChange, stage = 4, disabled = false, label = '形态选择' }: {
  species: Species; value: CompanionForm; onChange: (value: CompanionForm) => void;
  stage?: number; disabled?: boolean; label?: string;
}) {
  const styles = humanStylesFor(species);
  const options: Array<[CompanionForm, string]> = [['animal', '动物形态'], ...styles.map(style => [style, style === 'boy' ? '男性形态' : '女性形态'] as [CompanionForm, string])];
  return <div className="companion-form-choices" role="group" aria-label={label}>
    {options.map(([mode, text]) => <button key={mode} type="button" aria-pressed={value === mode}
      disabled={disabled || (mode !== 'animal' && !canTransform(species, stage))}
      title={mode !== 'animal' && !canTransform(species, stage) ? '少年期解锁后可以选择' : text}
      onClick={() => onChange(mode)}>{text}</button>)}
  </div>;
}
