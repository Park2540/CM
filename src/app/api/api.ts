import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import { environment } from '@/environments/environment';
import { components } from './schema';

/** Type ของ API สร้างจาก api/openapi.yaml ด้วย `npm run api:types` — ห้ามแก้ schema.ts ด้วยมือ */
export type ApiSchemas = components['schemas'];
export type ApiProblem = ApiSchemas['Problem'];
export type ApiPage<T> = ApiSchemas['PageMeta'] & { items: T[] };

export function apiUrl(path: string): string {
    return `${environment.apiBaseUrl}${path}`;
}

/** Query params จาก object โดยตัดค่าว่างออก */
export function queryParams(values: Record<string, string | number | null | undefined>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
        if (value !== null && value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return params;
}

/** ข้อความแสดงผู้ใช้จาก error ของ API (problem+json) */
export function problemMessage(error: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่'): string {
    if (error instanceof HttpErrorResponse) {
        const problem = error.error as Partial<ApiProblem> | null;
        if (problem && typeof problem === 'object' && problem.title) return problem.detail ? `${problem.title}: ${problem.detail}` : problem.title;
        if (error.status === 0) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
    }
    return fallback;
}

/** แปลง Date ของ API (string) เป็น Date */
export const toDate = (value: string) => new Date(value);
