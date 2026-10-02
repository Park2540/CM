import { HttpResponse } from 'msw';
import { environment } from '@/environments/environment';
import { ApiPage, ApiProblem } from '@/app/api/api';

export const api = (path: string) => `${environment.apiBaseUrl}${path}`;

export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export function problem(status: number, title: string, detail?: string, errors?: Record<string, string>) {
    return HttpResponse.json<ApiProblem>({ type: 'about:blank', title, status, detail, errors }, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

export function paginate<T>(items: T[], url: URL): ApiPage<T> {
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20));
    return { page, pageSize, total: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export const matchesQuery = (query: string | null, ...fields: Array<string | undefined>) => !query || fields.some((field) => field?.toLowerCase().includes(query.trim().toLowerCase()));
