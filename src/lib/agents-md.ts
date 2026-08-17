import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as clack from '@clack/prompts';
import type { ProjectConfig } from '../types.js';
import { getProjectConfig } from './config.js';

// HTML-comment markers delimit the Yarah-managed section so we can refresh it
// in place on re-link instead of appending a duplicate every run. Anything
// outside the markers is the user's own content and is never touched.
export const AGENTS_MD_START = '<!-- YARAH:START -->';
export const AGENTS_MD_END = '<!-- YARAH:END -->';

/**
 * Builds the Yarah-managed block for AGENTS.md (markers included).
 *
 * Contains no secrets: AGENTS.md follows the open agents.md standard and is
 * meant to be committed and shared, so only the project name and the (already
 * public) API host are embedded, never the api_key.
 */
export function buildYarahBlock(config: ProjectConfig | null): string {
  const lines: string[] = [
    AGENTS_MD_START,
    '## Yarah backend',
    '',
    'This project uses [Yarah](https://yarah.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.',
    '',
  ];

  if (config?.project_name || config?.oss_host) {
    const name = config.project_name ? `**${config.project_name}**` : 'This project';
    const host = config.oss_host ? ` (API base \`${config.oss_host}\`)` : '';
    lines.push(`- **Project:** ${name}${host}`);
  }

  lines.push(
    '- **Skills:** these Yarah skills are installed for supported coding agents. Reach for them before implementing any Yarah feature instead of guessing the API:',
    '  - `yarah`: app code with the `@yarahdev/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).',
    '  - `yarah-cli`: backend and infrastructure via the `yarah` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).',
    '  - `yarah-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.',
    '  - `yarah-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.',
    '  - `find-skills`: discovering additional skills on demand.',
    '- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.yarah/project.json`. Never hardcode or commit keys.',
    '',
    'Key patterns:',
    '',
    '- Database inserts take an array: `insert([{ ... }])`.',
    '- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.',
    '- For storage uploads, persist both the returned `url` and `key`.',
    AGENTS_MD_END,
  );

  return lines.join('\n');
}

/**
 * Pure merge of the Yarah block into AGENTS.md content.
 *
 * - No existing file (or blank): create one with a top-level heading.
 * - Existing file with our markers: replace the block in place (idempotent,
 *   the file never grows on repeated runs).
 * - Existing file without our markers: append the block, preserving the user's
 *   own content above it.
 */
export function mergeAgentsMd(existing: string | null, config: ProjectConfig | null): string {
  const block = buildYarahBlock(config);

  if (existing === null || existing.trim() === '') {
    return `# AGENTS.md\n\n${block}\n`;
  }

  const startIdx = existing.indexOf(AGENTS_MD_START);
  if (startIdx !== -1) {
    // Close the block at the END marker that follows this START (not the first
    // END in the file, which could be a stray marker in the user's own content
    // above the block). If the block was corrupted by removing its END marker,
    // replace from START through end-of-file so we recover in place instead of
    // appending a duplicate block on the next run.
    const endMarkerIdx = existing.indexOf(AGENTS_MD_END, startIdx + AGENTS_MD_START.length);
    let before = existing.slice(0, startIdx);
    if (before.length > 0 && !before.endsWith('\n')) before += '\n';
    const after = endMarkerIdx === -1 ? '\n' : existing.slice(endMarkerIdx + AGENTS_MD_END.length);
    return `${before}${block}${after}`;
  }

  // No Yarah block yet — append it, separated by a blank line.
  return `${existing.replace(/\s+$/, '')}\n\n${block}\n`;
}

/**
 * Writes (or refreshes) the Yarah section of `AGENTS.md` in the project
 * directory so bare agent harnesses that read `./AGENTS.md` get Yarah
 * context. Unlike the per-agent skill directories, AGENTS.md is left out of
 * .gitignore so it can be committed and shared with the team.
 *
 * Best-effort: callers wrap this so a write failure never aborts create/link.
 */
export function writeLocalAgentsMd(
  json: boolean,
  opts?: { cwd?: string; config?: ProjectConfig | null },
): void {
  const cwd = opts?.cwd ?? process.cwd();
  const config = opts?.config !== undefined ? opts.config : getProjectConfig();
  const path = join(cwd, 'AGENTS.md');

  const existed = existsSync(path);
  const existing = existed ? readFileSync(path, 'utf-8') : null;
  const next = mergeAgentsMd(existing, config);
  if (existing === next) return; // already up to date

  writeFileSync(path, next);
  if (!json) {
    clack.log.success(
      existed
        ? 'Updated AGENTS.md with Yarah guidance.'
        : 'Created AGENTS.md with Yarah guidance.',
    );
  }
}
