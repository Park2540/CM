import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiPage, ApiSchemas, apiUrl, queryParams, toDate } from '@/app/api/api';
import { ProjectTimeline } from './project-timeline.service';

export type Weather = ApiSchemas['Weather'];
export type IssueSeverity = ApiSchemas['IssueSeverity'];
export type SiteIssue = ApiSchemas['SiteIssue'];
export type { UploadedFile } from './file-upload.service';
export type ProgressUpdateInput = ApiSchemas['ProgressUpdateInput'];
export type InspectionInput = ApiSchemas['InspectionInput'];
export type ProgressUpdate = Omit<ApiSchemas['ProgressUpdate'], 'reportDate' | 'createdAt'> & { reportDate: Date; createdAt: Date };

export const WEATHER_OPTIONS: Array<{ value: Weather; label: string; icon: string }> = [
    { value: 'sunny', label: 'แดดจัด', icon: 'pi pi-sun' },
    { value: 'cloudy', label: 'มีเมฆ', icon: 'pi pi-cloud' },
    { value: 'light-rain', label: 'ฝนเล็กน้อย', icon: 'pi pi-cloud' },
    { value: 'heavy-rain', label: 'ฝนหนัก', icon: 'pi pi-cloud-download' }
];

export const SEVERITY_OPTIONS: Array<{ value: IssueSeverity; label: string; className: string }> = [
    { value: 'low', label: 'เล็กน้อย', className: 'bg-surface-100 text-surface-700 dark:bg-surface-800 dark:text-surface-200' },
    { value: 'medium', label: 'ปานกลาง', className: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' },
    { value: 'high', label: 'รุนแรง', className: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' }
];

/** วันที่ไม่มีเวลา (YYYY-MM-DD) → Date เที่ยงคืน UTC ให้ตรงกับ ThaiDatePipe */
const dateOnly = (value: string) => new Date(`${value}T00:00:00Z`);

export function timelineFromApi(timeline: ApiSchemas['ProjectTimeline']): ProjectTimeline {
    return {
        progress: timeline.progress,
        phases: timeline.phases.map((phase) => ({
            ...phase,
            start: dateOnly(phase.start),
            end: dateOnly(phase.end),
            tasks: phase.tasks.map((task) => ({ ...task, start: dateOnly(task.start), end: dateOnly(task.end) }))
        }))
    };
}

const updateFromApi = (update: ApiSchemas['ProgressUpdate']): ProgressUpdate => ({ ...update, reportDate: dateOnly(update.reportDate), createdAt: toDate(update.createdAt) });

/** ไทม์ไลน์และการอัปเดตงานของโครงการ (/projects/{code}/timeline, /updates, /inspection) — อัปโหลดรูปใช้ FileUploadService */
@Injectable({ providedIn: 'root' })
export class ProjectProgressService {
    private readonly http = inject(HttpClient);

    private projectUrl(code: string, path: string) {
        return apiUrl(`/projects/${encodeURIComponent(code)}${path}`);
    }

    getTimeline(code: string): Observable<ProjectTimeline> {
        return this.http.get<ApiSchemas['ProjectTimeline']>(this.projectUrl(code, '/timeline')).pipe(map(timelineFromApi));
    }

    listUpdates(code: string, page = 1, pageSize = 10): Observable<ApiPage<ProgressUpdate>> {
        return this.http.get<ApiSchemas['ProgressUpdatePage']>(this.projectUrl(code, '/updates'), { params: queryParams({ page, pageSize }) }).pipe(map((result) => ({ ...result, items: result.items.map(updateFromApi) })));
    }

    createUpdate(code: string, input: ProgressUpdateInput): Observable<ProgressUpdate> {
        return this.http.post<ApiSchemas['ProgressUpdate']>(this.projectUrl(code, '/updates'), input).pipe(map(updateFromApi));
    }

    recordInspection(code: string, taskCode: string, input: InspectionInput): Observable<ProgressUpdate> {
        return this.http.post<ApiSchemas['ProgressUpdate']>(this.projectUrl(code, `/tasks/${encodeURIComponent(taskCode)}/inspection`), input).pipe(map(updateFromApi));
    }
}
