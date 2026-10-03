import { persistArray, persistObject } from '../db/state.js';
import type { ApiSchemas } from '../api/api.js';
import { hoursAgo } from './utils.js';
import { USERS, as } from './users.js';

type Approval = ApiSchemas['Approval'];
type UserRef = ApiSchemas['UserRef'];

export const approvalSettings: ApiSchemas['ApprovalSettings'] = { projectManagerLimit: 50_000, changeOrderRequiresOwner: true };

/** กฎของหลังบ้าน: ยอดเกินวงเงินผู้จัดการโครงการ หรืองานเพิ่ม-ลด ต้องให้เจ้าของอนุมัติ */
export function approvalLevel(type: Approval['type'], amount: number): Approval['approvalLevel'] {
    if (type === 'change-order' && approvalSettings.changeOrderRequiresOwner) return 'owner';
    return amount > approvalSettings.projectManagerLimit ? 'owner' : 'project-manager';
}

interface Seed {
    id: string;
    type: Approval['type'];
    projectCode: string;
    title: string;
    reason?: string;
    requestedBy: UserRef;
    requestedHoursAgo: number;
    items: Approval['items'];
    decision?: { status: 'approved' | 'rejected'; by: UserRef; hoursAgo: number; note?: string };
}

function build(seed: Seed): Approval {
    const amount = seed.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const requestedAt = hoursAgo(seed.requestedHoursAgo);
    const history: Approval['history'] = [{ action: 'submitted', user: seed.requestedBy, at: requestedAt, note: seed.reason }];
    if (seed.decision) history.push({ action: seed.decision.status, user: seed.decision.by, at: hoursAgo(seed.decision.hoursAgo), note: seed.decision.note });
    return {
        id: seed.id,
        type: seed.type,
        projectCode: seed.projectCode,
        title: seed.title,
        reason: seed.reason,
        amount,
        requestedBy: seed.requestedBy,
        requestedAt,
        status: seed.decision?.status ?? 'pending',
        approvalLevel: approvalLevel(seed.type, amount),
        items: seed.items,
        history
    };
}

const pm = (user: UserRef) => as(user, 'ผู้จัดการโครงการ');

