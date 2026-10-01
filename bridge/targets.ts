import { parseMentions } from '../lib/agents'
import { localSyncTargets } from '../lib/room-sync-routing.mjs'
import type { Agent, Message } from '../lib/types'

/** 取込時の明示宛先を優先。空配列を既定のAIへフォールバックさせない。 */
export function targetsOf(msg: Message, agents: Agent[], defaultAgent: string): string[] {
  try {
    const meta = msg.meta ? JSON.parse(msg.meta) : null
    if (Array.isArray(meta?.sync_targets)) {
      return [...new Set<string>(meta.sync_targets.filter((id: unknown) => typeof id === 'string' && agents.some(a => a.id === id)))]
    }
    const scoped = localSyncTargets(msg.room_id, msg.content, agents.map(a => a.id))
    if (scoped !== null) return scoped
    if (meta?.target && agents.some(a => a.id === meta.target)) return [meta.target]
  } catch {
    // meta が壊れても複数人の部屋を従来の既定AIへ落とさない。
    const scoped = localSyncTargets(msg.room_id, msg.content, agents.map(a => a.id))
    if (scoped !== null) return scoped
  }
  const mentioned = parseMentions(msg.content, agents)
  if (mentioned.length) return mentioned
  return agents.some(a => a.id === defaultAgent) ? [defaultAgent] : []
}
