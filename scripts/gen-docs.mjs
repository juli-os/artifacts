// docs-as-code: copy README.md verbatim to docs/index.md.
// Pure node, zero dependencies. Idempotent: identical content is not rewritten.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'README.md');
const dest = join(root, 'docs', 'index.md');

const readme = await readFile(src, 'utf8');
let current = null;
try {
  current = await readFile(dest, 'utf8');
} catch {
  // first run — dest does not exist yet
}

if (current !== readme) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, readme);
}
