/**
 * ข้อมูลหลักของงานจัดซื้อ
 * - รายการวัสดุของบริษัท (ใช้เลือกตอนขอซื้อ/ทำ BOQ และเทียบการใช้วัสดุ)
 * - BOQ วัสดุรายโครงการ
 * - คลังหลักของบริษัท: ของเหลือจากหน้างานส่งเข้าคลัง / เบิกจากคลังไปหน้างาน
 * - ข้อมูลบริษัท (หัวกระดาษใบสั่งซื้อ)
 */
import { persistArray, persistMap, persistObject } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { recordAudit } from './audit-logs.js';
import { CURRENT_USER } from './users.js';

type Material = ApiSchemas['Material'];
type StockMovement = ApiSchemas['StockMovement'];
type Problem = { status: 403 | 404 | 409 | 422; title: string; detail?: string; errors?: Record<string, string> };
type Result<T> = { ok: T } | Problem;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const author = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });
const invalid = (errors: Record<string, string>): Problem => ({ status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors });
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** คีย์จับคู่วัสดุ: รหัสในรายการวัสดุ หรือ ชื่อ|หน่วย (ไม่สนตัวพิมพ์/ช่องว่าง) */
export function materialKey(item: { materialCode?: string; name: string; unit: string }): string {
    if (item.materialCode) return item.materialCode;
    const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    return `${norm(item.name)}|${norm(item.unit)}`;
}

// ---------- รายการวัสดุ ----------

const seed = (code: number, category: string, name: string, unit: string, spec?: string): Material => ({ code: `MAT-${String(code).padStart(4, '0')}`, name, unit, category, ...(spec ? { spec } : {}), active: true });

export const materials: Material[] = [
    seed(1, 'งานโครงสร้าง', 'ปูนซีเมนต์ปอร์ตแลนด์', 'ถุง', 'ประเภท 1 ถุงละ 50 กก.'),
    seed(2, 'งานโครงสร้าง', 'คอนกรีตผสมเสร็จ 240 ksc', 'คิว', 'ทรงกระบอก 240 ksc'),
    seed(3, 'งานโครงสร้าง', 'คอนกรีตผสมเสร็จ 280 ksc', 'คิว', 'ทรงกระบอก 280 ksc'),
    seed(4, 'งานโครงสร้าง', 'ทรายหยาบ', 'คิว'),
    seed(5, 'งานโครงสร้าง', 'หินเบอร์ 2', 'คิว'),
    seed(6, 'งานโครงสร้าง', 'เหล็กเส้นกลม RB9', 'เส้น', 'SR24 ยาว 10 ม.'),
    seed(7, 'งานโครงสร้าง', 'เหล็กข้ออ้อย DB12', 'เส้น', 'SD40 ยาว 10 ม.'),
    seed(8, 'งานโครงสร้าง', 'เหล็กข้ออ้อย DB16', 'เส้น', 'SD40 ยาว 10 ม.'),
    seed(9, 'งานโครงสร้าง', 'ลวดผูกเหล็ก', 'กก.'),
    seed(10, 'งานโครงสร้าง', 'เสาเข็มคอนกรีตอัดแรง I-18', 'ต้น', 'ยาว 6 ม.'),
    seed(11, 'งานโครงสร้าง', 'ไม้แบบ', 'แผ่น', 'ไม้อัด 4 มม. 120×240 ซม.'),
    seed(12, 'งานผนัง', 'อิฐมอญ', 'ก้อน'),
    seed(13, 'งานผนัง', 'อิฐมวลเบา 7.5 ซม.', 'ก้อน', '20×60×7.5 ซม.'),
    seed(14, 'งานผนัง', 'ปูนก่ออิฐมวลเบา', 'ถุง', 'ถุงละ 50 กก.'),
    seed(15, 'งานผนัง', 'ปูนฉาบสำเร็จรูป', 'ถุง', 'ถุงละ 50 กก.'),
    seed(16, 'งานหลังคา', 'กระเบื้องหลังคาคอนกรีต', 'แผ่น'),
    seed(17, 'งานหลังคา', 'เหล็กรูปพรรณกล่อง 2×4 นิ้ว', 'เส้น', 'หนา 2.3 มม. ยาว 6 ม.'),
    seed(18, 'งานหลังคา', 'ฉนวนกันความร้อน PE', 'ม้วน'),
    seed(19, 'งานพื้น', 'กระเบื้องพื้น 60×60 ซม.', 'ตร.ม.'),
    seed(20, 'งานพื้น', 'กาวซีเมนต์ปูกระเบื้อง', 'ถุง', 'ถุงละ 20 กก.'),
    seed(21, 'งานพื้น', 'ยาแนว', 'ถุง', 'ถุงละ 1 กก.'),
    seed(22, 'งานฝ้า', 'แผ่นยิปซัมบอร์ด 9 มม.', 'แผ่น', '120×240 ซม.'),
    seed(23, 'งานฝ้า', 'โครงฝ้า C-Line', 'เส้น'),
    seed(24, 'งานสี', 'สีรองพื้นปูนใหม่', 'ถัง', 'ถังละ 9 ลิตร'),
    seed(25, 'งานสี', 'สีทาภายนอก', 'ถัง', 'ถังละ 9 ลิตร'),
    seed(26, 'งานสี', 'สีทาภายใน', 'ถัง', 'ถังละ 9 ลิตร'),
    seed(27, 'งานไฟฟ้า', 'สายไฟ THW 2.5 ตร.มม.', 'ม้วน', '100 ม.'),
    seed(28, 'งานไฟฟ้า', 'ท่อร้อยสาย PVC 1/2 นิ้ว', 'เส้น', 'ยาว 4 ม.'),
    seed(29, 'งานประปา', 'ท่อ PVC 1/2 นิ้ว ชั้น 13.5', 'เส้น', 'ยาว 4 ม.'),
    seed(30, 'งานประปา', 'ท่อ PVC 4 นิ้ว ชั้น 8.5', 'เส้น', 'ยาว 4 ม.'),
    seed(31, 'งานกันซึม', 'วัสดุกันซึมชนิดทา', 'ถัง', 'ถังละ 20 กก.')
];

