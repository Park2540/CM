/** การรับชำระเงินงวดงานจากลูกค้า (พร้อมหลักฐาน) — งวดจะเป็น "ชำระแล้ว" เมื่อมีการบันทึกรับชำระที่ยังไม่ถูกยกเลิกเท่านั้น */
import { persistMap } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';

type UserRef = ApiSchemas['UserRef'];

export type PaymentRecord = ApiSchemas['InstallmentPayment'] & {
    /** งวดตามสัญญา = 'no:3', งวดงานเพิ่ม-ลด = 'co:CO-CR690002-01' (เลขงวดของงานเพิ่ม-ลดเลื่อนได้ จึงผูกกับรหัสงานเพิ่ม-ลด) */
    key: string;
    installmentNo: number;
    cancelledAt?: string;
    cancelledBy?: UserRef;
    cancelReason?: string;
};

/** รายการรับชำระต่อโครงการ (รวมรายการที่ยกเลิกแล้ว เก็บไว้เป็นประวัติ) */
const ledgers = new Map<string, PaymentRecord[]>();

export const installmentKey = (installment: { no: number; changeOrderId?: string }) => (installment.changeOrderId ? `co:${installment.changeOrderId}` : `no:${installment.no}`);

/** โครงการนี้มีสมุดรับชำระแล้วหรือยัง (ยังไม่มี = ต้องสร้างจากข้อมูลเดิมก่อน) */
export const hasLedger = (code: string) => ledgers.has(code);

/** สร้างสมุดรับชำระครั้งแรกของโครงการ (ไม่ทับของเดิม) */
export function initLedger(code: string, records: PaymentRecord[]) {
    if (!ledgers.has(code)) ledgers.set(code, records);
}

/** การรับชำระที่มีผลอยู่ของแต่ละงวด (key → รายการ) */
export function activePayments(code: string): Map<string, PaymentRecord> {
    return new Map((ledgers.get(code) ?? []).filter((record) => !record.cancelledAt).map((record) => [record.key, record]));
}

export function addPayment(code: string, record: PaymentRecord) {
    if (!ledgers.has(code)) ledgers.set(code, []);
    ledgers.get(code)!.push(record);
}

export function cancelPayment(code: string, key: string, by: UserRef, reason: string): PaymentRecord | undefined {
    const record = activePayments(code).get(key);
    if (record) Object.assign(record, { cancelledAt: new Date().toISOString(), cancelledBy: by, cancelReason: reason });
    return record;
}

/** ตัดฟิลด์ภายในออกก่อนส่งให้หน้าบ้าน */
export function toApiPayment({ key: _key, installmentNo: _no, cancelledAt: _at, cancelledBy: _by, cancelReason: _reason, ...payment }: PaymentRecord): ApiSchemas['InstallmentPayment'] {
    return payment;
}

persistMap('installment_payments', ledgers);
