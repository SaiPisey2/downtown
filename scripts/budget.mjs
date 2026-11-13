// Size budget for the built site in dist/: run after `vite build`.
// All JavaScript together at most 600 kB gzipped; any other file at most 200 kB as it is.
// The main bundle (the script index.html loads) is held by the first limit only.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist';
const JS_GZIP_LIMIT = 600 * 1024;
const FILE_LIMIT = 200 * 1024;

const kB = (n) => `${(n / 1024).toFixed(1)} kB`;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let all;
try {
  all = files(DIST);
} catch {
  console.error(`budget: no ${DIST}/ folder; run the build first`);
  process.exit(1);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entry = /<script[^>]*type="module"[^>]*src="(?:\.\/)?([^"]+)"/.exec(html)?.[1];
if (!entry) {
  console.error('budget: cannot find the main script in dist/index.html');
  process.exit(1);
}
const main = join(DIST, entry);

const breaches = [];
let jsRaw = 0;
let jsGzip = 0;
for (const path of all) {
  const raw = readFileSync(path);
  const name = relative(DIST, path);
  if (path.endsWith('.js')) {
    const gz = gzipSync(raw, { level: 9 }).length;
    jsRaw += raw.length;
    jsGzip += gz;
    console.log(`  ${name}  ${kB(raw.length)}  (${kB(gz)} gzipped)${path === main ? '  main bundle' : ''}`);
  }
  if (path !== main && raw.length > FILE_LIMIT) breaches.push(`${name} is ${kB(raw.length)}, over the ${kB(FILE_LIMIT)} limit for one file`);
}
if (jsGzip > JS_GZIP_LIMIT) breaches.push(`JavaScript is ${kB(jsGzip)} gzipped, over the ${kB(JS_GZIP_LIMIT)} limit`);

console.log(`JavaScript: ${kB(jsRaw)}, ${kB(jsGzip)} gzipped (limit ${kB(JS_GZIP_LIMIT)}); ${all.length} files in ${DIST}/`);
if (breaches.length) {
  for (const b of breaches) console.error(`budget: ${b}`);
  process.exit(1);
}
console.log('budget: within limits');
