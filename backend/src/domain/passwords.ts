import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** เก็บรหัสผ่านแบบ hash (scrypt + salt สุ่ม) — รูปแบบ "scrypt$<salt>$<hash>" */
export function hashPassword(password: string): string {
    const salt = randomBytes(16).toString('base64url');
    return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
    const [scheme, salt, hash] = stored?.split('$') ?? [];
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
}

/** รหัสผ่านของบัญชีตัวอย่างที่ใส่ไว้ตอนสร้างฐานข้อมูลครั้งแรก */
export const DEMO_PASSWORD = 'demo1234';
export const DEMO_PASSWORD_HASH = hashPassword(DEMO_PASSWORD);
