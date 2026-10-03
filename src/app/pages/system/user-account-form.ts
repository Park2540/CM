import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectModule } from 'primeng/select';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService, Permission, RoleId } from '@/app/pages/service/auth.service';
import { PersonnelService } from '@/app/pages/service/personnel.service';
import { ProjectService } from '@/app/pages/service/project.service';
import { PERMISSIONS, PERMISSION_INFO, Registration, UserAccount, UserAccountService } from '@/app/pages/service/user-account.service';
import { apiResource } from '@/app/api/api-resource';

/** บุคลากรที่ฟอร์มสร้างบัญชีให้ (ส่งมาเมื่อเปิดจากหน้าบุคลากร) */
export type AccountPersonnel = { id: string; fullName: string; email?: string };

/**
 * ฟอร์มสร้าง/แก้บัญชีผู้ใช้: บทบาท โครงการ และสิทธิ์รายคน
 * สิทธิ์ที่ใช้จริง = สิทธิ์ของบทบาท + ที่ติ๊กเพิ่ม − ที่ติ๊กออก (หลังบ้านคำนวณซ้ำ)
 */
@Component({
    selector: 'app-user-account-form',
    standalone: true,
    imports: [ButtonModule, DialogModule, FormsModule, InputTextModule, MultiSelectModule, NgClass, RouterLink, SelectModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && close()" [modal]="true" [draggable]="false" [style]="{ width: 'min(46rem, 95vw)' }" [header]="header()">
            <form id="user-account-form" class="flex flex-col gap-5" (ngSubmit)="save()" novalidate>
                @if (registration(); as request) {
                    <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 m-0 rounded-lg p-3 bg-emphasis text-sm">
                        <div>
                            <dt class="text-muted-color inline">อีเมล:</dt>
                            <dd class="inline m-0 break-all">{{ request.email }}</dd>
                        </div>
                        <div>
                            <dt class="text-muted-color inline">เบอร์โทร:</dt>
                            <dd class="inline m-0">{{ request.phone }}</dd>
                        </div>
                        <div>
                            <dt class="text-muted-color inline">รหัสบุคลากรที่แจ้ง:</dt>
                            <dd class="inline m-0">{{ request.employeeCode || '-' }}</dd>
                        </div>
                        <div>
                            <dt class="text-muted-color inline">ตำแหน่งที่แจ้ง:</dt>
                            <dd class="inline m-0">{{ request.position || '-' }}</dd>
                        </div>
                        @if (request.note) {
                            <div class="sm:col-span-2">
                                <dt class="text-muted-color inline">ข้อความ:</dt>
                                <dd class="inline m-0">{{ request.note }}</dd>
                            </div>
                        }
                    </dl>
                }
                @if (account(); as current) {
                    <div class="text-sm text-muted-color">{{ current.employeeCode }} · {{ current.position || 'ไม่ระบุตำแหน่ง' }}</div>
                } @else if (personnel(); as fixed) {
                    <div>
                        <span class="block text-sm font-semibold mb-2">บุคลากร</span>
                        <div class="font-semibold">{{ fixed.fullName }}</div>
                    </div>
                } @else {
                    <div>
                        <label for="account-personnel" class="block text-sm font-semibold mb-2">{{ registration() ? 'ผูกกับบุคลากรในทะเบียน' : 'บุคลากร' }} <span class="text-red-600" aria-hidden="true">*</span></label>
                        <p-select
                            inputId="account-personnel"
                            [options]="personnelOptions()"
                            [ngModel]="personnelId()"
                            (ngModelChange)="selectPersonnel($event)"
                            name="personnelId"
                            optionLabel="label"
                            optionValue="value"
                            [filter]="true"
                            filterBy="label"
                            [loading]="candidates.isLoading()"
                            placeholder="เลือกบุคลากรที่ยังไม่มีบัญชี"
                            emptyMessage="บุคลากรทุกคนมีบัญชีแล้ว"
                            class="w-full"
                            [attr.aria-invalid]="!!errors()['personnelId']"
                        />
                        @if (errors()['personnelId']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['personnelId'] }}</small>
                        } @else if (registration(); as request) {
                            <small class="text-muted-color">
                                @if (request.suggestedPersonnelId) {
                                    ระบบจับคู่ให้จากรหัสบุคลากร อีเมล หรือชื่อ ตรวจสอบให้ถูกคน
                                } @else {
                                    ไม่พบในทะเบียน ถ้าเป็นบุคลากรใหม่ให้<a routerLink="/master/personnel/new" target="_blank" class="text-primary">เพิ่มบุคลากร</a>ก่อน แล้วเปิดฟอร์มนี้ใหม่
                                }
                            </small>
                        }
                    </div>
                }

                <div>
                    <label for="account-email" class="block text-sm font-semibold mb-2">อีเมลสำหรับเข้าสู่ระบบ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="account-email" name="email" type="email" autocomplete="off" class="w-full" [ngModel]="email()" (ngModelChange)="email.set($event)" [readonly]="!!registration()" [attr.aria-invalid]="!!errors()['email']" />
                    @if (errors()['email']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['email'] }}</small>
                    } @else if (registration()) {
                        <small class="text-muted-color">อีเมลที่ผู้สมัครใช้ ผู้สมัครตั้งรหัสผ่านไว้แล้ว เข้าสู่ระบบได้ทันทีที่อนุมัติ</small>
                    } @else if (!account()) {
                        <small class="text-muted-color">ระบบจะส่งลิงก์ตั้งรหัสผ่านไปที่อีเมลนี้</small>
                    }
                </div>

                <div>
                    <label for="account-role" class="block text-sm font-semibold mb-2">บทบาท <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-select
                        inputId="account-role"
                        [options]="roleGroups()"
                        [group]="true"
                        optionGroupLabel="label"
                        optionGroupChildren="items"
                        optionLabel="label"
                        optionValue="value"
                        [ngModel]="roleId()"
                        (ngModelChange)="selectRole($event)"
                        name="roleId"
                        placeholder="เลือกบทบาท"
                        [disabled]="isSelf()"
                        class="w-full"
                        [attr.aria-invalid]="!!errors()['roleId']"
                    />
                    @if (errors()['roleId']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['roleId'] }}</small>
                    } @else if (isSelf()) {
                        <small class="text-muted-color">แก้บทบาทของตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นเป็นผู้แก้</small>
                    } @else if (role(); as selected) {
                        <small class="text-muted-color">{{ selected.access }}</small>
                    }
                </div>

                @if (role()?.group === 'project') {
                    <div>
                        <label for="account-projects" class="block text-sm font-semibold mb-2">โครงการที่เข้าถึงได้ <span class="text-red-600" aria-hidden="true">*</span></label>
                        <p-multiselect
                            inputId="account-projects"
                            [options]="projectOptions()"
                            [ngModel]="projectCodes()"
                            (ngModelChange)="projectCodes.set($event)"
                            name="projectCodes"
                            optionLabel="label"
                            optionValue="value"
                            [filter]="true"
                            display="chip"
                            [loading]="projects.isLoading()"
                            placeholder="เลือกโครงการ"
                            class="w-full"
                            [attr.aria-invalid]="!!errors()['projectCodes']"
                        />
                        @if (errors()['projectCodes']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['projectCodes'] }}</small>
                        } @else {
                            <small class="text-muted-color">ทีมประจำโครงการเห็นเฉพาะโครงการที่เลือก</small>
                        }
                    </div>
                } @else if (role()) {
                    <p class="text-sm text-muted-color m-0"><i class="pi pi-globe mr-1"></i>ทีมภายในบริษัทเห็นได้ทุกโครงการ</p>
                }

                <fieldset class="border-0 p-0 m-0 min-w-0">
                    <legend class="flex flex-wrap items-baseline justify-between gap-2 w-full text-sm font-semibold mb-2 p-0">
                        <span>สิทธิ์</span>
                        @if (overrideCount()) {
                            <button type="button" class="p-0 bg-transparent border-0 text-primary text-sm cursor-pointer" (click)="resetPermissions()">คืนค่าตามบทบาท ({{ overrideCount() }} รายการที่ปรับ)</button>
                        }
                    </legend>
                    @if (!role()) {
                        <p class="text-sm text-muted-color m-0">เลือกบทบาทก่อน ระบบจะติ๊กสิทธิ์ตั้งต้นของบทบาทให้</p>
                    } @else {
                        <ul class="list-none p-0 m-0 border border-surface rounded-lg overflow-hidden">
                            @for (permission of permissions; track permission) {
                                <li class="border-b border-surface last:border-b-0">
                                    <label class="flex items-start gap-3 px-3 py-2.5" [ngClass]="lockedPermission(permission) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:bg-emphasis'">
                                        <input type="checkbox" class="mt-1 accent-[var(--p-primary-color)]" [checked]="checked().has(permission)" [disabled]="lockedPermission(permission)" (change)="togglePermission(permission)" />
                                        <span class="flex-1 min-w-0">
                                            <span class="font-semibold">{{ info[permission].label }}</span>
                                            <span class="block text-xs text-muted-color">{{ info[permission].description }}</span>
                                        </span>
                                        @switch (permissionSource(permission)) {
                                            @case ('role') {
                                                <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis text-muted-color whitespace-nowrap">ตามบทบาท</span>
                                            }
                                            @case ('granted') {
                                                <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300 whitespace-nowrap">เพิ่มรายคน</span>
                                            }
                                            @case ('revoked') {
                                                <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 whitespace-nowrap">ถอนออก</span>
                                            }
                                        }
                                    </label>
                                </li>
                            }
                        </ul>
                        @if (errors()['permissions']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['permissions'] }}</small>
                        }
                    }
                </fieldset>
            </form>
            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="close()"></button>
                <button
                    pButton
                    type="submit"
                    form="user-account-form"
                    [icon]="registration() ? 'pi pi-check' : account() ? 'pi pi-check' : 'pi pi-send'"
                    [label]="registration() ? 'อนุมัติและเปิดใช้บัญชี' : account() ? 'บันทึก' : 'สร้างบัญชีและส่งคำเชิญ'"
                    [loading]="saving()"
                ></button>
            </ng-template>
        </p-dialog>
    `
})
export class UserAccountForm {
    private readonly auth = inject(AuthService);
    private readonly service = inject(UserAccountService);
    private readonly personnelService = inject(PersonnelService);
    private readonly projectService = inject(ProjectService);

    /** บัญชีที่แก้ — null = สร้างใหม่ */
    readonly account = input<UserAccount | null>(null);
    /** สร้างบัญชีให้บุคลากรคนนี้ (ไม่ต้องเลือกในฟอร์ม) */
    readonly personnel = input<AccountPersonnel | null>(null);
    /** อนุมัติคำขอสมัครสมาชิก: ผูกบุคลากร กำหนดบทบาท/สิทธิ์ แล้วเปิดใช้บัญชี */
    readonly registration = input<Registration | null>(null);
    readonly saved = output<UserAccount>();
    readonly closed = output<void>();

    readonly info = PERMISSION_INFO;
    readonly permissions = PERMISSIONS;

    readonly personnelId = linkedSignal(() => this.personnel()?.id ?? this.registration()?.suggestedPersonnelId ?? null);
    readonly email = linkedSignal(() => this.account()?.email ?? this.registration()?.email ?? this.personnel()?.email ?? '');
    readonly roleId = linkedSignal<RoleId | null>(() => this.account()?.roleId ?? null);
    readonly projectCodes = linkedSignal(() => this.account()?.projectCodes ?? []);
    /** สิทธิ์ที่ติ๊กอยู่ (= สิทธิ์ที่ใช้จริง) */
    readonly checked = linkedSignal(() => new Set<Permission>(this.account()?.permissions ?? []));

    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    private readonly catalog = this.auth.roleCatalog;
    readonly role = computed(() => this.catalog()?.roles.find((role) => role.id === this.roleId()));
    readonly header = computed(() => {
        const account = this.account();
        const registration = this.registration();
        if (registration) return 'อนุมัติคำขอสมัคร ' + registration.fullName;
        return account ? 'แก้ไขสิทธิ์ ' + account.name : 'สร้างบัญชีผู้ใช้';
    });
    readonly isSelf = computed(() => !!this.account() && this.account()!.id === this.auth.currentUser()?.id);
    /** บุคลากรภายนอก (ผู้รับเหมา ลูกค้า ผู้ขาย) ไม่ได้สร้างบัญชีจากทะเบียนบุคลากร */
    readonly roleGroups = computed(() => {
        const catalog = this.catalog();
        if (!catalog) return [];
        return catalog.groups.filter((group) => group.id !== 'external').map((group) => ({ label: group.label, items: catalog.roles.filter((role) => role.group === group.id).map((role) => ({ value: role.id, label: role.label })) }));
    });

    readonly projects = apiResource({ stream: () => this.projectService.list(), defaultValue: [] });
    readonly projectOptions = computed(() =>
        this.projects
            .value()
            .filter((project) => project.status !== 'completed' || this.projectCodes().includes(project.code))
            .map((project) => ({ value: project.code, label: `${project.code} ${project.name}` }))
    );

    /** บุคลากรที่ยังไม่มีบัญชี (เฉพาะตอนสร้างและไม่ได้ระบุบุคลากรมา) */
    readonly candidates = apiResource({
        params: () => (this.account() || this.personnel() ? undefined : true),
        stream: () => this.personnelService.list(),
        defaultValue: []
    });
    private readonly existingAccounts = apiResource({
        params: () => (this.account() || this.personnel() ? undefined : true),
        stream: () => this.service.list(),
        defaultValue: []
    });
    readonly personnelOptions = computed(() => {
        const taken = new Set(this.existingAccounts.value().map((account) => account.personnelId));
        return this.candidates
            .value()
            .filter((person) => !taken.has(person.id))
            .map((person) => ({ value: person.id, label: `${person.fullName} (${person.employeeCode})`, email: person.email }));
    });

    readonly overrideCount = computed(() => this.permissions.filter((permission) => this.permissionSource(permission) === 'granted' || this.permissionSource(permission) === 'revoked').length);

    selectPersonnel(id: string | null) {
        this.personnelId.set(id);
        const person = this.personnelOptions().find((option) => option.value === id);
        if (person?.email && !this.email()) this.email.set(person.email);
    }

    /** เปลี่ยนบทบาท: สิทธิ์กลับเป็นค่าตั้งต้นของบทบาทใหม่ */
    selectRole(roleId: RoleId) {
        this.roleId.set(roleId);
        this.resetPermissions();
        if (this.role()?.group !== 'project') this.projectCodes.set([]);
    }

    resetPermissions() {
        this.checked.set(new Set(this.role()?.permissions ?? []));
    }

    togglePermission(permission: Permission) {
        this.checked.update((current) => {
            const next = new Set(current);
            if (!next.delete(permission)) next.add(permission);
            return next;
        });
    }

    permissionSource(permission: Permission): 'role' | 'granted' | 'revoked' | null {
        const fromRole = this.role()?.permissions.includes(permission) ?? false;
        const checked = this.checked().has(permission);
        if (fromRole) return checked ? 'role' : 'revoked';
        return checked ? 'granted' : null;
    }

    /** ป้องกันการถอนสิทธิ์จัดการผู้ใช้ของตัวเอง */
    lockedPermission(permission: Permission) {
        return this.isSelf() && permission === 'user.manage';
    }

    close() {
        if (!this.saving()) this.closed.emit();
    }

    save() {
        const base = new Set(this.role()?.permissions ?? []);
        const checked = this.checked();
        const input = {
            email: this.email().trim(),
            roleId: this.roleId()!,
            projectCodes: this.role()?.group === 'project' ? this.projectCodes() : [],
            grantedPermissions: this.permissions.filter((permission) => checked.has(permission) && !base.has(permission)),
            revokedPermissions: this.permissions.filter((permission) => !checked.has(permission) && base.has(permission))
        };
        const account = this.account();
        const registration = this.registration();
        const personnelId = this.personnelId() ?? '';
        const request = registration ? this.service.approveRegistration(registration.id, { ...input, personnelId }) : account ? this.service.update(account.id, input) : this.service.create({ ...input, personnelId });

        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        request.subscribe({
            next: (saved) => {
                this.saving.set(false);
                this.saved.emit(saved);
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }
}
