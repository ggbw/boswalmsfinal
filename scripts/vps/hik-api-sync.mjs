#!/usr/bin/env node
/**
 * Hik-Connect OpenAPI → Lovable attendance ingest  (MULTI-ACCOUNT)
 *
 * Syncs every Hik-Connect account listed in accounts.json into the same
 * Supabase, via the ingest-attendance edge function. Each Hik-Connect account
 * caps at 100 registered persons, so additional accounts are created as
 * headcount grows. To cover a new account: add one entry to accounts.json.
 * No per-account folders, no extra cron lines.
 *
 * Deploy to: /opt/hik-sync/hik-api-sync.mjs
 *
 * USAGE:
 *   node hik-api-sync.mjs                        # ingest yesterday (daily cron)
 *   node hik-api-sync.mjs --today                # ingest today (every-5-min poll)
 *   node hik-api-sync.mjs 2026-05-13             # a single specific day
 *   node hik-api-sync.mjs 2026-05-08 2026-05-14  # a date range (backfill)
 *   node hik-api-sync.mjs --list-devices         # dump device lists (all accounts) and exit
 *   node hik-api-sync.mjs --account=dunlop-two   # restrict to one account (by name)
 *   node hik-api-sync.mjs --dry-run [dates]      # fetch + map but don't POST
 *   node hik-api-sync.mjs --quiet                # one-line output unless interesting
 *   node hik-api-sync.mjs --force-device-refresh # bypass device-list cache
 *
 * READS:
 *   /opt/hik-sync/.env           (LOVABLE_FUNCTION_URL, HIK_SYNC_SECRET, TZ_OFFSET — shared)
 *   /opt/hik-sync/accounts.json  ([{ name, apiKey, apiSecret, enabled }] — one per Hik-Connect account)
 *                                Falls back to HIK_API_KEY/HIK_API_SECRET in .env if the file is absent.
 * WRITES (per account, keyed by name):
 *   /opt/hik-sync/.hik-token-<name>.json    (cached token)
 *   /opt/hik-sync/.hik-devices-<name>.json  (cached device list, 1-hour lifetime)
 *   /opt/hik-sync/.hik-api-sync.lock        (single run lock; auto-released on exit)
 *   /var/log/hik-api.log                    (when redirected from cron)
 */

import fs from 'node:fs'

// ─── Configuration ─────────────────────────────────────────────────────────
const API_BASE = 'https://ieu.hikcentralconnect.com'
// Boswa runs on the SAME Contabo box as Dunlop (/opt/hik-sync). Keep Boswa in its
// own folder so tokens, device caches, the run lock and config never collide.
const BASE_DIR = '/opt/hik-sync-boswa'
const ENV_PATH = `${BASE_DIR}/.env`
const ACCOUNTS_PATH = `${BASE_DIR}/accounts.json`
const LOCK_FILE = `${BASE_DIR}/.hik-api-sync.lock`
const LOCK_STALE_MS = 10 * 60 * 1000         // 10 min: consider an existing lock stale
const DEVICES_CACHE_TTL_MS = 60 * 60 * 1000  // 1 hour
const TZ_OFFSET = '+02:00'                   // Botswana CAT
const TZ_OFFSET_MINUTES = 120
const PAGE_SIZE = 200
const POST_CHUNK = 500

const tokenCachePath   = (name) => `${BASE_DIR}/.hik-token-${name}.json`
const devicesCachePath = (name) => `${BASE_DIR}/.hik-devices-${name}.json`

// ─── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const quiet = args.includes('--quiet')
const dryRun = args.includes('--dry-run')
const listOnly = args.includes('--list-devices')
const forceDeviceRefresh = args.includes('--force-device-refresh')
const useToday = args.includes('--today')
const accountFilter = (args.find(a => a.startsWith('--account=')) || '').split('=')[1] || null
const dateArgs = args.filter(a => !a.startsWith('--'))

