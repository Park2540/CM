import { Injectable } from '@angular/core';

export interface PersonnelDocument {
    type: string;
    fileName: string;
    expiresAt: string;
    uploadedBy: string;
    dataUrl?: string;
}

export interface PersonnelProjectHistory {
    projectCode: string;
    role: string;
    period: string;
    assignment: string;
    dailyReport: string;
    paidAmount: number;
}

export interface PersonnelTraining {
    name: string;
    completedAt: string;
    expiresAt: string;
}

export interface PersonnelRecord {
    id: string;
    employeeCode: string;
    photoUrl: string;
    fullName: string;
    nationalId: string;
    professionalLicenseNumber: string;
    professionalLicenseType: string;
    professionalLicenseLevel: string;
    professionalLicenseExpiresAt: string;
    position: string;
    birthDate: string;
    hireDate: string;
    phone: string;
    lineId: string;
    email: string;
    registeredAddress: string;
    currentAddress: string;
    emergencyContactName: string;
    emergencyContactRelation: string;
    emergencyContactPhone: string;
    employmentType: string;
    endDate: string;
    department: string;
    supervisor: string;
    expertise: string;
    workAreas: string;
    availability: string;
    education: string;
    institution: string;
    otherCertificates: string;
    workPermitExpiresAt: string;
    socialSecurityNumber: string;
    compensationType: string;
    compensationRate: number;
    compensationHistory: string;
    withholdingTaxTerms: string;
    bankName: string;
    bankAccountNumber: string;
    bankAccountName: string;
    taxpayerId: string;
    withholdingCertificate: string;
    documents: PersonnelDocument[];
    projectHistory: PersonnelProjectHistory[];
    auditHistory: string[];
    trainings: PersonnelTraining[];
    issuedEquipment: string;
    performanceRating: string;
    performanceNotes: string;
}

@Injectable({ providedIn: 'root' })
export class PersonnelService {
    private readonly records: PersonnelRecord[] = [
        {
            id: 'personnel-001',
            employeeCode: 'EMP690001',
            photoUrl: '',
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
            endDate: '',
            department: 'ฝ่ายก่อสร้าง',
            supervisor: 'ผู้จัดการโครงการ',
            expertise: 'งานโครงสร้าง, งานสถาปัตย์',
            workAreas: 'เชียงราย, เชียงใหม่',
            availability: 'จันทร์-ศุกร์ 08:00-17:00',
            education: 'วิศวกรรมศาสตรบัณฑิต สาขาวิศวกรรมโยธา',
            institution: 'มหาวิทยาลัยตัวอย่าง',
            otherCertificates: 'ความปลอดภัยในการทำงาน (ตัวอย่าง)',
            workPermitExpiresAt: '',
            socialSecurityNumber: '***-****-****',
            compensationType: 'เงินเดือน',
            compensationRate: 45000,
            compensationHistory: '45,000 บาท/เดือน มีผล 01/01/2026',
            withholdingTaxTerms: 'หักภาษี ณ ที่จ่ายตามประเภทเงินได้ (รอยืนยันโดยฝ่ายบัญชี)',
            bankName: 'ธนาคารตัวอย่าง',
            bankAccountNumber: 'xxx-x-xxxxx-x',
            bankAccountName: 'ธนกฤต ศรีวงศ์',
            taxpayerId: '***-***-****',
            withholdingCertificate: 'หนังสือรับรองภาษีหัก ณ ที่จ่าย (ตัวอย่าง)',
            documents: [
                { type: 'สำเนาบัตรประชาชน', fileName: 'บัตรประชาชน-ตัวอย่าง.pdf', expiresAt: '', uploadedBy: 'ฝ่ายบุคคล' },
                { type: 'ใบอนุญาตประกอบวิชาชีพ', fileName: 'ใบอนุญาต-ตัวอย่าง.pdf', expiresAt: '2027-03-31', uploadedBy: 'ฝ่ายบุคคล' }
            ],
            projectHistory: [{ projectCode: 'CR690001', role: 'วิศวกรโครงการ', period: 'ม.ค. 2026 - ปัจจุบัน', assignment: 'ควบคุมงานโครงสร้าง', dailyReport: 'รายงานประจำวันที่ 30/09/2026', paidAmount: 405000 }],
            auditHistory: ['01/09/2026 เพิ่มข้อมูลบุคลากรโดย ฝ่ายบุคคล', '15/09/2026 แก้ไขข้อมูลติดต่อโดย ฝ่ายบุคคล'],
            trainings: [{ name: 'ความปลอดภัยในการทำงาน', completedAt: '2026-01-10', expiresAt: '2027-01-10' }],
            issuedEquipment: 'หมวกนิรภัย, เสื้อสะท้อนแสง, รองเท้านิรภัย',
            performanceRating: 'ดีมาก',
            performanceNotes: 'ทำงานตามแผนและส่งรายงานครบถ้วน (ตัวอย่าง)'
        },
        {
            id: 'personnel-002',
            employeeCode: 'EMP690002',
            photoUrl: '',
            fullName: 'พิมพ์ชนก วัฒนกุล',
            nationalId: '1-9876-*****-**-*',
            professionalLicenseNumber: '',
            professionalLicenseType: '',
            professionalLicenseLevel: '',
            professionalLicenseExpiresAt: '',
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
            endDate: '',
            department: 'ฝ่ายจัดซื้อ',
            supervisor: 'หัวหน้าฝ่ายจัดซื้อ',
            expertise: 'จัดซื้อ, เปรียบเทียบราคา',
            workAreas: 'เชียงราย',
            availability: 'จันทร์-ศุกร์ 08:00-17:00',
            education: 'บริหารธุรกิจบัณฑิต',
            institution: 'มหาวิทยาลัยตัวอย่าง',
            otherCertificates: '',
            workPermitExpiresAt: '',
            socialSecurityNumber: '***-****-****',
            compensationType: 'เงินเดือน',
            compensationRate: 32000,
            compensationHistory: '32,000 บาท/เดือน มีผล 01/04/2026',
            withholdingTaxTerms: 'หักภาษี ณ ที่จ่ายตามประเภทเงินได้ (รอยืนยันโดยฝ่ายบัญชี)',
            bankName: 'ธนาคารตัวอย่าง',
            bankAccountNumber: 'xxx-x-xxxxx-x',
            bankAccountName: 'พิมพ์ชนก วัฒนกุล',
            taxpayerId: '***-***-****',
            withholdingCertificate: '',
            documents: [],
            projectHistory: [],
            auditHistory: ['15/08/2022 เพิ่มข้อมูลบุคลากรโดย ฝ่ายบุคคล'],
            trainings: [],
            issuedEquipment: '',
            performanceRating: '',
            performanceNotes: ''
        }
    ];

