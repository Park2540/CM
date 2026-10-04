/**
 * จัดซื้อวัสดุและเช่า/ยืมอุปกรณ์ของโครงการ
 * - ใบขอซื้อ (PR) ส่งเข้าศูนย์อนุมัติ → อนุมัติ → สั่งซื้อ (PO) → รับของ (ทยอยรับได้) → ครบ
 * - เช่า (rent) ส่งเข้าศูนย์อนุมัติ / ยืม (borrow) จากคลังบริษัทไม่ต้องอนุมัติ → รับเข้าหน้างาน → (ขยายเวลา) → คืน
 * ใบขอซื้อ/คำขอเช่าในศูนย์อนุมัติที่สร้างก่อนมีโมดูลนี้ (ข้อมูลตั้งต้น) สร้างรายการให้อัตโนมัติเมื่ออ่าน (syncFromApprovals)
 */
import { persistArray } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { approvalLevel, approvals } from './approvals.js';
import { recordAudit } from './audit-logs.js';
import { getTimeline, todayIso, uploads } from './projects.js';
import { CURRENT_USER } from './users.js';

type Approval = ApiSchemas['Approval'];
type Purchase = ApiSchemas['PurchaseRequest'];
type Rental = ApiSchemas['Rental'];
type StoredRental = Omit<Rental, 'estimatedCost' | 'cost' | 'overdue'>;
type Item = ApiSchemas['ProcurementItem'];
export type Problem = { status: 403 | 404 | 409 | 422; title: string; detail?: string; errors?: Record<string, string> };
export type Result<T> = { ok: T } | Problem;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const author = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const money = (value: number) => `฿${value.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const fail = (status: Problem['status'], title: string, errors?: Record<string, string>): Problem => ({ status, title, ...(errors ? { detail: Object.values(errors)[0], errors } : {}) });
/** ข้อความเกินความยาวที่ API กำหนด */
function tooLong(errors: Record<string, string>, field: string, value: string, max: number) {
    if (value.length > max) errors[field] = `ยาวเกิน ${max.toLocaleString('th-TH')} ตัวอักษร`;
}
/** ขั้นตอนต้องมีในไทม์ไลน์ของโครงการ */
function checkPhase(errors: Record<string, string>, code: string, phaseCode: string) {
    if (phaseCode && !getTimeline(code)?.phases.some((phase) => phase.code === phaseCode)) errors['phaseCode'] = 'ไม่พบขั้นตอนนี้ในไทม์ไลน์';
}
const amountOf = (items: Item[]) => round2(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));

export const purchases: Purchase[] = [];
export const rentals: StoredRental[] = [];

// ---------- เลขเอกสาร: <คำนำหน้า>-<ปี พ.ศ. 2 หลัก><เดือน>-<ลำดับ 4 หลัก> ต่อจากเลขเดิม ----------

function nextNumber(prefix: string, existing: string[]): string {
    const now = new Date();
    const head = `${prefix}-${String(now.getFullYear() + 543).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const highest = Math.max(0, ...existing.filter((id) => id.startsWith(`${prefix}-`)).map((id) => Number(id.slice(-4)) || 0));
    return `${head}${String(highest + 1).padStart(4, '0')}`;
}
const allIds = () => [...approvals.map((item) => item.id), ...purchases.map((item) => item.id), ...rentals.map((item) => item.id)];

// ---------- ข้อมูลเดิมในศูนย์อนุมัติ → รายการจัดซื้อ/เช่า ----------

const approvalStatus = (approval: Approval): 'pending' | 'approved' | 'rejected' => approval.status;
const decidedAt = (approval: Approval) => approval.history.find((step) => step.action !== 'submitted')?.at;

