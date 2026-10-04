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
export type PurchaseOrder = ApiSchemas['PurchaseOrder'];
export type Vendor = ApiSchemas['Vendor'];
export type Material = ApiSchemas['Material'];
export type MaterialInput = ApiSchemas['MaterialInput'];
export type BoqItem = ApiSchemas['BoqItem'];
export type ProjectBoq = ApiSchemas['ProjectBoq'];
export type StockMovement = ApiSchemas['StockMovement'];
export type StockMovementInput = ApiSchemas['StockMovementInput'];
export type StockBalance = ApiSchemas['StockBalance'];
export type MaterialUsage = ApiSchemas['MaterialUsage'];
export type MaterialUsageRow = ApiSchemas['MaterialUsageRow'];
export type MaterialUsageStatus = ApiSchemas['MaterialUsageStatus'];
export type CompanyProfile = ApiSchemas['CompanyProfile'];

type Severity = 'warn' | 'success' | 'danger' | 'secondary' | 'info';

export const PURCHASE_STATUS: Record<PurchaseStatus, { label: string; severity: Severity }> = {
    pending: { label: 'รออนุมัติ', severity: 'warn' },
    approved: { label: 'อนุมัติแล้ว รอออกใบสั่งซื้อ', severity: 'info' },
    rejected: { label: 'ไม่อนุมัติ', severity: 'danger' },
    'po-pending': { label: 'ใบสั่งซื้อรออนุมัติ', severity: 'warn' },
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

export const USAGE_STATUS: Record<MaterialUsageStatus, { label: string; severity: Severity }> = {
    over: { label: 'ใช้เกิน BOQ', severity: 'danger' },
    under: { label: 'ใช้น้อยกว่า BOQ', severity: 'warn' },
    ok: { label: 'อยู่ในเกณฑ์', severity: 'success' },
    'in-progress': { label: 'ยังใช้ไม่ครบ', severity: 'info' },
    'not-in-boq': { label: 'ไม่มีใน BOQ', severity: 'secondary' }
};

/** ราคารวม VAT 7% → แยกยอดก่อน VAT และ VAT */
export function splitVat(amount: number) {
    const beforeVat = Math.round((amount / 1.07) * 100) / 100;
    return { beforeVat, vat: Math.round((amount - beforeVat) * 100) / 100 };
}

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

    // ---------- BOQ / การใช้วัสดุ / คลังหลัก ----------

    boq(code: string): Observable<ProjectBoq> {
        return this.http.get<ProjectBoq>(this.url(code, '/boq'));
    }

    saveBoq(code: string, items: BoqItem[]): Observable<ProjectBoq> {
        return this.http.put<ProjectBoq>(this.url(code, '/boq'), { items });
    }

    usage(code: string): Observable<MaterialUsage> {
        return this.http.get<MaterialUsage>(this.url(code, '/material-usage'));
    }

    stockMovements(code: string): Observable<StockMovement[]> {
        return this.http.get<StockMovement[]>(this.url(code, '/stock-movements'));
    }

    createStockMovement(code: string, input: StockMovementInput): Observable<StockMovement> {
        return this.http.post<StockMovement>(this.url(code, '/stock-movements'), input);
    }

    warehouseStock(): Observable<StockBalance[]> {
        return this.http.get<StockBalance[]>(apiUrl('/warehouse/stock'));
    }

    warehouseMovements(): Observable<StockMovement[]> {
        return this.http.get<StockMovement[]>(apiUrl('/warehouse/movements'));
    }

    // ---------- รายการวัสดุ / ข้อมูลบริษัท ----------

    materials(): Observable<Material[]> {
        return this.http.get<Material[]>(apiUrl('/materials'));
    }

    createMaterial(input: MaterialInput): Observable<Material> {
        return this.http.post<Material>(apiUrl('/materials'), input);
    }

    updateMaterial(code: string, input: MaterialInput): Observable<Material> {
        return this.http.put<Material>(apiUrl(`/materials/${encodeURIComponent(code)}`), input);
    }

    company(): Observable<CompanyProfile> {
        return this.http.get<CompanyProfile>(apiUrl('/settings/company'));
    }

    saveCompany(input: CompanyProfile): Observable<CompanyProfile> {
        return this.http.put<CompanyProfile>(apiUrl('/settings/company'), input);
    }

    private url(code: string, path: string) {
        return apiUrl(`/projects/${encodeURIComponent(code)}${path}`);
    }
}
