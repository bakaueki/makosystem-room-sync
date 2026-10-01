// 部屋の同期。自分の部屋と、相手（もう一つのシステム）の部屋を双方向に写す。
//
//   npm run room-sync      ← 画面とブリッジとは別の黒い窓で動かす。止める時は Ctrl+C
//
// 3 秒ごとに次の 2 つをする。
//   (a) 送る  : 自分の部屋で書き上がった投稿（kind='chat'）を相手へ POST する
//   (b) 受け取る: 相手の部屋の新着を GET して、自分の DB に sender='remote:<名前>' で入れる
//
// 通信は必ずこちらから相手への外向きだけ。こちらは 127.0.0.1 で待つだけで、外から入る道は作らない。
// 相手の投稿に @commander のような自分の AI の名前が入っていた時だけ、その行を pending にして
// 自分の AI を起こす。@ が無い投稿で起こすと、AI 同士の返事が往復して止まらなくなるため。
//
// 使う設定（.env）:
//   ROOM_SYNC_URL     相手の受け口（例 https://sync.makoman.uk）
//   ROOM_SYNC_SECRET  合言葉（相手と同じ値）
//   ROOM_SYNC_SITE    自分の拠点名（英数字と - _。例 partner）
//   ROOM_SYNC_ROOMS   <自分の部屋 id>=<相手の部屋 id> をカンマ区切り
//   ROOM_SYNC_HUMAN_NAME  相手の画面に出る自分（人）の名前。省略時「パートナー」
// 詳しくは docs/room-sync.md
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { pulledSyncTargets } from '../lib/room-sync-routing.mjs'

const ROOT = process.env.MAKO_ROOT
  ? path.resolve(process.env.MAKO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'makosystem.db')
const AGENTS_JSON = path.join(DATA_DIR, 'agents', 'agents.json')
const LOG_PATH = path.join(DATA_DIR, 'room-sync.log')

const INTERVAL_MS = 3_000
/** 1 回に送る件数。溜まっていても 3 秒ごとに少しずつ流す */
const PUSH_BATCH = 20
/** 相手に弾かれ続ける投稿（中身の問題）は、この回数で諦めて先へ進む */
const GIVE_UP_AFTER = 5
/** 相手の AI 発の投稿で自分の AI を起こす上限（部屋ごと・10 分あたり）。無限往復の歯止め */
const AI_WAKE_MAX = 10
const AI_WAKE_WINDOW_MS = 10 * 60_000
const LOG_MAX_BYTES = 5 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

// ─── 記録 ─────────────────────────────────────────────

function log(line) {
  const text = `${new Date().toISOString()} ${line}`
  console.log(text)
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    try {
      if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) fs.renameSync(LOG_PATH, `${LOG_PATH}.1`)
    } catch {
      // まだ無い
    }
    fs.appendFileSync(LOG_PATH, text + '\n')
  } catch {
    // ログが書けなくても同期は止めない
  }
}

/** 同じ失敗を 3 秒ごとに書き続けてログを埋めないよう、内容が変わった時だけ書く */
const lastProblem = new Map()
function logOnce(key, line) {
  if (lastProblem.get(key) === line) return
  lastProblem.set(key, line)
  log(line)
}
function clearProblem(key) {
  if (lastProblem.has(key)) {
    lastProblem.delete(key)
    log(`[${key}] 復旧した`)
  }
}

// ─── 設定 ─────────────────────────────────────────────

function loadConfig() {
  const envPath = path.join(ROOT, '.env')
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath)
  const url = (process.env.ROOM_SYNC_URL || '').trim().replace(/\/+$/, '')
  const secret = (process.env.ROOM_SYNC_SECRET || '').trim()
  const site = (process.env.ROOM_SYNC_SITE || '').trim()
  const humanName = (process.env.ROOM_SYNC_HUMAN_NAME || '').trim() || 'パートナー'
  const rooms = (process.env.ROOM_SYNC_ROOMS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=')
      return at > 0 ? { local: pair.slice(0, at).trim(), remote: pair.slice(at + 1).trim() } : null
    })

  const multiGroups = new Set((process.env.ROOM_SYNC_MULTI_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean))
  const problems = []
  if (!/^https?:\/\//.test(url)) problems.push('ROOM_SYNC_URL が無い（例 https://sync.makoman.uk）')
  if (secret.length < 32) problems.push('ROOM_SYNC_SECRET が無いか短い（相手から受け取った合言葉を貼る）')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(site)) problems.push('ROOM_SYNC_SITE は英数字と - _ だけ（例 partner）')
  if (rooms.length === 0 || rooms.some((r) => !r || !r.local || !r.remote)) {
    problems.push('ROOM_SYNC_ROOMS は <自分の部屋 id>=<相手の部屋 id>（例 r1a2b3c=buygift-joint）')
  }
  if (rooms.some(r => r && rooms.some(other => other && other !== r && (other.local === r.local || other.remote === r.remote)))) problems.push('ROOM_SYNC_ROOMS の部屋 id が重複している')
  if ([...multiGroups].some(g => !rooms.some(r => r?.remote === g))) problems.push('ROOM_SYNC_MULTI_GROUPS に対応する部屋が ROOM_SYNC_ROOMS に無い')
  if (problems.length) {
    for (const p of problems) console.error(`設定: ${p}`)
    console.error('.env を直したら、もう一度『つなぐ』をダブルクリックしてください。手順は docs/room-sync.md')
    process.exit(78)
  }
  return { url, secret, site, humanName, rooms, multiGroups }
}