export const listMaterials = () => [...materials].sort((a, b) => a.category.localeCompare(b.category, 'th') || a.name.localeCompare(b.name, 'th'));
export const findMaterial = (code: string | undefined) => (code ? materials.find((item) => item.code === code) : undefined);

function validateMaterial(input: Partial<ApiSchemas['MaterialInput']>, except?: string): { value: ApiSchemas['MaterialInput'] } | Problem {
    const errors: Record<string, string> = {};
    const name = text(input.name);
    const unit = text(input.unit);
    const category = text(input.category);
    const spec = text(input.spec);
    if (!name) errors['name'] = 'กรุณาระบุชื่อวัสดุ';
    else if (name.length > 200) errors['name'] = 'ยาวเกิน 200 ตัวอักษร';
    if (!unit) errors['unit'] = 'กรุณาระบุหน่วย';
    else if (unit.length > 30) errors['unit'] = 'ยาวเกิน 30 ตัวอักษร';
    if (!category) errors['category'] = 'กรุณาระบุหมวด';
    else if (category.length > 50) errors['category'] = 'ยาวเกิน 50 ตัวอักษร';
    if (spec.length > 300) errors['spec'] = 'ยาวเกิน 300 ตัวอักษร';
    if (Object.keys(errors).length) return invalid(errors);
    const key = materialKey({ name, unit });
    if (materials.some((item) => item.code !== except && materialKey({ name: item.name, unit: item.unit }) === key)) return { status: 409, title: 'มีวัสดุนี้ในรายการแล้ว', detail: `${name} (${unit})` };
    return { value: { name, unit, category, ...(spec ? { spec } : {}), active: input.active ?? true } };
}