/** สร้างรายการให้คำขอ pr / rental ในศูนย์อนุมัติที่ยังไม่มีรายการ (เช่น ข้อมูลตั้งต้น) */
export function syncFromApprovals() {
    for (const approval of approvals) {
        if (approval.type === 'pr' && !approval.purchaseId) approval.purchaseId = approval.id;
        if (approval.type === 'rental' && !approval.rentalId) approval.rentalId = approval.id;
        if (approval.type === 'pr' && !purchases.some((item) => item.approvalId === approval.id)) {
            purchases.push({
                id: approval.id,
                projectCode: approval.projectCode,
                title: approval.title,
                items: approval.items.map((item) => ({ ...item })),
                neededDate: addDays(approval.requestedAt.slice(0, 10), 7),
                ...(approval.reason ? { note: approval.reason } : {}),
                status: approvalStatus(approval),
                amount: approval.amount,
                approvalId: approval.id,
                requestedBy: approval.requestedBy,
                requestedAt: approval.requestedAt,
                ...(decidedAt(approval) ? { decidedAt: decidedAt(approval) } : {}),
                received: approval.items.map(() => 0),
                receipts: []
            });
        }
        if (approval.type === 'rental' && !rentals.some((item) => item.approvalId === approval.id)) {
            // รายการเดียว หน่วยแบบ "ชุด-เดือน" = จำนวนชุด × จำนวนเดือน
            const item = approval.items[0];
            const months = /เดือน/.test(approval.title) ? Number(approval.title.match(/(\d+)\s*เดือน/)?.[1] ?? 1) : 1;
            const start = addDays(approval.requestedAt.slice(0, 10), 3);
            rentals.push({
                id: approval.id,
                projectCode: approval.projectCode,
                source: 'rent',
                equipment: (item?.name ?? approval.title).replace(/\s*\(.*\)\s*$/, ''),
                quantity: item ? round2(item.quantity / months) : 1,
                unit: (item?.unit ?? 'ชุด').replace(/-เดือน$/, ''),
                startDate: start,
                endDate: addDays(start, months * 30 - 1),
                vendor: 'ร้านให้เช่าตามใบเสนอราคา',
                rate: item?.unitPrice ?? 0,
                rateUnit: 'month',
                ...(approval.reason ? { note: approval.reason } : {}),
                status: approvalStatus(approval),
                approvalId: approval.id,
                requestedBy: approval.requestedBy,
                requestedAt: approval.requestedAt,
                ...(decidedAt(approval) ? { decidedAt: decidedAt(approval) } : {})
            });
        }
    }
}

/** หลังตัดสินในศูนย์อนุมัติ: ใบขอซื้อ/คำขอเช่า เปลี่ยนสถานะตาม (เรียกจาก routes/approvals) */
export function applyProcurementDecision(approval: Approval, status: 'approved' | 'rejected', note?: string) {
    syncFromApprovals();
    const record = approval.type === 'pr' ? purchases.find((item) => item.approvalId === approval.id) : approval.type === 'rental' ? rentals.find((item) => item.approvalId === approval.id) : undefined;
    if (!record || record.status !== 'pending') return;
    Object.assign(record, { status, decidedAt: new Date().toISOString(), ...(note ? { decisionNote: note } : {}) });
}

/** ยกเลิกรายการที่รออนุมัติ: ปิดคำขอในศูนย์อนุมัติด้วย */
function withdrawApproval(approvalId: string | undefined, reason: string) {
    const approval = approvals.find((item) => item.id === approvalId);
    if (approval?.status !== 'pending') return;
    approval.status = 'rejected';
    approval.history.push({ action: 'rejected', user: author(), at: new Date().toISOString(), note: `ยกเลิกคำขอ: ${reason}` });
}

// ---------- ใบขอซื้อ ----------

