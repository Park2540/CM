import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type Estimate = ApiSchemas['Estimate'];
export type EstimateInput = ApiSchemas['EstimateInput'];
export type EstimateSummary = ApiSchemas['EstimateSummary'];
export type EstimateCreateInput = ApiSchemas['EstimateCreateInput'];
export type EstimateCategory = ApiSchemas['EstimateCategory'];
export type EstimateGroup = ApiSchemas['EstimateGroup'];
export type EstimateItem = ApiSchemas['EstimateItem'];
export type EstimateRate = ApiSchemas['EstimateRate'];
export type EstimateTotals = ApiSchemas['EstimateTotals'];
export type TakeoffLine = ApiSchemas['TakeoffLine'];
export type TakeoffMethod = ApiSchemas['TakeoffMethod'];
export type EstimateSource = ApiSchemas['EstimateSource'];
export type EstimateMaterial = ApiSchemas['EstimateMaterial'];
export type EstimateFromModelInput = ApiSchemas['EstimateFromModelInput'];
export type OverheadStatement = ApiSchemas['OverheadStatement'];
export type StatementSection = ApiSchemas['StatementSection'];
export type StatementSubsection = ApiSchemas['StatementSubsection'];
export type StatementBlock = ApiSchemas['StatementBlock'];
export type ResponsibilityRow = ApiSchemas['ResponsibilityRow'];

/** เลขข้อของรายการแบบ clause (เช่น 3.1 3.2 …) นับต่อกันทุกรายการในหัวข้อ — คืนเลขเริ่มต้นของแต่ละ block */
export function clauseStarts(blocks: StatementBlock[]): Record<string, number> {
    const starts: Record<string, number> = {};
    let n = 0;
    for (const block of blocks) {
        if (block.kind !== 'list' || block.style !== 'clause') continue;
        starts[block.id] = n;
        n += block.items?.length ?? 0;
    }
    return starts;
}

/** ข้อมูลที่แก้ในหน้าจอ (ทุกช่องที่จำเป็นมีค่าเสมอ) */
export type EstimateDraft = EstimateInput & { status: 'draft' | 'final'; overheadPercent: number; profitPercent: number; vatPercent: number; notes: string[] };

export const UNITS = ['ลบ.ม.', 'ตร.ม.', 'เมตร', 'กก.', 'ตัน', 'ชุด', 'แผ่น', 'ต้น', 'จุด', 'ถุง', 'ตัว', 'บาน', 'เหมา', 'งาน', 'วัน'];

export const TAKEOFF_METHODS: Record<TakeoffMethod, { label: string; unit: string; formula: string }> = {
    volume: { label: 'ปริมาตร', unit: 'ลบ.ม.', formula: 'กว้าง × ยาว × สูง/ลึก × จำนวน' },
    area: { label: 'พื้นที่', unit: 'ตร.ม.', formula: 'กว้าง × ยาว × จำนวน' },
    length: { label: 'ความยาว', unit: 'เมตร', formula: 'ยาว × จำนวน' },
    count: { label: 'จำนวน', unit: 'ชุด', formula: 'จำนวน' },
    rebar: { label: 'เหล็กเส้น', unit: 'กก.', formula: 'ยาวต่อเส้น × จำนวนเส้น × กก./ม. ตามขนาด' },
    steel: { label: 'เหล็กรูปพรรณ', unit: 'กก.', formula: 'ยาว × จำนวน × กก./ม.' },
    model: { label: 'จากโมเดล', unit: '', formula: 'ปริมาณที่ถอดจากโมเดล IFC' }
};

/** น้ำหนักเหล็กเส้นต่อเมตร (กก./ม.) — เหมือนหลังบ้าน */
export const REBAR_SIZES: Array<{ diameter: number; label: string; kgPerMeter: number }> = [
    { diameter: 6, label: 'RB 6', kgPerMeter: 0.222 },
    { diameter: 9, label: 'RB 9', kgPerMeter: 0.499 },
    { diameter: 10, label: 'DB 10', kgPerMeter: 0.617 },
    { diameter: 12, label: 'DB 12', kgPerMeter: 0.888 },
    { diameter: 16, label: 'DB 16', kgPerMeter: 1.578 },
    { diameter: 20, label: 'DB 20', kgPerMeter: 2.466 },
    { diameter: 25, label: 'DB 25', kgPerMeter: 3.853 },
    { diameter: 28, label: 'DB 28', kgPerMeter: 4.834 },
    { diameter: 32, label: 'DB 32', kgPerMeter: 6.313 }
];

const round2 = (value: number) => Math.round(value * 100) / 100;
const num = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
export const rebarKgPerMeter = (diameter: number) => REBAR_SIZES.find((size) => size.diameter === diameter)?.kgPerMeter ?? Math.round(0.00617 * diameter * diameter * 1000) / 1000;

export function lineResult(line: TakeoffLine): number {
    const [w, l, h, n] = [num(line.width), num(line.length), num(line.height), num(line.count)];
    const value =
        line.method === 'volume' ? w * l * h * n
        : line.method === 'area' ? w * l * n
        : line.method === 'length' ? l * n
        : line.method === 'count' ? n
        : line.method === 'rebar' ? l * n * rebarKgPerMeter(num(line.diameter))
        : line.method === 'model' ? n
        : l * n * num(line.kgPerMeter);
    return round2(line.deduct ? -value : value);
}

