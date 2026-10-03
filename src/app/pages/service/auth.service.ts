import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiSchemas, apiUrl, toDate } from '@/app/api/api';

export type RoleId = ApiSchemas['RoleId'];
export type Permission = ApiSchemas['Permission'];
export type RoleCatalog = ApiSchemas['RoleCatalog'];
export type CurrentUser = Omit<ApiSchemas['CurrentUser'], 'lastLoginAt'> & { lastLoginAt: Date };

/**
 * ผู้ใช้ที่ล็อกอินอยู่ (GET /auth/me) และตารางบทบาท/สิทธิ์ (GET /roles)
 * (ยังไม่มีหน้าล็อกอินจริง API จำลองตอบเป็นเจ้าของบริษัท)
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    private readonly userState = signal<CurrentUser | null>(null);
    /** null ระหว่างโหลด หรือเมื่อออกจากระบบแล้ว */
    readonly currentUser = this.userState.asReadonly();
    readonly loadError = signal(false);

    private readonly catalogState = signal<RoleCatalog | null>(null);
    readonly roleCatalog = this.catalogState.asReadonly();
    readonly role = computed(() => this.roleCatalog()?.roles.find((role) => role.id === this.currentUser()?.roleId));

    /** มีสิทธิ์นี้หรือไม่ (ใช้ซ่อน/แสดงส่วนของหน้าจอ หลังบ้านตรวจซ้ำทุกคำขอ) */
    can(permission: Permission): boolean {
        return this.currentUser()?.permissions.includes(permission) ?? false;
    }

    constructor() {
        this.http.get<ApiSchemas['CurrentUser']>(apiUrl('/auth/me')).subscribe({
            next: (user) => this.userState.set({ ...user, lastLoginAt: toDate(user.lastLoginAt) }),
            error: () => this.loadError.set(true)
        });
        this.http.get<RoleCatalog>(apiUrl('/roles')).subscribe({ next: (catalog) => this.catalogState.set(catalog), error: () => {} });
    }

    logout(): Observable<void> {
        return this.http.post<void>(apiUrl('/auth/logout'), null).pipe(
            tap(() => {
                this.userState.set(null);
                this.router.navigate(['/auth/login']);
            })
        );
    }
}
