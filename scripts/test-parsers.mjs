// Parser smoke-test for tracks. Run: node scripts/test-parsers.mjs
// Loads YAML tracks from Agent.PD/learning/tracker/tracks/ and prints what the dashboard would render.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const AGENT_PD = process.argv[2] ?? 'C:\\Users\\pradiphe\\src\\study-tracker-content';
const TRACKS_DIR = join(AGENT_PD, 'tracks');

const files = readdirSync(TRACKS_DIR).filter((n) => /\.ya?ml$/.test(n) && !n.startsWith('_'));
const tracks = [];
for (const f of files) {
  const text = readFileSync(join(TRACKS_DIR, f), 'utf8');
  try {
    const parsed = yaml.load(text);
    if (parsed && parsed.id && Array.isArray(parsed.items)) tracks.push(parsed);
  } catch (e) {
    console.error(`  ✗ ${f}: ${e.message}`);
  }
}
tracks.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

console.log(`\n→ Tracks at ${TRACKS_DIR}`);
let totalItems = 0;
let totalHours = 0;
const seenItemIds = new Set();
const dupIds = new Set();

for (const t of tracks) {
  const items = t.items.filter((i) => !i.deprecated);
  totalItems += items.length;
  totalHours += t.estimatedHours ?? 0;
  console.log(`  [${String(t.priority ?? '·').padStart(2)}] ${t.id.padEnd(28)} items=${String(items.length).padStart(3)}  hrs=${String(t.estimatedHours ?? '-').padStart(3)}  ${t.title}`);
  for (const i of items) {
    if (seenItemIds.has(i.id)) dupIds.add(i.id);
    seenItemIds.add(i.id);
    if (!i.id || !i.title || !i.kind) {
      console.log(`    ✗ malformed item: ${JSON.stringify(i)}`);
    }
  }
  const declaredSections = new Set((t.sections ?? []).map((s) => s.id));
  for (const i of items) {
    if (i.section && declaredSections.size > 0 && !declaredSections.has(i.section)) {
      console.log(`    ⚠ item ${i.id} references undeclared section "${i.section}"`);
    }
  }
}

console.log(`\n→ Summary: ${tracks.length} tracks, ${totalItems} items, ~${totalHours} estimated hours`);
if (dupIds.size > 0) {
  console.log(`  ✗ duplicate item IDs across tracks: ${[...dupIds].join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  ✓ all item IDs unique across tracks');
}
