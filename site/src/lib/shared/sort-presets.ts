// site/src/lib/shared/sort-presets.ts
export interface SortPreset {
  id: 'skill' | 'value' | 'speed';
  label: string;
  /** Server sort field (must be in leaderboard/+server.ts knownSorts). */
  sortKey: 'auc_2' | 'cost_per_pass_usd' | 'latency_p95_ms';
  direction: 'asc' | 'desc';
  /** Short formula shown inline under the label so the preset is never a black box. */
  formula: string;
}

export const PRESETS: SortPreset[] = [
  { id: 'skill', label: 'Skill', sortKey: 'auc_2', direction: 'desc', formula: 'Solve AUC@2' },
  { id: 'value', label: 'Value', sortKey: 'cost_per_pass_usd', direction: 'asc', formula: '$/solved ↓' },
  { id: 'speed', label: 'Speed', sortKey: 'latency_p95_ms', direction: 'asc', formula: 'p95 ↑ · AUC ≥ 75' },
];

export function sortString(p: SortPreset): string {
  return `${p.sortKey}:${p.direction}`;
}

export function presetForSort(sort: string): SortPreset['id'] {
  const [field] = sort.split(':');
  const match = PRESETS.find((p) => p.sortKey === field);
  return match ? match.id : 'skill';
}
