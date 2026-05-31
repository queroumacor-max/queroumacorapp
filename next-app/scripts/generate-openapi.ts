// scripts/generate-openapi.ts — STUB.
//
// Today `next-app/openapi.yaml` is hand-maintained (mirror of the vanilla
// `openapi.yaml` at the repo root, adjusted for the Next.js routes — see
// the file header for deltas). Whenever a route handler changes its
// request/response shape, bump the YAML by hand.
//
// TODO (Backend#22 follow-up): wire a real generator so the YAML stays
// in sync automatically. Two paths in order of preference:
//
//   1. `next-openapi-gen` (https://github.com/jakubmazanec/next-openapi-gen
//      — community Next.js-aware extractor that crawls `app/**/route.ts`
//      and reads JSDoc `@openapi` blocks). Minimal code rewriting; we'd
//      add a JSDoc block above each handler.
//
//   2. `tsoa` (https://tsoa-community.github.io/docs/) — requires
//      decorators (`@Route`, `@Post`, `@Body`) on each handler, which
//      means rewriting the route files. Heavier migration but gives
//      runtime validation + DI as a bonus.
//
// Either approach should:
//   - Read TypeScript types from `lib/types.ts` (domain) + Zod schemas
//     from `lib/schemas.ts` (validation) — `zod-to-openapi` can convert
//     a Zod schema directly into a JSON Schema component.
//   - Pull the per-endpoint rate limit + auth model from a small
//     metadata object exported alongside each handler.
//   - Emit a YAML byte-equivalent to the hand-maintained one (run in CI:
//     "regenerate; assert no diff").
//
// Until this is done, treat the YAML as source-of-truth: PR review for
// any backend change should check that the spec was bumped in lockstep.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

async function main(): Promise<void> {
  const yamlPath = join(__dirname, '..', 'openapi.yaml');
  const yaml = readFileSync(yamlPath, 'utf8');
  // Today: just sanity-check the file exists and isn't empty. Tomorrow:
  // call into next-openapi-gen / tsoa and compare against the on-disk
  // YAML, failing CI if they drift.
  if (yaml.length < 100) {
    throw new Error(`openapi.yaml looks empty: ${yamlPath}`);
  }
  console.log(
    `[generate-openapi] hand-maintained spec OK (${yaml.length} bytes). ` +
      `See TODO at top of this file for the automation plan.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
