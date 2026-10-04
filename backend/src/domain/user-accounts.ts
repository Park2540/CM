import { persistArray, persistMap } from '../db/state.js';
import { DEMO_PASSWORD_HASH, verifyPassword } from './passwords.js';
import type { ApiSchemas } from '../api/api.js';
import { recordAudit } from './audit-logs.js';
import { findPersonnel } from './personnel.js';
import { Outcome } from './project-team.js';
import { findProject } from './projects.js';
import { findRole } from './roles.js';
import { CURRENT_USER } from './users.js';

type UserAccount = ApiSchemas['UserAccount'];
type UserAccountInput = ApiSchemas['UserAccountInput'];
type Permission = ApiSchemas['Permission'];

/** ข้อมูลที่เก็บจริง — ชื่อ ตำแหน่ง และสิทธิ์ที่ใช้จริงคำนวณตอนตอบ */
type StoredAccount = Omit<UserAccount, 'name' | 'employeeCode' | 'position' | 'department' | 'phone' | 'roleLabel' | 'permissions'> & { passwordSet: boolean };

/** ชื่อสิทธิ์ภาษาไทยสำหรับ Audit Log */
const PERMISSION_LABEL: Record<Permission, string> = {
    'progress.update': 'บันทึกความคืบหน้า',
    'personnel.sensitive': 'ข้อมูลอ่อนไหวของบุคลากร',
    'finance.company': 'การเงินระดับบริษัท',
    'approval.any': 'อนุมัติทุกยอด',
    'project.create': 'เปิดโครงการ',
    'project.manage': 'จัดการโครงการ',
    'user.manage': 'จัดการผู้ใช้และสิทธิ์',
    'payment.record': 'บันทึกรับชำระเงินงวดงาน',
    'procurement.manage': 'จัดซื้อและเช่าอุปกรณ์',
    'procurement.receive': 'ตรวจรับของและคลังหน้างาน'
};
const PERMISSIONS = Object.keys(PERMISSION_LABEL) as Permission[];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** บัญชีตัวอย่าง — id ตรงกับ USERS ใน users.ts เพื่อให้ Audit Log อ้างถึงคนเดียวกัน */
const accounts: StoredAccount[] = [
    {
        id: CURRENT_USER.id,
        personnelId: 'personnel-000',
        email: CURRENT_USER.email,
        roleId: 'owner',
        projectCodes: [],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(400),
        lastLoginAt: CURRENT_USER.lastLoginAt
    },
    {
        id: 'user-thanakrit',
        personnelId: 'personnel-001',
        email: 'thanakrit@example.invalid',
        roleId: 'project-manager',
        projectCodes: ['CR690001', 'CR690002'],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(300),
        lastLoginAt: daysAgo(0.2)
    },
    {
        id: 'user-pimchanok',
        personnelId: 'personnel-002',
        email: 'pimchanok@example.invalid',
        roleId: 'procurement',
        projectCodes: [],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(280),
        lastLoginAt: daysAgo(0.1)
    },
    {
        id: 'user-nattapol',
        personnelId: 'personnel-003',
        email: 'nattapol@example.invalid',
        roleId: 'project-manager',
        projectCodes: ['BKK690001'],
        grantedPermissions: ['project.create'],
        revokedPermissions: [],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(250),
        lastLoginAt: daysAgo(1)
    },
    {
        id: 'user-waranya',
        personnelId: 'personnel-004',
        email: 'waranya@example.invalid',
        roleId: 'project-manager',
        projectCodes: ['CNX690001'],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'invited',
        passwordSet: false,
        createdAt: daysAgo(2.3),
        invitedAt: daysAgo(2.3)
    },
    {
        id: 'user-prasert',
        personnelId: 'personnel-006',
        email: 'prasert@example.invalid',
        roleId: 'engineer',
        projectCodes: ['CR690003'],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'suspended',
        passwordSet: true,
        createdAt: daysAgo(200),
        lastLoginAt: daysAgo(45)
    },
    {
        id: 'user-arunee',
        personnelId: 'personnel-008',
        email: 'arunee@example.invalid',
        roleId: 'accounting',
        projectCodes: [],
        grantedPermissions: [],
        revokedPermissions: ['personnel.sensitive'],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(320),
        lastLoginAt: daysAgo(0.4)
    },
    {
        id: 'user-kittisak',
        personnelId: 'personnel-009',
        email: 'kittisak@example.invalid',
        roleId: 'foreman',
        projectCodes: ['CR690001'],
        grantedPermissions: [],
        revokedPermissions: [],
        status: 'active',
        passwordSet: true,
        createdAt: daysAgo(150),
        lastLoginAt: daysAgo(0.05)
    }
];