export function listPurchases(code: string): Purchase[] {
    syncFromApprovals();
    return purchases.filter((item) => item.projectCode === code).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

const findPurchase = (code: string, id: string) => purchases.find((item) => item.projectCode === code && item.id === id);

function validateItems(input: unknown, errors: Record<string, string>): Item[] {
    const list = Array.isArray(input) ? input : [];
    if (!list.length) errors['items'] = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
    if (list.length > 50) errors['items'] = 'ได้ไม่เกิน 50 รายการ';
    return list.slice(0, 50).map((raw: Partial<Item>, index) => {
        const item = { name: text(raw.name), quantity: Number(raw.quantity), unit: text(raw.unit), unitPrice: Number(raw.unitPrice) };
        if (!item.name) errors[`items.${index}.name`] = 'กรุณาระบุชื่อรายการ';
        else if (item.name.length > 200) errors[`items.${index}.name`] = 'ชื่อยาวเกิน 200 ตัวอักษร';
        if (!(item.quantity > 0)) errors[`items.${index}.quantity`] = 'จำนวนต้องมากกว่า 0';
        if (!item.unit) errors[`items.${index}.unit`] = 'กรุณาระบุหน่วย';
        else tooLong(errors, `items.${index}.unit`, item.unit, 30);
        if (!(item.unitPrice >= 0)) errors[`items.${index}.unitPrice`] = 'ราคาต้องไม่ติดลบ';
        return item;
    });
}

export function createPurchase(code: string, input: Partial<ApiSchemas['PurchaseRequestInput']>): Result<Purchase> {
    const errors: Record<string, string> = {};
    const title = text(input.title);
    if (!title) errors['title'] = 'กรุณาระบุเรื่องที่ขอซื้อ';
    else if (title.length > 200) errors['title'] = 'ยาวเกิน 200 ตัวอักษร';
    const items = validateItems(input.items, errors);
    if (!DATE.test(input.neededDate ?? '')) errors['neededDate'] = 'กรุณาระบุวันที่ต้องการใช้';
    tooLong(errors, 'supplier', text(input.supplier), 200);
    checkPhase(errors, code, text(input.phaseCode));
    if (text(input.note).length > 1000) errors['note'] = 'หมายเหตุยาวเกิน 1,000 ตัวอักษร';
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);

    syncFromApprovals();
    const id = nextNumber('PR', allIds());
    const now = new Date().toISOString();
    const amount = amountOf(items);
    const purchase: Purchase = {
        id,
        projectCode: code,
        title,
        items,
        neededDate: input.neededDate!,
        ...(text(input.phaseCode) ? { phaseCode: text(input.phaseCode) } : {}),
        ...(text(input.supplier) ? { supplier: text(input.supplier) } : {}),
        ...(text(input.note) ? { note: text(input.note) } : {}),
        status: 'pending',
        amount,
        approvalId: id,
        requestedBy: author(),
        requestedAt: now,
        received: items.map(() => 0),
        receipts: []
    };
    purchases.push(purchase);
    approvals.unshift({
        id,
        type: 'pr',
        projectCode: code,
        title,
        ...(purchase.note ? { reason: purchase.note } : {}),
        amount,
        requestedBy: author(),
        requestedAt: now,
        status: 'pending',
        approvalLevel: approvalLevel('pr', amount),
        items: items.map((item) => ({ ...item })),
        history: [{ action: 'submitted', user: author(), at: now, ...(purchase.note ? { note: purchase.note } : {}) }],
        purchaseId: id
    });
    recordAudit({ module: 'procurement', action: 'ขอซื้อวัสดุ', target: `${code} ${id}`, detail: `${title} · ${items.length} รายการ · ${money(amount)}` });
    return { ok: purchase };
}

export function orderPurchase(code: string, id: string, input: Partial<ApiSchemas['PurchaseOrderInput']>): Result<Purchase> {
    const purchase = findPurchase(code, id);
    if (!purchase) return fail(404, 'ไม่พบใบขอซื้อ');
    if (purchase.status !== 'approved') return fail(409, purchase.status === 'pending' ? 'ใบขอซื้อยังรออนุมัติ' : 'สั่งซื้อได้เฉพาะใบขอซื้อที่อนุมัติแล้ว');
    const errors: Record<string, string> = {};
    const supplier = text(input.supplier);
    if (!supplier) errors['supplier'] = 'กรุณาระบุร้านค้า';
    else tooLong(errors, 'supplier', supplier, 200);
    tooLong(errors, 'poNumber', text(input.poNumber), 50);
    if (!DATE.test(input.orderDate ?? '')) errors['orderDate'] = 'กรุณาระบุวันที่สั่งซื้อ';
    else if (input.orderDate! > todayIso()) errors['orderDate'] = 'วันที่สั่งซื้อต้องไม่เกินวันนี้';
    if (input.expectedDate && !DATE.test(input.expectedDate)) errors['expectedDate'] = 'วันที่ไม่ถูกต้อง';
    else if (input.expectedDate && input.orderDate && input.expectedDate < input.orderDate) errors['expectedDate'] = 'วันส่งของต้องไม่ก่อนวันสั่งซื้อ';
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);
    const poNumber = text(input.poNumber) || nextNumber('PO', purchases.map((item) => item.order?.poNumber ?? '').filter(Boolean));
    purchase.order = { supplier, poNumber, orderDate: input.orderDate!, ...(input.expectedDate ? { expectedDate: input.expectedDate } : {}), orderedBy: author() };
    purchase.status = 'ordered';
    recordAudit({ module: 'procurement', action: 'สั่งซื้อวัสดุ', target: `${code} ${poNumber}`, detail: `${purchase.id} ${purchase.title} · ${supplier} · ${money(purchase.amount)}` });
    return { ok: purchase };
}