    getAll(): PersonnelRecord[] {
        return this.records;
    }

    getById(id: string): PersonnelRecord | undefined {
        return this.records.find((record) => record.id === id);
    }

    createBlank(): PersonnelRecord {
        const buddhistYear = String(new Date().getFullYear() + 543).slice(-2);
        const prefix = `EMP${buddhistYear}`;
        const highestNumber = Math.max(0, ...this.records.filter((record) => record.employeeCode.startsWith(prefix)).map((record) => Number(record.employeeCode.slice(prefix.length)) || 0));
        const nextNumber = String(highestNumber + 1).padStart(4, '0');

        return {
            id: `personnel-${Date.now()}`,
            employeeCode: `${prefix}${nextNumber}`,
            photoUrl: '',
            fullName: '',
            nationalId: '',
            professionalLicenseNumber: '',
            professionalLicenseType: '',
            professionalLicenseLevel: '',
            professionalLicenseExpiresAt: '',
            position: '',
            birthDate: '',
            hireDate: '',
            phone: '',
            lineId: '',
            email: '',
            registeredAddress: '',
            currentAddress: '',
            emergencyContactName: '',
            emergencyContactRelation: '',
            emergencyContactPhone: '',
            employmentType: 'ประจำ',
            endDate: '',
            department: '',
            supervisor: '',
            expertise: '',
            workAreas: '',
            availability: '',
            education: '',
            institution: '',
            otherCertificates: '',
            workPermitExpiresAt: '',
            socialSecurityNumber: '',
            compensationType: 'เงินเดือน',
            compensationRate: 0,
            compensationHistory: '',
            withholdingTaxTerms: '',
            bankName: '',
            bankAccountNumber: '',
            bankAccountName: '',
            taxpayerId: '',
            withholdingCertificate: '',
            documents: [],
            projectHistory: [],
            auditHistory: [],
            trainings: [],
            issuedEquipment: '',
            performanceRating: '',
            performanceNotes: ''
        };
    }

    save(record: PersonnelRecord): PersonnelRecord {
        const existingIndex = this.records.findIndex((item) => item.id === record.id);
        const savedRecord = { ...record, auditHistory: [...record.auditHistory, `${new Date().toLocaleDateString('th-TH')} แก้ไขข้อมูลบุคลากร`] };

        if (existingIndex === -1) {
            this.records.push(savedRecord);
        } else {
            this.records[existingIndex] = savedRecord;
        }

        return savedRecord;
    }

    isProfessionalLicenseValid(record: PersonnelRecord | undefined, onDate = new Date()): boolean {
        if (!record?.professionalLicenseNumber || !record.professionalLicenseExpiresAt) return false;

        const expiresAt = new Date(`${record.professionalLicenseExpiresAt}T23:59:59`);
        return expiresAt >= onDate;
    }

    canAssignToProject(id: string, requiresProfessionalLicense: boolean, onDate = new Date()): boolean {
        return !requiresProfessionalLicense || this.isProfessionalLicenseValid(this.getById(id), onDate);
    }

    getExpiringLicenses(withinDays = 90): Array<{ record: PersonnelRecord; license: string; expiresAt: string }> {
        const today = new Date();
        const cutoff = new Date(today);
        cutoff.setDate(cutoff.getDate() + withinDays);

        return this.records.flatMap((record) => {
            const licenses = [
                { license: 'ใบอนุญาตประกอบวิชาชีพ', expiresAt: record.professionalLicenseExpiresAt },
                { license: 'ใบอนุญาตทำงาน', expiresAt: record.workPermitExpiresAt },
                ...record.trainings.map((training) => ({ license: training.name, expiresAt: training.expiresAt })),
                ...record.documents.map((document) => ({ license: document.type, expiresAt: document.expiresAt }))
            ];

            return licenses
                .filter(({ expiresAt }) => {
                    if (!expiresAt) return false;
                    const expirationDate = new Date(`${expiresAt}T23:59:59`);
                    return expirationDate <= cutoff;
                })
                .map(({ license, expiresAt }) => ({ record, license, expiresAt }));
        });
    }
}
