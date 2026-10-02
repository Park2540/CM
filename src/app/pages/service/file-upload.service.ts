import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type UploadedFile = ApiSchemas['UploadedFile'];

/** อัปโหลดไฟล์ (POST /uploads) แล้วนำ id/url ไปอ้างอิงในข้อมูลอื่น */
@Injectable({ providedIn: 'root' })
export class FileUploadService {
    private readonly http = inject(HttpClient);

    upload(file: File): Observable<UploadedFile> {
        const body = new FormData();
        body.append('file', file);
        return this.http.post<UploadedFile>(apiUrl('/uploads'), body);
    }
}