export function receivePurchase(code: string, id: string, input: Partial<ApiSchemas['PurchaseReceiveInput']>): Result<Purchase> {
    const purchase = findPurchase(code, id);
    if (!purchase) return fail(404, 'ไม่พบใบขอซื้อ');
    if (purchase.status !== 'ordered' && purchase.status !== 'partial') return fail(409, 'รับของได้หลังสั่งซื้อแล้วเท่านั้น');
    const errors: Record<string, string> = {};
    if (!DATE.test(input.date ?? '')) errors['date'] = 'กรุณาระบุวันที่รับของ';
    else if (input.date! > todayIso()) errors['date'] = 'วันที่รับของต้องไม่เกินวันนี้';
    const quantities = Array.isArray(input.quantities) ? input.quantities.map(Number) : [];
    if (quantities.length !== purchase.items.length) errors['quantities'] = 'ระบุจำนวนที่รับให้ครบทุกรายการ';
    else {
        quantities.forEach((quantity, index) => {
            const remaining = round2(purchase.items[index]!.quantity - (purchase.received[index] ?? 0));
            if (!(quantity >= 0)) errors[`quantities.${index}`] = 'จำนวนต้องไม่ติดลบ';
            else if (quantity > remaining + 1e-9) errors[`quantities.${index}`] = `รับได้อีกไม่เกิน ${remaining} ${purchase.items[index]!.unit}`;
        });
        if (!Object.keys(errors).length && !quantities.some((quantity) => quantity > 0)) errors['quantities'] = 'ระบุจำนวนที่รับอย่างน้อย 1 รายการ';
    }
    const fileIds = Array.isArray(input.fileIds) ? input.fileIds : [];
    if (fileIds.length > 10) errors['fileIds'] = 'แนบได้ไม่เกิน 10 ไฟล์';
    else if (fileIds.some((fileId) => !uploads.has(fileId))) errors['fileIds'] = 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่';
    if (text(input.note).length > 1000) errors['note'] = 'หมายเหตุยาวเกิน 1,000 ตัวอักษร';
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);

    purchase.received = purchase.received.map((done, index) => round2(done + quantities[index]!));
    purchase.receipts.push({
        date: input.date!,
        quantities,
        ...(text(input.note) ? { note: text(input.note) } : {}),
        files: fileIds.map((fileId) => uploads.get(fileId)!),
        receivedBy: author(),
        recordedAt: new Date().toISOString()
    });
    const complete = purchase.items.every((item, index) => (purchase.received[index] ?? 0) >= item.quantity - 1e-9);
    purchase.status = complete ? 'received' : 'partial';
    const summary = purchase.items
        .map((item, index) => (quantities[index]! > 0 ? `${item.name} ${quantities[index]} ${item.unit}` : ''))
        .filter(Boolean)
        .join(', ');
    recordAudit({ module: 'procurement', action: complete ? 'รับของครบ' : 'รับของบางส่วน', target: `${code} ${purchase.order?.poNumber ?? purchase.id}`, detail: summary });
    return { ok: purchase };
}

export function cancelPurchase(code: string, id: string, reason: unknown): Result<Purchase> {
    const purchase = findPurchase(code, id);
    if (!purchase) return fail(404, 'ไม่พบใบขอซื้อ');
    if (!['pending', 'approved', 'ordered'].includes(purchase.status)) return fail(409, purchase.status === 'partial' ? 'รับของบางส่วนแล้ว ยกเลิกไม่ได้' : 'ยกเลิกรายการนี้ไม่ได้');
    const note = text(reason);
    if (!note) return fail(422, 'กรุณาระบุเหตุผลที่ยกเลิก', { reason: 'กรุณาระบุเหตุผลที่ยกเลิก' });
    if (note.length > 500) return fail(422, 'ข้อมูลไม่ถูกต้อง', { reason: 'ยาวเกิน 500 ตัวอักษร' });
    withdrawApproval(purchase.approvalId, note);
    Object.assign(purchase, { status: 'cancelled', cancelReason: note });
    recordAudit({ module: 'procurement', action: 'ยกเลิกใบขอซื้อ', target: `${code} ${purchase.id}`, detail: note });
    return { ok: purchase };
}