export function createMaterial(input: Partial<ApiSchemas['MaterialInput']>): Result<Material> {
    const checked = validateMaterial(input);
    if (!('value' in checked)) return checked;
    const highest = Math.max(0, ...materials.map((item) => Number(item.code.slice(4)) || 0));
    const material: Material = { code: `MAT-${String(highest + 1).padStart(4, '0')}`, ...checked.value, active: checked.value.active ?? true };
    materials.push(material);
    recordAudit({ module: 'procurement', action: 'เพิ่มวัสดุ', target: material.code, detail: `${material.name} (${material.unit}) · ${material.category}` });
    return { ok: material };
}

export function updateMaterial(code: string, input: Partial<ApiSchemas['MaterialInput']>): Result<Material> {
    const material = findMaterial(code);
    if (!material) return { status: 404, title: 'ไม่พบวัสดุ' };
    const checked = validateMaterial(input, code);
    if (!('value' in checked)) return checked;
    delete material.spec;
    Object.assign(material, checked.value);
    recordAudit({ module: 'procurement', action: material.active ? 'แก้ไขวัสดุ' : 'เลิกใช้วัสดุ', target: code, detail: `${material.name} (${material.unit})` });
    return { ok: material };
}

/** ราคาล่าสุดจากใบสั่งซื้อที่อนุมัติ */
export function recordLastPrice(code: string | undefined, price: number) {
    const material = findMaterial(code);
    if (material && price > 0) material.lastPrice = price;
}

// ---------- BOQ ----------

export const boqs = new Map<string, ApiSchemas['ProjectBoq']>();
export const getBoq = (code: string): ApiSchemas['ProjectBoq'] => boqs.get(code) ?? { items: [] };

export function saveBoq(code: string, input: Partial<ApiSchemas['ProjectBoqInput']>, phaseCodes: string[]): Result<ApiSchemas['ProjectBoq']> {
    const list = Array.isArray(input.items) ? input.items : [];
    const errors: Record<string, string> = {};
    if (list.length > 500) errors['items'] = 'ได้ไม่เกิน 500 รายการ';
    const seen = new Map<string, number>();
    const items = list.slice(0, 500).map((raw: Partial<ApiSchemas['BoqItem']>, index) => {
        const material = findMaterial(text(raw.materialCode));
        if (raw.materialCode && !material) errors[`items.${index}.materialCode`] = 'ไม่พบวัสดุนี้ในรายการวัสดุ';
        const item: ApiSchemas['BoqItem'] = {
            ...(material ? { materialCode: material.code } : {}),
            name: material?.name ?? text(raw.name),
            unit: material?.unit ?? text(raw.unit),
            quantity: Number(raw.quantity),
            ...(text(raw.phaseCode) ? { phaseCode: text(raw.phaseCode) } : {}),
            ...(text(raw.note) ? { note: text(raw.note) } : {})
        };
        if (!item.name) errors[`items.${index}.name`] = 'กรุณาระบุชื่อวัสดุ';
        else if (item.name.length > 200) errors[`items.${index}.name`] = 'ยาวเกิน 200 ตัวอักษร';
        if (!item.unit) errors[`items.${index}.unit`] = 'กรุณาระบุหน่วย';
        else if (item.unit.length > 30) errors[`items.${index}.unit`] = 'ยาวเกิน 30 ตัวอักษร';
        if (!(item.quantity >= 0)) errors[`items.${index}.quantity`] = 'ปริมาณต้องไม่ติดลบ';
        if (item.phaseCode && !phaseCodes.includes(item.phaseCode)) errors[`items.${index}.phaseCode`] = 'ไม่พบขั้นตอนนี้ในไทม์ไลน์';
        if ((item.note?.length ?? 0) > 300) errors[`items.${index}.note`] = 'ยาวเกิน 300 ตัวอักษร';
        // วัสดุเดียวกันในขั้นตอนเดียวกันซ้ำ → ให้รวมเป็นแถวเดียว
        const duplicateKey = `${materialKey(item)}@${item.phaseCode ?? ''}`;
        if (item.name && seen.has(duplicateKey)) errors[`items.${index}.name`] = `ซ้ำกับแถวที่ ${seen.get(duplicateKey)! + 1} (รวมเป็นแถวเดียว)`;
        else seen.set(duplicateKey, index);
        return item;
    });
    if (Object.keys(errors).length) return invalid(errors);
    const boq: ApiSchemas['ProjectBoq'] = { items, updatedBy: author(), updatedAt: new Date().toISOString() };
    boqs.set(code, boq);
    recordAudit({ module: 'procurement', action: 'บันทึก BOQ วัสดุ', target: code, detail: `${items.length} รายการ` });
    return { ok: boq };
}

