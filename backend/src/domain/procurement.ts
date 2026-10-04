/**
 * จัดซื้อวัสดุและเช่า/ยืมอุปกรณ์ของโครงการ
 * - ใบขอซื้อ (PR) ส่งเข้าศูนย์อนุมัติ → อนุมัติ → ออกใบสั่งซื้อ (PO ราคารวม VAT จากใบเสนอราคา) ส่งเข้าศูนย์อนุมัติ → อนุมัติ → ตรวจรับที่หน้างาน (ทยอยรับได้) → ครบ
 * - ของที่รับถือว่าใช้ที่หน้างานทันที ของเหลือส่งเข้าคลังหลัก / ขาดเบิกจากคลังหลัก → เทียบการใช้วัสดุกับ BOQ
 * - เช่า (rent) ส่งเข้าศูนย์อนุมัติ / ยืม (borrow) จากคลังบริษัทไม่ต้องอนุมัติ → รับเข้าหน้างาน → (ขยายเวลา) → คืน
 * ใบขอซื้อ/คำขอเช่าในศูนย์อนุมัติที่สร้างก่อนมีโมดูลนี้ (ข้อมูลตั้งต้น) สร้างรายการให้อัตโนมัติเมื่ออ่าน (syncFromApprovals)
 */
import { persistArray } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { approvalLevel, approvals } from './approvals.js';
import { recordAudit } from './audit-logs.js';
import { boqs, findMaterial, getBoq, materialKey, recordLastPrice, stockMovements, stockOf } from './materials.js';
import { currentProject, getTimeline, todayIso, uploads } from './projects.js';
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

