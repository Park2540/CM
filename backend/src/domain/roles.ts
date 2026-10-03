import type { ApiSchemas } from '../api/api.js';

/** ตารางบทบาทและสิทธิ์ตามที่บริษัทกำหนด (GET /roles) — permissions คือสิทธิ์ตั้งต้นของบทบาท ปรับรายคนได้ที่บัญชีผู้ใช้ */
export const ROLE_CATALOG: ApiSchemas['RoleCatalog'] = {
    groups: [
        { id: 'internal', label: 'ทีมภายในบริษัท', scope: 'เห็นได้ทุกโครงการ ตามระบบย่อยที่ได้สิทธิ์' },
        { id: 'project', label: 'ทีมประจำโครงการ', scope: 'เห็นเฉพาะโครงการที่ถูกเพิ่มเป็นสมาชิก' },
        { id: 'external', label: 'บุคคลภายนอก', scope: 'เห็นเฉพาะส่วนของตนเอง' }
    ],
    roles: [
        {
            id: 'admin',
            group: 'internal',
            label: 'แอดมิน',
            access: 'ตั้งค่าระบบ จัดการผู้ใช้ สิทธิ์ โครงการ ข้อมูลหลัก (วัสดุ ผู้ขาย เกณฑ์อนุมัติ)',
            restriction: 'ไม่อนุมัติเงินแทนใคร และดูข้อมูลการเงินเฉพาะที่ได้รับสิทธิ์',
            permissions: ['project.create', 'project.manage', 'user.manage']
        },
        {
            id: 'owner',
            group: 'internal',
            label: 'เจ้าของบริษัท',
            access: 'ทุกระบบย่อยและทุกโครงการ อนุมัติทุกยอด ดู Dashboard กำไร-ขาดทุน',
            restriction: 'ไม่มี (แต่ทุกการกระทำมีบันทึกประวัติ)',
            permissions: ['progress.update', 'personnel.sensitive', 'finance.company', 'approval.any', 'project.create', 'project.manage', 'user.manage']
        },
        { id: 'admin-staff', group: 'internal', label: 'ธุรการ', access: 'เอกสาร สัญญา จดหมายโต้ตอบ ทะเบียนบุคลากร ทะเบียนครุภัณฑ์ (ดู/แก้ข้อมูลทั่วไป)', restriction: 'ไม่เห็นราคาต้นทุนและกำไร', permissions: [] },
        {
            id: 'accounting',
            group: 'internal',
            label: 'บัญชี/การเงิน',
            access: 'ตรวจใบแจ้งหนี้ (3-way match) จ่ายเงิน ลูกหนี้-เจ้าหนี้ งวดงาน ภาษี ค่าเช่าสะสม',
            restriction: 'ไม่สร้างหรืออนุมัติ PR/PO',
            permissions: ['finance.company', 'personnel.sensitive']
        },
        { id: 'procurement', group: 'internal', label: 'ฝ่ายจัดซื้อ', access: 'PR ทุกโครงการ ขอราคา เปรียบเทียบ ออก PO ทำสัญญาเช่า ฐานข้อมูลผู้ขาย', restriction: 'ไม่อนุมัติ ไม่จ่ายเงิน', permissions: [] },
        { id: 'storekeeper', group: 'internal', label: 'ผู้ดูแลคลัง/เครื่องมือ', access: 'รับของ สต็อก ยืม-คืนเครื่องมือ ทะเบียนครุภัณฑ์ ป้าย QR', restriction: 'ไม่เห็นราคา', permissions: [], suggested: true },
        { id: 'auditor', group: 'internal', label: 'ผู้ตรวจสอบ/ที่ปรึกษา', access: 'ดูอย่างเดียวทั้งระบบหรือบางโครงการ', restriction: 'แก้ไขอะไรไม่ได้', permissions: ['finance.company'], suggested: true },
        {
            id: 'project-manager',
            group: 'project',
            label: 'ผู้จัดการโครงการ',
            access: 'ทุกอย่างในโครงการตน: แผนงาน BOQ งบ PR อนุมัติ ≤ เกณฑ์ (ตัวอย่าง ฿50,000) เช่าอุปกรณ์ รายงาน',
            restriction: 'ยอดเกินเกณฑ์ส่งเจ้าของอนุมัติ',
            permissions: ['progress.update', 'project.manage']
        },
        { id: 'engineer', group: 'project', label: 'วิศวกร', access: 'แบบ แผนงาน งานตรวจรับ ปัญหาคุณภาพ ขอเปลี่ยนแปลงงาน ดู BOQ', restriction: 'ไม่เห็นข้อมูลต้นทุนบริษัท ไม่อนุมัติจัดซื้อ', permissions: ['progress.update'] },
        { id: 'architect', group: 'project', label: 'สถาปนิก', access: 'แบบสถาปัตย์ ข้อกำหนดวัสดุ การอนุมัติแบบกับลูกค้า', restriction: 'เหมือนวิศวกร', permissions: ['progress.update'] },
        {
            id: 'foreman',
            group: 'project',
            label: 'โฟร์แมน',
            access: 'บันทึกความคืบหน้ารายวัน รูปหน้างาน ขอซื้อ (PR) รับของ รับ-คืนของเช่า เช็กชื่อแรงงาน',
            restriction: 'ไม่เห็นราคา งบ หรืออัตราเช่า และเห็นเฉพาะโครงการของตน',
            permissions: ['progress.update']
        },
        { id: 'safety-officer', group: 'project', label: 'เจ้าหน้าที่ความปลอดภัย (จป.)', access: 'รายงานความปลอดภัย อุบัติเหตุ ตรวจนั่งร้าน', restriction: 'ไม่เห็นการเงิน', permissions: [], suggested: true },
        { id: 'subcontractor', group: 'external', label: 'ผู้รับเหมาช่วง', access: 'งานที่ได้รับมอบ ความคืบหน้าของตน ส่งงวดงาน/ใบเรียกเก็บ ดูแบบที่เกี่ยวข้อง', restriction: 'ไม่เห็นผู้รับเหมารายอื่น ไม่เห็นงบรวม', permissions: [] },
        { id: 'client', group: 'external', label: 'ลูกค้า/เจ้าของโครงการ', access: 'ไทม์ไลน์ความคืบหน้า รูปถ่าย เอกสารส่งมอบ งวดชำระเงิน อนุมัติแบบและงานเพิ่ม-ลด', restriction: 'ไม่เห็นต้นทุนจริง ราคาซื้อ หรือกำไร', permissions: [] },
        { id: 'supplier', group: 'external', label: 'ผู้ขาย/ผู้ให้เช่า', access: 'ระยะแรกไม่ต้องล็อกอิน รับ RFQ/PO ทางอีเมลหรือ LINE', restriction: 'ถ้าอยากเปิดภายหลัง ให้ส่งใบเสนอราคาและดูสถานะวางบิลได้เท่านั้น', permissions: [], optional: true }
    ]
};

export const findRole = (id: string) => ROLE_CATALOG.roles.find((role) => role.id === id);
