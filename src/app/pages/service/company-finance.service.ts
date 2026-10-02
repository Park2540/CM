import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';

export type ProjectHealth = ApiSchemas['ProjectHealth'];
export type ProjectFinance = ApiSchemas['ProjectFinance'];
export type DashboardSummary = ApiSchemas['DashboardSummary'];

export interface MonthlyCashFlow {
    key: string;
    label: string;
    cashIn: number;
    cashOut: number;
}

const monthLabel = new Intl.DateTimeFormat('th-TH', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** ตัวเลขการเงินระดับบริษัทสำหรับ Dashboard เจ้าของ — หลังบ้านเป็นผู้คำนวณ (/dashboard/*) */
@Injectable({ providedIn: 'root' })
export class CompanyFinanceService {
    private readonly http = inject(HttpClient);

    summary(): Observable<DashboardSummary> {
        return this.http.get<DashboardSummary>(apiUrl('/dashboard/summary'));
    }

    cashFlow(months = 6): Observable<MonthlyCashFlow[]> {
        return this.http
            .get<ApiSchemas['MonthlyCashFlow'][]>(apiUrl('/dashboard/cash-flow'), { params: queryParams({ months }) })
            .pipe(map((rows) => rows.map((row) => ({ key: row.month, label: monthLabel.format(new Date(`${row.month}-01T00:00:00Z`)), cashIn: row.cashIn, cashOut: row.cashOut }))));
    }
}
