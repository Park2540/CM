import { ApiSchemas } from '@/app/api/api';
import { hoursAgo } from '../utils';
import { CURRENT_USER, USERS, as } from './users';

type AuditEntry = ApiSchemas['AuditEntry'];

const seed: Omit<AuditEntry, 'id'>[] = [
    { at: hoursAgo(2), user: USERS.pimchanok, module: 'procurement', action: 'สร้างใบสั่งซื้อ', target: 'PO-6910-0007', detail: 'คอนกรีตผสมเสร็จ 240 ksc โครงการ CR690002' },
    { at: hoursAgo(5), user: USERS.thanakrit, module: 'approval', action: 'อนุมัติ', target: 'PR-6909-0031', detail: 'อนุมัติภายในวงเงินผู้จัดการโครงการ ฿18,600' },
    { at: hoursAgo(9), user: USERS.arunee, module: 'finance', action: 'บันทึกรับชำระเงิน', target: 'CR690001 งวดที่ 5', detail: 'รับโอนจากลูกค้า ฿385,000' },
    { at: hoursAgo(26), user: USERS.nattapol, module: 'project', action: 'อัปเดตความคืบหน้า', target: 'BKK690001', detail: 'ความคืบหน้ารวม 89% → 91%' },
    { at: hoursAgo(30), user: as(USERS.pimchanok, 'ผู้จัดการโครงการ'), module: 'procurement', action: 'ส่งขออนุมัติ', target: 'PR-6910-0035', detail: 'เหล็กเสริม DB16 สำหรับคานชั้น 2' },
    { at: hoursAgo(50), user: USERS.admin, module: 'system', action: 'แก้ไขเกณฑ์อนุมัติ', target: 'ผู้จัดการโครงการ', detail: 'วงเงินอนุมัติ ฿50,000 ต่อรายการ' },
    { at: hoursAgo(54), user: USERS.admin, module: 'system', action: 'เพิ่มผู้ใช้', target: 'วรัญญา อินทร์แก้ว', detail: 'บทบาท ผู้จัดการโครงการ (CNX690001)' },
    { at: hoursAgo(75), user: USERS.owner, module: 'approval', action: 'อนุมัติ', target: 'SC-6909-0012', detail: 'เบิกงวดผู้รับเหมาช่วงงานหลังคา ฿142,000' },
    { at: hoursAgo(98), user: USERS.sunisa, module: 'personnel', action: 'แก้ไขข้อมูลบุคลากร', target: 'EMP690002', detail: 'อัปเดตเบอร์ติดต่อฉุกเฉิน' },
    { at: hoursAgo(120), user: USERS.arunee, module: 'finance', action: 'จ่ายเงิน', target: 'PO-6909-0021', detail: 'จ่ายผู้ขายวัสดุก่อสร้าง ฿96,300 (3-way match ผ่าน)' }
];

/** ล่าสุดก่อน */
export const auditLogs: AuditEntry[] = seed.map((entry, index) => ({ ...entry, id: `log-${seed.length - index}` }));

/** หลังบ้านจำลองบันทึก Audit Log ทุกครั้งที่ข้อมูลเปลี่ยน */
export function recordAudit(entry: Pick<AuditEntry, 'module' | 'action' | 'target' | 'detail'>) {
    auditLogs.unshift({ ...entry, id: `log-${auditLogs.length + 1}`, at: new Date().toISOString(), user: { id: CURRENT_USER.id, name: CURRENT_USER.name, roleLabel: CURRENT_USER.roleLabel } });
}
