import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { map } from 'rxjs';
import { problemMessage } from '@/app/api/api';
import { ACCOUNT_STATUS, PERMISSION_INFO, UserAccount, UserAccountService } from '@/app/pages/service/user-account.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { AccountPersonnel, UserAccountForm } from '@/app/pages/system/user-account-form';
import { apiResource } from '@/app/api/api-resource';

/** ส่วน "บัญชีผู้ใช้และสิทธิ์" ในหน้าบุคลากร (แสดงเฉพาะผู้มีสิทธิ์ user.manage) */
@Component({
    selector: 'app-personnel-account-section',
    standalone: true,
    imports: [ButtonModule, RouterLink, TagModule, ThaiDatePipe, UserAccountForm],
    template: `
        <section id="account" class="border-t border-surface py-5" aria-labelledby="account-heading">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <h2 id="account-heading" class="font-semibold text-xl m-0">10. บัญชีผู้ใช้และสิทธิ์</h2>
                <a routerLink="/system/users" class="text-primary text-sm">จัดการผู้ใช้ทั้งหมด <i class="pi pi-arrow-right text-xs"></i></a>
            </div>

            @if (account.error(); as error) {
                <div class="rounded-lg px-4 py-3 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <i class="pi pi-exclamation-triangle mr-2"></i>โหลดบัญชีผู้ใช้ไม่สำเร็จ: {{ errorText(error) }}
                    <button pButton type="button" [text]="true" size="small" label="ลองใหม่" (click)="account.reload()"></button>
                </div>
            } @else if (account.isLoading()) {
                <p class="text-muted-color m-0"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด...</p>
            } @else if (account.value(); as current) {
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                    <div>
                        <div class="text-sm text-muted-color">สถานะ</div>
                        <p-tag class="mt-1" [value]="statusInfo[current.status].label" [severity]="statusInfo[current.status].severity" />
                    </div>
                    <div>
                        <div class="text-sm text-muted-color">อีเมลเข้าสู่ระบบ</div>
                        <div class="mt-1 break-all">{{ current.email }}</div>
                    </div>
                    <div>
                        <div class="text-sm text-muted-color">บทบาท</div>
                        <div class="mt-1 font-semibold">{{ current.roleLabel }}</div>
                        <div class="text-xs text-muted-color">{{ current.projectCodes.length ? current.projectCodes.join(', ') : 'ทุกโครงการ' }}</div>
                    </div>
                    <div>
                        <div class="text-sm text-muted-color">{{ current.status === 'invited' ? 'ส่งคำเชิญเมื่อ' : 'เข้าสู่ระบบล่าสุด' }}</div>
                        <div class="mt-1">{{ (current.status === 'invited' ? current.invitedAt : current.lastLoginAt) | thaiDate: 'dateTime' }}</div>
                    </div>
                </div>
                <div class="text-sm text-muted-color mb-2">สิทธิ์ที่ใช้งานได้</div>
                <div class="flex flex-wrap gap-2 mb-4">
                    @for (permission of current.permissions; track permission) {
                        <span class="text-sm px-2 py-1 rounded-full" [class]="current.grantedPermissions.includes(permission) ? 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' : 'bg-emphasis'">
                            {{ info[permission].label }}
                        </span>
                    } @empty {
                        <span class="text-sm text-muted-color">ใช้งานทั่วไปตามบทบาท (ไม่มีสิทธิ์พิเศษ)</span>
                    }
                    @for (permission of current.revokedPermissions; track permission) {
                        <span class="text-sm px-2 py-1 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 line-through" [attr.aria-label]="'ถอนสิทธิ์ ' + info[permission].label">{{ info[permission].label }}</span>
                    }
                </div>
                <button pButton type="button" icon="pi pi-pencil" label="แก้ไขบทบาทและสิทธิ์" [outlined]="true" (click)="formOpen.set(true)"></button>
            } @else {
                <p class="text-muted-color mt-0">ยังไม่มีบัญชีผู้ใช้ บุคลากรคนนี้ยังเข้าสู่ระบบไม่ได้</p>
                <button pButton type="button" icon="pi pi-user-plus" label="สร้างบัญชีผู้ใช้" (click)="formOpen.set(true)"></button>
            }
        </section>

        @if (formOpen()) {
            <app-user-account-form [account]="account.value() ?? null" [personnel]="account.value() ? null : personnel()" (saved)="onSaved()" (closed)="formOpen.set(false)" />
        }
    `
})
export class PersonnelAccountSection {
    private readonly service = inject(UserAccountService);

    readonly personnel = input.required<AccountPersonnel>();

    readonly info = PERMISSION_INFO;
    readonly statusInfo = ACCOUNT_STATUS;
    readonly formOpen = signal(false);

    private readonly personnelId = computed(() => this.personnel().id);
    readonly account = apiResource<UserAccount | undefined, string>({
        params: () => this.personnelId(),
        stream: ({ params: personnelId }) => this.service.list({ personnelId }).pipe(map((accounts) => accounts[0]))
    });

    onSaved() {
        this.formOpen.set(false);
        this.account.reload();
    }

    errorText(error: unknown) {
        return problemMessage(error);
    }
}
