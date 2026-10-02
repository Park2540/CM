import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';

export interface PersonnelDocument {
    type: string;
    fileName: string;
    url: string;
    expiresAt: string;
    uploadedBy: string;
}

export interface PersonnelProjectHistory {
    projectCode: string;
    role: string;
    period: string;
    assignment: string;
    dailyReport: string;
    paidAmount: number | null;
}

export interface PersonnelTraining {
    name: string;
    completedAt: string;
    expiresAt: string;
}

/**
 * โมเดลหน้าจอ (ช่องว่าง = สตริงว่าง เพื่อผูกกับฟอร์มได้ตรงๆ)
 * แปลงจาก/เป็น Personnel ของ API ใน PersonnelService
 */
export interface PersonnelRecord {
    /** ว่างสำหรับบุคลากรใหม่ที่ยังไม่บันทึก */
    id: string;
    /** หลังบ้านออกให้ตอนบันทึกครั้งแรก */
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
    issuedEquipment: string;
    documents: PersonnelDocument[];
    trainings: PersonnelTraining[];
    /** หลังบ้านส่งข้อมูลอ่อนไหวมาหรือไม่ (ตามสิทธิ์ของผู้ใช้) */
    hasSensitive: boolean;
    compensationType: string;
    compensationRate: number;
    compensationHistory: string;
    withholdingTaxTerms: string;
    bankName: string;
    bankAccountNumber: string;
    bankAccountName: string;
    taxpayerId: string;
    withholdingCertificate: string;
    performanceRating: string;
    performanceNotes: string;
    /** อ่านอย่างเดียว (หลังบ้านสร้างให้) */
    projectHistory: PersonnelProjectHistory[];
    auditHistory: string[];
}

export type LicenseAlert = ApiSchemas['LicenseAlert'];

type ApiPersonnel = ApiSchemas['Personnel'];
type PersonnelInput = ApiSchemas['PersonnelInput'];

const TEXT_FIELDS = [
    'photoUrl',
    'fullName',
    'nationalId',
    'professionalLicenseNumber',
    'professionalLicenseType',
    'professionalLicenseLevel',
    'professionalLicenseExpiresAt',
    'position',
    'birthDate',
    'hireDate',
    'phone',
    'lineId',
    'email',
    'registeredAddress',
    'currentAddress',
    'emergencyContactName',
    'emergencyContactRelation',
    'emergencyContactPhone',
    'employmentType',
    'endDate',
    'department',
    'supervisor',
    'expertise',
    'workAreas',
    'availability',
    'education',
    'institution',
    'otherCertificates',
    'workPermitExpiresAt',
    'socialSecurityNumber',
    'issuedEquipment'
] as const;

const SENSITIVE_TEXT_FIELDS = ['compensationType', 'compensationHistory', 'withholdingTaxTerms', 'bankName', 'bankAccountNumber', 'bankAccountName', 'taxpayerId', 'withholdingCertificate', 'performanceRating', 'performanceNotes'] as const;

const auditDate = new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function blankPersonnel(hasSensitive: boolean): PersonnelRecord {
    const record = Object.fromEntries([...TEXT_FIELDS, ...SENSITIVE_TEXT_FIELDS].map((field) => [field, ''])) as unknown as PersonnelRecord;
    return { ...record, id: '', employeeCode: '', employmentType: 'ประจำ', compensationType: 'เงินเดือน', compensationRate: 0, documents: [], trainings: [], projectHistory: [], auditHistory: [], hasSensitive };
}

function fromApi(api: ApiPersonnel): PersonnelRecord {
    const record = blankPersonnel(!!api.sensitive);
    for (const field of TEXT_FIELDS) record[field] = api[field] ?? '';
    for (const field of SENSITIVE_TEXT_FIELDS) record[field] = api.sensitive?.[field] ?? '';
    return {
        ...record,
        id: api.id,
        employeeCode: api.employeeCode,
        compensationRate: api.sensitive?.compensationRate ?? 0,
        documents: (api.documents ?? []).map((doc) => ({ type: doc.type, fileName: doc.fileName, url: doc.url, expiresAt: doc.expiresAt ?? '', uploadedBy: doc.uploadedBy ?? '' })),
        trainings: (api.trainings ?? []).map((training) => ({ name: training.name, completedAt: training.completedAt, expiresAt: training.expiresAt ?? '' })),
        projectHistory: api.projectHistory.map((history) => ({ ...history, paidAmount: history.paidAmount ?? null })),
        auditHistory: api.auditHistory.map((entry) => `${auditDate.format(new Date(entry.at))} ${entry.action} โดย ${entry.userName}`)
    };
}

/** ช่องว่างไม่ส่ง (โดยเฉพาะวันที่ ที่ API ตรวจรูปแบบ) */
const optional = (value: string) => value.trim() || undefined;

function toApi(record: PersonnelRecord): PersonnelInput {
    const input: PersonnelInput = { fullName: record.fullName.trim() };
    for (const field of TEXT_FIELDS) if (field !== 'fullName') input[field] = optional(record[field]);
    input.documents = record.documents.map((doc) => ({ type: doc.type, fileName: doc.fileName, url: doc.url, expiresAt: optional(doc.expiresAt) }));
    input.trainings = record.trainings.map((training) => ({ name: training.name, completedAt: training.completedAt, expiresAt: optional(training.expiresAt) }));
    if (record.hasSensitive) {
        input.sensitive = { compensationRate: Number(record.compensationRate) || 0 };
        for (const field of SENSITIVE_TEXT_FIELDS) input.sensitive[field] = optional(record[field]);
    }
    return input;
}

/** ใบอนุญาตยังไม่หมดอายุ ณ วันที่ระบุ (ใช้ตรวจคุณสมบัติก่อนมอบหมายงาน) */
export function isProfessionalLicenseValid(record: Pick<PersonnelRecord, 'professionalLicenseNumber' | 'professionalLicenseExpiresAt'> | undefined, onDate = new Date()): boolean {
    if (!record?.professionalLicenseNumber || !record.professionalLicenseExpiresAt) return false;
    return new Date(`${record.professionalLicenseExpiresAt}T23:59:59`) >= onDate;
}

/** บุคลากร — เรียก API ตามสัญญา (/personnel) */
@Injectable({ providedIn: 'root' })
export class PersonnelService {
    private readonly http = inject(HttpClient);

    list(q?: string): Observable<PersonnelRecord[]> {
        return this.http.get<ApiPersonnel[]>(apiUrl('/personnel'), { params: queryParams({ q }) }).pipe(map((rows) => rows.map(fromApi)));
    }

    get(id: string): Observable<PersonnelRecord> {
        return this.http.get<ApiPersonnel>(apiUrl(`/personnel/${encodeURIComponent(id)}`)).pipe(map(fromApi));
    }

    /** เพิ่มใหม่ถ้ายังไม่มี id ไม่เช่นนั้นแก้ไข */
    save(record: PersonnelRecord): Observable<PersonnelRecord> {
        const body = toApi(record);
        const request = record.id ? this.http.put<ApiPersonnel>(apiUrl(`/personnel/${encodeURIComponent(record.id)}`), body) : this.http.post<ApiPersonnel>(apiUrl('/personnel'), body);
        return request.pipe(map(fromApi));
    }

    licenseAlerts(withinDays = 90): Observable<LicenseAlert[]> {
        return this.http.get<LicenseAlert[]>(apiUrl('/personnel/license-alerts'), { params: queryParams({ withinDays }) });
    }
}
