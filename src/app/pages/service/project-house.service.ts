import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type ProjectHouse = ApiSchemas['ProjectHouse'];
export type ProjectHouseInput = ApiSchemas['ProjectHouseInput'];
export type RenderView = ApiSchemas['RenderView'];

export const RENDER_VIEWS: Array<{ value: RenderView; label: string }> = [
    { value: 'front', label: 'ด้านหน้า' },
    { value: 'back', label: 'ด้านหลัง' },
    { value: 'left', label: 'ด้านซ้าย' },
    { value: 'right', label: 'ด้านขวา' }
];

/** ข้อมูลแบบบ้านของโครงการที่ผู้ตั้งค่ากรอกเอง (/projects/{code}/house) */
@Injectable({ providedIn: 'root' })
export class ProjectHouseService {
    private readonly http = inject(HttpClient);

    get(code: string): Observable<ProjectHouse> {
        return this.http.get<ProjectHouse>(this.url(code));
    }

    save(code: string, input: ProjectHouseInput): Observable<ProjectHouse> {
        return this.http.put<ProjectHouse>(this.url(code), input);
    }

    private url(code: string) {
        return apiUrl(`/projects/${encodeURIComponent(code)}/house`);
    }
}
