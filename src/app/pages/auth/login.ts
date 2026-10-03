import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { environment } from '@/environments/environment';
import { AppFloatingConfigurator } from '../../layout/component/app.floatingconfigurator';

/** บัญชีตัวอย่างในฐานข้อมูลตั้งต้น (แสดงเมื่อ showDemoLogins เปิดอยู่) — รหัสผ่าน demo1234 ทุกบัญชี */
const DEMO_ACCOUNTS = [
    { email: 'owner@example.invalid', label: 'เจ้าของบริษัท', note: 'ทุกสิทธิ์' },
    { email: 'thanakrit@example.invalid', label: 'ผู้จัดการโครงการ', note: 'CR690001, CR690002' },
    { email: 'pimchanok@example.invalid', label: 'ฝ่ายจัดซื้อ', note: 'ไม่มีสิทธิ์พิเศษ' },
    { email: 'kittisak@example.invalid', label: 'โฟร์แมน', note: 'CR690001' },
    { email: 'prasert@example.invalid', label: 'วิศวกร', note: 'บัญชีถูกระงับ' },
    { email: 'somsak@example.invalid', label: 'ผู้สมัครใหม่', note: 'คำขอรออนุมัติ' }
];

/** เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน (POST /auth/login) */
@Component({
    selector: 'app-login',
    standalone: true,
    imports: [ButtonModule, CheckboxModule, InputTextModule, PasswordModule, FormsModule, RouterModule, AppFloatingConfigurator],
    template: `
        <app-floating-configurator />
        <div class="bg-surface-50 dark:bg-surface-950 flex items-center justify-center min-h-screen px-4 py-10">
            <div class="w-full bg-surface-0 dark:bg-surface-900 rounded-3xl shadow-sm py-12 px-6 sm:px-14" style="max-width: 32rem">
                <div class="text-center mb-8">
                    <img src="/pp-prime-logo.svg" alt="" width="88" height="62" class="mb-6 mx-auto block" />
                    <h1 class="text-surface-900 dark:text-surface-0 text-3xl font-medium m-0 mb-3">PP Prime Construction</h1>
                    <span class="text-muted-color font-medium">เข้าสู่ระบบบริหารงานก่อสร้าง</span>
                </div>

                @if (expired) {
                    <div class="flex items-start gap-2 rounded-lg px-4 py-3 mb-6 text-sm bg-orange-50 text-orange-900 dark:bg-orange-500/10 dark:text-orange-200" role="status">
                        <i class="pi pi-clock mt-0.5"></i>
                        <span>เซสชันหมดอายุหรือบัญชีถูกเปลี่ยนสถานะ กรุณาเข้าสู่ระบบอีกครั้ง</span>
                    </div>
                }

                <form (ngSubmit)="submit()" novalidate>
                    <label for="login-email" class="block text-surface-900 dark:text-surface-0 font-medium mb-2">อีเมล</label>
                    <input pInputText id="login-email" name="email" type="email" autocomplete="username" class="w-full" [(ngModel)]="email" [attr.aria-invalid]="!!errors()['email']" />
                    @if (errors()['email']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['email'] }}</small>
                    }

                    <label for="login-password" class="block text-surface-900 dark:text-surface-0 font-medium mb-2 mt-5">รหัสผ่าน</label>
                    <p-password inputId="login-password" name="password" [(ngModel)]="password" autocomplete="current-password" [toggleMask]="true" [feedback]="false" [fluid]="true" [attr.aria-invalid]="!!errors()['password']" />
                    @if (errors()['password']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['password'] }}</small>
                    }

                    <div class="flex flex-wrap items-center justify-between gap-4 mt-4 mb-6">
                        <div class="flex items-center">
                            <p-checkbox [(ngModel)]="remember" name="remember" inputId="login-remember" [binary]="true" class="mr-2" />
                            <label for="login-remember">จดจำฉันไว้ 30 วัน</label>
                        </div>
                        <span class="text-sm text-muted-color">ลืมรหัสผ่าน? ติดต่อแอดมิน</span>
                    </div>

                    @if (failure(); as problem) {
                        <div
                            class="flex items-start gap-2 rounded-lg px-4 py-3 mb-4 text-sm"
                            [class]="problem.tone === 'info' ? 'bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-200' : 'bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200'"
                            role="alert"
                        >
                            <i class="pi mt-0.5" [class.pi-clock]="problem.tone === 'info'" [class.pi-exclamation-triangle]="problem.tone !== 'info'"></i>
                            <span>
                                <strong>{{ problem.title }}</strong>
                                @if (problem.detail) {
                                    <span class="block">{{ problem.detail }}</span>
                                }
                            </span>
                        </div>
                    }

                    <p-button type="submit" label="เข้าสู่ระบบ" icon="pi pi-sign-in" styleClass="w-full" [loading]="loading()" />
                </form>

                <p class="text-center text-muted-color mt-6 mb-0">ยังไม่มีบัญชี? <a routerLink="/auth/register" class="text-primary font-medium">สมัครสมาชิก</a></p>
                <p class="text-center text-xs text-muted-color mt-2 mb-0">บัญชีใหม่ใช้งานได้หลังแอดมินหรือเจ้าของบริษัทอนุมัติ</p>

                @if (demoAccounts.length) {
                    <details class="mt-8 rounded-lg border border-surface p-3 text-sm">
                        <summary class="cursor-pointer font-medium">บัญชีทดลอง · รหัสผ่าน demo1234</summary>
                        <ul class="list-none p-0 m-0 mt-2">
                            @for (account of demoAccounts; track account.email) {
                                <li>
                                    <button type="button" class="w-full flex justify-between gap-3 px-2 py-1.5 rounded bg-transparent border-0 cursor-pointer text-left text-color hover:bg-emphasis" (click)="useDemo(account.email)">
                                        <span
                                            >{{ account.label }} <span class="text-muted-color">· {{ account.note }}</span></span
                                        >
                                        <span class="text-muted-color truncate">{{ account.email }}</span>
                                    </button>
                                </li>
                            }
                        </ul>
                    </details>
                }
            </div>
        </div>
    `
})
export class Login {
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    readonly demoAccounts = environment.showDemoLogins ? DEMO_ACCOUNTS : [];
    readonly expired = this.route.snapshot.queryParamMap.get('reason') === 'expired';

