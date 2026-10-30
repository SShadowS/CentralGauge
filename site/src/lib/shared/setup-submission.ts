// site/src/lib/shared/setup-submission.ts
import { AGENT_TOOLS } from './setups';
import type { AgentTool, Role } from './setups';

export const SUBMISSION_LIMITS = {
  zipBytes: 10 * 1024 * 1024, instructionsBytes: 200 * 1024, descriptionMax: 200,
  flowMax: 4000, rolesMax: 12, keyMaxDays: 7, perIpPerDay: 5,
} as const;

export interface SubmissionFields {
  agent_tool: AgentTool; base_model: string; description: string; visibility: 'public' | 'private';
  instructions_name: 'CLAUDE.md' | 'AGENTS.md'; roles: Role[]; flow: string | null;
  key: string | null; key_expires_on: string | null; // YYYY-MM-DD
}
export type FieldErrors = Partial<Record<keyof SubmissionFields | 'zip' | 'instructions', string>>;

const DAY_MS = 86_400_000;

function utcDay(s: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s ? null : t;
}

function parseRoles(json: string): Role[] | string {
  if (!json) return [];
  let data: unknown;
  try { data = JSON.parse(json); } catch { return 'Roles must be valid JSON.'; }
  if (!Array.isArray(data)) return 'Roles must be a list.';
  if (data.length > SUBMISSION_LIMITS.rolesMax) return `Use at most ${SUBMISSION_LIMITS.rolesMax} roles.`;
  const roles: Role[] = [];
  for (const r of data) {
    const o = (r ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    if (!s(o.role) || !s(o.model)) return 'Every role needs a name and a model.';
    roles.push({ role: s(o.role), model: s(o.model), effort: s(o.effort) || null });
  }
  return roles;
}

export function parseSubmissionFields(
  raw: Record<string, string>, today: string,
): { ok: true; value: SubmissionFields } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const get = (k: string) => (raw[k] ?? '').trim();

  const agent_tool = get('agent_tool') as AgentTool;
  if (!(AGENT_TOOLS as readonly string[]).includes(agent_tool)) errors.agent_tool = 'Pick one of the listed agent tools.';

  const base_model = get('base_model');
  if (!base_model) errors.base_model = 'Base model is required.';

  const description = get('description');
  if (!description) errors.description = 'Description is required.';
  else if (description.length > SUBMISSION_LIMITS.descriptionMax) errors.description = `Description must be at most ${SUBMISSION_LIMITS.descriptionMax} characters.`;

  const vis = get('visibility') || 'public';
  if (vis !== 'public' && vis !== 'private') errors.visibility = 'Visibility must be public or private.';
  const visibility = vis === 'private' ? 'private' : 'public';

  const instructions_name = get('instructions_name') as SubmissionFields['instructions_name'];
  if (instructions_name !== 'CLAUDE.md' && instructions_name !== 'AGENTS.md') errors.instructions_name = 'Instructions file must be CLAUDE.md or AGENTS.md.';

  const rolesOrErr = parseRoles(get('roles_json'));
  if (typeof rolesOrErr === 'string') errors.roles = rolesOrErr;

  const flow = get('flow') || null;
  if (flow && flow.length > SUBMISSION_LIMITS.flowMax) errors.flow = `Flow must be at most ${SUBMISSION_LIMITS.flowMax} characters.`;

  const key = get('key') || null;
  let key_expires_on: string | null = null;
  if (key) {
    const exp = get('key_expires_on');
    const e = utcDay(exp);
    const t = utcDay(today);
    if (e === null || t === null) errors.key_expires_on = 'A key needs an expiry date (YYYY-MM-DD).';
    else if (e < t) errors.key_expires_on = 'The key expiry date is in the past.';
    else if (e > t + SUBMISSION_LIMITS.keyMaxDays * DAY_MS) errors.key_expires_on = `The key must expire within ${SUBMISSION_LIMITS.keyMaxDays} days.`;
    else key_expires_on = exp;
  }

  if (Object.keys(errors).length > 0 || typeof rolesOrErr === 'string') return { ok: false, errors };
  return { ok: true, value: { agent_tool, base_model, description, visibility, instructions_name, roles: rolesOrErr, flow, key, key_expires_on } };
}

/** Local file header (PK\x03\x04) or end-of-central-directory (PK\x05\x06, empty zip). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}
