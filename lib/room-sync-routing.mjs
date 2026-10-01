/** 同期スクリプト・投稿API・ブリッジで共用。起動やDBアクセスの副作用を持たない。 */
export function scopedTargets(content, site, ids) {
  const found = []
  const re = /(?<![\p{L}\p{N}_@/])@([A-Za-z0-9][A-Za-z0-9_-]{0,49})\/([A-Za-z0-9_-]{1,40})(?![A-Za-z0-9_/-])/gu
  for (const m of content.matchAll(re)) {
    if (m[1] === site && ids.includes(m[2]) && !found.includes(m[2])) found.push(m[2])
  }
  return found
}

/**
 * 取り込んだ投稿で起こす自分の AI。null は従来どおり（@名前・@id で判定）、配列はこの宛先だけ。
 * 2 人用の部屋で @拠点/id の形を全部拠点付き宛先とみなすと、@aws-sdk/client-s3 のようなパッケージ名だけで
 * 従来の @commander が効かなくなる。拠点部分が自分の拠点と一致する時だけ拠点付き経路へ入れる（10/1 検品）。
 */
export function pulledSyncTargets(content, site, ids, scoped) {
  if (scoped) return scopedTargets(content, site, ids)
  const re = /(?<![\p{L}\p{N}_@/])@([A-Za-z0-9][A-Za-z0-9_-]{0,49})\/([A-Za-z0-9_-]{1,40})(?![A-Za-z0-9_/-])/gu
  const own = !!site && [...content.matchAll(re)].some(m => m[1] === site)
  return own ? scopedTargets(content, site, ids) : null
}

/** null は従来どおり、空配列は「このPCのAIを起こさない」。 */
export function localSyncTargets(room, content, ids, env = process.env) {
  const groups = new Set((env.ROOM_SYNC_MULTI_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean))
  const shared = (env.ROOM_SYNC_ROOMS || '').split(',').some(pair => {
    const at = pair.indexOf('=')
    return at > 0 && pair.slice(0, at).trim() === room && groups.has(pair.slice(at + 1).trim())
  })
  if (!shared) return null
  return scopedTargets(content, (env.ROOM_SYNC_SITE || '').trim(), ids)
}

/** @拠点/id の形（他拠点宛て・パッケージ名を含む）を取り除く。@shun/commander の commander を自分の AI と取り違えないため */
export function withoutScopedMentions(content) {
  return content.replace(/@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g, ' ')
}

/**
 * その PC の人が自分で入力した投稿で起こす自分の AI。null は従来どおり（同期していない部屋・2 人用の部屋）。
 * 複数人の部屋でも自分の AI は今までどおり @名前・@id で呼べる（10/1 フナキチの「@ゼウス」で誰も起きなかった）。
 * @自拠点/id も有効で、両方あれば和集合。mentionsOf は lib/agents の parseMentions（.mjs から TS を読まないため呼び出し側が渡す）。
 * 相手拠点から取り込んだ投稿には使わない。3 台とも id が commander なので、裸の @commander で全員の AI が起きる。
 */
export function localHumanSyncTargets(room, content, ids, mentionsOf, env = process.env) {
  const scoped = localSyncTargets(room, content, ids, env)
  if (scoped === null) return null
  const out = [...scoped]
  for (const id of mentionsOf(withoutScopedMentions(content))) {
    if (ids.includes(id) && !out.includes(id)) out.push(id)
  }
  return out
}
