import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type ProcurementItem = ApiSchemas['ProcurementItem'];
export type PurchaseRequest = ApiSchemas['PurchaseRequest'];
export type PurchaseRequestInput = ApiSchemas['PurchaseRequestInput'];
export type PurchaseOrderInput = ApiSchemas['PurchaseOrderInput'];
export type PurchaseReceiveInput = ApiSchemas['PurchaseReceiveInput'];
export type PurchaseStatus = ApiSchemas['PurchaseStatus'];
export type Rental = ApiSchemas['Rental'];
export type RentalInput = ApiSchemas['RentalInput'];
export type RentalStatus = ApiSchemas['RentalStatus'];
export type RentalReturnInput = ApiSchemas['RentalReturnInput'];

type Severity = 'warn' | 'success' | 'danger' | 'secondary' | 'info';

export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; severity: Severity }> = {
    pending: { label: 'รออนุมัติ', severity: 'warn' },
    approved: { label: 'อนุมัติแล้ว รอสั่งซื้อ', severity: 'info' },
    rejected: { label: 'ไม่อนุมัติ', severity: 'danger' },
    ordered: { label: 'สั่งซื้อแล้ว รอรับของ', severity: 'info' },
    partial: { label: 'รับของบางส่วน', severity: 'warn' },
    received: { label: 'รับครบแล้ว', severity: 'success' },
    cancelled: { label: 'ยกเลิก', severity: 'secondary' }
};

export const RENTAL_STATUS: Record<RentalStatus, { label: string; severity: Severity }> = {
    pending: { label: 'รออนุมัติ', severity: 'warn' },
    approved: { label: 'พร้อมรับเข้าหน้างาน', severity: 'info' },
    rejected: { label: 'ไม่อนุมัติ', severity: 'danger' },
    'in-use': { label: 'ใช้งานอยู่', severity: 'success' },
    returned: { label: 'คืนแล้ว', severity: 'secondary' },
    cancelled: { label: 'ยกเลิก', severity: 'secondary' }
};

export const RENTAL_SOURCE_LABEL: Record<Rental['source'], string> = { rent: 'เช่า', borrow: 'ยืมคลังบริษัท' };
export const RATE_UNIT_LABEL: Record<NonNullable<Rental['rateUnit']>, string> = { day: 'วัน', month: 'เดือน' };
export const RETURN_CONDITION_LABEL: Record<NonNullable<Rental['returnCondition']>, string> = { good: 'ปกติ', damaged: 'ชำรุด', lost: 'สูญหาย' };

const DAY_MS = 86_400_000;

/** ค่าเช่าตามแผน (เหมือนหลังบ้าน: นับวันแรกและวันสุดท้าย รายเดือนปัดขึ้นทีละ 30 วัน) */
export function estimateRent(rate: number, quantity: number, rateUnit: 'day' | 'month', start: string, end: string): number {
    if (!(rate > 0) || !(quantity > 0) || !start || !end || end < start) return 0;
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
    return Math.round(rate * quantity * (rateUnit === 'month' ? Math.ceil(days / 30) : days) * 100) / 100;
}

/** จัดซื้อวัสดุและเช่า/ยืมอุปกรณ์ของโครงการ (/projects/{code}/purchases, /rentals) */
@Injectable({ providedIn: 'root' })
export class ProcurementService {
    private readonly http = inject(HttpClient);

    purchases(code: string): Observable<PurchaseRequest[]> {
        return this.http.get<PurchaseRequest[]>(this.url(code, '/purchases'));
    }

    createPurchase(code: string, input: PurchaseRequestInput): Observable<PurchaseRequest> {
        return this.http.post<PurchaseRequest>(this.url(code, '/purchases'), input);
    }

    order(code: string, id: string, input: PurchaseOrderInput): Observable<PurchaseRequest> {
        return this.http.post<PurchaseRequest>(this.url(code, `/purchases/${encodeURIComponent(id)}/order`), input);
    }

    receive(code: string, id: string, input: PurchaseReceiveInput): Observable<PurchaseRequest> {
        return this.http.post<PurchaseRequest>(this.url(code, `/purchases/${encodeURIComponent(id)}/receive`), input);
    }

    cancelPurchase(code: string, id: string, reason: string): Observable<PurchaseRequest> {
        return this.http.post<PurchaseRequest>(this.url(code, `/purchases/${encodeURIComponent(id)}/cancel`), { reason });
    }

    rentals(code: string): Observable<Rental[]> {
        return this.http.get<Rental[]>(this.url(code, '/rentals'));
    }

    createRental(code: string, input: RentalInput): Observable<Rental> {
        return this.http.post<Rental>(this.url(code, '/rentals'), input);
    }

    startRental(code: string, id: string, date: string, note?: string): Observable<Rental> {
        return this.http.post<Rental>(this.url(code, `/rentals/${encodeURIComponent(id)}/start`), { date, note });
    }

    extendRental(code: string, id: string, endDate: string, note?: string): Observable<Rental> {
        return this.http.post<Rental>(this.url(code, `/rentals/${encodeURIComponent(id)}/extend`), { endDate, note });
    }

    returnRental(code: string, id: string, input: RentalReturnInput): Observable<Rental> {
        return this.http.post<Rental>(this.url(code, `/rentals/${encodeURIComponent(id)}/return`), input);
    }

    cancelRental(code: string, id: string, reason: string): Observable<Rental> {
        return this.http.post<Rental>(this.url(code, `/rentals/${encodeURIComponent(id)}/cancel`), { reason });
    }

    private url(code: string, path: string) {
        return apiUrl(`/projects/${encodeURIComponent(code)}${path}`);
    }
}