// ─── Logger ────────────────────────────────────────────────────────────────
let verboseLines = []
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`
  if (quiet) verboseLines.push(line)
  else console.log(line)
}
const err = (...a) => {
  console.error(`[${new Date().toISOString()}] ${a.join(' ')}`)
}
const summary = (line) => {
  console.log(`[${new Date().toISOString()}] ${line}`)
}
function flushVerbose() {
  for (const l of verboseLines) console.log(l)
  verboseLines = []
}

// ─── File lock (single run, covers all accounts) ───────────────────────────
function acquireLock() {
  try {
    const existing = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
    const age = Date.now() - existing.acquiredAt
    if (age < LOCK_STALE_MS) {
      summary(`SKIP: another run is in progress (pid=${existing.pid}, age=${Math.round(age/1000)}s)`)
      process.exit(0)
    } else {
      log(`Found stale lock (age ${Math.round(age/1000)}s); overwriting`)
    }
  } catch (_) { /* no lock or invalid; ok to proceed */ }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }))
  fs.chmodSync(LOCK_FILE, 0o600)
}
function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE) } catch (_) {}
}
process.on('exit', releaseLock)
process.on('SIGINT', () => { releaseLock(); process.exit(130) })
process.on('SIGTERM', () => { releaseLock(); process.exit(143) })

// ─── Load shared .env ──────────────────────────────────────────────────────
const env = Object.fromEntries(
  fs.readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const [k, ...rest] = l.split('=')
      return [k.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')]
    })
)
const INGEST_URL = env.LOVABLE_FUNCTION_URL || env.LOVABLE_INGEST_URL
const INGEST_SECRET = env.HIK_SYNC_SECRET
if (!INGEST_URL)    { err('Missing LOVABLE_FUNCTION_URL or LOVABLE_INGEST_URL'); process.exit(1) }
if (!INGEST_SECRET) { err('Missing HIK_SYNC_SECRET'); process.exit(1) }

// ─── Load accounts (accounts.json, else single-account .env fallback) ──────
function loadAccounts() {
  let raw
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'))
    raw = Array.isArray(parsed) ? parsed : parsed.accounts
  } catch (_) { raw = null }

  if (Array.isArray(raw) && raw.length) {
    return raw
      .filter(a => a && a.name && a.apiKey && a.apiSecret)
      .map(a => ({ name: String(a.name), apiKey: a.apiKey, apiSecret: a.apiSecret, enabled: a.enabled !== false }))
  }
  // Fallback: legacy single-account .env. Keeps the original install working
  // before accounts.json exists.
  if (env.HIK_API_KEY && env.HIK_API_SECRET) {
    return [{ name: 'default', apiKey: env.HIK_API_KEY, apiSecret: env.HIK_API_SECRET, enabled: true }]
  }
  return []
}

// ─── Date helpers ──────────────────────────────────────────────────────────
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayBotswana() {
  const nowBw = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000)
  return `${nowBw.getUTCFullYear()}-${String(nowBw.getUTCMonth() + 1).padStart(2, '0')}-${String(nowBw.getUTCDate()).padStart(2, '0')}`
}
function yesterdayBotswana() {
  const nowBw = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000)
  nowBw.setUTCDate(nowBw.getUTCDate() - 1)
  return `${nowBw.getUTCFullYear()}-${String(nowBw.getUTCMonth() + 1).padStart(2, '0')}-${String(nowBw.getUTCDate()).padStart(2, '0')}`
}
function utcToBotswanaLocal(utcIsoString) {
  const d = new Date(utcIsoString)
  if (isNaN(d.getTime())) return null
  const bw = new Date(d.getTime() + TZ_OFFSET_MINUTES * 60_000)
  const date = ymd(new Date(Date.UTC(bw.getUTCFullYear(), bw.getUTCMonth(), bw.getUTCDate())))
  const time = `${String(bw.getUTCHours()).padStart(2, '0')}:${String(bw.getUTCMinutes()).padStart(2, '0')}:${String(bw.getUTCSeconds()).padStart(2, '0')}`
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][bw.getUTCDay()]
  return { punch_date: date, punch_time: time, punch_at: `${date}T${time}${TZ_OFFSET}`, weekday }
}

// ─── Token: cache-then-refresh (per account) ───────────────────────────────
async function getToken(account) {
  const cachePath = tokenCachePath(account.name)
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (cached.accessToken && cached.expireTime && cached.expireTime * 1000 > Date.now() + 60_000 && cached.fetchedAt && (Date.now() - cached.fetchedAt) < 12 * 60 * 60_000) {
      return cached.accessToken
    }
  } catch (_) {}

  log(`[${account.name}] Fetching fresh token from Hik-Connect...`)
  const res = await fetch(`${API_BASE}/api/hccgw/platform/v1/token/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey: account.apiKey, secretKey: account.apiSecret }),
  })
  const body = await res.json()
  if (body.errorCode !== '0') throw new Error(`Token failed: ${JSON.stringify(body)}`)
  fs.writeFileSync(cachePath, JSON.stringify({ ...body.data, fetchedAt: Date.now() }, null, 2))
  fs.chmodSync(cachePath, 0o600)
  log(`[${account.name}] Token cached (expires ${new Date(body.data.expireTime * 1000).toISOString()})`)
  return body.data.accessToken
}

