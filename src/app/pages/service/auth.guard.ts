import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, throwError } from 'rxjs';
import { environment } from '@/environments/environment';
import { AuthService } from './auth.service';

const isApiRequest = (url: string) => url.startsWith(environment.apiBaseUrl);
const isLoginRequest = (url: string) => url.startsWith(`${environment.apiBaseUrl}/auth/login`);

/** แนบ token กับทุกคำขอ API และพากลับหน้าเข้าสู่ระบบเมื่อหลังบ้านตอบ 401 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
    if (!isApiRequest(request.url)) return next(request);
    const auth = inject(AuthService);
    const router = inject(Router);
    const token = auth.token();
    const authorized = token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
    return next(authorized).pipe(
        catchError((error: unknown) => {
            // 401 จากหน้าเข้าสู่ระบบ = รหัสผ่านผิด ให้หน้าเข้าสู่ระบบแสดงเอง
            if (error instanceof HttpErrorResponse && error.status === 401 && !isLoginRequest(request.url)) auth.expireSession(router.url);
            return throwError(() => error);
        })
    );
};

/** หน้าที่ต้องเข้าสู่ระบบ: ยังไม่ล็อกอินพาไปหน้าเข้าสู่ระบบพร้อม returnUrl */
export const authGuard: CanActivateFn = (_route, state) => {
    const router = inject(Router);
    return inject(AuthService)
        .ensureUser()
        .pipe(map((loggedIn) => loggedIn || router.createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url === '/' ? null : state.url } })));
};

/** หน้าเข้าสู่ระบบ/สมัครสมาชิก: ล็อกอินอยู่แล้วพาไปหน้าแรก */
export const guestGuard: CanActivateFn = () => {
    const router = inject(Router);
    return inject(AuthService)
        .ensureUser()
        .pipe(map((loggedIn) => (loggedIn ? router.createUrlTree(['/']) : true)));
};
