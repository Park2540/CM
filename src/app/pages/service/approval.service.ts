import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { ApiPage, ApiSchemas, apiUrl, queryParams, toDate } from '@/app/api/api';

export type ApprovalType = ApiSchemas['ApprovalType'];
export type ApprovalStatus = ApiSchemas['ApprovalStatus'];
export type ApprovalSummary = ApiSchemas['ApprovalSummary'];
export type ApprovalSettings = ApiSchemas['ApprovalSettings'];

export const APPROVAL_TYPE_LABEL: Record<ApprovalType, string> = {
    pr: 'ใบขอซื้อ (PR)',
    po: 'ใบสั่งซื้อ (PO)',
    subcontract: 'เบิกงวดผู้รับเหมาช่วง',
    'change-order': 'งานเพิ่ม-ลด',
    'petty-cash': 'เบิกเงินสดย่อย',
    rental: 'เช่าอุปกรณ์'
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };

export const APPROVAL_STEP_LABEL: Record<ApiSchemas['ApprovalStep']['action'], string> = { submitted: 'ส่งขออนุมัติ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ' };

export type ApprovalStep = Omit<ApiSchemas['ApprovalStep'], 'at'> & { at: Date };
export type ApprovalRequest = Omit<ApiSchemas['Approval'], 'requestedAt' | 'history'> & { requestedAt: Date; history: ApprovalStep[] };

export interface ApprovalQuery {
    status?: ApprovalStatus | null;
    type?: ApprovalType | null;
    projectCode?: string | null;
    q?: string;
    sort?: 'newest' | 'priority';
    page?: number;
    pageSize?: number;
}

function fromApi(approval: ApiSchemas['Approval']): ApprovalRequest {
    return { ...approval, requestedAt: toDate(approval.requestedAt), history: approval.history.map((step) => ({ ...step, at: toDate(step.at) })) };
}

/** คำขออนุมัติ — เรียก API ตามสัญญา (/approvals) */
@Injectable({ providedIn: 'root' })
export class ApprovalService {
    private readonly http = inject(HttpClient);

    private readonly summaryState = signal<ApprovalSummary | null>(null);
    /** ตัวเลขสรุป ใช้ร่วมกันหลายหน้า (แถบด้านบน, Dashboard, ศูนย์อนุมัติ) — อัปเดตหลังทุกการตัดสินใจ */
    readonly summary = this.summaryState.asReadonly();
    private readonly settingsState = signal<ApprovalSettings | null>(null);
    readonly settings = this.settingsState.asReadonly();

    constructor() {
        this.refreshSummary();
        this.http.get<ApprovalSettings>(apiUrl('/settings/approval')).subscribe({ next: (settings) => this.settingsState.set(settings), error: () => {} });
    }

    refreshSummary() {
        // A failed summary only hides the counters; pages show their own errors.
        this.http.get<ApprovalSummary>(apiUrl('/approvals/summary')).subscribe({ next: (summary) => this.summaryState.set(summary), error: () => {} });
    }

    list(query: ApprovalQuery = {}): Observable<ApiPage<ApprovalRequest>> {
        return this.http.get<ApiSchemas['ApprovalPage']>(apiUrl('/approvals'), { params: queryParams({ ...query }) }).pipe(map((page) => ({ ...page, items: page.items.map(fromApi) })));
    }

    approve(id: string, note?: string): Observable<ApprovalRequest> {
        return this.http.post<ApiSchemas['Approval']>(apiUrl(`/approvals/${encodeURIComponent(id)}/approve`), { note: note || undefined } satisfies ApiSchemas['DecisionInput']).pipe(
            map(fromApi),
            tap(() => this.refreshSummary())
        );
    }

    reject(id: string, note: string): Observable<ApprovalRequest> {
        return this.http.post<ApiSchemas['Approval']>(apiUrl(`/approvals/${encodeURIComponent(id)}/reject`), { note } satisfies ApiSchemas['RejectInput']).pipe(
            map(fromApi),
            tap(() => this.refreshSummary())
        );
    }

    bulkApprove(ids: string[], note?: string): Observable<{ approved: ApprovalRequest[]; skipped: ApiSchemas['BulkApproveResult']['skipped'] }> {
        return this.http.post<ApiSchemas['BulkApproveResult']>(apiUrl('/approvals/bulk-approve'), { ids, note: note || undefined }).pipe(
            map((result) => ({ approved: result.approved.map(fromApi), skipped: result.skipped })),
            tap(() => this.refreshSummary())
        );
    }
}
