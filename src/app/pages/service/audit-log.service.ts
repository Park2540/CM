import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiPage, ApiSchemas, apiUrl, queryParams, toDate } from '@/app/api/api';

export type AuditModule = ApiSchemas['AuditModule'];

export const AUDIT_MODULE_LABEL: Record<AuditModule, string> = {
    approval: 'อนุมัติ',
    project: 'โครงการ',
    personnel: 'บุคลากร',
    procurement: 'จัดซื้อ',
    finance: 'การเงิน',
    system: 'ระบบ'
};

export type AuditEntry = Omit<ApiSchemas['AuditEntry'], 'at'> & { at: Date };

export interface AuditLogQuery {
    module?: AuditModule | null;
    userId?: string | null;
    q?: string;
    page?: number;
    pageSize?: number;
}

/**
 * Audit Log (อ่านอย่างเดียว) — หลังบ้านเป็นผู้บันทึกทุกการเปลี่ยนแปลง หน้าบ้านไม่มีสิทธิ์เขียน
 */
@Injectable({ providedIn: 'root' })
export class AuditLogService {
    private readonly http = inject(HttpClient);

    list(query: AuditLogQuery = {}): Observable<ApiPage<AuditEntry>> {
        return this.http.get<ApiSchemas['AuditLogPage']>(apiUrl('/audit-logs'), { params: queryParams({ ...query }) }).pipe(map((page) => ({ ...page, items: page.items.map((entry) => ({ ...entry, at: toDate(entry.at) })) })));
    }

    exportCsv(query: Omit<AuditLogQuery, 'page' | 'pageSize'> = {}): Observable<Blob> {
        return this.http.get(apiUrl('/audit-logs/export'), { params: queryParams({ ...query }), responseType: 'blob' });
    }
}
