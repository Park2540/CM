import { persistArray } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { approvalLevel, approvals } from './approvals.js';
import { recordAudit } from './audit-logs.js';
import type { Outcome } from './project-team.js';
import { PROJECT_SEED } from './project-seed.js';
import { findContracted, getTimeline, isConfigured, recalculate, todayIso } from './projects.js';
import { CURRENT_USER, USERS, as } from './users.js';
import { hoursAgo } from './utils.js';

type ChangeOrder = ApiSchemas['ChangeOrder'];
type ChangeOrderInput = ApiSchemas['ChangeOrderInput'];
type Approval = ApiSchemas['Approval'];
type Problem = { status: 400 | 403 | 404 | 409 | 422; title: string; detail?: string; errors?: Record<string, string> };

const DAY_MS = 86_400_000;
const SOURCES: ChangeOrder['source'][] = ['customer', 'site', 'design'];
export const SOURCE_LABEL: Record<ChangeOrder['source'], string> = { customer: 'ลูกค้าขอ', site: 'ปรับแก้หน้างาน', design: 'แก้แบบ' };

const money = (value: number) => `฿${Math.abs(value).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
const signed = (value: number) => `${value < 0 ? '−' : '+'}${money(value)}`;
const addDays = (isoDate: string, days: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const round2 = (value: number) => Math.round(value * 100) / 100;
const author = (): ApiSchemas['UserRef'] => ({ id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel });

function totals(items: ChangeOrderInput['items']) {
    const sum = (kind: 'add' | 'deduct') => round2(items.filter((item) => item.kind === kind).reduce((total, item) => total + item.quantity * item.unitPrice, 0));
    const addTotal = sum('add');
    const deductTotal = sum('deduct');
    return { addTotal, deductTotal, total: round2(addTotal - deductTotal) };
}

/** รายการในศูนย์อนุมัติ: งานลดเป็นราคาติดลบ ให้ยอดรวมตรงกับยอดสุทธิ */
const approvalItems = (items: ChangeOrderInput['items']): Approval['items'] =>
    items.map((item) => ({ name: item.kind === 'deduct' ? `(หักลด) ${item.name}` : item.name, quantity: item.quantity, unit: item.unit, unitPrice: item.kind === 'deduct' ? -item.unitPrice : item.unitPrice }));

// ---------- ข้อมูลตั้งต้น: งานเพิ่มหลังคากันสาดของ CR690002 (ผูกกับคำขออนุมัติ CO-6910-0003) ----------

const SEED_ITEMS: ChangeOrderInput['items'] = [
    { name: 'โครงเหล็กกันสาดพร้อมทาสีกันสนิม', kind: 'add', quantity: 1, unit: 'งาน', unitPrice: 28_500 },
    { name: 'แผ่นหลังคาโพลีคาร์บอเนต', kind: 'add', quantity: 18, unit: 'ตร.ม.', unitPrice: 950 }
];

export const changeOrders: ChangeOrder[] = [
    {
        id: 'CO-CR690002-01',
        projectCode: 'CR690002',
        title: 'ลูกค้าขอเพิ่มหลังคากันสาดหน้าบ้าน',
        source: 'customer',
        reason: 'ลูกค้าแจ้งความต้องการเพิ่มเติมหลังเห็นงานโครงสร้าง',
        items: SEED_ITEMS,
        ...totals(SEED_ITEMS),
        scheduleImpactDays: 7,
        newTask: { phaseCode: '07', name: 'ติดตั้งหลังคากันสาดหน้าบ้าน (งานเพิ่ม)', durationDays: 5 },
        customerConfirmed: true,
        customerConfirmedAt: hoursAgo(22),
        status: 'pending',
        requestedBy: as(USERS.pimchanok, 'ผู้จัดการโครงการ'),
        requestedAt: hoursAgo(20),
        approvalId: 'CO-6910-0003'
    }
];
for (const order of changeOrders) {
    const approval = approvals.find((item) => item.id === order.approvalId);
    if (approval) approval.changeOrderId = order.id;
}

export const listChangeOrders = (code: string) => changeOrders.filter((order) => order.projectCode === code).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
const findOrder = (code: string, id: string) => changeOrders.find((order) => order.projectCode === code && order.id === id);

// ---------- ตรวจข้อมูล ----------

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function validate(code: string, input: Partial<ChangeOrderInput>): { errors: Record<string, string>; value?: ChangeOrderInput } {
    const errors: Record<string, string> = {};
    const items = Array.isArray(input.items) ? input.items : [];
    if (!text(input.title)) errors['title'] = 'กรุณาระบุชื่อรายการ';
    if (!SOURCES.includes(input.source as ChangeOrder['source'])) errors['source'] = 'กรุณาเลือกที่มาของการเปลี่ยนแปลง';
    if (!text(input.reason)) errors['reason'] = 'กรุณาระบุเหตุผล';
    if (!items.length) errors['items'] = 'กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ';
    items.forEach((item, index) => {
        const key = `items.${index}`;
        if (!text(item?.name)) errors[key] = 'กรุณาระบุรายละเอียดงาน';
        else if (item.kind !== 'add' && item.kind !== 'deduct') errors[key] = 'กรุณาเลือกเพิ่มหรือลด';
        else if (!(Number(item.quantity) > 0)) errors[key] = 'จำนวนต้องมากกว่า 0';
        else if (!text(item.unit)) errors[key] = 'กรุณาระบุหน่วย';
        else if (!(Number(item.unitPrice) >= 0)) errors[key] = 'ราคาต่อหน่วยต้องไม่ติดลบ';
    });
    const days = Number(input.scheduleImpactDays ?? 0);
    if (!Number.isInteger(days) || days < -60 || days > 365) errors['scheduleImpactDays'] = 'ผลต่อกำหนดส่งมอบต้องอยู่ระหว่าง -60 ถึง 365 วัน';
    if (input.newTask) {
        const phases = getTimeline(code)?.phases ?? [];
        if (!phases.some((phase) => phase.code === input.newTask!.phaseCode)) errors['newTask'] = 'ไม่พบขั้นตอนนี้ในไทม์ไลน์';
        else if (!text(input.newTask.name)) errors['newTask'] = 'กรุณาระบุชื่องานที่จะเพิ่มในไทม์ไลน์';
        else if (!Number.isInteger(input.newTask.durationDays) || input.newTask.durationDays < 1 || input.newTask.durationDays > 120) errors['newTask'] = 'ระยะเวลางานต้องเป็น 1-120 วัน';
    }
    if (Object.keys(errors).length) return { errors };
    const cleanItems = items.map((item) => ({ name: text(item.name), kind: item.kind, quantity: Number(item.quantity), unit: text(item.unit), unitPrice: Number(item.unitPrice) }));
    if (totals(cleanItems).addTotal === 0 && totals(cleanItems).deductTotal === 0) return { errors: { items: 'ยอดรวมต้องไม่เป็น 0' } };
    return {
        errors,
        value: {
            title: text(input.title),
            source: input.source as ChangeOrder['source'],
            reason: text(input.reason),
            items: cleanItems,
            scheduleImpactDays: days,
            ...(input.newTask ? { newTask: { phaseCode: input.newTask.phaseCode, name: text(input.newTask.name), durationDays: input.newTask.durationDays } } : {}),
            customerConfirmed: input.customerConfirmed === true
        }
    };
}

/** เลขคำขออนุมัติ: CO-<ปี พ.ศ. 2 หลัก><เดือน>-<ลำดับ 4 หลัก> ต่อเนื่องจากคำขอเดิม */
function nextApprovalId(): string {
    const now = new Date();
    const prefix = `CO-${String(now.getFullYear() + 543).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
    const highest = Math.max(0, ...approvals.filter((item) => item.id.startsWith('CO-')).map((item) => Number(item.id.slice(-4)) || 0));
    return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

// ---------- คำสั่ง ----------

export function createChangeOrder(code: string, input: Partial<ChangeOrderInput>): Outcome<ChangeOrder> | Problem {
    if (!findContracted(code)) return { status: 409, title: 'โครงการยังไม่ได้บันทึกสัญญา' };
    if (!isConfigured(code)) return { status: 409, title: 'ยังไม่ได้ตั้งค่างานก่อสร้าง', detail: 'ตั้งค่างานก่อสร้างเพื่อสร้างไทม์ไลน์ก่อน' };
    const { errors, value } = validate(code, input);
    if (!value) return { status: 422, title: 'ข้อมูลไม่ถูกต้อง', detail: Object.values(errors)[0], errors };

    const sequence = changeOrders.filter((order) => order.projectCode === code).length + 1;
    const now = new Date().toISOString();
    const amounts = totals(value.items);
    const approvalId = nextApprovalId();
    const order: ChangeOrder = {
        ...value,
        ...amounts,
        id: `CO-${code}-${String(sequence).padStart(2, '0')}`,
        projectCode: code,
        status: 'pending',
        requestedBy: author(),
        requestedAt: now,
        approvalId,
        ...(value.customerConfirmed ? { customerConfirmedAt: now } : {})
    };
    changeOrders.push(order);
    approvals.unshift({
        id: approvalId,
        type: 'change-order',
        projectCode: code,
        title: value.title,
        reason: `${SOURCE_LABEL[value.source]}: ${value.reason}`,
        amount: amounts.total,
        requestedBy: author(),
        requestedAt: now,
        status: 'pending',
        approvalLevel: approvalLevel('change-order', Math.abs(amounts.total)),
        items: approvalItems(value.items),
        history: [{ action: 'submitted', user: author(), at: now, note: value.reason }],
        changeOrderId: order.id
    });
    recordAudit({
        module: 'project',
        action: 'ขอเพิ่ม-ลดงาน',
        target: `${code} ${order.id}`,
        detail: `${value.title} · สุทธิ ${signed(amounts.total)}${value.scheduleImpactDays ? ` · กำหนดส่งมอบ ${value.scheduleImpactDays > 0 ? '+' : ''}${value.scheduleImpactDays} วัน` : ''}`
    });
    return { ok: order };
}

export function confirmByCustomer(code: string, id: string): Outcome<ChangeOrder> | Problem {
    const order = findOrder(code, id);
    if (!order) return { status: 404, title: 'ไม่พบรายการงานเพิ่ม-ลด' };
    if (order.status !== 'pending') return { status: 409, title: 'รายการนี้ไม่ได้รออนุมัติแล้ว' };
    if (order.customerConfirmed) return { status: 409, title: 'ลูกค้ายืนยันไว้แล้ว' };
    order.customerConfirmed = true;
    order.customerConfirmedAt = new Date().toISOString();
    recordAudit({ module: 'project', action: 'ลูกค้ายืนยันงานเพิ่ม-ลด', target: `${code} ${order.id}`, detail: order.title });
    return { ok: order };
}

export function cancelChangeOrder(code: string, id: string, reason?: string): Outcome<ChangeOrder> | Problem {
    const order = findOrder(code, id);
    if (!order) return { status: 404, title: 'ไม่พบรายการงานเพิ่ม-ลด' };
    if (order.status !== 'pending') return { status: 409, title: 'ยกเลิกได้เฉพาะรายการที่รออนุมัติ' };
    const note = text(reason) || 'ยกเลิกโดยผู้ขอ';
    Object.assign(order, { status: 'cancelled', decidedAt: new Date().toISOString(), decidedBy: author(), decisionNote: note });
    const approval = approvals.find((item) => item.id === order.approvalId);
    if (approval?.status === 'pending') {
        approval.status = 'rejected';
        approval.history.push({ action: 'rejected', user: author(), at: order.decidedAt!, note: `ยกเลิกคำขอ: ${note}` });
    }
    recordAudit({ module: 'project', action: 'ยกเลิกงานเพิ่ม-ลด', target: `${code} ${order.id}`, detail: note });
    return { ok: order };
}

/** ตรวจก่อนอนุมัติในศูนย์อนุมัติ: งานที่ลูกค้าขอต้องให้ลูกค้ายืนยันก่อน */
/** งานเพิ่ม-ลดที่ผูกกับคำขออนุมัตินี้ (หาจาก approvalId ใช้ได้กับคำขอเดิมที่ไม่มี changeOrderId) */
const orderOf = (approval: Approval) => changeOrders.find((item) => item.approvalId === approval.id);

export function blockApproval(approval: Approval): Problem | null {
    const order = orderOf(approval);
    if (order?.source === 'customer' && !order.customerConfirmed) return { status: 409, title: 'รอลูกค้ายืนยันงานเพิ่ม-ลด', detail: 'บันทึกการยืนยันของลูกค้าที่แท็บงานเพิ่ม-ลดของโครงการก่อนอนุมัติ' };
    return null;
}

/** หลังตัดสินในศูนย์อนุมัติ: อนุมัติ = ปรับมูลค่าสัญญา กำหนดส่งมอบ และไทม์ไลน์ของโครงการ */
export function applyDecision(approval: Approval, status: 'approved' | 'rejected', note?: string) {
    const order = orderOf(approval);
    if (!order || order.status !== 'pending') return;
    Object.assign(order, { status, decidedAt: new Date().toISOString(), decidedBy: author(), ...(note ? { decisionNote: note } : {}) });
    if (status !== 'approved') return;

    const project = PROJECT_SEED.find((item) => item.code === order.projectCode);
    if (!project) return;
    project.changeOrderTotal = round2((project.changeOrderTotal ?? 0) + order.total);
    if (order.scheduleImpactDays && project.deliveryDate) {
        order.deliveryDateBefore = project.deliveryDate;
        project.deliveryDate = addDays(project.deliveryDate, order.scheduleImpactDays);
        order.deliveryDateAfter = project.deliveryDate;
    }
    if (order.newTask) order.appliedTaskCode = addTimelineTask(order);
    recordAudit({
        module: 'project',
        action: 'อนุมัติงานเพิ่ม-ลด',
        target: `${order.projectCode} ${order.id}`,
        detail: `มูลค่าสัญญา ${signed(order.total)}${order.deliveryDateAfter ? ` · ส่งมอบ ${order.deliveryDateAfter}` : ''}${order.appliedTaskCode ? ` · เพิ่มงาน ${order.appliedTaskCode}` : ''}`
    });
}

/** เพิ่มงานท้ายขั้นตอน (ก่อนหมุดหมาย) เริ่มวันนี้หรือหลังงานสุดท้ายของขั้นตอน แล้วคำนวณ % ใหม่ */
function addTimelineTask(order: ChangeOrder): string | undefined {
    const timeline = getTimeline(order.projectCode);
    const phase = timeline?.phases.find((item) => item.code === order.newTask!.phaseCode);
    if (!timeline || !phase) return undefined;
    const count = phase.tasks.filter((task) => task.code.startsWith(`${phase.code}.CO`)).length + 1;
    const code = `${phase.code}.CO${count}`;
    const work = phase.tasks.filter((task) => !task.isMilestone);
    const lastEnd = work.reduce((latest, task) => (task.end > latest ? task.end : latest), phase.start);
    // วันที่ช้าที่สุดของ: วันนี้, วันถัดจากงานสุดท้ายในขั้นตอน, วันเริ่มขั้นตอน (วันที่ ISO เทียบเป็นข้อความได้)
    const start = [todayIso(), addDays(lastEnd, 1), phase.start].sort().at(-1)!;
    const end = addDays(start, order.newTask!.durationDays - 1);
    const task: ApiSchemas['TimelineTask'] = {
        code,
        name: order.newTask!.name,
        team: 'งานเพิ่ม-ลด',
        note: `ตาม ${order.id}`,
        start,
        end,
        progress: 0,
        status: 'pending',
        isHoldPoint: false,
        isMilestone: false,
        isPaymentMilestone: false,
        involvesOwner: false
    };
    const milestoneIndex = phase.tasks.findIndex((item) => item.isMilestone);
    phase.tasks.splice(milestoneIndex >= 0 ? milestoneIndex : phase.tasks.length, 0, task);
    if (end > phase.end) phase.end = end;
    recalculate(timeline);
    return code;
}

/** งวดเงินของงานเพิ่ม-ลดที่อนุมัติแล้ว (ต่อท้ายงวดตามสัญญา) */
export function changeOrderInstallments(code: string, startNo: number, contractValue: number): ApiSchemas['Installment'][] {
    return changeOrders
        .filter((order) => order.projectCode === code && order.status === 'approved' && order.total !== 0)
        .sort((a, b) => (a.decidedAt ?? '').localeCompare(b.decidedAt ?? ''))
        .map((order, index) => ({
            no: startNo + index,
            title: order.total > 0 ? `งานเพิ่ม ${order.id}: ${order.title}` : `งานลด ${order.id}: ${order.title} (หักจากงวดสุดท้าย)`,
            phaseSteps: [],
            percent: contractValue ? round2((order.total / contractValue) * 100) : 0,
            amount: order.total,
            // งานเพิ่ม: เรียกเก็บ 7 วันหลังอนุมัติ / งานลด: หักตอนเก็บงวดสุดท้าย
            status: order.total > 0 ? 'due' : 'upcoming',
            dueDate: addDays((order.decidedAt ?? order.requestedAt).slice(0, 10), 7),
            paidDate: null,
            changeOrderId: order.id
        }));
}

persistArray('change_orders', changeOrders, (order) => order.id);
