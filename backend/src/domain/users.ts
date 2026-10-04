import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApiSchemas } from '../api/api.js';

type UserRef = ApiSchemas['UserRef'];
type CurrentUser = ApiSchemas['CurrentUser'];

export const USERS = {
    owner: { id: 'user-owner', name: 'เจ้าของบริษัท', roleLabel: 'เจ้าของบริษัท' },
    admin: { id: 'user-admin', name: 'ผู้ดูแลระบบ', roleLabel: 'แอดมิน' },
    thanakrit: { id: 'user-thanakrit', name: 'ธนกฤต ศรีวงศ์', roleLabel: 'ผู้จัดการโครงการ' },
    pimchanok: { id: 'user-pimchanok', name: 'พิมพ์ชนก วัฒนกุล', roleLabel: 'ฝ่ายจัดซื้อ' },
    nattapol: { id: 'user-nattapol', name: 'ณัฐพล ภูมิรักษ์', roleLabel: 'ผู้จัดการโครงการ' },
    arunee: { id: 'user-arunee', name: 'อรุณี แก้วใส', roleLabel: 'บัญชี/การเงิน' },
    sunisa: { id: 'user-sunisa', name: 'สุนิสา พรหมมา', roleLabel: 'ธุรการ' }
} satisfies Record<string, UserRef>;

/** ข้อมูลเจ้าของบริษัทสำหรับสร้างบัญชีตั้งต้น (ใช้ตอนใส่ข้อมูลครั้งแรกเท่านั้น) */
const SEED_OWNER: CurrentUser = {
    ...USERS.owner,
    roleId: 'owner',
    projectCodes: [],
    email: 'owner@example.invalid',
    phone: '081-000-0000',
    position: 'กรรมการผู้จัดการ',
    department: 'ผู้บริหาร',
    employeeCode: 'EMP690000',
    lastLoginAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    permissions: ['progress.update', 'personnel.sensitive', 'finance.company', 'approval.any', 'project.create', 'project.manage', 'user.manage', 'payment.record', 'procurement.manage', 'procurement.receive']
};

/** ผู้ที่ยังไม่ได้เข้าสู่ระบบ (ไม่มีสิทธิ์ใดเลย) */
const ANONYMOUS: CurrentUser = { id: '', name: '', roleId: 'client', roleLabel: '', projectCodes: [], email: '', lastLoginAt: new Date(0).toISOString(), permissions: [] };

/** ผู้ใช้ของคำขอปัจจุบัน — แยกตามคำขอด้วย AsyncLocalStorage (คำขอที่ทำงานพร้อมกันไม่ปนกัน) */
export const requestContext = new AsyncLocalStorage<{ user: CurrentUser | null }>();

/**
 * ผู้ใช้ที่ทำรายการในคำขอนี้ — ตรรกะทางธุรกิจอ่านสิทธิ์และชื่อผู้ทำรายการจากที่นี่
 * นอกคำขอ (ตอนใส่ข้อมูลตั้งต้น) คืนเจ้าของบริษัท ในคำขอที่ยังไม่ล็อกอินคืนผู้ใช้ที่ไม่มีสิทธิ์
 */
export const CURRENT_USER: CurrentUser = new Proxy({} as CurrentUser, {
    get(_target, prop) {
        const store = requestContext.getStore();
        const user = store ? (store.user ?? ANONYMOUS) : SEED_OWNER;
        return user[prop as keyof CurrentUser];
    },
    set(_target, prop, value) {
        const store = requestContext.getStore();
        if (!store) return false;
        store.user = { ...(store.user ?? ANONYMOUS), [prop]: value };
        return true;
    }
});

/** ข้อมูลผู้ใช้ของคำขอนี้แบบอ็อบเจกต์ปกติ (spread CURRENT_USER ไม่ได้เพราะเป็น Proxy) */
export function currentUserSnapshot(): CurrentUser {
    return { ...(requestContext.getStore()?.user ?? ANONYMOUS) };
}

/** ตั้งผู้ใช้ของคำขอนี้ (หลังตรวจ token หรือเข้าสู่ระบบสำเร็จ) */
export function setRequestUser(user: CurrentUser) {
    const store = requestContext.getStore();
    if (store) store.user = user;
}

/** UserRef ที่ทำรายการในฐานะบทบาทอื่น (เช่น จัดซื้อที่ส่งคำขอแทนผู้จัดการโครงการ) */
export const as = (user: UserRef, roleLabel: string): UserRef => ({ ...user, roleLabel });