// ─── DB ──────────────────────────────────────────────

export function openDb(dbPath = DB_PATH) {
  if (!fs.existsSync(dbPath)) throw new Error(`DB が見つからない: ${dbPath}（先に画面を一度起動してください）`)
  const db = new Database(dbPath)
  // 画面とブリッジも同じファイルを開いているので、WAL と待ち時間を揃える
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  // 同期の足跡。部屋ごとの進み具合と、送った／受け取った投稿の控え
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      room_id                TEXT PRIMARY KEY,
      last_pushed_updated_at TEXT NOT NULL DEFAULT '',
      last_pulled_remote_id  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sync_pushed (
      message_id INTEGER PRIMARY KEY,
      pushed_at  TEXT NOT NULL,
      result     TEXT NOT NULL DEFAULT 'ok'
    );
    CREATE TABLE IF NOT EXISTS sync_pulled (
      origin    TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      local_id  INTEGER NOT NULL,
      PRIMARY KEY (origin, remote_id)
    );
  `)
  return db
}

/** DB の時刻の形（"YYYY-MM-DD HH:MM:SS"・手元の時刻）。lib/time.ts の localNow と同じ */
function localNow(at = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())} ` +
    `${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`
  )
}

function loadAgents() {
  try {
    const list = JSON.parse(fs.readFileSync(AGENTS_JSON, 'utf-8'))
    return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : []
  } catch {
    return []
  }
}

/** 本文に自分の AI の @名前（または @id）が入っているか。ブリッジの parseMentions と同じ当て方 */
export function mentionsLocalAgent(content, agents) {
  return agents.some((a) => content.includes('@' + a.name) || content.includes('@' + a.id))
}

// ─── 署名付きの通信 ───────────────────────────────────

/** 署名＝HMAC-SHA256(合言葉, `${ts}.${method}.${path}.${sha256(本文)}`)。path はクエリ込み */
export function sign(secret, ts, method, pathWithQuery, body) {
  const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex')
  return crypto
    .createHmac('sha256', secret)
    .update(`${ts}.${method}.${pathWithQuery}.${bodyHash}`)
    .digest('hex')
}

