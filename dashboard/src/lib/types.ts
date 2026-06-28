export interface Me { id: string; email: string | null; publicToGroup: boolean; devices: DeviceInfo[] }
export interface DeviceInfo { id: string; label: string; createdAt: number; lastSeenAt: number | null; revokedAt: number | null }
export interface SummaryTotals { sessions: number; totalTokens: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number }
export interface ByDay { day: string; totalTokens: number; totalCost: number }
export interface ByDaySource { day: string; source: string; totalTokens: number; totalCost: number }
export interface BySource { source: string; totalTokens: number; totalCost: number; sessions: number }
export interface ByModel { model: string; totalTokens: number; totalCost: number }
export interface ByProject { projectPath: string; totalTokens: number; totalCost: number; sessions: number }
export interface ByDevice { deviceId: string; label: string; totalTokens: number; totalCost: number; sessions: number }
export interface Summary { totals: SummaryTotals; byDay: ByDay[]; byDaySource: ByDaySource[]; bySource: BySource[]; byModel: ByModel[]; byProject: ByProject[]; byDevice: ByDevice[] }
export interface SessionItem { source: string; sessionId: string; deviceId: string; totalTokens: number; totalCost: number; firstActivity: string | null; lastActivity: string | null; modelsUsed: string[]; projectPath: string | null }
export interface SessionsPage { sessions: SessionItem[]; nextCursor: string | null }
export interface Filters { from?: string; to?: string; source?: string; device?: string; scope?: 'me' | 'group' }
export interface EnrollCode { code: string; expiresAt: number }
