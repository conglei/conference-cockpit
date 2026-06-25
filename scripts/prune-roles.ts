/**
 * CLI: prune non-relevant roles already in the DB (issue #42 cleanup).
 *
 *   pnpm prune-roles
 *
 * Loads every `roles` row and deletes the ones whose title fails
 * {@link isRelevantRole} (non-engineering or explicitly junior) — the same gate
 * find-jobs now applies at insert time, applied retroactively to clear the
 * non-eng roles already swept in before the filter existed.
 *
 * Guard: a role referenced by an `applications` row is never deleted (there are
 * none today, but we check anyway rather than orphan the FK). Read-only otherwise.
 */
import { loadEnvFile } from "../src/onboarding/load-env";
import { createDb, DB_URL } from "../src/db/client";
import { createRoleRepo } from "../src/db/repository";
import { createApplicationRepo } from "../src/db/applications-repository";
import { isRelevantRole } from "../src/roles";

// tsx does not auto-load .env.local; do it before touching the DB.
loadEnvFile();

function main() {
  const db = createDb(DB_URL);
  const roles = createRoleRepo(db);
  const applications = createApplicationRepo(db);

  const all = roles.list();
  // Role ids referenced by an application — these are off-limits for deletion.
  const referenced = new Set(applications.list().map((a) => a.roleId));

  let pruned = 0;
  for (const role of all) {
    if (isRelevantRole(role.title)) continue;
    if (referenced.has(role.id)) {
      console.log(`· kept     ${role.title} (#${role.id}) — referenced by an application`);
      continue;
    }
    roles.delete(role.id);
    console.log(`✗ ${role.title}`);
    pruned += 1;
  }

  console.log(`Pruned ${pruned} of ${all.length} roles`);
}

main();
