import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type ConstructionOptionGroup = ApiSchemas['ConstructionOptionGroup'];
export type ConstructionOptionValue = ApiSchemas['ConstructionOptionValue'];
export type SetupOptions = ApiSchemas['ConstructionSetupOptions'];
export type ProjectSetup = ApiSchemas['ProjectSetup'];
export type SetupPreview = ApiSchemas['SetupPreview'];
export type SetupPreviewTask = ApiSchemas['SetupPreviewTask'];
export type CustomTask = ApiSchemas['CustomTaskInput'];
export type ProjectSetupInput = ApiSchemas['ProjectSetupInput'];

/** ตัวเลือกนี้แสดงหรือไม่ ตาม visibleWhen ของตัวเลือก */
export function isOptionVisible(group: ConstructionOptionGroup, options: SetupOptions): boolean {
    return !group.visibleWhen || group.visibleWhen.values.includes(String(options[group.visibleWhen.key]));
}

/** ตั้งค่างานก่อสร้าง: ตัวเลือกของบ้านหลังนี้ → หลังบ้านคัดงานจากแม่แบบและสร้างไทม์ไลน์ */
@Injectable({ providedIn: 'root' })
export class ProjectSetupService {
    private readonly http = inject(HttpClient);

    options(): Observable<ConstructionOptionGroup[]> {
        return this.http.get<ConstructionOptionGroup[]>(apiUrl('/settings/construction-options'));
    }

    get(code: string): Observable<ProjectSetup> {
        return this.http.get<ProjectSetup>(apiUrl(`/projects/${code}/setup`));
    }

    /** ตัวอย่างงานทั้งหมด (รวมงานที่ตัดออก) ตามตัวเลือกและการปรับงานย่อย โดยไม่บันทึก */
    preview(code: string, input: ProjectSetupInput): Observable<SetupPreview> {
        return this.http.post<SetupPreview>(apiUrl(`/projects/${code}/setup/preview`), input);
    }

    save(code: string, input: ProjectSetupInput): Observable<ProjectSetup> {
        return this.http.put<ProjectSetup>(apiUrl(`/projects/${code}/setup`), input);
    }
}
