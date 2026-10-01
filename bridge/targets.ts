import { parseMentions } from '../lib/agents'
import { localHumanSyncTargets, localSyncTargets } from '../lib/room-sync-routing.mjs'
import type { Agent, Message } from '../lib/types'

/**
 * meta の宛先が無い・壊れた時に、複数人の部屋で起こす自分の AI（null は従来どおり）。
 * 投稿 API と同じく、この PC の人の投稿（sender='human'）だけ @名前・@id も宛先にする。
 * 取り込んだ remote 投稿や定期タスク（system）は @自拠点/id だけ（裸の @commander で全員の AI を起こさない）。
 */
function syncFallback(msg: Message, agents: Agent[]): string[] | null {
  const ids = agents.map(a => a.id)
  return msg.sender === 'human'
    ? localHumanSyncTargets(msg.room_id, msg.content, ids, text => parseMentions(text, agents))
    : localSyncTargets(msg.room_id, msg.content, ids)
}

/** 取込時の明示宛先を優先。空配列を既定のAIへフォールバックさせない。 */
export function targetsOf(msg: Message, agents: Agent[], defaultAgent: string): string[] {
  try {
    const meta = msg.meta ? JSON.parse(msg.meta) : null
    if (Array.isArray(meta?.sync_targets)) {
      return [...new Set<string>(meta.sync_targets.filter((id: unknown) => typeof id === 'string' && agents.some(a => a.id === id)))]
    }
    const scoped = syncFallback(msg, agents)
    if (scoped !== null) return scoped
    if (meta?.target && agents.some(a => a.id === meta.target)) return [meta.target]
  } catch {
    // meta が壊れても複数人の部屋を従来の既定AIへ落とさない。
    const scoped = syncFallback(msg, agents)
    if (scoped !== null) return scoped
  }
  const mentioned = parseMentions(msg.content, agents)
  if (mentioned.length) return mentioned
  return agents.some(a => a.id === defaultAgent) ? [defaultAgent] : []
}
