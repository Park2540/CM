import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type StaffRole = ApiSchemas['StaffRole'];
export type StaffAssignment = ApiSchemas['StaffAssignment'];
export type StaffAssignmentInput = ApiSchemas['StaffAssignmentInput'];
export type SubcontractorAssignment = ApiSchemas['SubcontractorAssignment'];
export type SubcontractorAssignmentInput = ApiSchemas['SubcontractorAssignmentInput'];
export type ProjectAssignments = ApiSchemas['ProjectAssignments'];

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
    'project-manager': 'ผู้จัดการโครงการ',
    engineer: 'วิศวกรโครงการ',
    'site-supervisor': 'ผู้ควบคุมงาน',
    architect: 'สถาปนิก',
    foreman: 'โฟร์แมน',
    'safety-officer': 'เจ้าหน้าที่ความปลอดภัย',
    purchasing: 'ฝ่ายจัดซื้อ',
    accounting: 'ฝ่ายบัญชีและการเงิน'
};

export const STAFF_ROLES = Object.keys(STAFF_ROLE_LABEL) as StaffRole[];

export const SUB_STATUS_LABEL: Record<SubcontractorAssignment['status'], string> = { upcoming: 'ยังไม่เริ่ม', working: 'กำลังทำงาน', done: 'เสร็จแล้ว' };

/** ผู้รับผิดชอบและผู้รับเหมาช่วงของโครงการ (/projects/{code}/assignments, /staff, /subcontractors) */
@Injectable({ providedIn: 'root' })
export class ProjectTeamService {
    private readonly http = inject(HttpClient);

    private url(code: string, path = '') {
        return apiUrl(`/projects/${encodeURIComponent(code)}${path}`);
    }

    assignments(code: string): Observable<ProjectAssignments> {
        return this.http.get<ProjectAssignments>(this.url(code, '/assignments'));
    }

    addStaff(code: string, input: StaffAssignmentInput): Observable<StaffAssignment> {
        return this.http.post<StaffAssignment>(this.url(code, '/staff'), input);
    }

    updateStaff(code: string, id: string, input: StaffAssignmentInput): Observable<StaffAssignment> {
        return this.http.put<StaffAssignment>(this.url(code, `/staff/${encodeURIComponent(id)}`), input);
    }

    removeStaff(code: string, id: string): Observable<void> {
        return this.http.delete<void>(this.url(code, `/staff/${encodeURIComponent(id)}`));
    }

    addSubcontractor(code: string, input: SubcontractorAssignmentInput): Observable<SubcontractorAssignment> {
        return this.http.post<SubcontractorAssignment>(this.url(code, '/subcontractors'), input);
    }

    updateSubcontractor(code: string, id: string, input: SubcontractorAssignmentInput): Observable<SubcontractorAssignment> {
        return this.http.put<SubcontractorAssignment>(this.url(code, `/subcontractors/${encodeURIComponent(id)}`), input);
    }

    removeSubcontractor(code: string, id: string): Observable<void> {
        return this.http.delete<void>(this.url(code, `/subcontractors/${encodeURIComponent(id)}`));
    }
}
