import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiSchemas, apiUrl } from '@/app/api/api';

export type UserRef = ApiSchemas['UserRef'];

@Injectable({ providedIn: 'root' })
export class UserService {
    private readonly http = inject(HttpClient);

    list(): Observable<UserRef[]> {
        return this.http.get<UserRef[]>(apiUrl('/users'));
    }
}
