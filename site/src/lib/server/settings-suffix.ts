/**
 * Concise model-settings suffix renderer.
 *
 * The leaderboard SQL only emits a non-NULL `settings_profile_json` when
 * COUNT(DISTINCT runs.settings_hash) = 1 across the row's runs (multi-run
 * ambiguity: settings differ → suffix omitted). This helper renders that
 * payload to a short string like ` (50K, t0.1)`. Returns the empty string
 * when the input is null OR no formatted parts apply (so callers can
 * always concatenate verbatim onto a display name).
 *
 * Rounding: max_tokens divided by 1000 and rounded to nearest integer
 * ("50K"); temperature rounded to one decimal ("t0.1", "t0", "t1").
 */
export interface SettingsProfileLike {
  temperature: number | null;
  max_tokens: number | null;
  extra_json?: string | null;
}

export function formatSettingsSuffix(profile: SettingsProfileLike | null): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.max_tokens !== null && profile.max_tokens !== undefined && profile.max_tokens > 0) {
    const k = Math.round(profile.max_tokens / 1000);
    parts.push(`${k}K`);
  }
  if (profile.temperature !== null && profile.temperature !== undefined) {
    const t = Math.round(profile.temperature * 10) / 10;
    parts.push(`t${t}`);
  }
  if (parts.length === 0) return '';
  return ` (${parts.join(', ')})`;
}
