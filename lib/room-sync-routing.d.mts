export function scopedTargets(content: string, site: string, ids: readonly string[]): string[];
export function pulledSyncTargets(content: string, site: string, ids: readonly string[], scoped: boolean): string[] | null;
export function localSyncTargets(room: string, content: string, ids: readonly string[], env?: Record<string, string | undefined>): string[] | null;
export function withoutScopedMentions(content: string): string;
export function localHumanSyncTargets(room: string, content: string, ids: readonly string[], mentionsOf: (text: string) => string[], env?: Record<string, string | undefined>): string[] | null;
