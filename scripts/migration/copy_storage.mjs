// Copies every stored file from the Lovable Cloud project to the target
// Supabase project. Upload only: nothing is deleted on either side, and a file
// already present on the target is left as it is.
//
// The file list comes from the export (storage.objects rows), so the copy
// matches the database snapshot. Source files are read as the super_admin
// user (RLS lets that role read every bucket); uploads use the target's
// service role key, which stays in the local env file.
//
// Usage: node copy_storage.mjs <objects.copy> <buckets.copy>
//   objects.copy / buckets.copy: `pg_restore --data-only` output for
//   storage.objects and storage.buckets (run_restore.sh writes them).
// Env: SOURCE_URL, SOURCE_ADMIN_EMAIL, SOURCE_ADMIN_PASSWORD,
//      TARGET_URL, TARGET_SERVICE_ROLE_KEY

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClient } = require('../../node_modules/@supabase/supabase-js');

const CONCURRENCY = 6;
const LIVE_SITE = 'https://boswalms.automate.co.bw';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

// Parses pg_restore COPY output into row objects keyed by column name.
function readCopy(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith('COPY '));
  const cols = lines[start].match(/\((.*)\) FROM stdin/)[1].split(', ').map((c) => c.replace(/"/g, ''));
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line === '\\.') break;
    const vals = line.split('\t').map((v) => (v === '\\N' ? null : v.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')));
    rows.push(Object.fromEntries(cols.map((c, i) => [c, vals[i]])));
  }
  return rows;
}

// The publishable key is public: the live site ships it in its bundle.
async function sourceAnonKey() {
  const html = await (await fetch(LIVE_SITE)).text();
  const bundle = html.match(/\/assets\/index-[^"]+\.js/)[0];
  const js = await (await fetch(LIVE_SITE + bundle)).text();
  return js.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)[0];
}

async function main() {
  const [objectsPath, bucketsPath] = process.argv.slice(2);
  // Lovable keeps its own database exports in database_export_* buckets: full
  // dumps that don't belong in the client's project.
  const isAppBucket = (id) => !id.startsWith('database_export_');
  const objects = readCopy(objectsPath).filter((o) => isAppBucket(o.bucket_id));
  const buckets = readCopy(bucketsPath).filter((b) => isAppBucket(b.id));

  const source = createClient(need('SOURCE_URL'), await sourceAnonKey(), { auth: { persistSession: false } });
  const { error: loginError } = await source.auth.signInWithPassword({
    email: need('SOURCE_ADMIN_EMAIL'),
    password: need('SOURCE_ADMIN_PASSWORD'),
  });
  if (loginError) throw new Error(`source sign-in failed: ${loginError.message}`);

  const target = createClient(need('TARGET_URL'), need('TARGET_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  for (const b of buckets) {
    const opts = {
      public: b.public === 't',
      fileSizeLimit: b.file_size_limit ? Number(b.file_size_limit) : undefined,
      allowedMimeTypes: b.allowed_mime_types ? b.allowed_mime_types.replace(/[{}"]/g, '').split(',').filter(Boolean) : undefined,
    };
    const { error } = await target.storage.createBucket(b.id, opts);
    if (error && !/already exists/i.test(error.message)) throw new Error(`bucket ${b.id}: ${error.message}`);
    out(`bucket ${b.id}: ${error ? 'already there' : 'created'}`);
  }

  const failures = [];
  let copied = 0;
  let skipped = 0;
  let next = 0;
  async function worker() {
    while (next < objects.length) {
      const o = objects[next++];
      const meta = o.metadata ? JSON.parse(o.metadata) : {};
      const { data, error } = await source.storage.from(o.bucket_id).download(o.name);
      if (error) {
        failures.push(`${o.bucket_id}/${o.name}\tdownload: ${error.message}`);
        continue;
      }
      const { error: upError } = await target.storage
        .from(o.bucket_id)
        .upload(o.name, data, { contentType: meta.mimetype, cacheControl: meta.cacheControl?.replace('max-age=', ''), upsert: false });
      if (upError && /exists|duplicate/i.test(upError.message)) skipped++;
      else if (upError) failures.push(`${o.bucket_id}/${o.name}\tupload: ${upError.message}`);
      else copied++;
      const done = copied + skipped + failures.length;
      if (done % 100 === 0) out(`${done}/${objects.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  writeFileSync('storage_failures.txt', failures.join('\n'));
  out(`files: ${objects.length} listed, ${copied} copied, ${skipped} already there, ${failures.length} failed (see storage_failures.txt)`);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