export const approvals: Approval[] = [
    build({
        id: 'PR-6910-0036',
        type: 'pr',
        projectCode: 'CR690001',
        title: 'กระเบื้องพื้นและผนังห้องน้ำชั้น 2',
        reason: 'ใช้สำหรับงานตกแต่งชั้น 2 ตามแผนเริ่ม 8 ต.ค.',
        requestedBy: USERS.thanakrit,
        requestedHoursAgo: 3,
        items: [
            { name: 'กระเบื้องพื้นแกรนิตโต้ 60×60 ซม.', quantity: 85, unit: 'ตร.ม.', unitPrice: 420 },
            { name: 'กระเบื้องผนังเซรามิก 30×60 ซม.', quantity: 120, unit: 'ตร.ม.', unitPrice: 310 },
            { name: 'กาวซีเมนต์ปูกระเบื้อง', quantity: 60, unit: 'ถุง', unitPrice: 185 }
        ]
    }),
    build({
        id: 'SC-6910-0014',
        type: 'subcontract',
        projectCode: 'BKK690001',
        title: 'เบิกงวดที่ 3 ผู้รับเหมางานระบบไฟฟ้า',
        reason: 'งานร้อยสายและติดตั้งตู้ไฟชั้น 1-2 ตรวจรับแล้ว',
        requestedBy: USERS.nattapol,
        requestedHoursAgo: 6,
        items: [{ name: 'งวดที่ 3 งานระบบไฟฟ้า (30% ของสัญญา ฿620,000)', quantity: 1, unit: 'งวด', unitPrice: 186_000 }]
    }),
    build({
        id: 'CO-6910-0003',
        type: 'change-order',
        projectCode: 'CR690002',
        title: 'ลูกค้าขอเพิ่มหลังคากันสาดหน้าบ้าน',
        reason: 'ลูกค้าแจ้งความต้องการเพิ่มเติมหลังเห็นงานโครงสร้าง',
        requestedBy: pm(USERS.pimchanok),
        requestedHoursAgo: 20,
        items: [
            { name: 'โครงเหล็กกันสาดพร้อมทาสีกันสนิม', quantity: 1, unit: 'งาน', unitPrice: 28_500 },
            { name: 'แผ่นหลังคาโพลีคาร์บอเนต', quantity: 18, unit: 'ตร.ม.', unitPrice: 950 }
        ]
    }),
    build({
        id: 'PO-6910-0008',
        type: 'po',
        projectCode: 'CNX690001',
        title: 'เสาเข็มเจาะ ขนาด 35 ซม.',
        reason: 'เปรียบเทียบราคา 3 ราย เลือกรายที่ราคาต่ำสุดและส่งงานได้ตามแผน',
        requestedBy: USERS.pimchanok,
        requestedHoursAgo: 28,
        items: [{ name: 'เสาเข็มเจาะ Ø35 ซม. ลึก 18 ม.', quantity: 24, unit: 'ต้น', unitPrice: 9_800 }]
    }),
    build({
        id: 'PR-6910-0035',
        type: 'pr',
        projectCode: 'CR690002',
        title: 'เหล็กเสริม DB16 สำหรับคานชั้น 2',
        requestedBy: pm(USERS.pimchanok),
        requestedHoursAgo: 30,
        items: [
            { name: 'เหล็กข้ออ้อย DB16 SD40 ยาว 10 ม.', quantity: 180, unit: 'เส้น', unitPrice: 395 },
            { name: 'ลวดผูกเหล็ก', quantity: 20, unit: 'ม้วน', unitPrice: 120 }
        ]
    }),
    build({
        id: 'RT-6910-0002',
        type: 'rental',
        projectCode: 'BKK690001',
        title: 'เช่านั่งร้านเพิ่ม 2 เดือน',
        requestedBy: USERS.nattapol,
        requestedHoursAgo: 44,
        items: [{ name: 'นั่งร้านเหล็ก ชุดละ 2 ขา (ค่าเช่า/เดือน)', quantity: 120, unit: 'ชุด-เดือน', unitPrice: 85 }]
    }),
    build({
        id: 'PC-6910-0011',
        type: 'petty-cash',
        projectCode: 'CR690001',
        title: 'ค่าน้ำมันรถขนวัสดุและค่าแรงล่วงเวลา',
        requestedBy: USERS.thanakrit,
        requestedHoursAgo: 50,
        items: [
            { name: 'ค่าน้ำมันรถกระบะ', quantity: 1, unit: 'รายการ', unitPrice: 3_200 },
            { name: 'ค่าแรงล่วงเวลาทีมเทคอนกรีต', quantity: 8, unit: 'คน', unitPrice: 450 }
        ]
    }),
    build({
        id: 'SC-6909-0012',
        type: 'subcontract',
        projectCode: 'CR690001',
        title: 'เบิกงวดผู้รับเหมาช่วงงานหลังคา',
        requestedBy: USERS.thanakrit,
        requestedHoursAgo: 96,
        items: [{ name: 'งวดงานมุงหลังคาและรางน้ำ', quantity: 1, unit: 'งวด', unitPrice: 142_000 }],
        decision: { status: 'approved', by: USERS.owner, hoursAgo: 75, note: 'ตรวจรับงานหลังคาผ่านแล้ว' }
    }),
    build({
        id: 'PR-6909-0031',
        type: 'pr',
        projectCode: 'CR690001',
        title: 'ปูนฉาบสำเร็จรูป',
        requestedBy: USERS.thanakrit,
        requestedHoursAgo: 10,
        items: [{ name: 'ปูนฉาบสำเร็จรูป 50 กก.', quantity: 120, unit: 'ถุง', unitPrice: 155 }],
        decision: { status: 'approved', by: USERS.thanakrit, hoursAgo: 5 }
    }),
    build({
        id: 'PO-6909-0019',
        type: 'po',
        projectCode: 'CNX690001',
        title: 'เครื่องปรับอากาศ 4 ชุด (ยี่ห้อนอกสเปก)',
        requestedBy: USERS.pimchanok,
        requestedHoursAgo: 150,
        items: [{ name: 'เครื่องปรับอากาศ Inverter 18,000 BTU', quantity: 4, unit: 'ชุด', unitPrice: 21_900 }],
        decision: { status: 'rejected', by: USERS.owner, hoursAgo: 140, note: 'ไม่ตรงกับรายการประกอบแบบ ให้เสนอยี่ห้อตามสเปกใหม่' }
    })
];

persistArray('approvals', approvals, (item) => item.id);
persistObject('approval_settings', approvalSettings);
