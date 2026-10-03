import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiSchemas } from '../api/api.js';
import { config } from '../config.js';
import { recordAudit } from './audit-logs.js';
import type { Outcome } from './project-team.js';
import { latestRegistrationFor } from './registrations.js';
import { findAccountByEmail, findAccountById, passwordMatches, recordLogin, toCurrentUser } from './user-accounts.js';
import { setRequestUser } from './users.js';

const HOUR_MS = 3_600_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;

/**
 * access token: base64url(JSON { sub, exp, prev }) + "." + ลายเซ็น HMAC-SHA256
 * ตรวจลายเซ็นและวันหมดอายุทุกคำขอ และตรวจสถานะบัญชีซ้ำ (บัญชีที่ถูกระงับใช้ token เดิมต่อไม่ได้)
 */
type TokenPayload = { sub: string; exp: number; prev: string };

const sign = (data: string) => createHmac('sha256', config.authSecret).update(data).digest('base64url');

function issueToken(payload: TokenPayload): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${data}.${sign(data)}`;
}

function readToken(token: string): TokenPayload | null {
    const [data, signature] = token.split('.');
    if (!data || !signature) return null;
    const expected = Buffer.from(sign(data));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TokenPayload;
        return payload.exp > Date.now() ? payload : null;
    } catch {
        return null;
    }
}

const failedAttempts = new Map<string, { count: number; lockedUntil: number }>();

/** ตรวจ token จาก header Authorization แล้วตั้งผู้ใช้ของคำขอนี้ — false ถ้าไม่มี/ไม่ถูกต้อง/หมดอายุ หรือบัญชีใช้งานไม่ได้แล้ว */
export function authenticate(authorization: string | undefined): boolean {
    const payload = readToken(authorization?.replace(/^Bearer\s+/i, '') ?? '');
    const account = payload && findAccountById(payload.sub);
    if (!payload || !account || account.status !== 'active') return false;
    // lastLoginAt = เวลาเข้าสู่ระบบครั้งก่อนหน้า (ตอนออก token นี้)
    setRequestUser({ ...toCurrentUser(account), lastLoginAt: payload.prev });
    return true;
}

const invalidCredentials = { status: 401 as const, title: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' };

export function login(input: Partial<ApiSchemas['LoginInput']>): Outcome<ApiSchemas['LoginResult']> | { status: 401 | 403 | 429; title: string; detail?: string } {
    const email = input.email?.trim().toLowerCase() ?? '';
    const password = input.password ?? '';
    const errors: Record<string, string> = {};
    if (!email) errors['email'] = 'กรุณาระบุอีเมล';
    if (!password) errors['password'] = 'กรุณาระบุรหัสผ่าน';
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ครบ', detail: Object.values(errors)[0], errors };

    const attempts = failedAttempts.get(email);
    if (attempts && attempts.lockedUntil > Date.now()) {
        return { status: 429, title: 'พยายามเข้าสู่ระบบผิดหลายครั้ง', detail: `ลองใหม่ได้ในอีก ${Math.ceil((attempts.lockedUntil - Date.now()) / 60_000)} นาที หรือติดต่อแอดมิน` };
    }
    const fail = () => {
        const count = (failedAttempts.get(email)?.count ?? 0) + 1;
        failedAttempts.set(email, { count: count >= MAX_FAILED_ATTEMPTS ? 0 : count, lockedUntil: count >= MAX_FAILED_ATTEMPTS ? Date.now() + LOCK_MS : 0 });
        return invalidCredentials;
    };

    const account = findAccountByEmail(email);
    if (!account) {
        // ยังไม่มีบัญชี: บอกสถานะคำขอสมัครเฉพาะเมื่อรหัสผ่านตรงกับที่สมัครไว้
        const registration = latestRegistrationFor(email, password);
        if (registration?.status === 'pending') return { status: 403, title: 'บัญชีรออนุมัติ', detail: 'แอดมินหรือเจ้าของบริษัทยังไม่ได้อนุมัติคำขอสมัครของคุณ' };
        if (registration?.status === 'rejected') return { status: 403, title: 'คำขอสมัครถูกปฏิเสธ', detail: registration.rejectReason };
        return fail();
    }
    if (account.status === 'invited') return { status: 403, title: 'ยังไม่ได้ตั้งรหัสผ่าน', detail: 'ตั้งรหัสผ่านจากลิงก์ในอีเมลคำเชิญก่อน หรือขอให้แอดมินส่งคำเชิญใหม่' };
    if (!passwordMatches(account.id, password)) return fail();
    if (account.status === 'suspended') return { status: 403, title: 'บัญชีถูกระงับ', detail: 'ติดต่อแอดมินหรือเจ้าของบริษัท' };

    failedAttempts.delete(email);
    const previousLogin = recordLogin(account);
    const user = { ...toCurrentUser(account), lastLoginAt: previousLogin };
    setRequestUser(user);
    recordAudit({ module: 'system', action: 'เข้าสู่ระบบ', target: user.name, detail: user.email });
    const expiresAt = Date.now() + (input.remember ? 30 * 24 : 8) * HOUR_MS;
    return { ok: { accessToken: issueToken({ sub: account.id, exp: expiresAt, prev: previousLogin }), expiresAt: new Date(expiresAt).toISOString(), user } };
}