async function call(cfg, method, pathWithQuery, bodyObj) {
  const body = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
  const ts = String(Math.floor(Date.now() / 1000))
  const headers = {
    'X-Sync-Site': cfg.site,
    'X-Sync-Ts': ts,
    'X-Sync-Sign': sign(cfg.secret, ts, method, pathWithQuery, body),
    'X-Sync-Protocol': '2',
  }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(cfg.url + pathWithQuery, {
    method,
    headers,
    body: body || undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'manual',
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    // 相手の前段（トンネル・ログイン画面など）が HTML を返した時
  }
  return { status: res.status, json }
}

function explainStatus(status) {
  if (status === 401) return '401＝合言葉が違うか、この PC の時計が 5 分以上ずれている'
  if (status === 403) return '403＝相手がこの部屋の同期を許可していない（部屋 id を相手に確認）'
  if (status === 503) return '503＝相手側で同期の設定がまだ入っていない'
  if (status === 426) return '426＝複数人同期の更新版が必要（投稿は保留）'
  if (status >= 300 && status < 400) return `${status}＝ログイン画面へ飛ばされた（URL を相手に確認）`
  return String(status)
}

// ─── 送る ─────────────────────────────────────────────

const failures = new Map()

export async function pushRoom(db, cfg, map, agents) {
  const state = db.prepare('SELECT * FROM sync_state WHERE room_id = ?').get(map.local) ?? {
    last_pushed_updated_at: '',
  }
  // updated_at は秒単位なので「同じ秒」の取りこぼしが無いよう >= で拾い、送った控えで除く
  const rows = db
    .prepare(
      `SELECT * FROM messages
        WHERE room_id = ? AND kind = 'chat' AND hidden = 0 AND deleted_at IS NULL
          AND sender NOT LIKE 'remote:%' AND sender <> 'system'
          AND updated_at >= ?
          AND id NOT IN (SELECT message_id FROM sync_pushed)
        ORDER BY updated_at, id LIMIT ?`
    )
    .all(map.local, state.last_pushed_updated_at, PUSH_BATCH)

  const markPushed = db.prepare(
    'INSERT OR IGNORE INTO sync_pushed (message_id, pushed_at, result) VALUES (?, ?, ?)'
  )
  const saveState = db.prepare(
    `INSERT INTO sync_state (room_id, last_pushed_updated_at) VALUES (?, ?)
     ON CONFLICT(room_id) DO UPDATE SET last_pushed_updated_at = excluded.last_pushed_updated_at`
  )

  for (const row of rows) {
    const content = String(row.content ?? '').trim()
    if (!content) {
      // 画像だけの投稿など。本文が無いと相手に入れられないので送らずに進む
      markPushed.run(row.id, localNow(), 'empty')
      saveState.run(map.local, row.updated_at)
      continue
    }
    const agent = agents.find((a) => a.id === row.sender)
    const payload = {
      origin: cfg.site,
      remote_id: String(row.id),
      group_id: map.remote,
      sender_name: row.sender === 'human' ? cfg.humanName : (agent?.name ?? row.sender),
      sender_kind: row.sender === 'human' ? 'human' : 'ai',
      content,
      created_at: row.created_at,
      ...(cfg.multiGroups?.has(map.remote) ? { mention_mode: 'scoped' } : {}),
    }
    let r
    try {
      r = await call(cfg, 'POST', '/api/sync/inbound', payload)
    } catch (e) {
      logOnce('push', `[push] 相手へ届かない（次の回にもう一度送る）: ${e?.message ?? e}`)
      return
    }
    if (r.status === 200 || r.status === 201) {
      clearProblem('push')
      markPushed.run(row.id, localNow(), r.json?.duplicate ? 'duplicate' : 'ok')
      saveState.run(map.local, row.updated_at)
      failures.delete(row.id)
      log(`[push] ${map.local}#${row.id} → ${map.remote}${r.json?.id ? ` (相手 id=${r.json.id})` : ''}${r.json?.woke?.length ? ` 起こした: ${r.json.woke.join(',')}` : ''}`)
      continue
    }
    if (r.status === 409 && r.json?.retry) {
      // 相手側で直前に同じ文面が入った。数秒後に送り直せば通るので、順番を守ってここで止める
      return
    }
    if (r.status === 401 || r.status === 403 || r.status === 426 || r.status === 503 || r.status >= 500 || (r.status >= 300 && r.status < 400)) {
      // 設定や相手の都合。投稿のせいではないので諦めず、直るまで待つ
      logOnce('push', `[push] 送れない: ${explainStatus(r.status)} ${r.json?.error ?? ''}`.trim())
      return
    }
    // 400 など投稿の中身で弾かれた。何度か試してだめなら飛ばして後ろを詰まらせない
    const n = (failures.get(row.id) ?? 0) + 1
    failures.set(row.id, n)
    log(`[push] ${map.local}#${row.id} を相手が受け取らない（${r.status} ${r.json?.error ?? ''}・${n}/${GIVE_UP_AFTER}）`)
    if (n < GIVE_UP_AFTER) return
    markPushed.run(row.id, localNow(), `rejected:${r.status}`)
    saveState.run(map.local, row.updated_at)
    failures.delete(row.id)
  }
}

// ─── 受け取る ─────────────────────────────────────────

const aiWakes = new Map()
function allowAiWake(roomId, now = Date.now()) {
  const kept = (aiWakes.get(roomId) ?? []).filter((t) => now - t < AI_WAKE_WINDOW_MS)
  if (kept.length >= AI_WAKE_MAX) {
    aiWakes.set(roomId, kept)
    return false
  }
  kept.push(now)
  aiWakes.set(roomId, kept)
  return true
}

export async function pullRoom(db, cfg, map, agents) {
  const state = db.prepare('SELECT * FROM sync_state WHERE room_id = ?').get(map.local) ?? {
    last_pulled_remote_id: 0,
  }
  const after = Number(state.last_pulled_remote_id) || 0
  const q = new URLSearchParams({ group_id: map.remote, after: String(after), limit: '100' })
  let r
  try {
    r = await call(cfg, 'GET', `/api/sync/outbound?${q.toString()}`)
  } catch (e) {
    logOnce('pull', `[pull] 相手へ届かない（次の回にもう一度取りに行く）: ${e?.message ?? e}`)
    return
  }
  if (r.status !== 200 || !r.json || !Array.isArray(r.json.messages)) {
    logOnce('pull', `[pull] 受け取れない: ${explainStatus(r.status)} ${r.json?.error ?? ''}`.trim())
    return
  }
  clearProblem('pull')

  const scoped = r.json.protocol === 2 && r.json.mention_mode === 'scoped'
  // API・ブリッジも同じ部屋設定を使う。同期プロセスだけ更新したPCは受信を進めない。
  if (scoped !== !!cfg.multiGroups?.has(map.remote)) {
    logOnce('mode', '[pull] ROOM_SYNC_MULTI_GROUPS が相手の部屋設定と異なる。設定をそろえるまで受信を保留')
    return
  }
  clearProblem('mode')

  const origin = String(r.json.origin || 'remote')
  const seen = db.prepare('SELECT 1 FROM sync_pulled WHERE origin = ? AND remote_id = ?')
  const insertMsg = db.prepare(
    `INSERT INTO messages (room_id, sender, kind, content, meta, status, hidden, created_at, updated_at)
     VALUES (?, ?, 'chat', ?, ?, ?, 0, ?, ?)`
  )
  const insertPulled = db.prepare('INSERT INTO sync_pulled (origin, remote_id, local_id) VALUES (?, ?, ?)')
  const saveCursor = db.prepare(
    `INSERT INTO sync_state (room_id, last_pulled_remote_id) VALUES (?, ?)
     ON CONFLICT(room_id) DO UPDATE SET last_pulled_remote_id = excluded.last_pulled_remote_id`
  )

  // 行の追加と進み具合の保存を 1 つにまとめる。途中で落ちても「入ったのに進んでいない」
  // （＝次の回に二重に入る）や「進んだのに入っていない」（＝抜け）にならないように
  const apply = db.transaction((messages, cursor) => {
    const added = []
    for (const m of messages) {
      const remoteId = String(m.id)
      if (seen.get(origin, remoteId)) continue
      const content = String(m.content ?? '').trim()
      if (!content) continue
      const name = String(m.sender_name || m.sender || '相手').replace(/\s+/g, ' ').slice(0, 40)
      const kind = m.sender_kind === 'human' ? 'human' : 'ai'
      const senderOrigin = scoped ? String(m.origin || '') : origin
      if (scoped && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(senderOrigin)) throw new Error('相手拠点名のない投稿は受信しない')
      // 自分発はサーバーでも除く。再取込・二重表示を防ぐ最後の歯止め。
      if (scoped && senderOrigin === cfg.site) continue
      const targets = pulledSyncTargets(content, cfg.site, agents.map(a => a.id), scoped)
      let wake = targets === null ? mentionsLocalAgent(content, agents) : targets.length > 0
      if (wake && kind === 'ai' && !allowAiWake(map.local)) {
        wake = false
        log(`[pull] 相手の AI からの呼び出しが多すぎるので起こさない（${map.local}・10 分で ${AI_WAKE_MAX} 回まで）`)
      }
      const t = localNow()
      const res = insertMsg.run(
        map.local,
        scoped ? `remote:${name}（${senderOrigin}）` : `remote:${name}`,
        content,
        JSON.stringify({ remote: { origin: senderOrigin, id: m.id, kind, hub: origin }, ...(targets !== null ? { sync_targets: wake ? targets : [] } : {}) }),
        wake ? 'pending' : 'done',
        t,
        t
      )
      insertPulled.run(origin, remoteId, Number(res.lastInsertRowid))
      added.push({ local: Number(res.lastInsertRowid), remote: remoteId, name, wake })
    }
    saveCursor.run(map.local, cursor)
    return added
  })

  const cursor = Math.max(after, Number(r.json.cursor) || 0, ...r.json.messages.map((m) => Number(m.id) || 0))
  const added = apply(r.json.messages, cursor)
  for (const a of added) {
    log(`[pull] ${origin}#${a.remote} → ${map.local}#${a.local}（${a.name}）${a.wake ? ' 自分の AI を起こす' : ''}`)
  }
}

// ─── 本体 ─────────────────────────────────────────────

async function main() {
  const cfg = loadConfig()
  let db
  try { db = openDb() } catch (e) {
    console.error(e.message)
    process.exit(78)
  }
  const rooms = db.prepare('SELECT id FROM rooms').all().map((r) => r.id)
  for (const m of cfg.rooms) {
    if (!rooms.includes(m.local)) {
      console.error(`自分の部屋 id「${m.local}」が見つからない。画面の /api/rooms で id を確かめて ROOM_SYNC_ROOMS を直してください。`)
      process.exit(78)
    }
  }
  log(`[start] ${cfg.site} ⇄ ${cfg.url} 部屋: ${cfg.rooms.map((m) => `${m.local}=${m.remote}`).join(', ')}`)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    log('[stop] 同期を止めた')
    try {
      db.close()
    } catch {
      // 閉じられなくても終わる
    }
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (!stopping) {
    const agents = loadAgents()
    for (const m of cfg.rooms) {
      try {
        await pushRoom(db, cfg, m, agents)
        await pullRoom(db, cfg, m, agents)
      } catch (e) {
        logOnce('loop', `[error] ${e?.stack ?? e}`)
      }
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
