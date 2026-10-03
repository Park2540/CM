import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, filter, map } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type UploadedFile = ApiSchemas['UploadedFile'];

/** ความคืบหน้าการอัปโหลด (progress 0-100) แล้วจบด้วยไฟล์ที่อัปโหลดเสร็จ */
export type UploadProgress = { progress: number; file?: UploadedFile };

/** อัปโหลดไฟล์ (POST /uploads) แล้วนำ id/url ไปอ้างอิงในข้อมูลอื่น */
@Injectable({ providedIn: 'root' })
export class FileUploadService {
    private readonly http = inject(HttpClient);

    upload(file: File): Observable<UploadedFile> {
        return this.http.post<UploadedFile>(apiUrl('/uploads'), this.body(file));
    }

    /** สำหรับไฟล์ใหญ่ (เช่น แบบ 3 มิติ) ให้แสดงความคืบหน้าได้ */
    uploadWithProgress(file: File): Observable<UploadProgress> {
        return this.http.post<UploadedFile>(apiUrl('/uploads'), this.body(file), { reportProgress: true, observe: 'events' }).pipe(
            filter((event) => event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response),
            map((event) => (event.type === HttpEventType.Response ? { progress: 100, file: event.body ?? undefined } : { progress: event.total ? Math.round((event.loaded / event.total) * 100) : 0 }))
        );
    }

    private body(file: File) {
        const body = new FormData();
        body.append('file', file);
        return body;
    }
}
