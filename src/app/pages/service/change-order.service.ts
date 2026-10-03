import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type ChangeOrder = ApiSchemas['ChangeOrder'];
export type ChangeOrderInput = ApiSchemas['ChangeOrderInput'];
export type ChangeOrderItem = ApiSchemas['ChangeOrderItem'];
export type ChangeOrderSource = ApiSchemas['ChangeOrderSource'];
export type ChangeOrderStatus = ApiSchemas['ChangeOrderStatus'];

export const CHANGE_SOURCE: Record<ChangeOrderSource, { label: string; hint: string }> = {
    customer: { label: 'ลูกค้าขอ', hint: 'งานนอกเหนือสัญญาหรือเปลี่ยนสเปกตามที่ลูกค้าต้องการ (ต้องให้ลูกค้ายืนยันก่อนอนุมัติ)' },
    site: { label: 'ปรับแก้หน้างาน', hint: 'แก้ไขระหว่างก่อสร้างตามสภาพหน้างานจริง' },
    design: { label: 'แก้แบบ', hint: 'แก้แบบหรือเปลี่ยนวัสดุตามผู้ออกแบบ/วิศวกร' }
};

export const CHANGE_STATUS: Record<ChangeOrderStatus, { label: string; severity: 'warn' | 'success' | 'danger' | 'secondary' }> = {
    pending: { label: 'รออนุมัติ', severity: 'warn' },
    approved: { label: 'อนุมัติแล้ว', severity: 'success' },
    rejected: { label: 'ไม่อนุมัติ', severity: 'danger' },
    cancelled: { label: 'ยกเลิก', severity: 'secondary' }
};

/** งานเพิ่ม-ลดของโครงการ (/projects/{code}/change-orders) — อนุมัติ/ไม่อนุมัติผ่าน ApprovalService ด้วย approvalId */
@Injectable({ providedIn: 'root' })
export class ChangeOrderService {
    private readonly http = inject(HttpClient);

    list(projectCode: string): Observable<ChangeOrder[]> {
        return this.http.get<ChangeOrder[]>(this.url(projectCode));
    }

    create(projectCode: string, input: ChangeOrderInput): Observable<ChangeOrder> {
        return this.http.post<ChangeOrder>(this.url(projectCode), input);
    }

    confirmByCustomer(projectCode: string, id: string): Observable<ChangeOrder> {
        return this.http.post<ChangeOrder>(this.url(projectCode, `/${encodeURIComponent(id)}/customer-confirm`), null);
    }

    cancel(projectCode: string, id: string, reason: string): Observable<ChangeOrder> {
        return this.http.post<ChangeOrder>(this.url(projectCode, `/${encodeURIComponent(id)}/cancel`), { reason: reason || undefined });
    }

    private url(projectCode: string, suffix = '') {
        return apiUrl(`/projects/${encodeURIComponent(projectCode)}/change-orders${suffix}`);
    }
}