/** หลังตัดสินในศูนย์อนุมัติ: ใบขอซื้อ / ใบสั่งซื้อ / คำขอเช่า เปลี่ยนสถานะตาม (เรียกจาก routes/approvals) */
export function applyProcurementDecision(approval: Approval, status: 'approved' | 'rejected', note?: string) {
    syncFromApprovals();
    const decidedAt = new Date().toISOString();
    if (approval.type === 'po') {
        const purchase = purchases.find((item) => item.order?.approvalId === approval.id);
        if (!purchase?.order || purchase.status !== 'po-pending') return;
        Object.assign(purchase.order, { status, decidedAt, ...(note ? { decisionNote: note } : {}) });
        if (status === 'approved') {
            purchase.status = 'ordered';
            // ราคาล่าสุดของวัสดุ (รวม VAT) ใช้เป็นราคาอ้างอิงตอนขอซื้อครั้งต่อไป
            purchase.items.forEach((item, index) => recordLastPrice(item.materialCode, purchase.order!.unitPrices?.[index] ?? 0));
        } else {
            // ไม่อนุมัติ: เก็บเป็นประวัติ กลับไปรอออกใบสั่งซื้อใหม่
            purchase.rejectedOrders = [...(purchase.rejectedOrders ?? []), purchase.order];
            delete purchase.order;
            purchase.status = 'approved';
        }
        return;
    }
    const record = approval.type === 'pr' ? purchases.find((item) => item.approvalId === approval.id) : approval.type === 'rental' ? rentals.find((item) => item.approvalId === approval.id) : undefined;
    if (!record || record.status !== 'pending') return;
    Object.assign(record, { status, decidedAt, ...(note ? { decisionNote: note } : {}) });
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
    for (const purchase of purchases) if (purchase.order && !purchase.order.status) purchase.order.status = 'approved';
    return purchases.filter((item) => item.projectCode === code).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

const findPurchase = (code: string, id: string) => purchases.find((item) => item.projectCode === code && item.id === id);

function validateItems(input: unknown, errors: Record<string, string>): Item[] {
    const list = Array.isArray(input) ? input : [];
    if (!list.length) errors['items'] = 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
    if (list.length > 50) errors['items'] = 'ได้ไม่เกิน 50 รายการ';
    return list.slice(0, 50).map((raw: Partial<Item>, index) => {
        const material = findMaterial(text(raw.materialCode));
        if (raw.materialCode && !material) errors[`items.${index}.materialCode`] = 'ไม่พบวัสดุนี้ในรายการวัสดุ';
        // เลือกจากรายการวัสดุ: ใช้ชื่อและหน่วยตามรายการ (เทียบ BOQ ได้ตรง)
        const item: Item = { ...(material ? { materialCode: material.code } : {}), name: material?.name ?? text(raw.name), quantity: Number(raw.quantity), unit: material?.unit ?? text(raw.unit), unitPrice: Number(raw.unitPrice) };
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

const VAT_RATE = 0.07;
const vendorLimits: Record<keyof ApiSchemas['Vendor'], number> = { name: 200, taxId: 20, address: 500, contactName: 100, phone: 30 };

/** ออกใบสั่งซื้อ: ราคาจากใบเสนอราคาที่ดีที่สุด (รวม VAT) → ส่งเข้าศูนย์อนุมัติเป็น po วงเงินเดียวกับใบขอซื้อ */
export function orderPurchase(code: string, id: string, input: Partial<ApiSchemas['PurchaseOrderInput']>): Result<Purchase> {
    const purchase = findPurchase(code, id);
    if (!purchase) return fail(404, 'ไม่พบใบขอซื้อ');
    if (purchase.status !== 'approved') return fail(409, purchase.status === 'pending' ? 'ใบขอซื้อยังรออนุมัติ' : purchase.status === 'po-pending' ? 'ใบสั่งซื้อของใบขอซื้อนี้รออนุมัติอยู่' : 'ออกใบสั่งซื้อได้เฉพาะใบขอซื้อที่อนุมัติแล้ว');
    const errors: Record<string, string> = {};
    const rawVendor: Partial<ApiSchemas['Vendor']> = input.vendor ?? {};
    const vendor: ApiSchemas['Vendor'] = { name: text(rawVendor.name) };
    for (const field of ['taxId', 'address', 'contactName', 'phone'] as const) if (text(rawVendor[field])) vendor[field] = text(rawVendor[field]);
    if (vendor.taxId) vendor.taxId = vendor.taxId.replace(/[\s-]/g, '');
    if (!vendor.name) errors['vendor.name'] = 'กรุณาระบุร้านค้า/ผู้ขาย';
    for (const [field, max] of Object.entries(vendorLimits)) tooLong(errors, `vendor.${field}`, vendor[field as keyof typeof vendor] ?? '', max);
    if (vendor.taxId && !errors['vendor.taxId'] && !/^\d{13}$/.test(vendor.taxId)) errors['vendor.taxId'] = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
    if (!DATE.test(input.orderDate ?? '')) errors['orderDate'] = 'กรุณาระบุวันที่สั่งซื้อ';
    else if (input.orderDate! > todayIso()) errors['orderDate'] = 'วันที่สั่งซื้อต้องไม่เกินวันนี้';
    if (input.expectedDate && !DATE.test(input.expectedDate)) errors['expectedDate'] = 'วันที่ไม่ถูกต้อง';
    else if (input.expectedDate && input.orderDate && input.expectedDate < input.orderDate) errors['expectedDate'] = 'วันส่งของต้องไม่ก่อนวันสั่งซื้อ';
    const unitPrices = Array.isArray(input.unitPrices) ? input.unitPrices.map(Number) : [];
    if (unitPrices.length !== purchase.items.length) errors['unitPrices'] = 'ระบุราคาให้ครบทุกรายการ';
    else unitPrices.forEach((price, index) => {
        if (!(price >= 0)) errors[`unitPrices.${index}`] = 'ราคาต้องไม่ติดลบ';
    });
    tooLong(errors, 'paymentTerms', text(input.paymentTerms), 200);
    tooLong(errors, 'note', text(input.note), 1000);
    const fileIds = Array.isArray(input.quotationFileIds) ? input.quotationFileIds : [];
    if (fileIds.length > 10) errors['quotationFileIds'] = 'แนบได้ไม่เกิน 10 ไฟล์';
    else if (fileIds.some((fileId) => !uploads.has(fileId))) errors['quotationFileIds'] = 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดใหม่';
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);

    syncFromApprovals();
    const poNumber = nextNumber('PO', [...allIds(), ...purchases.flatMap((item) => [item.order?.poNumber ?? '', ...(item.rejectedOrders ?? []).map((order) => order.poNumber)])]);
    const now = new Date().toISOString();
    // ราคารวม VAT แล้ว: ถอด VAT 7% ออกมาแสดง
    const amount = round2(purchase.items.reduce((sum, item, index) => sum + item.quantity * unitPrices[index]!, 0));
    const amountBeforeVat = round2(amount / (1 + VAT_RATE));
    purchase.order = {
        poNumber,
        approvalId: poNumber,
        status: 'pending',
        vendor,
        supplier: vendor.name,
        orderDate: input.orderDate!,
        ...(input.expectedDate ? { expectedDate: input.expectedDate } : {}),
        unitPrices,
        amount,
        amountBeforeVat,
        vatAmount: round2(amount - amountBeforeVat),
        ...(text(input.paymentTerms) ? { paymentTerms: text(input.paymentTerms) } : {}),
        ...(text(input.note) ? { note: text(input.note) } : {}),
        quotationFiles: fileIds.map((fileId) => uploads.get(fileId)!),
        orderedBy: author(),
        orderedAt: now
    };
    purchase.status = 'po-pending';
    approvals.unshift({
        id: poNumber,
        type: 'po',
        projectCode: code,
        title: `ใบสั่งซื้อ ${purchase.title} · ${vendor.name}`,
        reason: `อ้างอิงใบขอซื้อ ${purchase.id} (ประมาณ ${money(purchase.amount)})${text(input.note) ? ` · ${text(input.note)}` : ''}`,
        amount,
        requestedBy: author(),
        requestedAt: now,
        status: 'pending',
        // วงเงินอนุมัติเดียวกับใบขอซื้อ
        approvalLevel: approvalLevel('pr', amount),
        items: purchase.items.map((item, index) => ({ name: item.name, quantity: item.quantity, unit: item.unit, unitPrice: unitPrices[index]! })),
        history: [{ action: 'submitted', user: author(), at: now, ...(text(input.note) ? { note: text(input.note) } : {}) }],
        purchaseId: purchase.id
    });
    recordAudit({ module: 'procurement', action: 'ออกใบสั่งซื้อ', target: `${code} ${poNumber}`, detail: `${purchase.id} ${purchase.title} · ${vendor.name} · ${money(amount)} (รวม VAT)` });
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
    if (!['pending', 'approved', 'po-pending', 'ordered'].includes(purchase.status)) return fail(409, purchase.status === 'partial' ? 'รับของบางส่วนแล้ว ยกเลิกไม่ได้' : 'ยกเลิกรายการนี้ไม่ได้');
    const note = text(reason);
    if (!note) return fail(422, 'กรุณาระบุเหตุผลที่ยกเลิก', { reason: 'กรุณาระบุเหตุผลที่ยกเลิก' });
    if (note.length > 500) return fail(422, 'ข้อมูลไม่ถูกต้อง', { reason: 'ยาวเกิน 500 ตัวอักษร' });
    withdrawApproval(purchase.approvalId, note);
    if (purchase.order?.status === 'pending') {
        withdrawApproval(purchase.order.approvalId, note);
        purchase.order.status = 'rejected';
    }
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

// ---------- การใช้วัสดุเทียบ BOQ ----------

/** เกณฑ์ยอมรับส่วนต่างการใช้วัสดุเทียบ BOQ (%) */
export const USAGE_TOLERANCE_PERCENT = 5;
const ACTIVE_PURCHASE = ['pending', 'approved', 'po-pending', 'ordered', 'partial', 'received'];
const ORDERED_PURCHASE = ['ordered', 'partial', 'received'];

export function materialUsage(code: string): ApiSchemas['MaterialUsage'] {
    syncFromApprovals();
    const rows = new Map<string, ApiSchemas['MaterialUsageRow']>();
    const row = (item: { materialCode?: string; name: string; unit: string }) => {
        const key = materialKey(item);
        let current = rows.get(key);
        if (!current) {
            const material = findMaterial(item.materialCode);
            current = {
                key,
                ...(material ? { materialCode: material.code, category: material.category } : {}),
                name: material?.name ?? item.name,
                unit: material?.unit ?? item.unit,
                boqQuantity: 0,
                requestedQuantity: 0,
                orderedQuantity: 0,
                receivedQuantity: 0,
                issuedQuantity: 0,
                returnedQuantity: 0,
                usedQuantity: 0,
                variance: 0,
                variancePercent: null,
                spent: 0,
                status: 'ok'
            };
            rows.set(key, current);
        }
        return current;
    };
    const boqKeys = new Set<string>();
    for (const item of getBoq(code).items) {
        row(item).boqQuantity += item.quantity;
        boqKeys.add(materialKey(item));
    }
    for (const purchase of purchases.filter((item) => item.projectCode === code)) {
        purchase.items.forEach((item, index) => {
            const target = row(item);
            if (ACTIVE_PURCHASE.includes(purchase.status)) target.requestedQuantity += item.quantity;
            if (ORDERED_PURCHASE.includes(purchase.status)) target.orderedQuantity += item.quantity;
            const received = purchase.received[index] ?? 0;
            target.receivedQuantity += received;
            target.spent += received * (purchase.order?.unitPrices?.[index] ?? item.unitPrice);
        });
    }
    for (const movement of stockMovements.filter((item) => item.projectCode === code)) {
        const target = row(movement);
        if (movement.type === 'issue') target.issuedQuantity += movement.quantity;
        else target.returnedQuantity += movement.quantity;
    }
    const completed = currentProject(code)?.status === 'completed';
    const tolerance = USAGE_TOLERANCE_PERCENT / 100;
    const result = [...rows.values()].map((item) => {
        for (const field of ['boqQuantity', 'requestedQuantity', 'orderedQuantity', 'receivedQuantity', 'issuedQuantity', 'returnedQuantity'] as const) item[field] = round2(item[field]);
        item.spent = round2(item.spent);
        item.usedQuantity = round2(item.receivedQuantity + item.issuedQuantity - item.returnedQuantity);
        item.variance = round2(item.usedQuantity - item.boqQuantity);
        const inBoq = boqKeys.has(item.key);
        item.variancePercent = inBoq && item.boqQuantity > 0 ? round2((item.variance / item.boqQuantity) * 100) : null;
        if (!inBoq) item.status = 'not-in-boq';
        else if (item.usedQuantity > item.boqQuantity * (1 + tolerance)) item.status = 'over';
        else if (item.usedQuantity >= item.boqQuantity * (1 - tolerance)) item.status = 'ok';
        else item.status = completed ? 'under' : 'in-progress';
        return item;
    });
    const order: Record<ApiSchemas['MaterialUsageStatus'], number> = { over: 0, under: 1, 'not-in-boq': 2, 'in-progress': 3, ok: 4 };
    result.sort((a, b) => order[a.status] - order[b.status] || (a.category ?? '').localeCompare(b.category ?? '', 'th') || a.name.localeCompare(b.name, 'th'));
    return { tolerancePercent: USAGE_TOLERANCE_PERCENT, projectCompleted: completed, rows: result };
}

/** ส่งของเหลือเข้าคลังหลัก (ไม่เกินที่ใช้จริงของโครงการ) / เบิกจากคลังหลัก (ไม่เกินคงเหลือ) */
export function createStockMovement(code: string, input: Partial<ApiSchemas['StockMovementInput']>): Result<ApiSchemas['StockMovement']> {
    const errors: Record<string, string> = {};
    const type = input.type;
    const material = findMaterial(text(input.materialCode));
    if (input.materialCode && !material) errors['materialCode'] = 'ไม่พบวัสดุนี้ในรายการวัสดุ';
    const name = material?.name ?? text(input.name);
    const unit = material?.unit ?? text(input.unit);
    const quantity = Number(input.quantity);
    if (type !== 'return' && type !== 'issue') errors['type'] = 'กรุณาเลือกส่งคืนคลังหรือเบิกจากคลัง';
    if (!name) errors['name'] = 'กรุณาระบุวัสดุ';
    else tooLong(errors, 'name', name, 200);
    if (!unit) errors['unit'] = 'กรุณาระบุหน่วย';
    else tooLong(errors, 'unit', unit, 30);
    if (!(quantity > 0)) errors['quantity'] = 'จำนวนต้องมากกว่า 0';
    if (!DATE.test(input.date ?? '')) errors['date'] = 'กรุณาระบุวันที่';
    else if (input.date! > todayIso()) errors['date'] = 'วันที่ต้องไม่เกินวันนี้';
    tooLong(errors, 'note', text(input.note), 500);
    if (Object.keys(errors).length) return fail(422, 'ข้อมูลไม่ถูกต้อง', errors);

    const key = materialKey({ ...(material ? { materialCode: material.code } : {}), name, unit });
    if (type === 'issue') {
        const available = stockOf(key);
        if (quantity > available + 1e-9) return fail(409, 'ของในคลังหลักไม่พอ', { quantity: `คงเหลือในคลังหลัก ${available} ${unit}` });
    } else {
        const used = materialUsage(code).rows.find((item) => item.key === key)?.usedQuantity ?? 0;
        if (quantity > used + 1e-9) return fail(409, 'ส่งคืนเกินจำนวนที่โครงการรับไว้', { quantity: `โครงการนี้มี ${name} อยู่ ${used} ${unit}` });
    }
    const now = new Date();
    const movement: ApiSchemas['StockMovement'] = {
        id: nextNumber('SM', stockMovements.map((item) => item.id)),
        projectCode: code,
        type: type!,
        ...(material ? { materialCode: material.code } : {}),
        name,
        unit,
        quantity: round2(quantity),
        date: input.date!,
        ...(text(input.note) ? { note: text(input.note) } : {}),
        recordedBy: author(),
        recordedAt: now.toISOString()
    };
    stockMovements.push(movement);
    recordAudit({ module: 'procurement', action: type === 'return' ? 'ส่งของเหลือเข้าคลังหลัก' : 'เบิกวัสดุจากคลังหลัก', target: `${code} ${movement.id}`, detail: `${name} ${movement.quantity} ${unit}${movement.note ? ` · ${movement.note}` : ''}` });
    return { ok: movement };
}

export const hasBoq = (code: string) => boqs.has(code);

// ใบขอซื้อ: ล่าสุดก่อนเมื่อโหลด, การเช่า: ล่าสุดก่อน
persistArray('purchase_requests', purchases, (item) => item.id, (a, b) => b.requestedAt.localeCompare(a.requestedAt));
persistArray('rentals', rentals, (item) => item.id, (a, b) => b.requestedAt.localeCompare(a.requestedAt));
