import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl, queryParams } from '@/app/api/api';

export type Project = ApiSchemas['Project'];
export type ProjectStatus = ApiSchemas['ProjectStatus'];
export type ProjectInput = ApiSchemas['ProjectInput'];
export type ContractInput = ApiSchemas['ContractInput'];
export type ProjectRegion = ApiSchemas['ProjectRegion'];
export type ProjectGroup = ApiSchemas['ProjectGroup'];
export type ProjectPortfolio = ApiSchemas['ProjectPortfolio'];
export type WarrantyType = ApiSchemas['WarrantyType'];
export type WarrantyTerm = ApiSchemas['WarrantyTerm'];
export type WarrantyCoverage = ApiSchemas['WarrantyCoverage'];

/** ใกล้หมดประกัน: เหลือไม่เกินกี่วัน */
export const WARRANTY_EXPIRING_DAYS = 60;

/** ระยะประกันเป็นข้อความ เช่น 12 → "1 ปี", 18 → "18 เดือน" */
export function warrantyPeriod(months: number): string {
    return months % 12 === 0 ? `${months / 12} ปี` : `${months} เดือน`;
}

/** สถานะของการรับประกันแต่ละส่วน */
export function coverageState(coverage: WarrantyCoverage): 'expired' | 'expiring' | 'active' {
    if (!coverage.active) return 'expired';
    return coverage.daysLeft <= WARRANTY_EXPIRING_DAYS ? 'expiring' : 'active';
}

/** กลุ่มโครงการ (ตัวกรองในรายการโครงการและการ์ดใน Dashboard) */
export const PROJECT_GROUP_LABEL: Record<ProjectGroup, string> = {
    'in-hand': 'โครงการในมือ',
    'pending-contract': 'รอทำสัญญา',
    active: 'กำลังดำเนินการ',
    completed: 'เสร็จแล้ว',
    warranty: 'อยู่ในประกัน'
};

/** โครงการที่บันทึกสัญญาแล้ว — มีมูลค่า วันที่ และที่ตั้งหน้างานครบ จึงมีแผนงาน งวดงาน ภาพ เอกสาร */
export type ContractedProject = Project & { value: number; startDate: string; deliveryDate: string; location: string; contractSignedAt: string };

export function isContracted(project: Project | null | undefined): project is ContractedProject {
    return !!project && project.status !== 'pending-contract' && project.value !== null && !!project.startDate && !!project.deliveryDate;
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
    'pending-contract': 'รอเซ็นสัญญา',
    planning: 'รอดำเนินการ',
    'in-progress': 'กำลังดำเนินการ',
    'near-handover': 'ใกล้ส่งมอบ',
    completed: 'เสร็จสิ้น',
    delayed: 'ล่าช้า'
};

export function getProjectSeverity(status: ProjectStatus) {
    switch (status) {
        case 'pending-contract':
            return 'secondary';
        case 'completed':
            return 'success';
        case 'delayed':
            return 'danger';
        case 'planning':
            return 'warn';
        default:
            return 'info';
    }
}

/** โครงการ — เรียก API ตามสัญญา (/projects) */
@Injectable({ providedIn: 'root' })
export class ProjectService {
    private readonly http = inject(HttpClient);

    list(query: { status?: ProjectStatus | null; group?: ProjectGroup | null; q?: string } = {}): Observable<Project[]> {
        return this.http.get<Project[]>(apiUrl('/projects'), { params: queryParams(query) });
    }

    get(code: string): Observable<Project> {
        return this.http.get<Project>(apiUrl(`/projects/${encodeURIComponent(code)}`));
    }

    /** เปิดโครงการ (ข้อมูลเบื้องต้น) — สถานะเริ่มต้น "รอเซ็นสัญญา" */
    create(input: ProjectInput): Observable<Project> {
        return this.http.post<Project>(apiUrl('/projects'), input);
    }

    /** บันทึกสัญญา — แผนงานและงวดงานสร้างหลังตั้งค่างานก่อสร้าง */
    recordContract(code: string, input: ContractInput): Observable<Project> {
        return this.http.post<Project>(apiUrl(`/projects/${encodeURIComponent(code)}/contract`), input);
    }

    /** จำนวนโครงการตามกลุ่มสำหรับ Dashboard */
    portfolio(): Observable<ProjectPortfolio> {
        return this.http.get<ProjectPortfolio>(apiUrl('/dashboard/projects'));
    }

    regions(): Observable<ProjectRegion[]> {
        return this.http.get<ProjectRegion[]>(apiUrl('/settings/project-regions'));
    }
}