export const takeoffQuantity = (lines: TakeoffLine[], waste = 0) => round2(Math.max(0, lines.reduce((sum, line) => sum + lineResult(line), 0)) * (1 + waste / 100));

export const itemMaterial = (item: EstimateItem) => (item.kind === 'item' ? round2(item.quantity * item.materialPrice) : 0);
export const itemLabor = (item: EstimateItem) => (item.kind === 'item' ? round2(item.quantity * item.laborPrice) : 0);

/** ยอดรวม (เหมือนหลังบ้าน) ใช้แสดงทันทีระหว่างแก้ */
export function computeTotals(estimate: EstimateDraft): EstimateTotals {
    const categories = estimate.categories.map((category) => {
        let material = 0;
        let labor = 0;
        for (const group of category.groups) {
            for (const item of group.items) {
                material += itemMaterial(item);
                labor += itemLabor(item);
            }
        }
        return { id: category.id, material: round2(material), labor: round2(labor), total: round2(material + labor) };
    });
    const included = categories.filter((total) => !estimate.categories.find((category) => category.id === total.id)?.excluded);
    const material = round2(included.reduce((sum, item) => sum + item.material, 0));
    const labor = round2(included.reduce((sum, item) => sum + item.labor, 0));
    const subtotal = round2(material + labor);
    // ค่าดำเนินการและกำไรคิดจากวัสดุ + ค่าแรง, ภาษีมูลค่าเพิ่มคิดจากราคารวมก่อนภาษี (เหมือนหลังบ้าน)
    const overhead = round2((subtotal * estimate.overheadPercent) / 100);
    const profit = round2((subtotal * estimate.profitPercent) / 100);
    const beforeVat = round2(subtotal + overhead + profit);
    const vat = round2((beforeVat * estimate.vatPercent) / 100);
    const grandTotal = round2(beforeVat + vat);
    return { categories, material, labor, subtotal, overhead, profit, beforeVat, vat, grandTotal, pricePerSqm: estimate.area ? round2(grandTotal / estimate.area) : null };
}

export const groupTotal = (group: EstimateGroup) => group.items.reduce((sum, item) => sum + itemMaterial(item) + itemLabor(item), 0);

export const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

/** ถอดปริมาณและ BOQ (/estimates) */
@Injectable({ providedIn: 'root' })
export class EstimateService {
    private readonly http = inject(HttpClient);

    list(): Observable<EstimateSummary[]> {
        return this.http.get<EstimateSummary[]>(apiUrl('/estimates'));
    }

    get(id: string): Observable<Estimate> {
        return this.http.get<Estimate>(apiUrl(`/estimates/${encodeURIComponent(id)}`));
    }

    create(input: EstimateCreateInput): Observable<Estimate> {
        return this.http.post<Estimate>(apiUrl('/estimates'), input);
    }

    save(id: string, input: EstimateInput): Observable<Estimate> {
        return this.http.put<Estimate>(apiUrl(`/estimates/${encodeURIComponent(id)}`), input);
    }

    remove(id: string): Observable<void> {
        return this.http.delete<void>(apiUrl(`/estimates/${encodeURIComponent(id)}`));
    }

    /** ถอด BOQ จากโมเดล IFC ของโครงการ (ใช้เวลาตามขนาดไฟล์) */
    createFromModel(input: EstimateFromModelInput): Observable<Estimate> {
        return this.http.post<Estimate>(apiUrl('/estimates/from-model'), input);
    }

    /** ส่งรายการวัสดุเข้า BOQ วัสดุของโครงการ */
    applyMaterials(id: string): Observable<ApiSchemas['ProjectBoq']> {
        return this.http.post<ApiSchemas['ProjectBoq']>(apiUrl(`/estimates/${encodeURIComponent(id)}/apply-materials`), {});
    }

    rates(): Observable<EstimateRate[]> {
        return this.http.get<EstimateRate[]>(apiUrl('/estimate-rates'));
    }

    /** แม่แบบเอกสารชี้แจงค่าดำเนินการของบริษัท */
    statementTemplate(): Observable<OverheadStatement> {
        return this.http.get<OverheadStatement>(apiUrl('/settings/overhead-statement'));
    }

    saveStatementTemplate(statement: OverheadStatement): Observable<OverheadStatement> {
        return this.http.put<OverheadStatement>(apiUrl('/settings/overhead-statement'), statement);
    }

    resetStatementTemplate(): Observable<OverheadStatement> {
        return this.http.delete<OverheadStatement>(apiUrl('/settings/overhead-statement'));
    }

    /** ไฟล์ Excel ของ BOQ (ฉบับที่บันทึกล่าสุด) */
    exportExcel(id: string): Observable<Blob> {
        return this.http.get(apiUrl(`/estimates/${encodeURIComponent(id)}/export`), { responseType: 'blob' });
    }
}

/** ดาวน์โหลดไฟล์ Excel ของ BOQ — ชื่อไฟล์ตรงกับหลังบ้าน เช่น BOQ-EST-6910-0001-บ้านพักอาศัย.xlsx */
export function saveEstimateExcel(blob: Blob, estimate: Pick<Estimate, 'id' | 'title'>) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BOQ-${estimate.id}-${estimate.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
}