// ─── Device list with 1-hour cache (per account) ───────────────────────────
async function getDeviceMap(token, account) {
  const cachePath = devicesCachePath(account.name)
  if (!forceDeviceRefresh) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
      if (cached.fetchedAt && Date.now() - cached.fetchedAt < DEVICES_CACHE_TTL_MS) {
        log(`[${account.name}] Using cached device list (${cached.list.length} devices, age ${Math.round((Date.now() - cached.fetchedAt)/1000/60)}m)`)
        return rebuildMaps(cached.list)
      }
    } catch (_) {}
  }

  log(`[${account.name}] Fetching device list from Hik-Connect...`)
  const res = await fetch(`${API_BASE}/api/hccgw/resource/v1/devices/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Token': token },
    body: JSON.stringify({ pageIndex: 1, pageSize: 500, deviceCategory: 'accessControllerDevice' }),
  })
  const body = await res.json()
  if (body.errorCode !== '0') throw new Error(`Device list failed: ${JSON.stringify(body)}`)
  const list = body.data?.device ?? []
  log(`[${account.name}] Found ${list.length} device(s) in Hik-Connect`)
  for (const d of list) {
    log(`  - ${d.name.padEnd(15)} serial=${d.serialNo}  online=${d.onlineStatus === 1 ? 'yes' : 'no'}  tz=${d.timeZone}`)
  }
  fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt: Date.now(), list }, null, 2))
  fs.chmodSync(cachePath, 0o600)
  return rebuildMaps(list)
}
function rebuildMaps(list) {
  const byId = {}
  const byName = {}
  for (const d of list) {
    const entry = { id: d.id, name: d.name, serial: d.serialNo, type: d.type, online: d.onlineStatus === 1, timeZone: d.timeZone }
    byId[d.id] = entry
    byName[d.name] = entry
  }
  return { byId, byName, list }
}

// ─── Attendance fetch with pagination ──────────────────────────────────────
async function fetchAttendance(token, account, beginTime, endTime) {
  const url = `${API_BASE}/api/hccgw/acs/v1/event/certificaterecords/search`
  let pageIndex = 1
  let allRecords = []
  let totalNum = null

  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Token': token },
      body: JSON.stringify({
        pageIndex,
        pageSize: PAGE_SIZE,
        searchCriteria: { beginTime, endTime, type: 0, swipeAuthResult: 1, searchType: 0 },
      }),
    })
    const body = await res.json()
    if (body.errorCode !== '0') throw new Error(`Search failed: ${JSON.stringify(body)}`)
    const records = body.data?.recordList ?? []
    totalNum = body.data?.totalNum ?? records.length
    allRecords.push(...records)
    if (records.length === PAGE_SIZE && allRecords.length < totalNum) {
      log(`  [${account.name}] page ${pageIndex}: ${records.length} record(s)  (running total ${allRecords.length} / ${totalNum})`)
      pageIndex++
      if (pageIndex > 50) { err(`[${account.name}] Safety cap of 50 pages hit`); break }
    } else {
      if (pageIndex > 1 || records.length > 0) {
        log(`  [${account.name}] page ${pageIndex}: ${records.length} record(s)  (total ${allRecords.length} / ${totalNum})`)
      }
      break
    }
  }
  return allRecords
}

// ─── Map RecordInfo → DB payload ───────────────────────────────────────────
function mapRecord(record, deviceMap) {
  const apiDeviceName = record.deviceName ?? null
  const apiDeviceId = record.deviceId ?? null
  const deviceEntry =
    (apiDeviceId && deviceMap.byId[apiDeviceId]) ||
    (apiDeviceName && deviceMap.byName[apiDeviceName]) ||
    null
  if (!deviceEntry) return { skip: true, reason: `unknown device: name="${apiDeviceName}" id="${apiDeviceId}"` }

  const person = record.personInfo
  const base = person?.baseInfo
  if (!person || !base) return { skip: true, reason: 'missing personInfo' }
  const employeeId = String(base.personCode ?? '').trim()
  if (!employeeId) {
    // Name the person so it's clear WHO needs a Person ID set in Hik-Connect —
    // these punches are dropped until that account assigns them an employee code.
    const nm = [base.firstName, base.lastName].filter(Boolean).join(' ').trim() || '(unnamed)'
    return { skip: true, reason: `missing personCode — ${nm}` }
  }

  const t = utcToBotswanaLocal(record.recordTime || record.occurTime)
  if (!t) return { skip: true, reason: `bad timestamp: recordTime=${record.recordTime} occurTime=${record.occurTime}` }

  const firstName = base.firstName || null
  const lastName = base.lastName && base.lastName !== '--' ? base.lastName : null
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || firstName || null

  return {
    skip: false,
    payload: {
      device_serial: deviceEntry.serial,
      device_name: deviceEntry.name,
      employee_id: employeeId,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      department: base.fullPath || null,
      punch_date: t.punch_date,
      punch_time: t.punch_time,
      punch_at: t.punch_at,
      weekday: t.weekday,
      data_source: 'hik-openapi',
      punch_state: null,
      raw_row: record,
    },
  }
}

// ─── POST to Edge Function ─────────────────────────────────────────────────
async function postRecords(records, account) {
  if (!records.length) return { inserted: 0, skipped: 0, errors: 0 }
  let totalInserted = 0, totalSkipped = 0, totalErrors = 0
  for (let i = 0; i < records.length; i += POST_CHUNK) {
    const chunk = records.slice(i, i + POST_CHUNK)
    log(`  [${account.name}] Posting chunk ${i / POST_CHUNK + 1}: ${chunk.length} record(s)...`)
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-key': INGEST_SECRET },
      body: JSON.stringify({
        source: 'hik-api-sync',
        account: account.name,
        filename: `api-fetch-${account.name}-${new Date().toISOString().slice(0, 10)}.json`,
        records: chunk,
      }),
    })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = null }
    if (!res.ok) {
      err(`  [${account.name}] Chunk failed: HTTP ${res.status} ${text.substring(0, 300)}`)
      totalErrors += chunk.length
      continue
    }
    const inserted = body?.inserted ?? body?.records_inserted ?? 0
    const skipped = body?.skipped ?? body?.duplicates_skipped ?? body?.rows_skipped ?? 0
    log(`    [${account.name}] Chunk ok: inserted=${inserted} skipped=${skipped}`)
    totalInserted += inserted
    totalSkipped += skipped
  }
  return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors }
}

// ─── Per-account pipeline ──────────────────────────────────────────────────
async function processAccount(account, startDate, endDate) {
  const token = await getToken(account)
  const deviceMap = await getDeviceMap(token, account)

  if (listOnly) {
    return { name: account.name, devices: deviceMap.list.length, inserted: 0, skipped: 0, errors: 0 }
  }

  const beginTime = `${startDate}T00:00:00${TZ_OFFSET}`
  const endTimeISO = `${endDate}T23:59:59${TZ_OFFSET}`
  const records = await fetchAttendance(token, account, beginTime, endTimeISO)

  const payloads = []
  const skips = {}
  for (const r of records) {
    const mapped = mapRecord(r, deviceMap)
    if (mapped.skip) skips[mapped.reason] = (skips[mapped.reason] ?? 0) + 1
    else payloads.push(mapped.payload)
  }
  log(`[${account.name}] Got ${records.length} from API; mapped ${payloads.length}; skipped ${records.length - payloads.length}`)
  for (const [reason, count] of Object.entries(skips)) {
    log(`  [${account.name}] skip reason: ${reason}: ${count}`)
  }

  if (dryRun) {
    if (payloads[0]) log(`[${account.name}] Sample payload: ` + JSON.stringify(payloads[0]))
    return { name: account.name, devices: deviceMap.list.length, inserted: 0, skipped: 0, errors: 0, dryRunMapped: payloads.length }
  }

  if (!payloads.length) {
    return { name: account.name, devices: deviceMap.list.length, inserted: 0, skipped: 0, errors: 0 }
  }

  const result = await postRecords(payloads, account)
  return { name: account.name, devices: deviceMap.list.length, ...result }
}

// ─── Main ──────────────────────────────────────────────────────────────────
acquireLock()

let startDate, endDate
if (dateArgs.length === 0) {
  startDate = endDate = useToday ? todayBotswana() : yesterdayBotswana()
} else if (dateArgs.length === 1) {
  startDate = endDate = dateArgs[0]
} else {
  startDate = dateArgs[0]; endDate = dateArgs[1]
}

let accounts = loadAccounts()
if (accountFilter) accounts = accounts.filter(a => a.name === accountFilter)
const active = accounts.filter(a => a.enabled)

log(`=== hik-api-sync starting === mode=${listOnly ? 'list-devices' : (dryRun ? 'dry-run' : 'live')}  accounts=${active.map(a => a.name).join(',') || '(none)'}  range: ${startDate} → ${endDate}`)

if (!active.length) {
  err('No enabled accounts found (checked accounts.json and .env fallback).')
  process.exit(1)
}

// Hik-Connect can invalidate a token before its stated expiry. The cached
// token then yields TOKEN_NOT_FOUND / expired errors on the device or
// attendance calls. Detect that so we can drop the cache and refetch.
function isTokenError(e) {
  const m = String(e?.message ?? e).toUpperCase()
  return m.includes('TOKEN_NOT_FOUND') || m.includes('OPEN000006') ||
         m.includes('TOKEN_EXPIRED')  || m.includes('TOKEN_INVALID')
}

const results = []
let fatalErrors = 0
for (const account of active) {
  try {
    results.push(await processAccount(account, startDate, endDate))
  } catch (e) {
    // Self-heal a rejected token: clear the cached token and retry ONCE with a
    // fresh one (getToken refetches when the cache file is missing). Without
    // this, an invalidated token makes the account fail silently for hours
    // until the cache naturally ages out.
    if (isTokenError(e)) {
      log(`[${account.name}] token rejected (${e.message}); clearing cache and retrying once`)
      try { fs.unlinkSync(tokenCachePath(account.name)) } catch (_) {}
      try {
        results.push(await processAccount(account, startDate, endDate))
        continue
      } catch (e2) {
        fatalErrors++
        err(`[${account.name}] FAILED after token refresh: ${e2.message}`)
        results.push({ name: account.name, devices: 0, inserted: 0, skipped: 0, errors: 0, failed: true })
        continue
      }
    }
    // Isolate failures: one bad account must not stop the others.
    fatalErrors++
    err(`[${account.name}] FAILED: ${e.message}`)
    results.push({ name: account.name, devices: 0, inserted: 0, skipped: 0, errors: 0, failed: true })
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────
const totals = results.reduce((t, r) => ({
  inserted: t.inserted + (r.inserted || 0),
  skipped:  t.skipped + (r.skipped || 0),
  errors:   t.errors + (r.errors || 0),
}), { inserted: 0, skipped: 0, errors: 0 })

if (listOnly) {
  if (quiet) flushVerbose()
  for (const r of results) summary(`account ${r.name}: ${r.failed ? 'FAILED' : `${r.devices} device(s)`}`)
  process.exit(fatalErrors ? 1 : 0)
}

if (dryRun) {
  if (quiet) flushVerbose()
  summary(`--dry-run; not posted. ` + results.map(r => `${r.name}=${r.dryRunMapped ?? 0}`).join(' '))
  process.exit(fatalErrors ? 1 : 0)
}

const interesting = totals.inserted > 0 || totals.errors > 0 || fatalErrors > 0
if (quiet) {
  if (interesting) {
    flushVerbose()
    summary(`=== done === inserted=${totals.inserted} dedup=${totals.skipped} errors=${totals.errors} failedAccounts=${fatalErrors}`)
  } else {
    summary(`OK: 0 new across ${active.length} account(s), ${totals.skipped} dedup'd`)
  }
} else {
  summary(`=== hik-api-sync done === inserted=${totals.inserted} dedup=${totals.skipped} errors=${totals.errors} failedAccounts=${fatalErrors}`)
  for (const r of results) summary(`  ${r.name}: inserted=${r.inserted || 0} dedup=${r.skipped || 0} ${r.failed ? 'FAILED' : ''}`)
}

process.exit(totals.errors > 0 || fatalErrors > 0 ? 1 : 0)
