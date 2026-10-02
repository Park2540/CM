import { ApiSchemas } from '@/app/api/api';

type UserRef = ApiSchemas['UserRef'];

export const USERS = {
    owner: { id: 'user-owner', name: 'เจ้าของบริษัท', roleLabel: 'เจ้าของบริษัท' },
    admin: { id: 'user-admin', name: 'ผู้ดูแลระบบ', roleLabel: 'แอดมิน' },
    thanakrit: { id: 'user-thanakrit', name: 'ธนกฤต ศรีวงศ์', roleLabel: 'ผู้จัดการโครงการ' },
    pimchanok: { id: 'user-pimchanok', name: 'พิมพ์ชนก วัฒนกุล', roleLabel: 'ฝ่ายจัดซื้อ' },
    nattapol: { id: 'user-nattapol', name: 'ณัฐพล ภูมิรักษ์', roleLabel: 'ผู้จัดการโครงการ' },
    arunee: { id: 'user-arunee', name: 'อรุณี แก้วใส', roleLabel: 'บัญชี/การเงิน' },
    sunisa: { id: 'user-sunisa', name: 'สุนิสา พรหมมา', roleLabel: 'ธุรการ' }
} satisfies Record<string, UserRef>;

/** ผู้ใช้ที่ "ล็อกอิน" อยู่ใน API จำลอง */
export const CURRENT_USER: ApiSchemas['CurrentUser'] = {
    ...USERS.owner,
    roleId: 'owner',
    projectCodes: [],
    email: 'owner@example.invalid',
    phone: '081-000-0000',
    position: 'กรรมการผู้จัดการ',
    department: 'ผู้บริหาร',
    employeeCode: 'EMP690000',
    lastLoginAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    // เจ้าของบริษัทได้ทุกสิทธิ์ตามตารางบทบาท
    permissions: ['progress.update', 'personnel.sensitive', 'finance.company', 'approval.any', 'project.create', 'project.manage']
};

/** UserRef ที่ทำรายการในฐานะบทบาทอื่น (เช่น จัดซื้อที่ส่งคำขอแทนผู้จัดการโครงการ) */
export const as = (user: UserRef, roleLabel: string): UserRef => ({ ...user, roleLabel });