/** hash รหัสผ่านตามบัญชี (บัญชีตัวอย่างใช้ demo1234) */
const passwords = new Map<string, string>(accounts.filter((account) => account.passwordSet).map((account) => [account.id, DEMO_PASSWORD_HASH]));

/** สิทธิ์ที่ใช้จริง = สิทธิ์ของบทบาท + ที่ให้เพิ่ม − ที่ถอนออก */
function effectivePermissions(account: Pick<StoredAccount, 'roleId' | 'grantedPermissions' | 'revokedPermissions'>): Permission[] {
    const base = findRole(account.roleId)?.permissions ?? [];
    return PERMISSIONS.filter((permission) => (base.includes(permission) || account.grantedPermissions.includes(permission)) && !account.revokedPermissions.includes(permission));
}

function present(account: StoredAccount): UserAccount {
    const { passwordSet: _passwordSet, ...rest } = account;
    const person = findPersonnel(account.personnelId);
    return {
        ...rest,
        name: person?.fullName ?? '(ไม่พบในทะเบียนบุคลากร)',
        employeeCode: person?.employeeCode,
        position: person?.position,
        department: person?.department,
        phone: person?.phone,
        roleLabel: findRole(account.roleId)?.label ?? account.roleId,
        permissions: effectivePermissions(account)
    };
}

export const canManageUsers = () => CURRENT_USER.permissions.includes('user.manage');
/** อนุมัติ/ปฏิเสธการสมัครสมาชิกได้เฉพาะบทบาทแอดมินหรือเจ้าของบริษัท (ไม่ขึ้นกับสิทธิ์รายคน) */
export const canApproveRegistrations = () => CURRENT_USER.roleId === 'admin' || CURRENT_USER.roleId === 'owner';
export const emailHasAccount = (email: string) => accounts.some((account) => account.email.toLowerCase() === email.trim().toLowerCase());
export const personnelHasAccount = (personnelId: string) => accounts.some((account) => account.personnelId === personnelId);
const isSelf = (account: StoredAccount) => account.id === CURRENT_USER.id;
const activeOwners = () => accounts.filter((account) => account.roleId === 'owner' && account.status !== 'suspended');

export function listAccounts(filter: { q: string | null; roleId: string | null; status: string | null; personnelId: string | null }): UserAccount[] {
    const query = filter.q?.trim().toLowerCase();
    return accounts
        .map(present)
        .filter(
            (account) =>
                (!filter.roleId || account.roleId === filter.roleId) &&
                (!filter.status || account.status === filter.status) &&
                (!filter.personnelId || account.personnelId === filter.personnelId) &&
                (!query || [account.name, account.employeeCode, account.email].some((field) => field?.toLowerCase().includes(query)))
        )
        .sort((a, b) => (a.employeeCode ?? '').localeCompare(b.employeeCode ?? ''));
}

const findAccount = (id: string) => accounts.find((account) => account.id === id);