    email = '';
    password = '';
    remember = false;
    readonly loading = signal(false);
    readonly errors = signal<Record<string, string>>({});
    /** info = รออนุมัติ (ไม่ใช่ความผิดของผู้ใช้), error = อื่น ๆ */
    readonly failure = signal<{ title: string; detail?: string; tone: 'info' | 'error' } | null>(null);

    useDemo(email: string) {
        this.email = email;
        this.password = 'demo1234';
        this.failure.set(null);
        this.errors.set({});
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.email.trim()) errors['email'] = 'กรุณาระบุอีเมล';
        if (!this.password) errors['password'] = 'กรุณาระบุรหัสผ่าน';
        this.errors.set(errors);
        this.failure.set(null);
        if (Object.keys(errors).length) return;

        this.loading.set(true);
        this.auth.login(this.email, this.password, this.remember).subscribe({
            next: () => {
                this.loading.set(false);
                this.router.navigateByUrl(this.safeReturnUrl());
            },
            error: (error) => {
                this.loading.set(false);
                this.password = '';
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.title) {
                    this.failure.set({ title: problem.title, detail: problem.detail, tone: problem.title === 'บัญชีรออนุมัติ' ? 'info' : 'error' });
                } else {
                    this.failure.set({ title: problemMessage(error, 'เข้าสู่ระบบไม่สำเร็จ'), tone: 'error' });
                }
            }
        });
    }

    /** กลับไปหน้าที่ผู้ใช้ตั้งใจเปิด (เฉพาะ path ภายในระบบ กันการพาไปเว็บอื่น) */
    private safeReturnUrl(): string {
        const url = this.route.snapshot.queryParamMap.get('returnUrl');
        return url && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/auth') ? url : '/';
    }
}