// ---------- เช่า / ยืมอุปกรณ์ ----------

/** จำนวนช่วงที่คิดค่าเช่า (นับวันแรกและวันสุดท้าย; รายเดือนปัดขึ้นทีละ 30 วัน) */
function periods(rateUnit: Rental['rateUnit'], from: string, to: string): number {
    const days = Math.max(1, daysBetween(from, to) + 1);
    return rateUnit === 'month' ? Math.ceil(days / 30) : days;
}

export function presentRental(rental: StoredRental): Rental {
    const rentCost = (from: string, to: string) => (rental.source === 'rent' && rental.rate ? round2(rental.rate * rental.quantity * periods(rental.rateUnit, from, to)) : 0);
    const today = todayIso();
    const start = rental.deliveredAt ?? rental.startDate;
    const cost = rental.status === 'in-use' ? rentCost(start, today) : rental.status === 'returned' ? rentCost(start, rental.returnedAt ?? today) : 0;
    return { ...rental, estimatedCost: rentCost(rental.startDate, rental.endDate), cost, overdue: rental.status === 'in-use' && rental.endDate < today };
}

export function listRentals(code: string): Rental[] {
    syncFromApprovals();
    return rentals
        .filter((item) => item.projectCode === code)
        .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
        .map(presentRental);
}

const findRental = (code: string, id: string) => rentals.find((item) => item.projectCode === code && item.id === id);

export function createRental(code: string, input: Partial<ApiSchemas['RentalInput']>): Result<Rental> {
    const errors: Record<string, string> = {};
    const source = input.source;
    const equipment = text(input.equipment);
    const vendor = text(input.vendor);
    if (source !== 'rent' && source !== 'borrow') errors['source'] = 'กรุณาเลือกเช่าหรือยืม';
    if (!equipment) errors['equipment'] = 'กรุณาระบุอุปกรณ์';
    else tooLong(errors, 'equipment', equipment, 200);
    tooLong(errors, 'vendor', vendor, 200);
    if (!(Number(input.quantity) > 0)) errors['quantity'] = 'จำนวนต้องมากกว่า 0';
    if (!text(input.unit)) errors['unit'] = 'กรุณาระบุหน่วย';
    else tooLong(errors, 'unit', text(input.unit), 30);
    if (!DATE.test(input.startDate ?? '')) errors['startDate'] = 'กรุณาระบุวันเริ่มใช้';
    if (!DATE.test(input.endDate ?? '')) errors['endDate'] = 'กรุณาระบุกำหนดคืน';
    else if (input.startDate && input.endDate! < input.startDate) errors['endDate'] = 'กำหนดคืนต้องไม่ก่อนวันเริ่มใช้';
    if (source === 'rent') {
        if (!vendor) errors['vendor'] = 'กรุณาระบุร้านให้เช่า';
        if (!(Number(input.rate) > 0)) errors['rate'] = 'กรุณาระบุค่าเช่า';
        if (input.rateUnit !== 'day' && input.rateUnit !== 'month') errors['rateUnit'] = 'กรุณาเลือกคิดรายวันหรือรายเดือน';
    }
    checkPhase(errors, code, text(input.phaseCode));
    if (text(input.note).length > 1000) errors['note'] = 'หมายเหตุยาวเกิน 1,000 ตัวอักษร';
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);

    syncFromApprovals();
    const now = new Date().toISOString();
    const rent = source === 'rent';
    const id = nextNumber(rent ? 'RT' : 'BR', allIds());
    const rental: StoredRental = {
        id,
        projectCode: code,
        source: source!,
        equipment,
        quantity: Number(input.quantity),
        unit: text(input.unit),
        startDate: input.startDate!,
        endDate: input.endDate!,
        ...(vendor ? { vendor } : {}),
        ...(rent ? { rate: Number(input.rate), rateUnit: input.rateUnit } : {}),
        ...(text(input.phaseCode) ? { phaseCode: text(input.phaseCode) } : {}),
        ...(text(input.note) ? { note: text(input.note) } : {}),
        // ยืมจากคลังบริษัทไม่ต้องอนุมัติ
        status: rent ? 'pending' : 'approved',
        ...(rent ? { approvalId: id } : {}),
        requestedBy: author(),
        requestedAt: now
    };
    rentals.push(rental);
    const presented = presentRental(rental);
    if (rent) {
        const count = periods(rental.rateUnit, rental.startDate, rental.endDate);
        approvals.unshift({
            id,
            type: 'rental',
            projectCode: code,
            title: `เช่า${equipment} ${rental.quantity} ${rental.unit}`,
            reason: `${vendor} · ${rental.startDate} ถึง ${rental.endDate}${rental.note ? ` · ${rental.note}` : ''}`,
            amount: presented.estimatedCost,
            requestedBy: author(),
            requestedAt: now,
            status: 'pending',
            approvalLevel: approvalLevel('rental', presented.estimatedCost),
            items: [{ name: `${equipment} (ค่าเช่า/${rental.rateUnit === 'month' ? 'เดือน' : 'วัน'})`, quantity: round2(rental.quantity * count), unit: `${rental.unit}-${rental.rateUnit === 'month' ? 'เดือน' : 'วัน'}`, unitPrice: rental.rate! }],
            history: [{ action: 'submitted', user: author(), at: now, ...(rental.note ? { note: rental.note } : {}) }],
            rentalId: id
        });
    }
    recordAudit({ module: 'procurement', action: rent ? 'ขอเช่าอุปกรณ์' : 'ขอยืมอุปกรณ์', target: `${code} ${id}`, detail: `${equipment} ${rental.quantity} ${rental.unit} · ${rental.startDate} ถึง ${rental.endDate}${rent ? ` · ประมาณ ${money(presented.estimatedCost)}` : ''}` });
    return { ok: presented };
}

