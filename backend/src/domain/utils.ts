import type { ApiSchemas } from '../api/api.js';

export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export const matchesQuery = (query: string | null | undefined, ...fields: Array<string | undefined>) => !query || fields.some((field) => field?.toLowerCase().includes(query.trim().toLowerCase()));

/** แบ่งหน้าตาม query ?page=&pageSize= (สูงสุด 100 ต่อหน้า) */
export function paginate<T>(items: T[], query: { page?: unknown; pageSize?: unknown }): ApiSchemas['PageMeta'] & { items: T[] } {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    return { page, pageSize, total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}
