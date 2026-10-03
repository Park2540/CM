import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, map, of, shareReplay, tap } from 'rxjs';
import { ApiSchemas, apiUrl, toDate } from '@/app/api/api';

export type RoleId = ApiSchemas['RoleId'];
export type Permission = ApiSchemas['Permission'];
export type RoleCatalog = ApiSchemas['RoleCatalog'];
export type CurrentUser = Omit<ApiSchemas['CurrentUser'], 'lastLoginAt'> & { lastLoginAt: Date };

type StoredSession = { token: string; expiresAt: string };
const STORAGE_KEY = 'cm-planning.session';

/** อ่าน/เขียน storage แบบไม่ล้มเมื่อเบราว์เซอร์ปิดการเข้าถึง (เช่น โหมดส่วนตัวบางแบบ) */
function readSession(): StoredSession | null {
    for (const storage of [sessionStorage, localStorage]) {
        try {
            const raw = storage.getItem(STORAGE_KEY);
            if (raw) return JSON.parse(raw) as StoredSession;
        } catch {
            // ข้ามไปลอง storage ถัดไป
        }
    }
    return null;
}

function writeSession(session: StoredSession | null, remember = false) {
    for (const storage of [sessionStorage, localStorage]) {
        try {
            storage.removeItem(STORAGE_KEY);
        } catch {
            // ไม่มีสิทธิ์เข้าถึง storage
        }
    }
    if (!session) return;
    try {
        // จดจำฉันไว้ = อยู่ได้ข้ามการปิดเบราว์เซอร์ / ไม่จดจำ = หายเมื่อปิดแท็บ
        (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
        // เก็บไม่ได้ ยังใช้งานได้จนกว่าจะรีเฟรช
    }
}

/**
 * การเข้าสู่ระบบ: token (POST /auth/login), ผู้ใช้ที่ล็อกอิน (GET /auth/me) และตารางบทบาท/สิทธิ์ (GET /roles)
 * token แนบไปกับทุกคำขอโดย authInterceptor หน้าที่ต้องล็อกอินกันด้วย authGuard
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    private session: StoredSession | null = readSession();
    private loading$: Observable<boolean> | null = null;

    private readonly userState = signal<CurrentUser | null>(null);
    /** null ระหว่างโหลด หรือเมื่อยังไม่ได้เข้าสู่ระบบ */
    readonly currentUser = this.userState.asReadonly();
    readonly loadError = signal(false);

    private readonly catalogState = signal<RoleCatalog | null>(null);
    readonly roleCatalog = this.catalogState.asReadonly();
    readonly role = computed(() => this.roleCatalog()?.roles.find((role) => role.id === this.currentUser()?.roleId));

    /** มีสิทธิ์นี้หรือไม่ (ใช้ซ่อน/แสดงส่วนของหน้าจอ หลังบ้านตรวจซ้ำทุกคำขอ) */
    can(permission: Permission): boolean {
        return this.currentUser()?.permissions.includes(permission) ?? false;
    }

    /** token ที่ยังไม่หมดอายุ (null = ต้องเข้าสู่ระบบใหม่) */
    token(): string | null {
        if (!this.session) return null;
        if (Date.parse(this.session.expiresAt) <= Date.now()) {
            this.clearSession();
            return null;
        }
        return this.session.token;
    }

    login(email: string, password: string, remember: boolean): Observable<CurrentUser> {
        return this.http.post<ApiSchemas['LoginResult']>(apiUrl('/auth/login'), { email: email.trim(), password, remember } satisfies ApiSchemas['LoginInput']).pipe(
            tap((result) => {
                this.session = { token: result.accessToken, expiresAt: result.expiresAt };
                writeSession(this.session, remember);
                this.setUser(result.user);
                this.loadCatalog().subscribe();
            }),
            map(() => this.userState()!)
        );
    }

    /** ใช้ใน guard: โหลดผู้ใช้จาก token ที่เก็บไว้ (ครั้งเดียว) — false ถ้าไม่มี token หรือ token ใช้ไม่ได้แล้ว */
    ensureUser(): Observable<boolean> {
        if (!this.token()) return of(false);
        if (this.userState()) return of(true);
        this.loading$ ??= forkJoin([this.http.get<ApiSchemas['CurrentUser']>(apiUrl('/auth/me')), this.loadCatalog()]).pipe(
            tap(([user]) => this.setUser(user)),
            map(() => true),
            catchError(() => {
                // 401: interceptor ล้าง session แล้ว → ไปหน้าเข้าสู่ระบบ
                if (!this.session) return of(false);
                // error อื่น (เช่น เครือข่าย): ให้เข้าหน้าได้ แล้วแถบด้านบนแจ้งให้รีเฟรช
                this.loadError.set(true);
                return of(true);
            }),
            finalize(() => (this.loading$ = null)),
            shareReplay(1)
        );
        return this.loading$;
    }

    /** ออกจากระบบ: แจ้งหลังบ้านให้ยกเลิก token แล้วล้างข้อมูลในเครื่องเสมอ (แม้หลังบ้านตอบไม่สำเร็จ) */
    logout(): Observable<void> {
        return this.http.post<void>(apiUrl('/auth/logout'), null).pipe(
            catchError(() => of(undefined)),
            map(() => undefined),
            finalize(() => {
                this.clearSession();
                this.router.navigate(['/auth/login']);
            })
        );
    }

    /** token หมดอายุหรือถูกยกเลิก (หลังบ้านตอบ 401): ล้าง session แล้วพากลับหน้าเข้าสู่ระบบ */
    expireSession(returnUrl: string) {
        if (!this.session && !this.userState()) return;
        this.clearSession();
        this.router.navigate(['/auth/login'], { queryParams: { returnUrl: returnUrl.startsWith('/auth') ? null : returnUrl, reason: 'expired' } });
    }

    private clearSession() {
        this.session = null;
        writeSession(null);
        this.userState.set(null);
        this.loadError.set(false);
    }

    private setUser(user: ApiSchemas['CurrentUser']) {
        this.loadError.set(false);
        this.userState.set({ ...user, lastLoginAt: toDate(user.lastLoginAt) });
    }

    private loadCatalog(): Observable<RoleCatalog | null> {
        return this.http.get<RoleCatalog>(apiUrl('/roles')).pipe(
            tap((catalog) => this.catalogState.set(catalog)),
            catchError(() => of(null))
        );
    }
}
