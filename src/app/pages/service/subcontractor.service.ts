import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';

export type Subcontractor = ApiSchemas['Subcontractor'];
export type SubcontractorInput = ApiSchemas['SubcontractorInput'];
export type SubcontractorTrade = ApiSchemas['SubcontractorTrade'];

export const TRADE_LABEL: Record<SubcontractorTrade, string> = {
    piling: 'เสาเข็ม',
    structure: 'โครงสร้าง คสล.',
    masonry: 'ก่อ-ฉาบ',
    roofing: 'หลังคา',
    waterproofing: 'กันซึม',
    electrical: 'ไฟฟ้า',
    plumbing: 'ประปา/สุขาภิบาล',
    hvac: 'ปรับอากาศ',
    aluminium: 'อลูมิเนียม/กระจก',
    tiling: 'กระเบื้อง',
    ceiling: 'ฝ้า',
    painting: 'สี',
    carpentry: 'ไม้/บิลท์อิน',
    landscape: 'ภูมิทัศน์',
    solar: 'โซลาร์เซลล์',
    pool: 'สระว่ายน้ำ',
    lift: 'ลิฟต์',
    fire: 'ระบบดับเพลิง',
    other: 'อื่น ๆ'
};

export const TRADES = Object.keys(TRADE_LABEL) as SubcontractorTrade[];

/** ขั้นตอนในแผนงานที่มักใช้ผู้รับเหมาแต่ละสาขา — ใช้เลือกขั้นตอนให้อัตโนมัติตอนมอบหมาย (แก้ได้) */
export const TRADE_PHASES: Record<SubcontractorTrade, string[]> = {
    piling: ['05'],
    structure: ['05', '06'],
    masonry: ['08', '10'],
    roofing: ['07'],
    waterproofing: ['07', '10'],
    electrical: ['09', '12'],
    plumbing: ['09', '12'],
    hvac: ['09', '12'],
    aluminium: ['11'],
    tiling: ['11'],
    ceiling: ['11'],
    painting: ['11'],
    carpentry: ['11'],
    landscape: ['13'],
    solar: ['12'],
    pool: ['13'],
    lift: ['12'],
    fire: ['12'],
    other: []
};

/** ทะเบียนผู้รับเหมาช่วง (/subcontractors) */
@Injectable({ providedIn: 'root' })
export class SubcontractorService {
    private readonly http = inject(HttpClient);

    list(query: { q?: string; trade?: SubcontractorTrade | null; status?: 'active' | 'inactive' | null } = {}): Observable<Subcontractor[]> {
        return this.http.get<Subcontractor[]>(apiUrl('/subcontractors'), { params: queryParams(query) });
    }

    create(input: SubcontractorInput): Observable<Subcontractor> {
        return this.http.post<Subcontractor>(apiUrl('/subcontractors'), input);
    }

    update(id: string, input: SubcontractorInput): Observable<Subcontractor> {
        return this.http.put<Subcontractor>(apiUrl(`/subcontractors/${encodeURIComponent(id)}`), input);
    }
}