export function startRental(code: string, id: string, input: Partial<ApiSchemas['RentalStartInput']>): Result<Rental> {
    const rental = findRental(code, id);
    if (!rental) return fail(404, 'ไม่พบรายการเช่า/ยืม');
    if (rental.status !== 'approved') return fail(409, rental.status === 'pending' ? 'การเช่ายังรออนุมัติ' : 'รับเข้าหน้างานได้เฉพาะรายการที่พร้อมรับ');
    if (!DATE.test(input.date ?? '')) return fail(422, 'ข้อมูลไม่ถูกต้อง', { date: 'กรุณาระบุวันที่รับเข้าหน้างาน' });
    if (input.date! > todayIso()) return fail(422, 'ข้อมูลไม่ถูกต้อง', { date: 'วันที่ต้องไม่เกินวันนี้' });
    if (input.date! < rental.requestedAt.slice(0, 10)) return fail(422, 'ข้อมูลไม่ถูกต้อง', { date: 'วันที่ต้องไม่ก่อนวันที่ขอ' });
    if (text(input.note).length > 500) return fail(422, 'ข้อมูลไม่ถูกต้อง', { note: 'ยาวเกิน 500 ตัวอักษร' });
    Object.assign(rental, { status: 'in-use', deliveredAt: input.date, deliveredBy: author(), ...(text(input.note) ? { deliveryNote: text(input.note) } : {}) });
    recordAudit({ module: 'procurement', action: 'รับอุปกรณ์เข้าหน้างาน', target: `${code} ${id}`, detail: `${rental.equipment} ${rental.quantity} ${rental.unit} · ${input.date}${text(input.note) ? ` · ${text(input.note)}` : ''}` });
    return { ok: presentRental(rental) };
}

export function extendRental(code: string, id: string, input: Partial<ApiSchemas['RentalExtendInput']>): Result<Rental> {
    const rental = findRental(code, id);
    if (!rental) return fail(404, 'ไม่พบรายการเช่า/ยืม');
    if (!['approved', 'in-use'].includes(rental.status)) return fail(409, 'ขยายเวลาได้เฉพาะรายการที่ยังไม่คืน');
    if (!DATE.test(input.endDate ?? '')) return fail(422, 'ข้อมูลไม่ถูกต้อง', { endDate: 'กรุณาระบุกำหนดคืนใหม่' });
    if (input.endDate! <= rental.endDate) return fail(422, 'ข้อมูลไม่ถูกต้อง', { endDate: 'กำหนดคืนใหม่ต้องหลังกำหนดเดิม' });
    if (text(input.note).length > 500) return fail(422, 'ข้อมูลไม่ถูกต้อง', { note: 'ยาวเกิน 500 ตัวอักษร' });
    const from = rental.endDate;
    rental.extensions = [...(rental.extensions ?? []), { from, to: input.endDate!, ...(text(input.note) ? { note: text(input.note) } : {}), by: author(), at: new Date().toISOString() }];
    rental.endDate = input.endDate!;
    recordAudit({ module: 'procurement', action: 'ขยายเวลาเช่า/ยืม', target: `${code} ${id}`, detail: `${rental.equipment} · ${from} → ${input.endDate}${text(input.note) ? ` · ${text(input.note)}` : ''}` });
    return { ok: presentRental(rental) };
}

