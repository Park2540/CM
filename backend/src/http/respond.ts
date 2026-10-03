import type { Request, Response } from 'express';
import type { ApiSchemas } from '../api/api.js';
import type { Outcome } from '../domain/project-team.js';
import { CURRENT_USER } from '../domain/users.js';
import { HttpProblem } from './problem.js';

/** โยน error ตามรูปแบบ Problem (errorHandler แปลงเป็น response) */
export function fail(status: number, title: string, detail?: string, errors?: Record<string, string>): never {
    throw new HttpProblem(status, title, detail, errors);
}

/** 422 พร้อมข้อผิดพลาดรายช่อง ถ้ามี */
export function failIfInvalid(errors: Record<string, string>, title = 'ข้อมูลไม่ถูกต้อง') {
    if (Object.keys(errors).length) fail(422, title, Object.values(errors)[0], errors);
}

/** ส่งผลลัพธ์จากตรรกะทางธุรกิจ: ok → JSON (ok === true → 204), ไม่ ok → Problem */
export function send<T>(res: Response, outcome: Outcome<T> | { status: number; title: string; detail?: string; errors?: Record<string, string> }, status = 200) {
    if ('ok' in outcome) {
        if (outcome.ok === true) res.status(204).end();
        else res.status(status).json(outcome.ok);
        return;
    }
    fail(outcome.status, outcome.title, outcome.detail, outcome.errors);
}

/** ค่า query string เดียว (ไม่มี/ว่าง = null) */
export function query(req: Request, name: string): string | null {
    const value = req.query[name];
    return typeof value === 'string' && value.trim() ? value : null;
}

/** ผู้ใช้ของคำขอนี้มีสิทธิ์นี้ไหม */
export const can = (permission: ApiSchemas['Permission']) => CURRENT_USER.permissions.includes(permission);

/** body ของคำขอ (ไม่มี body = {}) */
export const body = <T>(req: Request) => (req.body ?? {}) as Partial<T>;
