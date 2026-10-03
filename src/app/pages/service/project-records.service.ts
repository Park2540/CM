import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams, toDate } from '@/app/api/api';

export type TeamMember = ApiSchemas['TeamMember'];
export type InstallmentStatus = ApiSchemas['InstallmentStatus'];
export type DocumentCategory = ApiSchemas['DocumentCategory'];
export type ProjectDocument = ApiSchemas['ProjectDocument'];
export type DocumentFileType = ProjectDocument['fileType'];

export type Installment = Omit<ApiSchemas['Installment'], 'dueDate' | 'paidDate'> & { dueDate: Date; paidDate: Date | null };
export type InstallmentPayment = ApiSchemas['InstallmentPayment'];
export type InstallmentPaymentInput = ApiSchemas['InstallmentPaymentInput'];
export type PaymentMethod = ApiSchemas['PaymentMethod'];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
    transfer: 'โอนเงิน',
    cheque: 'เช็ค',
    cash: 'เงินสด'
};
export type SitePhoto = ApiSchemas['SitePhoto'] & { date: Date };
export type PhotoPhaseCount = ApiSchemas['SitePhotoPage']['phases'][number];
export interface SitePhotoPage {
    items: SitePhoto[];
    total: number;
    phases: PhotoPhaseCount[];
}

export const DOCUMENT_CATEGORIES: DocumentCategory[] = ['contract', 'drawing', 'permit', 'inspection', 'billing', 'handover'];

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
    contract: 'สัญญาและงวดงาน',
    drawing: 'แบบก่อสร้าง',
    permit: 'ใบอนุญาต',
    inspection: 'รายงานตรวจคุณภาพ',
    billing: 'ใบแจ้งหนี้/ใบเสร็จ',
    handover: 'เอกสารส่งมอบ'
};

/** ไอคอนและสีตามชนิดไฟล์ (ใช้ร่วมกันในแท็บเอกสารและบันทึกหน้างาน) */
export const DOCUMENT_FILE_ICON: Record<DocumentFileType, string> = {
    pdf: 'pi-file-pdf text-red-600 dark:text-red-400',
    dwg: 'pi-objects-column text-blue-600 dark:text-blue-400',
    xlsx: 'pi-file-excel text-green-600 dark:text-green-400',
    docx: 'pi-file-word text-blue-600 dark:text-blue-400',
    image: 'pi-image text-violet-600 dark:text-violet-400'
};

const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`);
const installmentFromApi = (row: ApiSchemas['Installment']): Installment => ({ ...row, dueDate: dateOnly(row.dueDate), paidDate: row.paidDate ? dateOnly(row.paidDate) : null });

/** งวดงาน ภาพถ่าย เอกสาร และทีมงานของโครงการ (/projects/{code}/...) */
@Injectable({ providedIn: 'root' })
export class ProjectRecordsService {
    private readonly http = inject(HttpClient);

    private url(code: string, path: string) {
        return apiUrl(`/projects/${encodeURIComponent(code)}${path}`);
    }

    installments(code: string): Observable<Installment[]> {
        return this.http.get<ApiSchemas['Installment'][]>(this.url(code, '/installments')).pipe(map((rows) => rows.map(installmentFromApi)));
    }

    /** บันทึกรับชำระงวดพร้อมหลักฐาน (สิทธิ์ payment.record) */
    recordPayment(code: string, no: number, input: InstallmentPaymentInput): Observable<Installment> {
        return this.http.post<ApiSchemas['Installment']>(this.url(code, `/installments/${no}/payment`), input).pipe(map(installmentFromApi));
    }

    cancelPayment(code: string, no: number, reason: string): Observable<Installment> {
        return this.http.post<ApiSchemas['Installment']>(this.url(code, `/installments/${no}/payment/cancel`), { reason }).pipe(map(installmentFromApi));
    }

    photos(code: string, query: { phaseCode?: string | null; page?: number; pageSize?: number } = {}): Observable<SitePhotoPage> {
        return this.http
            .get<ApiSchemas['SitePhotoPage']>(this.url(code, '/photos'), { params: queryParams(query) })
            .pipe(map((page) => ({ total: page.total, phases: page.phases, items: page.items.map((photo) => ({ ...photo, date: toDate(photo.takenAt) })) })));
    }

    documents(code: string): Observable<ProjectDocument[]> {
        return this.http.get<ProjectDocument[]>(this.url(code, '/documents'));
    }

    team(code: string): Observable<TeamMember[]> {
        return this.http.get<TeamMember[]>(this.url(code, '/team'));
    }
}