// ---------- คลังหลัก ----------

export const stockMovements: StockMovement[] = [];

export function warehouseStock(): ApiSchemas['StockBalance'][] {
    const balances = new Map<string, ApiSchemas['StockBalance']>();
    for (const movement of [...stockMovements].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
        const key = materialKey(movement);
        const material = findMaterial(movement.materialCode);
        const balance = balances.get(key) ?? {
            key,
            ...(movement.materialCode ? { materialCode: movement.materialCode } : {}),
            name: material?.name ?? movement.name,
            unit: material?.unit ?? movement.unit,
            ...(material ? { category: material.category } : {}),
            quantity: 0,
            lastMovementAt: movement.recordedAt
        };
        balance.quantity = round3(balance.quantity + (movement.type === 'return' ? movement.quantity : -movement.quantity));
        balance.lastMovementAt = movement.recordedAt;
        balances.set(key, balance);
    }
    return [...balances.values()].filter((item) => item.quantity > 0).sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

export const stockOf = (key: string) => warehouseStock().find((item) => item.key === key)?.quantity ?? 0;
export const listWarehouseMovements = () => [...stockMovements].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
export const listProjectMovements = (code: string) => listWarehouseMovements().filter((item) => item.projectCode === code);

// ---------- ข้อมูลบริษัท ----------

export const companyProfile: ApiSchemas['CompanyProfile'] = {
    name: 'บริษัท ตัวอย่าง คอนสตรัคชั่น จำกัด',
    branch: 'สำนักงานใหญ่',
    address: 'กรุณาแก้ไขที่อยู่บริษัท (ข้อมูลตัวอย่าง)',
    taxId: '0000000000000',
    phone: '0-0000-0000'
};

export function saveCompanyProfile(input: Partial<ApiSchemas['CompanyProfile']>): Result<ApiSchemas['CompanyProfile']> {
    const errors: Record<string, string> = {};
    const value = { name: text(input.name), branch: text(input.branch), address: text(input.address), taxId: text(input.taxId).replace(/[\s-]/g, ''), phone: text(input.phone), email: text(input.email) };
    if (!value.name) errors['name'] = 'กรุณาระบุชื่อบริษัท';
    const limits: Record<string, number> = { name: 200, branch: 100, address: 500, taxId: 20, phone: 50, email: 100 };
    for (const [field, max] of Object.entries(limits)) if (value[field as keyof typeof value].length > max) errors[field] = `ยาวเกิน ${max} ตัวอักษร`;
    if (value.taxId && !/^\d{13}$/.test(value.taxId)) errors['taxId'] = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
    if (Object.keys(errors).length) return invalid(errors);
    for (const key of ['branch', 'email'] as const) delete companyProfile[key];
    Object.assign(companyProfile, { name: value.name, address: value.address, taxId: value.taxId, phone: value.phone, ...(value.branch ? { branch: value.branch } : {}), ...(value.email ? { email: value.email } : {}) });
    recordAudit({ module: 'system', action: 'แก้ไขข้อมูลบริษัท', target: value.name });
    return { ok: companyProfile };
}

persistArray('materials', materials, (item) => item.code);
persistMap('project_boq', boqs);
persistArray('stock_movements', stockMovements, (item) => item.id, (a, b) => b.recordedAt.localeCompare(a.recordedAt));
persistObject('company_profile', companyProfile);
