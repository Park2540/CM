import { persistArray, persistMap } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { hoursAgo } from './utils.js';
import { recordAudit } from './audit-logs.js';
import { listPersonnel } from './personnel.js';
import { Outcome } from './project-team.js';
import { createAccount, emailHasAccount, personnelHasAccount } from './user-accounts.js';
import { DEMO_PASSWORD_HASH, hashPassword, verifyPassword } from './passwords.js';
import { CURRENT_USER, USERS } from './users.js';

type Registration = ApiSchemas['Registration'];
type ApproveInput = ApiSchemas['UserAccountInput'] & { personnelId: string };

const PHONE = /^0\d{8,9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** คำขอตัวอย่าง (ล่าสุดก่อน) — suggestedPersonnelId คำนวณตอนตอบ */
const registrations: Omit<Registration, 'suggestedPersonnelId'>[] = [
    { id: 'reg-003', fullName: 'สมศักดิ์ มั่นคง', email: 'somsak@example.invalid', phone: '081-555-0107', employeeCode: 'EMP690007', position: 'ผู้ควบคุมงาน', note: 'ประจำโครงการ CR690001', status: 'pending', submittedAt: hoursAgo(3) },
    { id: 'reg-002', fullName: 'ปิยะพงษ์ ดวงดี', email: 'piyapong@example.invalid', phone: '089-555-0202', position: 'ช่างสำรวจ', note: 'พนักงานใหม่ เริ่มงานสัปดาห์หน้า', status: 'pending', submittedAt: hoursAgo(20) },
    {
        id: 'reg-001',
        fullName: 'ทดสอบ ไม่ทราบชื่อ',
        email: 'unknown@example.invalid',
        phone: '090-555-0303',
        status: 'rejected',
        submittedAt: hoursAgo(80),
        decidedAt: hoursAgo(76),
        decidedBy: USERS.admin,
        rejectReason: 'ไม่ใช่บุคลากรของบริษัท'
    }
];

/** hash รหัสผ่านที่ผู้สมัครตั้งไว้ ใช้ได้เมื่ออนุมัติ */
const passwords = new Map<string, string>(registrations.map((item) => [item.id, DEMO_PASSWORD_HASH]));

/** คำขอล่าสุดของอีเมลนี้ (ใช้แจ้งเหตุผลตอนเข้าสู่ระบบไม่ได้) */
export function latestRegistrationFor(email: string, password: string) {
    const found = registrations.find((item) => item.email === email.trim().toLowerCase());
    return found && verifyPassword(password, passwords.get(found.id)) ? found : undefined;
}

/** จับคู่กับบุคลากรที่ยังไม่มีบัญชี: รหัสบุคลากร → อีเมล → ชื่อ */
function suggestPersonnel(registration: Omit<Registration, 'suggestedPersonnelId'>): string | undefined {
    const candidates = listPersonnel().filter((person) => !personnelHasAccount(person.id) && !person.endDate);
    const code = registration.employeeCode?.trim().toUpperCase();
    const email = registration.email.toLowerCase();
    const name = registration.fullName.replace(/\s+/g, ' ').trim();
    return ((code && candidates.find((person) => person.employeeCode === code)) || candidates.find((person) => person.email?.toLowerCase() === email) || candidates.find((person) => person.fullName.replace(/\s+/g, ' ').trim() === name))?.id;
}

const present = (registration: Omit<Registration, 'suggestedPersonnelId'>): Registration => (registration.status === 'pending' ? { ...registration, suggestedPersonnelId: suggestPersonnel(registration) } : registration);

export function listRegistrations(status: string | null): Registration[] {
    return registrations.filter((item) => !status || item.status === status).map(present);
}

export const pendingRegistrationCount = () => registrations.filter((item) => item.status === 'pending').length;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function submitRegistration(input: Partial<ApiSchemas['RegistrationInput']>): Outcome<Registration> {
    const errors: Record<string, string> = {};
    const email = text(input.email).toLowerCase();
    if (!text(input.fullName)) errors['fullName'] = 'กรุณาระบุชื่อ-นามสกุล';
    if (!EMAIL.test(email)) errors['email'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (!PHONE.test(text(input.phone).replace(/[\s-]/g, ''))) errors['phone'] = 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0';
    if ((input.password ?? '').length < 8) errors['password'] = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    if (Object.keys(errors).length) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };
    if (emailHasAccount(email)) return { status: 409, title: 'อีเมลนี้มีบัญชีอยู่แล้ว', detail: 'เข้าสู่ระบบ หรือติดต่อแอดมินเพื่อรีเซ็ตรหัสผ่าน', errors: { email: 'อีเมลนี้มีบัญชีอยู่แล้ว' } };
    if (registrations.some((item) => item.status === 'pending' && item.email === email)) return { status: 409, title: 'อีเมลนี้มีคำขอรออนุมัติอยู่แล้ว', detail: 'กรุณารอแอดมินหรือเจ้าของบริษัทอนุมัติ', errors: { email: 'มีคำขอรออนุมัติอยู่แล้ว' } };

    const registration: Registration = {
        id: `reg-${Date.now()}`,
        fullName: text(input.fullName),
        email,
        phone: text(input.phone),
        employeeCode: text(input.employeeCode).toUpperCase() || undefined,
        position: text(input.position) || undefined,
        note: text(input.note) || undefined,
        status: 'pending',
        submittedAt: new Date().toISOString()
    };
    registrations.unshift(registration);
    passwords.set(registration.id, hashPassword(input.password ?? ''));
    return { ok: registration };
}

function findPending(id: string): Outcome<Omit<Registration, 'suggestedPersonnelId'>> {
    const registration = registrations.find((item) => item.id === id);
    if (!registration) return { status: 404, title: 'ไม่พบคำขอสมัครสมาชิก' };
    if (registration.status !== 'pending') return { status: 409, title: 'คำขอนี้ถูกตัดสินไปแล้ว', detail: registration.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว' };
    return { ok: registration };
}

const decider = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });

/** อนุมัติ: สร้างบัญชี active ด้วยอีเมลที่สมัครไว้ */
export function approveRegistration(id: string, input: Partial<ApproveInput>): Outcome<ApiSchemas['UserAccount']> {
    const found = findPending(id);
    if (!('ok' in found)) return found;
    const registration = found.ok;
    const created = createAccount({ ...input, email: registration.email }, { passwordHash: passwords.get(registration.id) ?? '' });
    if (!('ok' in created)) return created;

    Object.assign(registration, { status: 'approved', decidedAt: new Date().toISOString(), decidedBy: decider(), accountId: created.ok.id });
    recordAudit({ module: 'system', action: 'อนุมัติสมัครสมาชิก', target: created.ok.name, detail: `บทบาท ${created.ok.roleLabel}${created.ok.projectCodes.length ? ` (${created.ok.projectCodes.join(', ')})` : ''} · ${registration.email}` });
    return created;
}

export function rejectRegistration(id: string, reason: string | undefined): Outcome<Registration> {
    const found = findPending(id);
    if (!('ok' in found)) return found;
    const note = reason?.trim();
    if (!note) return { status: 422, title: 'กรุณาระบุเหตุผลที่ปฏิเสธ', errors: { reason: 'จำเป็นต้องระบุ' } };
    Object.assign(found.ok, { status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: decider(), rejectReason: note });
    recordAudit({ module: 'system', action: 'ปฏิเสธสมัครสมาชิก', target: found.ok.fullName, detail: `${found.ok.email} · ${note}` });
    return { ok: present(found.ok) };
}

// ล่าสุดก่อน
persistArray(
    'registrations',
    registrations,
    (item) => item.id,
    (a, b) => b.submittedAt.localeCompare(a.submittedAt)
);
persistMap('registration_passwords', passwords);
