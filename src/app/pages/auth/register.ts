import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { RegistrationInput, UserAccountService } from '@/app/pages/service/user-account.service';
import { AppFloatingConfigurator } from '../../layout/component/app.floatingconfigurator';

const blankForm = (): RegistrationInput & { confirmPassword: string } => ({ fullName: '', email: '', phone: '', employeeCode: '', position: '', note: '', password: '', confirmPassword: '' });

/** สมัครสมาชิก: ส่งคำขอ แล้วรอแอดมินหรือเจ้าของบริษัทอนุมัติก่อนเข้าใช้งาน */
@Component({
    selector: 'app-register',
    standalone: true,
    imports: [AppFloatingConfigurator, ButtonModule, FormsModule, InputTextModule, PasswordModule, RouterLink, TextareaModule],
    template: `
        <app-floating-configurator />
        <div class="bg-surface-50 dark:bg-surface-950 flex items-center justify-center min-h-screen px-4 py-10">
            <div class="w-full bg-surface-0 dark:bg-surface-900 rounded-3xl shadow-sm py-10 px-6 sm:px-12" style="max-width: 40rem">
                <div class="text-center mb-8">
                    <img src="/pp-prime-logo.svg" alt="" width="72" height="51" class="mb-4 mx-auto block" />
                    <h1 class="text-surface-900 dark:text-surface-0 text-2xl font-semibold m-0 mb-2">สมัครสมาชิก</h1>
                    <p class="text-muted-color m-0">ระบบบริหารงานก่อสร้าง PP Prime Construction</p>
                </div>

                @if (submitted(); as email) {
                    <div class="text-center" role="status">
                        <span class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 mb-4"><i class="pi pi-clock text-2xl"></i></span>
                        <h2 class="text-xl font-semibold m-0 mb-2">ส่งคำขอแล้ว รออนุมัติ</h2>
                        <p class="text-muted-color mt-0 mb-6">
                            แอดมินหรือเจ้าของบริษัทจะตรวจสอบคำขอของคุณ เมื่ออนุมัติแล้วเข้าสู่ระบบด้วย <strong class="text-color">{{ email }}</strong> และรหัสผ่านที่ตั้งไว้ได้ทันที
                        </p>
                        <a pButton routerLink="/auth/login" label="กลับหน้าเข้าสู่ระบบ" icon="pi pi-arrow-left" [outlined]="true"></a>
                    </div>
                } @else {
                    <div class="flex items-start gap-3 rounded-lg px-4 py-3 mb-6 text-sm bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-200" role="note">
                        <i class="pi pi-info-circle mt-0.5"></i>
                        <span>บัญชีจะใช้งานได้หลังแอดมินหรือเจ้าของบริษัทอนุมัติ และกำหนดบทบาทให้ตามตำแหน่งงาน</span>
                    </div>

                    <form class="grid grid-cols-1 sm:grid-cols-2 gap-4" (ngSubmit)="submit()" novalidate>
                        <div class="sm:col-span-2">
                            <label for="reg-name" class="block font-medium mb-2">ชื่อ-นามสกุล <span class="text-red-600" aria-hidden="true">*</span></label>
                            <input pInputText id="reg-name" name="fullName" autocomplete="name" class="w-full" [(ngModel)]="form.fullName" [attr.aria-invalid]="!!errors()['fullName']" />
                            @if (errors()['fullName']) {
                                <small class="text-red-600 dark:text-red-400">{{ errors()['fullName'] }}</small>
                            }
                        </div>
                        <div>
                            <label for="reg-email" class="block font-medium mb-2">อีเมล (ใช้เข้าสู่ระบบ) <span class="text-red-600" aria-hidden="true">*</span></label>
                            <input pInputText id="reg-email" name="email" type="email" autocomplete="email" class="w-full" [(ngModel)]="form.email" [attr.aria-invalid]="!!errors()['email']" />
                            @if (errors()['email']) {
                                <small class="text-red-600 dark:text-red-400">{{ errors()['email'] }}</small>
                            }
                        </div>
                        <div>
                            <label for="reg-phone" class="block font-medium mb-2">เบอร์โทร <span class="text-red-600" aria-hidden="true">*</span></label>
                            <input pInputText id="reg-phone" name="phone" type="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" class="w-full" [(ngModel)]="form.phone" [attr.aria-invalid]="!!errors()['phone']" />
                            @if (errors()['phone']) {
                                <small class="text-red-600 dark:text-red-400">{{ errors()['phone'] }}</small>
                            }
                        </div>
                        <div>
                            <label for="reg-code" class="block font-medium mb-2">รหัสบุคลากร</label>
                            <input pInputText id="reg-code" name="employeeCode" placeholder="เช่น EMP690001 (ถ้ามี)" class="w-full" [(ngModel)]="form.employeeCode" />
                        </div>
                        <div>
                            <label for="reg-position" class="block font-medium mb-2">ตำแหน่งงาน</label>
                            <input pInputText id="reg-position" name="position" autocomplete="organization-title" class="w-full" [(ngModel)]="form.position" />
                        </div>
                        <div>
                            <label for="reg-password" class="block font-medium mb-2">รหัสผ่าน <span class="text-red-600" aria-hidden="true">*</span></label>
                            <p-password inputId="reg-password" name="password" [(ngModel)]="form.password" [toggleMask]="true" [feedback]="false" [fluid]="true" autocomplete="new-password" [attr.aria-invalid]="!!errors()['password']" />
                            @if (errors()['password']) {
                                <small class="text-red-600 dark:text-red-400">{{ errors()['password'] }}</small>
                            } @else {
                                <small class="text-muted-color">อย่างน้อย 8 ตัวอักษร</small>
                            }
                        </div>
                        <div>
                            <label for="reg-confirm" class="block font-medium mb-2">ยืนยันรหัสผ่าน <span class="text-red-600" aria-hidden="true">*</span></label>
                            <p-password
                                inputId="reg-confirm"
                                name="confirmPassword"
                                [(ngModel)]="form.confirmPassword"
                                [toggleMask]="true"
                                [feedback]="false"
                                [fluid]="true"
                                autocomplete="new-password"
                                [attr.aria-invalid]="!!errors()['confirmPassword']"
                            />
                            @if (errors()['confirmPassword']) {
                                <small class="text-red-600 dark:text-red-400">{{ errors()['confirmPassword'] }}</small>
                            }
                        </div>
                        <div class="sm:col-span-2">
                            <label for="reg-note" class="block font-medium mb-2">ข้อความถึงผู้อนุมัติ</label>
                            <textarea pTextarea id="reg-note" name="note" rows="2" class="w-full" placeholder="เช่น ประจำโครงการไหน ใครเป็นหัวหน้างาน" [(ngModel)]="form.note"></textarea>
                        </div>

                        @if (generalError()) {
                            <div class="sm:col-span-2 rounded-lg px-3 py-2 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
                        }
                        <div class="sm:col-span-2 flex flex-col gap-4 mt-2">
                            <button pButton type="submit" label="ส่งคำขอสมัครสมาชิก" icon="pi pi-send" class="w-full" [loading]="saving()"></button>
                            <p class="text-center text-muted-color m-0">มีบัญชีแล้ว? <a routerLink="/auth/login" class="text-primary font-medium">เข้าสู่ระบบ</a></p>
                        </div>
                    </form>
                }
            </div>
        </div>
    `
})
export class Register {
    private readonly service = inject(UserAccountService);

    form = blankForm();
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');
    /** อีเมลที่ส่งคำขอแล้ว (แสดงหน้ารออนุมัติ) */
    readonly submitted = signal<string | null>(null);

    submit() {
        this.errors.set({});
        this.generalError.set('');
        if (this.form.password !== this.form.confirmPassword) {
            this.errors.set({ confirmPassword: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
            return;
        }
        const { confirmPassword: _confirm, ...input } = this.form;
        this.saving.set(true);
        this.service.register(input).subscribe({
            next: () => {
                this.saving.set(false);
                this.submitted.set(input.email.trim());
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'ส่งคำขอไม่สำเร็จ'));
            }
        });
    }
}
