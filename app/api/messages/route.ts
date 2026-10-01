import { getDb } from '@/lib/db'
import { isInside } from '@/lib/uploads'
import { UPLOADS_DIR } from '@/lib/paths'
import { isNoAgent, toView } from '@/lib/messages'
import { localNow } from '@/lib/time'
import { loadAgents } from '@/lib/agents'
import { localSyncTargets } from '@/lib/room-sync-routing.mjs'
import type { Attachment, Message, MessageMeta } from '@/lib/types'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const room = url.searchParams.get('room') ?? 'main'
  const after = Number(url.searchParams.get('after') ?? 0) || 0
  const limit = Number(url.searchParams.get('limit') ?? 200) || 200

  const rows = getDb()
    .prepare(
      `SELECT * FROM messages
        WHERE room_id = ? AND hidden = 0 AND deleted_at IS NULL AND id > ?
        ORDER BY id DESC LIMIT ?`
    )
    .all(room, after, limit) as Message[]

  return Response.json({ messages: rows.reverse().map(toView) })
}

/**
 * ボタンのラベル。人間の投稿の本文に [BUTTONS:…] と書いても
 * ボタンにはならない（本文はそのまま AI へ渡す物なので触らない）。
 * 画面からボタンを出したい時はこの欄で渡す。
 */
function cleanButtons(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const it of input) {
    if (typeof it !== 'string') continue
    const v = it.trim().slice(0, 60)
    if (v && !out.includes(v)) out.push(v)
    if (out.length >= 6) break
  }
  return out
}

/** 送られてきた添付を、data/uploads の中を指すものだけに絞る */
function cleanImages(input: unknown): Attachment[] {
  if (!Array.isArray(input)) return []
  const out: Attachment[] = []
  for (const it of input) {
    if (!it || typeof it !== 'object') continue
    const url = (it as Attachment).url
    const p = (it as Attachment).path
    if (typeof url !== 'string' || typeof p !== 'string') continue
    if (!url.startsWith('/api/uploads/')) continue
    if (!isInside(UPLOADS_DIR, p)) continue
    out.push({ url, path: p })
  }
  return out
}

export async function POST(request: Request) {
  let body: {
    room?: string
    content?: string
    images?: unknown
    forward_of?: unknown
    target?: string
    buttons?: unknown
    /** true なら誰のターンも起こさない（status='done' で入る） */
    no_agent?: unknown
    targets?: unknown
    /** 画面が出した「お知らせ」。押されたボタンの出所を見分けるために sender を分ける */
    system?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '読めない本文' }, { status: 400 })
  }
  const room = (body.room ?? '').trim() || 'main'
  const content = (body.content ?? '').trim()
  const images = cleanImages(body.images)
  if (!content && images.length === 0) return Response.json({ error: '本文が空' }, { status: 400 })

  const db = getDb()
  const exists = db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(room)
  if (!exists) return Response.json({ error: 'その部屋は無い' }, { status: 404 })

  // 転送元は実在する投稿だけ。消えていたら無かったことにする
  let forwardOf: number | null = null
  const raw = Number(body.forward_of)
  if (Number.isInteger(raw) && raw > 0) {
    const src = db
      .prepare('SELECT id FROM messages WHERE id = ? AND deleted_at IS NULL')
      .get(raw) as { id: number } | undefined
    forwardOf = src?.id ?? null
  }

  const meta: MessageMeta = {}
  if (images.length) meta.images = images
  const buttons = cleanButtons(body.buttons)
  if (buttons.length) meta.buttons = buttons
  if (typeof body.target === 'string' && body.target.trim()) meta.target = body.target.trim()

  // 誰も起こさない投稿は取り出し対象にしない。ブリッジは status='pending' しか見ない
  const syncTargets = localSyncTargets(room, content, loadAgents().map(a => a.id))
  if (syncTargets !== null) meta.sync_targets = syncTargets
  const noAgent = isNoAgent(body) || syncTargets?.length === 0
  const sender = body.system === true ? 'system' : 'human'

  const now = localNow()
  const res = db
    .prepare(
      `INSERT INTO messages (room_id, sender, kind, content, meta, status, hidden, created_at, updated_at, forward_of)
       VALUES (?, ?, 'chat', ?, ?, ?, 0, ?, ?, ?)`
    )
    .run(
      room,
      sender,
      content,
      Object.keys(meta).length ? JSON.stringify(meta) : null,
      noAgent ? 'done' : 'pending',
      now,
      now,
      forwardOf
    )

  return Response.json({ id: Number(res.lastInsertRowid) })
}
