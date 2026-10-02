import { ApiSchemas } from '@/app/api/api';
import { recordAudit } from './audit-logs';

type Subcontractor = Omit<ApiSchemas['Subcontractor'], 'activeProjects'>;
type SubcontractorInput = ApiSchemas['SubcontractorInput'];

/** ทะเบียนผู้รับเหมาช่วงตัวอย่าง (ข้อมูลสมมติ) */
const subcontractors: Subcontractor[] = [
    { id: 'sub-001', code: 'SUB-001', name: 'หจก. เข็มมั่นคง ฐานราก', trades: ['piling'], contactName: 'วีระ คงทน', phone: '081-700-1001', taxId: '0573560000011', address: 'อ.เมือง จ.เชียงราย', status: 'active' },
    { id: 'sub-002', code: 'SUB-002', name: 'ทีมช่างโครงสร้างสมพงษ์', trades: ['structure', 'masonry'], contactName: 'สมพงษ์ แก้วดี', phone: '081-700-1002', status: 'active' },
    { id: 'sub-003', code: 'SUB-003', name: 'บจก. หลังคาเหนือ', trades: ['roofing', 'waterproofing'], contactName: 'อนุชา ฟ้าใส', phone: '081-700-1003', taxId: '0505561000022', status: 'active' },
    { id: 'sub-004', code: 'SUB-004', name: 'ช่างไฟฟ้าประปา ไพโรจน์', trades: ['electrical', 'plumbing'], contactName: 'ไพโรจน์ สายทอง', phone: '081-700-1004', status: 'active' },
    { id: 'sub-005', code: 'SUB-005', name: 'บจก. เย็นสบาย แอร์', trades: ['hvac'], contactName: 'ชาตรี เย็นใจ', phone: '081-700-1005', taxId: '0505562000033', status: 'active' },
    { id: 'sub-006', code: 'SUB-006', name: 'ร้านอลูมิเนียมกระจก ใสสะอาด', trades: ['aluminium'], contactName: 'มานพ ใสสะอาด', phone: '081-700-1006', status: 'active' },
    { id: 'sub-007', code: 'SUB-007', name: 'ทีมงานตกแต่ง ช่างเอก', trades: ['tiling', 'ceiling', 'painting'], contactName: 'เอกชัย ฝีมือดี', phone: '081-700-1007', status: 'active' },
    { id: 'sub-008', code: 'SUB-008', name: 'ช่างไม้บิลท์อิน ณัฐ', trades: ['carpentry'], contactName: 'ณัฐวัฒน์ ไม้งาม', phone: '081-700-1008', status: 'active' },
    { id: 'sub-009', code: 'SUB-009', name: 'สวนสวย แลนด์สเคป', trades: ['landscape'], contactName: 'บุญมี เขียวขจี', phone: '081-700-1009', status: 'active' },
    { id: 'sub-010', code: 'SUB-010', name: 'บจก. โซลาร์ล้านนา', trades: ['solar', 'electrical'], contactName: 'ปิยะ แสงตะวัน', phone: '081-700-1010', taxId: '0505563000044', status: 'active' },
    { id: 'sub-011', code: 'SUB-011', name: 'ทีมช่างก่อฉาบ ประยูร', trades: ['masonry'], contactName: 'ประยูร ปูนแน่น', phone: '081-700-1011', status: 'inactive', note: 'หยุดรับงานชั่วคราว' }
];

export const findSubcontractor = (id: string) => subcontractors.find((item) => item.id === id);

export function listSubcontractors(activeProjects: (id: string) => number): ApiSchemas['Subcontractor'][] {
    return subcontractors.map((item) => ({ ...item, activeProjects: activeProjects(item.id) }));
}

const PHONE = /^0\d{8,9}$/;
const TRADES: ApiSchemas['SubcontractorTrade'][] = [
    'piling',
    'structure',
    'masonry',
    'roofing',
    'waterproofing',
    'electrical',
    'plumbing',
    'hvac',
    'aluminium',
    'tiling',
    'ceiling',
    'painting',
    'carpentry',
    'landscape',
    'solar',
    'pool',
    'lift',
    'fire',
    'other'
];

/** ตรวจข้อมูลผู้รับเหมา — คืน errors รายช่อง และ conflict เมื่อเลขผู้เสียภาษีซ้ำ */
export function validateSubcontractor(input: SubcontractorInput, selfId?: string): { errors: Record<string, string>; conflict?: string } {
    const errors: Record<string, string> = {};
    if (!input.name?.trim()) errors['name'] = 'กรุณาระบุชื่อผู้รับเหมา';
    if (!input.trades?.length) errors['trades'] = 'กรุณาเลือกสาขางานอย่างน้อย 1 สาขา';
    else if (input.trades.some((trade) => !TRADES.includes(trade))) errors['trades'] = 'สาขางานไม่ถูกต้อง';
    if (!input.contactName?.trim()) errors['contactName'] = 'กรุณาระบุชื่อผู้ติดต่อ';
    if (!PHONE.test((input.phone ?? '').replace(/[\s-]/g, ''))) errors['phone'] = 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0';
    if (input.email?.trim() && !/^[^\s@]+@[^\s@]+$/.test(input.email.trim())) errors['email'] = 'รูปแบบอีเมลไม่ถูกต้อง';
    const taxId = input.taxId?.replace(/\D/g, '');
    if (input.taxId?.trim() && taxId?.length !== 13) errors['taxId'] = 'เลขผู้เสียภาษีต้องมี 13 หลัก';
    const duplicate = taxId && subcontractors.find((item) => item.id !== selfId && item.taxId === taxId);
    return { errors, conflict: duplicate ? `เลขผู้เสียภาษีซ้ำกับ ${duplicate.code} ${duplicate.name}` : undefined };
}

const optional = (value: string | undefined) => value?.trim() || undefined;

function clean(input: SubcontractorInput) {
    return {
        name: input.name.trim(),
        trades: [...new Set(input.trades)],
        contactName: input.contactName.trim(),
        phone: input.phone.trim(),
        email: optional(input.email),
        lineId: optional(input.lineId),
        taxId: input.taxId?.replace(/\D/g, '') || undefined,
        address: optional(input.address),
        note: optional(input.note),
        status: input.status ?? 'active'
    } satisfies SubcontractorInput;
}

export function createSubcontractor(input: SubcontractorInput): Subcontractor {
    const next = Math.max(0, ...subcontractors.map((item) => Number(item.code.slice(4)) || 0)) + 1;
    const record: Subcontractor = { id: `sub-${String(next).padStart(3, '0')}`, code: `SUB-${String(next).padStart(3, '0')}`, ...clean(input), status: input.status ?? 'active' };
    subcontractors.push(record);
    recordAudit({ module: 'project', action: 'เพิ่มผู้รับเหมาช่วง', target: record.code, detail: record.name });
    return record;
}

export function updateSubcontractor(existing: Subcontractor, input: SubcontractorInput): Subcontractor {
    const statusChanged = (input.status ?? 'active') !== existing.status;
    Object.assign(existing, clean(input));
    for (const key of Object.keys(existing) as Array<keyof Subcontractor>) if (existing[key] === undefined) delete existing[key];
    recordAudit({ module: 'project', action: statusChanged ? (existing.status === 'active' ? 'เปิดใช้งานผู้รับเหมาช่วง' : 'ปิดใช้งานผู้รับเหมาช่วง') : 'แก้ไขข้อมูลผู้รับเหมาช่วง', target: existing.code, detail: existing.name });
    return existing;
}
