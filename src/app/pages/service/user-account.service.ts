import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';
import { Permission, RoleId } from './auth.service';

export type UserAccount = ApiSchemas['UserAccount'];
export type UserAccountInput = ApiSchemas['UserAccountInput'];
export type UserAccountCreateInput = ApiSchemas['UserAccountCreateInput'];
export type UserAccountStatus = ApiSchemas['UserAccountStatus'];
export type Registration = ApiSchemas['Registration'];
export type RegistrationInput = ApiSchemas['RegistrationInput'];
export type RegistrationStatus = ApiSchemas['RegistrationStatus'];
export type ApproveRegistrationInput = UserAccountInput & { personnelId: string };
export type UserAccountQuery = { q?: string; roleId?: RoleId | null; status?: UserAccountStatus | null; personnelId?: string };

/** ชื่อและคำอธิบายสิทธิ์ (เรียงตามที่แสดงในฟอร์ม) */
export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
    'project.create': { label: 'เปิดโครงการ', description: 'เปิดโครงการใหม่ในระบบ' },
    'project.manage': { label: 'จัดการโครงการ', description: 'บันทึกสัญญา ตั้งค่างานก่อสร้าง จัดทีมงานและผู้รับเหมา' },
    'progress.update': { label: 'บันทึกความคืบหน้า', description: 'อัปเดตงานหน้างานและบันทึกผลตรวจ' },
    'approval.any': { label: 'อนุมัติทุกยอด', description: 'อนุมัติคำขอได้โดยไม่จำกัดวงเงิน' },
    'finance.company': { label: 'การเงินระดับบริษัท', description: 'ดู Dashboard กำไร-ขาดทุนและกระแสเงินสด' },
    'personnel.sensitive': { label: 'ข้อมูลอ่อนไหวของบุคลากร', description: 'ดู/แก้ค่าตอบแทน บัญชีธนาคาร ผลประเมิน' },
    'user.manage': { label: 'จัดการผู้ใช้และสิทธิ์', description: 'สร้างบัญชี กำหนดบทบาท สิทธิ์ และระงับผู้ใช้' },
    'payment.record': { label: 'บันทึกรับชำระเงิน', description: 'บันทึกและยกเลิกการรับชำระเงินงวดงานจากลูกค้า พร้อมหลักฐาน' },
    'procurement.manage': { label: 'จัดซื้อและเช่าอุปกรณ์', description: 'ออกใบสั่งซื้อ รับของเข้าหน้างาน รับ/คืนอุปกรณ์ที่เช่าหรือยืม' }
};
export const PERMISSIONS = Object.keys(PERMISSION_INFO) as Permission[];

export const ACCOUNT_STATUS: Record<UserAccountStatus, { label: string; severity: 'success' | 'info' | 'danger' }> = {
    active: { label: 'ใช้งาน', severity: 'success' },
    invited: { label: 'รอตั้งรหัสผ่าน', severity: 'info' },
    suspended: { label: 'ระงับ', severity: 'danger' }
};

/** บัญชีผู้ใช้ของบุคลากร (/user-accounts) — ต้องมีสิทธิ์ user.manage */
@Injectable({ providedIn: 'root' })
export class UserAccountService {
    private readonly http = inject(HttpClient);

    list(query: UserAccountQuery = {}): Observable<UserAccount[]> {
        return this.http.get<UserAccount[]>(apiUrl('/user-accounts'), { params: queryParams(query) });
    }

    create(input: UserAccountCreateInput): Observable<UserAccount> {
        return this.http.post<UserAccount>(apiUrl('/user-accounts'), input);
    }

    update(id: string, input: UserAccountInput): Observable<UserAccount> {
        return this.http.put<UserAccount>(this.url(id), input);
    }

    suspend(id: string, reason: string): Observable<UserAccount> {
        return this.http.post<UserAccount>(this.url(id, '/suspend'), { reason: reason || undefined });
    }

    activate(id: string): Observable<UserAccount> {
        return this.http.post<UserAccount>(this.url(id, '/activate'), null);
    }

    resetPassword(id: string): Observable<UserAccount> {
        return this.http.post<UserAccount>(this.url(id, '/reset-password'), null);
    }

    /** สมัครสมาชิก (ไม่ต้องล็อกอิน) — ได้คำขอที่รอแอดมินหรือเจ้าของบริษัทอนุมัติ */
    register(input: RegistrationInput): Observable<{ id: string; status: 'pending'; submittedAt: string }> {
        return this.http.post<{ id: string; status: 'pending'; submittedAt: string }>(apiUrl('/auth/register'), input);
    }

    registrations(status: RegistrationStatus | null = null): Observable<Registration[]> {
        return this.http.get<Registration[]>(apiUrl('/registrations'), { params: queryParams({ status }) });
    }

    approveRegistration(id: string, input: ApproveRegistrationInput): Observable<UserAccount> {
        return this.http.post<UserAccount>(apiUrl(`/registrations/${encodeURIComponent(id)}/approve`), input);
    }

    rejectRegistration(id: string, reason: string): Observable<Registration> {
        return this.http.post<Registration>(apiUrl(`/registrations/${encodeURIComponent(id)}/reject`), { reason });
    }

    private url(id: string, suffix = '') {
        return apiUrl(`/user-accounts/${encodeURIComponent(id)}${suffix}`);
    }
}