/** ตรวจข้อมูลบัญชี คืนข้อมูลที่ทำความสะอาดแล้ว หรือ errors รายช่อง */
function validate(input: Partial<UserAccountInput>, selfId?: string): { errors: Record<string, string>; value?: UserAccountInput } {
    const errors: Record<string, string> = {};
    const email = input.email?.trim().toLowerCase() ?? '';
    const role = input.roleId ? findRole(input.roleId) : undefined;
    const projectCodes = [...new Set(input.projectCodes ?? [])];
    const granted = [...new Set(input.grantedPermissions ?? [])];
    const revoked = [...new Set(input.revokedPermissions ?? [])];

    if (!EMAIL.test(email)) errors['email'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    else if (accounts.some((account) => account.id !== selfId && account.email.toLowerCase() === email)) errors['email'] = 'อีเมลนี้ใช้กับบัญชีอื่นแล้ว';
    if (!role) errors['roleId'] = 'กรุณาเลือกบทบาท';
    else if (role.group === 'external') errors['roleId'] = 'บทบาทบุคคลภายนอกสร้างจากทะเบียนบุคลากรไม่ได้';
    else if (role.id === 'owner' && CURRENT_USER.roleId !== 'owner') errors['roleId'] = 'เฉพาะเจ้าของบริษัทที่มอบบทบาทเจ้าของบริษัทได้';
    if (role?.group === 'project') {
        if (!projectCodes.length) errors['projectCodes'] = 'บทบาททีมประจำโครงการต้องเลือกอย่างน้อย 1 โครงการ';
        else if (projectCodes.some((code) => !findProject(code))) errors['projectCodes'] = 'ไม่พบบางโครงการที่เลือก';
    }
    if ([...granted, ...revoked].some((permission) => !PERMISSIONS.includes(permission))) errors['permissions'] = 'สิทธิ์ไม่ถูกต้อง';
    else if (role && granted.some((permission) => role.permissions.includes(permission))) errors['permissions'] = 'สิทธิ์ที่ให้เพิ่มต้องไม่ใช่สิทธิ์ที่บทบาทมีอยู่แล้ว';
    else if (role && revoked.some((permission) => !role.permissions.includes(permission))) errors['permissions'] = 'ถอนได้เฉพาะสิทธิ์ที่บทบาทมี';
    if (Object.keys(errors).length) return { errors };

    return {
        errors,
        value: { email, roleId: role!.id, projectCodes: role!.group === 'project' ? projectCodes : [], grantedPermissions: granted, revokedPermissions: revoked }
    };
}

const unprocessable = (errors: Record<string, string>) => ({ status: 422 as const, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors });

/**
 * สร้างบัญชีให้บุคลากร — แอดมินสร้างเอง: invited (ส่งคำเชิญตั้งรหัสผ่าน)
 * อนุมัติจากคำขอสมัครสมาชิก: active (ผู้สมัครตั้งรหัสผ่านไว้แล้ว)
 */
export function createAccount(input: Partial<ApiSchemas['UserAccountCreateInput']>, fromRegistration: { passwordHash: string } | null = null): Outcome<UserAccount> {
    const person = input.personnelId ? findPersonnel(input.personnelId) : undefined;
    if (!person) return unprocessable({ personnelId: 'กรุณาเลือกบุคลากร' });
    if (accounts.some((account) => account.personnelId === person.id)) return { status: 409, title: 'บุคลากรคนนี้มีบัญชีแล้ว', detail: person.fullName };
    if (person.endDate && person.endDate < new Date().toISOString().slice(0, 10)) return unprocessable({ personnelId: 'บุคลากรคนนี้พ้นสภาพแล้ว' });
    const { errors, value } = validate(input);
    if (!value) return unprocessable(errors);

    const now = new Date().toISOString();
    const account: StoredAccount = fromRegistration
        ? { id: `user-${Date.now()}`, personnelId: person.id, ...value, status: 'active', passwordSet: true, createdAt: now }
        : { id: `user-${Date.now()}`, personnelId: person.id, ...value, status: 'invited', passwordSet: false, createdAt: now, invitedAt: now };
    accounts.push(account);
    if (fromRegistration) passwords.set(account.id, fromRegistration.passwordHash);
    const result = present(account);
    if (!fromRegistration) recordAudit({ module: 'system', action: 'เพิ่มผู้ใช้', target: result.name, detail: `บทบาท ${result.roleLabel}${value.projectCodes.length ? ` (${value.projectCodes.join(', ')})` : ''} · ส่งคำเชิญไปที่ ${value.email}` });
    return { ok: result };
}

const permissionDiff = (before: Permission[], after: Permission[]) =>
    [...after.filter((permission) => !before.includes(permission)).map((permission) => `+${PERMISSION_LABEL[permission]}`), ...before.filter((permission) => !after.includes(permission)).map((permission) => `−${PERMISSION_LABEL[permission]}`)].join(
        ', '
    );

export function updateAccount(id: string, input: Partial<UserAccountInput>): Outcome<UserAccount> {
    const account = findAccount(id);
    if (!account) return { status: 404, title: 'ไม่พบบัญชีผู้ใช้' };
    const { errors, value } = validate(input, id);
    if (!value) return unprocessable(errors);
    if (isSelf(account) && value.roleId !== account.roleId) return { status: 409, title: 'แก้บทบาทของตัวเองไม่ได้', detail: 'ให้ผู้ดูแลคนอื่นเป็นผู้แก้' };
    if (isSelf(account) && !effectivePermissions(value).includes('user.manage')) return { status: 409, title: 'ถอนสิทธิ์จัดการผู้ใช้ของตัวเองไม่ได้', detail: 'ป้องกันไม่ให้ไม่มีใครจัดการผู้ใช้ได้' };
    if (account.roleId === 'owner' && value.roleId !== 'owner' && account.status !== 'suspended' && activeOwners().length === 1) return { status: 409, title: 'ต้องมีเจ้าของบริษัทอย่างน้อย 1 บัญชี' };

    const before = present(account);
    Object.assign(account, value);
    const after = present(account);
    const changes = [
        before.roleId !== after.roleId ? `บทบาท ${before.roleLabel} → ${after.roleLabel}` : '',
        before.projectCodes.join(',') !== after.projectCodes.join(',') ? `โครงการ ${after.projectCodes.join(', ') || 'ทุกโครงการ'}` : '',
        permissionDiff(before.permissions, after.permissions) ? `สิทธิ์ ${permissionDiff(before.permissions, after.permissions)}` : '',
        before.email !== after.email ? `อีเมล ${after.email}` : ''
    ].filter(Boolean);
    recordAudit({ module: 'system', action: 'แก้ไขสิทธิ์ผู้ใช้', target: after.name, detail: changes.join(' · ') || 'ไม่มีการเปลี่ยนแปลง' });
    return { ok: after };
}

export function suspendAccount(id: string, reason?: string): Outcome<UserAccount> {
    const account = findAccount(id);
    if (!account) return { status: 404, title: 'ไม่พบบัญชีผู้ใช้' };
    if (account.status === 'suspended') return { status: 409, title: 'บัญชีนี้ถูกระงับอยู่แล้ว' };
    if (isSelf(account)) return { status: 409, title: 'ระงับบัญชีของตัวเองไม่ได้' };
    if (account.roleId === 'owner' && activeOwners().length === 1) return { status: 409, title: 'ต้องมีเจ้าของบริษัทที่ใช้งานได้อย่างน้อย 1 บัญชี' };
    account.status = 'suspended';
    const result = present(account);
    recordAudit({ module: 'system', action: 'ระงับผู้ใช้', target: result.name, detail: reason?.trim() || 'ไม่ระบุเหตุผล' });
    return { ok: result };
}

export function activateAccount(id: string): Outcome<UserAccount> {
    const account = findAccount(id);
    if (!account) return { status: 404, title: 'ไม่พบบัญชีผู้ใช้' };
    if (account.status !== 'suspended') return { status: 409, title: 'บัญชีนี้ไม่ได้ถูกระงับ' };
    account.status = account.passwordSet ? 'active' : 'invited';
    const result = present(account);
    recordAudit({ module: 'system', action: 'เปิดใช้ผู้ใช้', target: result.name, detail: `บทบาท ${result.roleLabel}` });
    return { ok: result };
}

export function resetPassword(id: string): Outcome<UserAccount> {
    const account = findAccount(id);
    if (!account) return { status: 404, title: 'ไม่พบบัญชีผู้ใช้' };
    if (account.status === 'suspended') return { status: 409, title: 'บัญชีที่ระงับอยู่รีเซ็ตรหัสผ่านไม่ได้', detail: 'เปิดใช้บัญชีก่อน' };
    account.invitedAt = new Date().toISOString();
    const result = present(account);
    recordAudit({ module: 'system', action: account.status === 'invited' ? 'ส่งคำเชิญซ้ำ' : 'รีเซ็ตรหัสผ่าน', target: result.name, detail: `ส่งลิงก์ไปที่ ${account.email}` });
    return { ok: result };
}

// ---------- การเข้าสู่ระบบ (ใช้โดย session.ts) ----------

export const findAccountByEmail = (email: string) => accounts.find((account) => account.email.toLowerCase() === email.trim().toLowerCase());
export const findAccountById = (id: string) => accounts.find((account) => account.id === id);
export const passwordMatches = (accountId: string, password: string) => verifyPassword(password, passwords.get(accountId));

/** ข้อมูลผู้ใช้ที่ล็อกอิน (GET /auth/me) จากบัญชี + ทะเบียนบุคลากร */
export function toCurrentUser(account: StoredAccount): ApiSchemas['CurrentUser'] {
    const presented = present(account);
    const person = findPersonnel(account.personnelId);
    return {
        id: account.id,
        name: presented.name,
        roleId: account.roleId,
        roleLabel: presented.roleLabel,
        projectCodes: account.projectCodes,
        email: account.email,
        phone: person?.phone,
        position: person?.position,
        department: person?.department,
        employeeCode: person?.employeeCode,
        avatarUrl: person?.photoUrl,
        lastLoginAt: account.lastLoginAt ?? account.createdAt,
        permissions: presented.permissions
    };
}

/** บันทึกเวลาเข้าสู่ระบบ คืนเวลาครั้งก่อนหน้า (ใช้แสดง "เข้าสู่ระบบครั้งก่อน") */
export function recordLogin(account: StoredAccount): string {
    const previous = account.lastLoginAt ?? account.createdAt;
    account.lastLoginAt = new Date().toISOString();
    return previous;
}

persistArray('user_accounts', accounts, (account) => account.id);
persistMap('user_passwords', passwords);
