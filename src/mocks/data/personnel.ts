import { ApiSchemas } from '@/app/api/api';
import { recordAudit } from './audit-logs';
import { CURRENT_USER } from './users';

type Personnel = ApiSchemas['Personnel'];
type PersonnelInput = ApiSchemas['PersonnelInput'];

/** เห็นข้อมูลอ่อนไหว (ค่าตอบแทน บัญชีธนาคาร ผลประเมิน) ตามสิทธิ์ personnel.sensitive */
export const canSeeSensitive = () => CURRENT_USER.permissions.includes('personnel.sensitive');

const SAMPLE_FILE = 'data:text/plain;charset=utf-8,' + encodeURIComponent('ไฟล์ตัวอย่างจาก API จำลอง');

const personnel: Personnel[] = [
    {
        id: 'personnel-001',
        employeeCode: 'EMP690001',
        fullName: 'ธนกฤต ศรีวงศ์',
        nationalId: '1-2345-*****-**-*',
        professionalLicenseNumber: 'ภย. 12345 (ตัวอย่าง)',
        professionalLicenseType: 'วิศวกรโยธา',
        professionalLicenseLevel: 'ภาคีวิศวกร',
        professionalLicenseExpiresAt: '2026-11-25',
        position: 'วิศวกรโครงการ',
        birthDate: '1990-06-15',
        hireDate: '2020-04-01',
        phone: '081-234-5678',
        lineId: 'thanakrit.demo',
        email: 'thanakrit@example.invalid',
        registeredAddress: 'อำเภอเมือง เชียงราย (ข้อมูลตัวอย่าง)',
        currentAddress: 'อำเภอเมือง เชียงราย (ข้อมูลตัวอย่าง)',
        emergencyContactName: 'ศิริพร ศรีวงศ์',
        emergencyContactRelation: 'คู่สมรส',
        emergencyContactPhone: '089-000-0001',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        supervisor: 'ผู้จัดการโครงการ',
        expertise: 'งานโครงสร้าง, งานสถาปัตย์',
        workAreas: 'เชียงราย, เชียงใหม่',
        availability: 'จันทร์-ศุกร์ 08:00-17:00',
        education: 'วิศวกรรมศาสตรบัณฑิต สาขาวิศวกรรมโยธา',
        institution: 'มหาวิทยาลัยตัวอย่าง',
        otherCertificates: 'ความปลอดภัยในการทำงาน (ตัวอย่าง)',
        socialSecurityNumber: '***-****-****',
        issuedEquipment: 'หมวกนิรภัย, เสื้อสะท้อนแสง, รองเท้านิรภัย',
        documents: [
            { type: 'สำเนาบัตรประชาชน', fileName: 'บัตรประชาชน-ตัวอย่าง.pdf', url: SAMPLE_FILE, uploadedBy: 'ฝ่ายบุคคล' },
            { type: 'ใบอนุญาตประกอบวิชาชีพ', fileName: 'ใบอนุญาต-ตัวอย่าง.pdf', url: SAMPLE_FILE, expiresAt: '2027-03-31', uploadedBy: 'ฝ่ายบุคคล' }
        ],
        trainings: [{ name: 'ความปลอดภัยในการทำงาน', completedAt: '2026-01-10', expiresAt: '2027-01-10' }],
        sensitive: {
            compensationType: 'เงินเดือน',
            compensationRate: 45000,
            compensationHistory: '45,000 บาท/เดือน มีผล 01/01/2026',
            withholdingTaxTerms: 'หักภาษี ณ ที่จ่ายตามประเภทเงินได้ (รอยืนยันโดยฝ่ายบัญชี)',
            bankName: 'ธนาคารตัวอย่าง',
            bankAccountNumber: 'xxx-x-xxxxx-x',
            bankAccountName: 'ธนกฤต ศรีวงศ์',
            taxpayerId: '***-***-****',
            withholdingCertificate: 'หนังสือรับรองภาษีหัก ณ ที่จ่าย (ตัวอย่าง)',
            performanceRating: 'ดีมาก',
            performanceNotes: 'ทำงานตามแผนและส่งรายงานครบถ้วน (ตัวอย่าง)'
        },
        projectHistory: [{ projectCode: 'CR690001', role: 'วิศวกรโครงการ', period: 'ม.ค. 2026 - ปัจจุบัน', assignment: 'ควบคุมงานโครงสร้าง', dailyReport: 'รายงานประจำวันที่ 30/09/2026', paidAmount: 405000 }],
        auditHistory: [
            { at: '2026-09-01T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' },
            { at: '2026-09-15T14:20:00+07:00', userName: 'ฝ่ายบุคคล', action: 'แก้ไขข้อมูลติดต่อ' }
        ]
    },
    {
        id: 'personnel-002',
        employeeCode: 'EMP690002',
        fullName: 'พิมพ์ชนก วัฒนกุล',
        nationalId: '1-9876-*****-**-*',
        position: 'เจ้าหน้าที่จัดซื้อ',
        birthDate: '1995-11-02',
        hireDate: '2022-08-15',
        phone: '089-123-4567',
        lineId: 'pimchanok.demo',
        email: 'pimchanok@example.invalid',
        registeredAddress: 'อำเภอเมือง เชียงราย (ข้อมูลตัวอย่าง)',
        currentAddress: 'อำเภอเมือง เชียงราย (ข้อมูลตัวอย่าง)',
        emergencyContactName: 'วิชัย วัฒนกุล',
        emergencyContactRelation: 'บิดา',
        emergencyContactPhone: '086-000-0002',
        employmentType: 'ประจำ',
        department: 'ฝ่ายจัดซื้อ',
        supervisor: 'หัวหน้าฝ่ายจัดซื้อ',
        expertise: 'จัดซื้อ, เปรียบเทียบราคา',
        workAreas: 'เชียงราย',
        availability: 'จันทร์-ศุกร์ 08:00-17:00',
        education: 'บริหารธุรกิจบัณฑิต',
        institution: 'มหาวิทยาลัยตัวอย่าง',
        socialSecurityNumber: '***-****-****',
        documents: [],
        trainings: [],
        sensitive: {
            compensationType: 'เงินเดือน',
            compensationRate: 32000,
            compensationHistory: '32,000 บาท/เดือน มีผล 01/04/2026',
            withholdingTaxTerms: 'หักภาษี ณ ที่จ่ายตามประเภทเงินได้ (รอยืนยันโดยฝ่ายบัญชี)',
            bankName: 'ธนาคารตัวอย่าง',
            bankAccountNumber: 'xxx-x-xxxxx-x',
            bankAccountName: 'พิมพ์ชนก วัฒนกุล',
            taxpayerId: '***-***-****'
        },
        projectHistory: [],
        auditHistory: [{ at: '2022-08-15T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    // บุคลากรฝ่ายก่อสร้าง (ข้อมูลย่อ) ที่ถูกมอบหมายในโครงการตัวอย่าง
    {
        id: 'personnel-003',
        employeeCode: 'EMP690003',
        fullName: 'ณัฐพล ภูมิรักษ์',
        position: 'ผู้จัดการโครงการ',
        phone: '084-210-3301',
        hireDate: '2019-05-01',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2019-05-01T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-004',
        employeeCode: 'EMP690004',
        fullName: 'วรัญญา อินทร์แก้ว',
        position: 'ผู้จัดการโครงการ',
        phone: '085-210-3302',
        hireDate: '2021-02-15',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2021-02-15T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-005',
        employeeCode: 'EMP690005',
        fullName: 'ศุภชัย จันทร์เพ็ญ',
        position: 'ผู้จัดการโครงการ',
        phone: '086-210-3303',
        hireDate: '2018-09-01',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2018-09-01T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-006',
        employeeCode: 'EMP690006',
        fullName: 'ประเสริฐ ทองดี',
        position: 'วิศวกรโครงการ',
        phone: '089-555-0101',
        hireDate: '2022-06-01',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2022-06-01T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-007',
        employeeCode: 'EMP690007',
        fullName: 'สมศักดิ์ มั่นคง',
        position: 'ผู้ควบคุมงาน',
        phone: '086-555-0102',
        hireDate: '2017-03-20',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2017-03-20T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-008',
        employeeCode: 'EMP690008',
        fullName: 'อรุณี แก้วใส',
        position: 'เจ้าหน้าที่บัญชีและการเงิน',
        phone: '053-555-0103',
        hireDate: '2020-01-06',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2020-01-06T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-009',
        employeeCode: 'EMP690009',
        fullName: 'กิตติศักดิ์ แสนคำ',
        position: 'โฟร์แมน',
        phone: '087-555-0104',
        hireDate: '2023-04-10',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2023-04-10T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    },
    {
        id: 'personnel-010',
        employeeCode: 'EMP690010',
        fullName: 'นภัสสร ใจงาม',
        position: 'สถาปนิก',
        phone: '088-555-0105',
        hireDate: '2021-11-01',
        employmentType: 'ประจำ',
        department: 'ฝ่ายก่อสร้าง',
        projectHistory: [],
        auditHistory: [{ at: '2021-11-01T09:00:00+07:00', userName: 'ฝ่ายบุคคล', action: 'เพิ่มข้อมูลบุคลากร' }]
    }
];

/** ตัดข้อมูลอ่อนไหวออกตามสิทธิ์ของผู้ขอ */
export function present(record: Personnel): Personnel {
    if (canSeeSensitive()) return record;
    const { sensitive: _hidden, ...rest } = record;
    return { ...rest, projectHistory: record.projectHistory.map(({ paidAmount: _paid, ...history }) => history) };
}

export const listPersonnel = () => personnel;
export const findPersonnel = (id: string) => personnel.find((record) => record.id === id);

/** รหัสบุคลากร: EMP + ปี พ.ศ. 2 หลัก + ลำดับ 4 หลัก */
function nextEmployeeCode(): string {
    const prefix = `EMP${String(new Date().getFullYear() + 543).slice(-2)}`;
    const highest = Math.max(0, ...personnel.filter((record) => record.employeeCode.startsWith(prefix)).map((record) => Number(record.employeeCode.slice(prefix.length)) || 0));
    return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

function clean(input: PersonnelInput): PersonnelInput {
    const documents = (input.documents ?? []).map((doc) => ({ ...doc, uploadedBy: doc.uploadedBy || CURRENT_USER.name }));
    // ผู้ที่ไม่มีสิทธิ์ส่ง sensitive มาจะถูกละเว้น
    const { sensitive, ...rest } = input;
    return { ...rest, documents, trainings: input.trainings ?? [], ...(canSeeSensitive() && sensitive ? { sensitive } : {}) };
}

export function createPersonnel(input: PersonnelInput): Personnel {
    const record: Personnel = {
        ...clean(input),
        id: `personnel-${Date.now()}`,
        employeeCode: nextEmployeeCode(),
        projectHistory: [],
        auditHistory: [{ at: new Date().toISOString(), userName: CURRENT_USER.name, action: 'เพิ่มข้อมูลบุคลากร' }]
    };
    personnel.push(record);
    recordAudit({ module: 'personnel', action: 'เพิ่มบุคลากร', target: record.employeeCode, detail: record.fullName });
    return record;
}

export function updatePersonnel(existing: Personnel, input: PersonnelInput): Personnel {
    const cleaned = clean(input);
    const updated: Personnel = {
        ...cleaned,
        // ข้อมูลที่หลังบ้านดูแลเอง หรือที่ผู้แก้ไม่มีสิทธิ์เห็น จะคงค่าเดิม
        sensitive: canSeeSensitive() ? cleaned.sensitive : existing.sensitive,
        id: existing.id,
        employeeCode: existing.employeeCode,
        projectHistory: existing.projectHistory,
        auditHistory: [...existing.auditHistory, { at: new Date().toISOString(), userName: CURRENT_USER.name, action: 'แก้ไขข้อมูลบุคลากร' }]
    };
    personnel[personnel.indexOf(existing)] = updated;
    recordAudit({ module: 'personnel', action: 'แก้ไขข้อมูลบุคลากร', target: updated.employeeCode, detail: updated.fullName });
    return updated;
}

/** ใบอนุญาต/อบรม/เอกสารที่หมดอายุแล้วหรือจะหมดภายใน withinDays วัน */
export function licenseAlerts(withinDays: number): ApiSchemas['LicenseAlert'][] {
    const today = new Intl.DateTimeFormat('en-CA').format(new Date());
    const cutoff = new Intl.DateTimeFormat('en-CA').format(new Date(Date.now() + withinDays * 86_400_000));
    return personnel.flatMap((record) =>
        [
            { license: 'ใบอนุญาตประกอบวิชาชีพ', expiresAt: record.professionalLicenseExpiresAt },
            { license: 'ใบอนุญาตทำงาน', expiresAt: record.workPermitExpiresAt },
            ...(record.trainings ?? []).map((training) => ({ license: training.name, expiresAt: training.expiresAt })),
            ...(record.documents ?? []).map((doc) => ({ license: doc.type, expiresAt: doc.expiresAt }))
        ]
            .filter((item): item is { license: string; expiresAt: string } => !!item.expiresAt && item.expiresAt <= cutoff)
            .map((item) => ({ personnelId: record.id, fullName: record.fullName, license: item.license, expiresAt: item.expiresAt, expired: item.expiresAt < today }))
    );
}
