import 'dotenv/config'
import fs from 'node:fs'
import { loadAgents } from '../lib/agents'
import { ROOT } from '../lib/paths'
import { IS_WINDOWS } from '../lib/platform'
import { targetsOf } from './targets'
import { authStatus, checkClaude, launcherFor } from './claude-cli'
import { startControl } from './control'
import { getDb, getRoom, pendingMessages, setAgentState, setStatus } from './db'
import { recoverInterrupted } from './recover'
import { startSchedules } from './schedules'
import { runTurn } from './turn'

const POLL_MS = 2_000
const TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 30 * 60 * 1000)
const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || 'bypassPermissions'
// 承認付きの窓口は画面の番号 +1。画面が 3210 なら 3211
const CONTROL_PORT = Number(process.env.PORT || 3210) + 1

/** 同じ人格は同時に 1 ターンしか走らせない */
const busy = new Set<string>()

async function tick(): Promise<void> {
  const agents = loadAgents()
  if (agents.length === 0) return

  // 同じ部屋の投稿は投稿順に処理する。先の投稿が待たされたら後ろは止める
  const blockedRooms = new Set<string>()

  for (const msg of pendingMessages()) {
    if (blockedRooms.has(msg.room_id)) continue
    const room = getRoom(msg.room_id)
    if (!room) {
      setStatus(msg.id, 'done')
      continue
    }
    const targets = targetsOf(msg, agents, room.default_agent)
    if (targets.length === 0) {
      setStatus(msg.id, 'done')
      continue
    }
    if (targets.some((t) => busy.has(t))) {
      blockedRooms.add(msg.room_id)
      continue
    }

    setStatus(msg.id, 'taken')
    for (const t of targets) busy.add(t)

    const runs = targets.map(async (id) => {
      const agent = agents.find((a) => a.id === id)!
      try {
        await runTurn({
          agent,
          agents,
          room,
          message: msg,
          claudePath: process.env.CLAUDE_PATH!,
          permissionMode: PERMISSION_MODE,
          timeoutMs: TIMEOUT_MS,
        })
      } catch (e) {
        console.error(`[${id}] ターンが落ちた:`, e)
        setAgentState(id, 'idle', null)
      } finally {
        busy.delete(id)
      }
    })

    void Promise.all(runs).then(() => setStatus(msg.id, 'done'))
  }
}

/**
 * 設定が原因で立ち上がれない時の終了コード。
 * 見張り役（scripts/run-bridge.mjs）はこれを見たら立て直さない。
 * 直さない限り必ず同じ所で転ぶので、1 秒ごとに再起動して画面を流してしまわないため。
 */
const EXIT_BAD_CONFIG = 78

/** claude が見つからない・動かない時の直し方。OS で言葉が違うのでここで分ける */
function howToFixClaude(): string {
  return IS_WINDOWS
    ? [
        '直し方:',
        '  1. コマンドプロンプトで  where claude  と打つ。',
        '  2. 出てきた場所（…\\npm\\claude.cmd など）を .env の CLAUDE_PATH= の右に貼る。',
        '  3. 何も出ないなら  npm install -g @anthropic-ai/claude-code  で入れ直す。',
      ].join('\n')
    : [
        '直し方:',
        '  1. ターミナルで  which claude  と打つ。',
        '  2. 出てきた場所を .env の CLAUDE_PATH= の右に貼る。',
        '  3. 何も出ないなら  npm install -g @anthropic-ai/claude-code  で入れ直す。',
      ].join('\n')
}

async function main(): Promise<void> {
  const claudePath = process.env.CLAUDE_PATH
  if (!claudePath || !fs.existsSync(claudePath)) {
    console.error(`claude コマンドが見つからない（CLAUDE_PATH=${claudePath ?? '未設定'}）。`)
    console.error(howToFixClaude())
    process.exit(EXIT_BAD_CONFIG)
  }

  // どの経路で起動するか（Windows の .cmd 対策）を先に決めて、必ずログに残す。
  // Windows で転んだ時に「何を実行しようとしたのか」が分からないのが一番困るため。
  const launcher = launcherFor(claudePath)
  console.log(`claude の起動方法: ${launcher.how}`)
  if (launcher.viaShell) {
    console.warn(
      '警告: cmd.exe 経由でしか起動できなかった。改行を引数で渡せないので ' +
        'system prompt は本文の先頭に畳んで渡す（動くが本来の形ではない）。' +
        '.env の CLAUDE_PATH に claude.exe の場所を直接書くと解消する。'
    )
  }

  const version = await checkClaude(claudePath)
  if (!version) {
    console.error(`claude を実行できなかった（${claudePath}）。`)
    console.error(`起動の形: ${launcher.how}`)
    console.error(howToFixClaude())
    process.exit(EXIT_BAD_CONFIG)
  }

  // ログインしていないと毎ターン失敗する。起動時に 1 度だけ確かめる（ターンは消費しない）
  const auth = await authStatus(claudePath)
  if (auth && !auth.loggedIn) {
    console.error('claude にログインしていない。ターミナルで  claude  と打ってログインしてください。')
    process.exit(EXIT_BAD_CONFIG)
  }
  if (auth?.projectsDirectory) {
    // 会話ログの置き場所は OS と設定で変わる。CLI が教えてくれた場所を sessions.ts へ渡す
    process.env.CLAUDE_PROJECTS_DIR = auth.projectsDirectory
  }

  getDb() // ここでテーブルを作る
  for (const a of loadAgents()) setAgentState(a.id, 'idle', null)

  // 前回の落ち方に関わらず、残っている「作業中」の行と取り出し済みの投稿を畳む
  const left = recoverInterrupted()
  if (left.rewritten || left.interrupted) {
    console.log(
      `前回の中断を片付けた: 作業中の行 ${left.rewritten} 件・取り出し済みの投稿 ${left.interrupted} 件`
    )
  }

  console.log(`makoSystem ブリッジ起動: ${ROOT}`)
  console.log(`claude: ${claudePath}（${version}）／権限: ${PERMISSION_MODE}`)
  startControl(CONTROL_PORT)
  startSchedules()

  let running = false
  setInterval(() => {
    if (running) return
    running = true
    tick()
      .catch((e) => console.error('取り出しに失敗:', e))
      .finally(() => {
        running = false
      })
  }, POLL_MS)
}

void main()