const CONDITION_LABEL = { good: 'ปกติ', damaged: 'ชำรุด', lost: 'สูญหาย' } as const;

export function returnRental(code: string, id: string, input: Partial<ApiSchemas['RentalReturnInput']>): Result<Rental> {
    const rental = findRental(code, id);
    if (!rental) return fail(404, 'ไม่พบรายการเช่า/ยืม');
    if (rental.status !== 'in-use') return fail(409, 'คืนได้เฉพาะอุปกรณ์ที่ใช้งานอยู่');
    const errors: Record<string, string> = {};
    if (!DATE.test(input.date ?? '')) errors['date'] = 'กรุณาระบุวันที่คืน';
    else if (input.date! > todayIso()) errors['date'] = 'วันที่คืนต้องไม่เกินวันนี้';
    else if (rental.deliveredAt && input.date! < rental.deliveredAt) errors['date'] = 'วันที่คืนต้องไม่ก่อนวันที่รับเข้าหน้างาน';
    if (!input.condition || !(input.condition in CONDITION_LABEL)) errors['condition'] = 'กรุณาเลือกสภาพตอนคืน';
    else if (input.condition !== 'good' && !text(input.note)) errors['note'] = 'กรุณาระบุรายละเอียดความเสียหาย';
    tooLong(errors, 'note', text(input.note), 500);
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);
    Object.assign(rental, { status: 'returned', returnedAt: input.date, returnedBy: author(), returnCondition: input.condition, ...(text(input.note) ? { returnNote: text(input.note) } : {}) });
    const presented = presentRental(rental);
    recordAudit({
        module: 'procurement',
        action: 'คืนอุปกรณ์',
        target: `${code} ${id}`,
        detail: `${rental.equipment} · ${input.date} · สภาพ${CONDITION_LABEL[input.condition!]}${presented.cost ? ` · ค่าเช่า ${money(presented.cost)}` : ''}${text(input.note) ? ` · ${text(input.note)}` : ''}`
    });
    return { ok: presented };
}

export function cancelRental(code: string, id: string, reason: unknown): Result<Rental> {
    const rental = findRental(code, id);
    if (!rental) return fail(404, 'ไม่พบรายการเช่า/ยืม');
    if (!['pending', 'approved'].includes(rental.status)) return fail(409, 'ยกเลิกได้เฉพาะรายการที่ยังไม่รับเข้าหน้างาน');
    const note = text(reason);
    if (!note) return fail(422, 'กรุณาระบุเหตุผลที่ยกเลิก', { reason: 'กรุณาระบุเหตุผลที่ยกเลิก' });
    if (note.length > 500) return fail(422, 'ข้อมูลไม่ถูกต้อง', { reason: 'ยาวเกิน 500 ตัวอักษร' });
    withdrawApproval(rental.approvalId, note);
    Object.assign(rental, { status: 'cancelled', cancelReason: note });
    recordAudit({ module: 'procurement', action: 'ยกเลิกการเช่า/ยืม', target: `${code} ${id}`, detail: note });
    return { ok: presentRental(rental) };
}

/** ผู้ขอยกเลิกรายการของตัวเองได้ */
export const isRequester = (record: { requestedBy: ApiSchemas['UserRef'] }) => record.requestedBy.id === CURRENT_USER.id;
export const findPurchaseRecord = findPurchase;
export const findRentalRecord = findRental;

// ใบขอซื้อ: ล่าสุดก่อนเมื่อโหลด, การเช่า: ล่าสุดก่อน
persistArray('purchase_requests', purchases, (item) => item.id, (a, b) => b.requestedAt.localeCompare(a.requestedAt));
persistArray('rentals', rentals, (item) => item.id, (a, b) => b.requestedAt.localeCompare(a.requestedAt));
