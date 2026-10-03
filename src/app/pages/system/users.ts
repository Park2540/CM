import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { debounceTime } from 'rxjs';
import { problemMessage } from '@/app/api/api';
import { AuthService, Permission, RoleId } from '@/app/pages/service/auth.service';
import { PersonnelService } from '@/app/pages/service/personnel.service';
import { ACCOUNT_STATUS, PERMISSIONS, PERMISSION_INFO, Registration, UserAccount, UserAccountService, UserAccountStatus } from '@/app/pages/service/user-account.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { AccountPersonnel, UserAccountForm } from './user-account-form';
import { apiResource } from '@/app/api/api-resource';

/** ผู้ใช้งาน: บัญชีของบุคลากร บทบาท โครงการที่เข้าถึง และสิทธิ์รายคน (ต้องมีสิทธิ์ user.manage) */
@Component({
    selector: 'app-users',
    standalone: true,
    imports: [
        ButtonModule,
        ConfirmDialogModule,
        DialogModule,
        FormsModule,
        IconFieldModule,
        InputIconModule,
        InputTextModule,
        NgTemplateOutlet,
        RouterLink,
        SelectButtonModule,
        SelectModule,
        TableModule,
        TagModule,
        TextareaModule,
        ThaiDatePipe,
        ToastModule,
        TooltipModule,
        UserAccountForm
    ],
    providers: [ConfirmationService, MessageService],
    template: `
        <p-toast />
        <p-confirmdialog />

        @if (!auth.currentUser()) {
            <div class="card text-center text-muted-color py-10"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังตรวจสอบสิทธิ์...</div>
        } @else if (!canManage()) {
            <div class="card text-center py-10">
                <i class="pi pi-lock text-3xl text-muted-color"></i>
                <h1 class="text-xl font-semibold mt-3 mb-1">ไม่มีสิทธิ์เข้าถึง</h1>
                <p class="text-muted-color m-0">หน้านี้สำหรับผู้มีสิทธิ์จัดการผู้ใช้และสิทธิ์</p>
            </div>
        } @else {
            @if (pendingRegistrations().length) {
                <section class="card border-l-4 border-orange-400" aria-labelledby="registrations-heading">
                    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                        <h2 id="registrations-heading" class="text-lg font-semibold m-0">
                            <i class="pi pi-user-plus mr-2 text-orange-500"></i>คำขอสมัครสมาชิกรออนุมัติ
                            <span class="ml-1 px-2 py-0.5 rounded-full text-sm bg-orange-500 text-white">{{ pendingRegistrations().length }}</span>
                        </h2>
                        @if (!canApprove()) {
                            <span class="text-sm text-muted-color"><i class="pi pi-lock mr-1"></i>อนุมัติได้เฉพาะแอดมินหรือเจ้าของบริษัท</span>
                        }
                    </div>
                    <ul class="list-none p-0 m-0">
                        @for (request of pendingRegistrations(); track request.id) {
                            <li class="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 border-t border-surface first:border-t-0">
                                <div class="min-w-0 flex-1" style="min-width: 16rem">
                                    <div class="font-semibold">{{ request.fullName }}</div>
                                    <div class="text-sm text-muted-color break-all">{{ request.email }} · {{ request.phone }}</div>
                                    @if (request.note) {
                                        <div class="text-sm mt-1">"{{ request.note }}"</div>
                                    }
                                </div>
                                <div class="text-sm" style="min-width: 12rem">
                                    <div>{{ request.position || 'ไม่ระบุตำแหน่ง' }}{{ request.employeeCode ? ' · ' + request.employeeCode : '' }}</div>
                                    @if (request.suggestedPersonnelId) {
                                        <div class="text-green-700 dark:text-green-400"><i class="pi pi-link text-xs mr-1"></i>พบในทะเบียน: {{ personnelName(request.suggestedPersonnelId) }}</div>
                                    } @else {
                                        <div class="text-orange-700 dark:text-orange-300"><i class="pi pi-exclamation-circle text-xs mr-1"></i>ไม่พบในทะเบียนบุคลากร</div>
                                    }
                                </div>
                                <div class="text-sm text-muted-color" style="min-width: 8rem">ส่งเมื่อ {{ request.submittedAt | thaiDate: 'dateTime' }}</div>
                                @if (canApprove()) {
                                    <div class="flex gap-2 ml-auto">
                                        <button pButton type="button" label="ปฏิเสธ" icon="pi pi-times" severity="danger" [outlined]="true" size="small" [attr.aria-label]="'ปฏิเสธคำขอของ ' + request.fullName" (click)="openReject(request)"></button>
                                        <button pButton type="button" label="อนุมัติ" icon="pi pi-check" size="small" [attr.aria-label]="'อนุมัติคำขอของ ' + request.fullName" (click)="openApprove(request)"></button>
                                    </div>
                                }
                            </li>
                        }
                    </ul>
                </section>
            }

            <div class="card">
                <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                    <div>
                        <h1 class="text-2xl font-bold m-0">ผู้ใช้งาน</h1>
                        <p class="text-muted-color mt-1 mb-0">บัญชีเข้าสู่ระบบของบุคลากร · สิทธิ์ตั้งต้นมาจากบทบาท (<a routerLink="/system/roles" class="text-primary">ดูตารางบทบาท</a>) ปรับเพิ่ม/ถอนรายคนได้</p>
                    </div>
                    <button pButton type="button" icon="pi pi-user-plus" label="สร้างบัญชีผู้ใช้" (click)="openCreate(null)"></button>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4" role="group" aria-label="สรุปจำนวนผู้ใช้">
                    @for (tile of statusTiles(); track tile.label) {
                        <button
                            type="button"
                            class="text-left rounded-lg border p-3 bg-transparent cursor-pointer text-color hover:border-primary"
                            [class]="status() === tile.status ? 'border-primary bg-primary-50 dark:bg-primary-500/10' : 'border-surface'"
                            [attr.aria-pressed]="status() === tile.status"
                            (click)="status.set(status() === tile.status ? null : tile.status)"
                        >
                            <div class="flex items-center gap-2 text-sm text-muted-color"><i class="pi" [class]="tile.icon"></i>{{ tile.label }}</div>
                            <div class="text-2xl font-bold mt-1 tabular-nums">{{ tile.count }}</div>
                        </button>
                    }
                </div>

                @if (withoutAccount().length) {
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-blue-50 text-blue-900 dark:bg-blue-500/10 dark:text-blue-200" role="status">
                        <span><i class="pi pi-info-circle mr-2"></i>บุคลากรที่ยังไม่มีบัญชี {{ withoutAccount().length }} คน: {{ withoutAccountNames() }}</span>
                    </div>
                }

                <div class="flex flex-wrap items-center gap-3 mb-4">
                    <p-iconfield iconPosition="left" class="grow sm:grow-0">
                        <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                        <input pInputText type="search" class="w-full sm:w-72" placeholder="ค้นหาชื่อ รหัสบุคลากร อีเมล" aria-label="ค้นหาผู้ใช้" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                    </p-iconfield>
                    <p-select [options]="roleOptions()" [ngModel]="roleId()" (ngModelChange)="roleId.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกบทบาท" [showClear]="true" ariaLabel="กรองตามบทบาท" class="w-56" />
                    <p-select [options]="statusOptions" [ngModel]="status()" (ngModelChange)="status.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกสถานะ" [showClear]="true" ariaLabel="กรองตามสถานะ" class="w-44" />
                    <p-selectbutton class="ml-auto" [options]="viewOptions" [ngModel]="view()" (ngModelChange)="$event && view.set($event)" optionLabel="label" optionValue="value" [allowEmpty]="false" ariaLabel="มุมมอง" />
                </div>

                @if (accounts.error(); as error) {
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                        <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลไม่สำเร็จ: {{ errorText(error) }}</span>
                        <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="accounts.reload()"></button>
                    </div>
                }

                @if (view() === 'list') {
                    <p-table [value]="accounts.value()" [loading]="accounts.isLoading()" dataKey="id" [expandedRowKeys]="expandedRows" [rows]="10" [paginator]="accounts.value().length > 10" [rowHover]="true" [tableStyle]="{ 'min-width': '76rem' }">
                        <ng-template #header>
                            <tr>
                                <th style="width: 3rem"><span class="sr-only">รายละเอียด</span></th>
                                <th pSortableColumn="name">บุคลากร <p-sortIcon field="name" /></th>
                                <th pSortableColumn="position" style="width: 13rem">ตำแหน่ง / แผนก <p-sortIcon field="position" /></th>
                                <th style="width: 15rem">ติดต่อ</th>
                                <th pSortableColumn="roleLabel" style="width: 13rem">บทบาท <p-sortIcon field="roleLabel" /></th>
                                <th style="width: 8rem">สถานะ</th>
                                <th style="width: 9rem">เข้าสู่ระบบล่าสุด</th>
                                <th style="width: 9rem"><span class="sr-only">จัดการ</span></th>
                            </tr>
                        </ng-template>
                        <ng-template #body let-row let-expanded="expanded">
                            @let item = asAccount(row);
                            <tr [class.opacity-60]="item.status === 'suspended'">
                                <td>
                                    <button
                                        type="button"
                                        pButton
                                        [pRowToggler]="row"
                                        [text]="true"
                                        [rounded]="true"
                                        severity="secondary"
                                        [icon]="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                                        [attr.aria-expanded]="expanded"
                                        [attr.aria-label]="(expanded ? 'ซ่อนรายละเอียด ' : 'ดูรายละเอียดและสิทธิ์ ') + item.name"
                                    ></button>
                                </td>
                                <td>
                                    <div class="font-semibold">
                                        <a [routerLink]="['/master/personnel', item.personnelId]" class="text-color hover:text-primary">{{ item.name }}</a>
                                        @if (item.id === currentUserId()) {
                                            <span class="ml-1 px-1.5 py-0.5 rounded text-xs bg-primary text-primary-contrast">คุณ</span>
                                        }
                                    </div>
                                    <div class="text-xs text-muted-color">{{ item.employeeCode || '-' }}</div>
                                </td>
                                <td>
                                    <div class="text-sm">{{ item.position || '-' }}</div>
                                    <div class="text-xs text-muted-color">{{ item.department || '-' }}</div>
                                </td>
                                <td>
                                    <div class="text-sm break-all">{{ item.email }}</div>
                                    @if (item.phone) {
                                        <a [href]="'tel:' + item.phone" class="text-xs text-primary">{{ item.phone }}</a>
                                    }
                                </td>
                                <td>
                                    <div>{{ item.roleLabel }}</div>
                                    <div class="text-xs text-muted-color">{{ item.projectCodes.length ? item.projectCodes.join(', ') : 'ทุกโครงการ' }}</div>
                                </td>
                                <td><p-tag [value]="statusInfo[item.status].label" [severity]="statusInfo[item.status].severity" /></td>
                                <td class="text-sm">
                                    @if (item.status === 'invited') {
                                        <span class="text-muted-color">เชิญเมื่อ {{ item.invitedAt | thaiDate: 'dateTime' }}</span>
                                    } @else {
                                        {{ item.lastLoginAt | thaiDate: 'dateTime' }}
                                    }
                                </td>
                                <td>
                                    <ng-container *ngTemplateOutlet="actions; context: { $implicit: item }" />
                                </td>
                            </tr>
                        </ng-template>
                        <ng-template #expandedrow let-row>
                            @let item = asAccount(row);
                            <tr>
                                <td colspan="8" class="bg-emphasis">
                                    <div class="grid grid-cols-1 lg:grid-cols-5 gap-6 p-2">
                                        <section class="lg:col-span-2" [attr.aria-label]="'ข้อมูลบัญชี ' + item.name">
                                            <h3 class="text-sm font-semibold m-0 mb-3">ข้อมูลบัญชี</h3>
                                            <dl class="grid grid-cols-3 gap-x-3 gap-y-2 m-0 text-sm">
                                                <dt class="text-muted-color">รหัสบุคลากร</dt>
                                                <dd class="col-span-2 m-0">{{ item.employeeCode || '-' }}</dd>
                                                <dt class="text-muted-color">ตำแหน่ง</dt>
                                                <dd class="col-span-2 m-0">{{ item.position || '-' }}</dd>
                                                <dt class="text-muted-color">แผนก</dt>
                                                <dd class="col-span-2 m-0">{{ item.department || '-' }}</dd>
                                                <dt class="text-muted-color">อีเมลเข้าสู่ระบบ</dt>
                                                <dd class="col-span-2 m-0 break-all">{{ item.email }}</dd>
                                                <dt class="text-muted-color">เบอร์โทร</dt>
                                                <dd class="col-span-2 m-0">{{ item.phone || '-' }}</dd>
                                                <dt class="text-muted-color">โครงการที่เข้าถึง</dt>
                                                <dd class="col-span-2 m-0">{{ item.projectCodes.length ? item.projectCodes.join(', ') : 'ทุกโครงการ (ทีมภายใน)' }}</dd>
                                                <dt class="text-muted-color">สร้างบัญชีเมื่อ</dt>
                                                <dd class="col-span-2 m-0">{{ item.createdAt | thaiDate: 'dateTime' }}</dd>
                                                <dt class="text-muted-color">{{ item.status === 'invited' ? 'ส่งคำเชิญเมื่อ' : 'เข้าสู่ระบบล่าสุด' }}</dt>
                                                <dd class="col-span-2 m-0">{{ (item.status === 'invited' ? item.invitedAt : item.lastLoginAt) | thaiDate: 'dateTime' }}</dd>
                                            </dl>
                                            <a [routerLink]="['/master/personnel', item.personnelId]" class="inline-block text-sm text-primary mt-3">ดูข้อมูลบุคลากรทั้งหมด <i class="pi pi-arrow-right text-xs"></i></a>
                                        </section>
                                        <section class="lg:col-span-3" [attr.aria-label]="'สิทธิ์การใช้งาน ' + item.name">
                                            <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                                                <h3 class="text-sm font-semibold m-0">สิทธิ์การใช้งาน · บทบาท {{ item.roleLabel }}</h3>
                                                <button pButton type="button" icon="pi pi-sliders-h" label="ตั้งค่าสิทธิ์" size="small" [outlined]="true" (click)="openEdit(item)"></button>
                                            </div>
                                            <ul class="list-none p-0 m-0 border border-surface rounded-lg overflow-hidden bg-surface-0 dark:bg-surface-900">
                                                @for (permission of permissions; track permission) {
                                                    @let state = permissionState(item, permission);
                                                    <li class="flex items-center gap-3 px-3 py-2 border-b border-surface last:border-b-0 text-sm">
                                                        @if (state === 'role' || state === 'granted') {
                                                            <i class="pi pi-check-circle text-green-600 dark:text-green-400" aria-label="มีสิทธิ์"></i>
                                                        } @else {
                                                            <i class="pi pi-minus-circle text-muted-color" aria-label="ไม่มีสิทธิ์"></i>
                                                        }
                                                        <span class="flex-1 min-w-0" [class.text-muted-color]="state === null || state === 'revoked'">
                                                            <span class="font-medium" [class.line-through]="state === 'revoked'">{{ info[permission].label }}</span>
                                                            <span class="block text-xs text-muted-color">{{ info[permission].description }}</span>
                                                        </span>
                                                        @switch (state) {
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
                                                    </li>
                                                }
                                            </ul>
                                        </section>
                                    </div>
                                </td>
                            </tr>
                        </ng-template>
                        <ng-template #emptymessage>
                            <tr>
                                <td colspan="8" class="text-center text-muted-color py-6">{{ accounts.isLoading() ? 'กำลังโหลด...' : 'ไม่พบผู้ใช้ตามเงื่อนไข' }}</td>
                            </tr>
                        </ng-template>
                    </p-table>
                } @else {
                    <p-table [value]="accounts.value()" [loading]="accounts.isLoading()" dataKey="id" [rowHover]="true" [scrollable]="true" [tableStyle]="{ 'min-width': '72rem' }">
                        <ng-template #header>
                            <tr>
                                <th pFrozenColumn pSortableColumn="name" style="min-width: 15rem">ผู้ใช้ / บทบาท <p-sortIcon field="name" /></th>
                                @for (permission of permissions; track permission) {
                                    <th class="text-center text-xs" style="width: 7rem" [pTooltip]="info[permission].description" tooltipPosition="top">{{ info[permission].label }}</th>
                                }
                                <th style="width: 4rem"><span class="sr-only">ตั้งค่า</span></th>
                            </tr>
                        </ng-template>
                        <ng-template #body let-row>
                            @let item = asAccount(row);
                            <tr [class.opacity-60]="item.status === 'suspended'">
                                <td pFrozenColumn>
                                    <div class="font-semibold">{{ item.name }}</div>
                                    <div class="text-xs text-muted-color">{{ item.roleLabel }} · {{ statusInfo[item.status].label }}</div>
                                </td>
                                @for (permission of permissions; track permission) {
                                    @let state = permissionState(item, permission);
                                    <td class="text-center" [attr.aria-label]="info[permission].label + ': ' + stateLabel[state ?? 'none']">
                                        @switch (state) {
                                            @case ('role') {
                                                <i class="pi pi-check text-green-600 dark:text-green-400" [pTooltip]="stateLabel.role"></i>
                                            }
                                            @case ('granted') {
                                                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-100 dark:bg-green-500/15" [pTooltip]="stateLabel.granted"
                                                    ><i class="pi pi-plus text-green-700 dark:text-green-300 text-xs"></i
                                                ></span>
                                            }
                                            @case ('revoked') {
                                                <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-500/15" [pTooltip]="stateLabel.revoked"
                                                    ><i class="pi pi-times text-orange-700 dark:text-orange-300 text-xs"></i
                                                ></span>
                                            }
                                            @default {
                                                <span class="text-muted-color" aria-hidden="true">–</span>
                                            }
                                        }
                                    </td>
                                }
                                <td>
                                    <button pButton type="button" icon="pi pi-sliders-h" [text]="true" [rounded]="true" pTooltip="ตั้งค่าสิทธิ์" [attr.aria-label]="'ตั้งค่าสิทธิ์ ' + item.name" (click)="openEdit(item)"></button>
                                </td>
                            </tr>
                        </ng-template>
                        <ng-template #emptymessage>
                            <tr>
                                <td [attr.colspan]="permissions.length + 2" class="text-center text-muted-color py-6">{{ accounts.isLoading() ? 'กำลังโหลด...' : 'ไม่พบผู้ใช้ตามเงื่อนไข' }}</td>
                            </tr>
                        </ng-template>
                    </p-table>
                    <div class="flex flex-wrap gap-x-5 gap-y-2 mt-3 text-sm text-muted-color">
                        <span><i class="pi pi-check text-green-600 dark:text-green-400 mr-1"></i>{{ stateLabel.role }}</span>
                        <span><i class="pi pi-plus text-green-700 dark:text-green-300 mr-1"></i>{{ stateLabel.granted }}</span>
                        <span><i class="pi pi-times text-orange-700 dark:text-orange-300 mr-1"></i>{{ stateLabel.revoked }}</span>
                        <span>– {{ stateLabel.none }}</span>
                    </div>
                }

                <ng-template #actions let-item>
                    <div class="flex justify-end">
                        <button pButton type="button" icon="pi pi-sliders-h" [text]="true" [rounded]="true" pTooltip="ตั้งค่าบทบาทและสิทธิ์" [attr.aria-label]="'ตั้งค่าสิทธิ์ ' + item.name" (click)="openEdit(item)"></button>
                        @if (item.status !== 'suspended') {
                            <button
                                pButton
                                type="button"
                                [icon]="item.status === 'invited' ? 'pi pi-send' : 'pi pi-key'"
                                [text]="true"
                                [rounded]="true"
                                [pTooltip]="item.status === 'invited' ? 'ส่งคำเชิญซ้ำ' : 'รีเซ็ตรหัสผ่าน'"
                                [attr.aria-label]="(item.status === 'invited' ? 'ส่งคำเชิญซ้ำ ' : 'รีเซ็ตรหัสผ่าน ') + item.name"
                                (click)="confirmReset(item)"
                            ></button>
                            @if (item.id !== currentUserId()) {
                                <button pButton type="button" icon="pi pi-ban" severity="danger" [text]="true" [rounded]="true" pTooltip="ระงับบัญชี" [attr.aria-label]="'ระงับบัญชี ' + item.name" (click)="openSuspend(item)"></button>
                            }
                        } @else {
                            <button pButton type="button" icon="pi pi-check-circle" severity="success" [text]="true" [rounded]="true" pTooltip="เปิดใช้บัญชี" [attr.aria-label]="'เปิดใช้บัญชี ' + item.name" (click)="confirmActivate(item)"></button>
                        }
                    </div>
                </ng-template>
            </div>
        }

        @if (formOpen()) {
            <app-user-account-form [account]="editing()" [personnel]="formPersonnel()" [registration]="approving()" (saved)="onSaved($event)" (closed)="formOpen.set(false)" />
        }

        <p-dialog [visible]="!!rejecting()" (visibleChange)="!$event && closeReject()" [modal]="true" [draggable]="false" [style]="{ width: 'min(32rem, 95vw)' }" header="ปฏิเสธคำขอสมัครสมาชิก">
            @if (rejecting(); as request) {
                <p class="mt-0">
                    ปฏิเสธคำขอของ <strong>{{ request.fullName }}</strong> ({{ request.email }}) ผู้สมัครจะเข้าสู่ระบบไม่ได้
                </p>
                <label for="reject-reason" class="block text-sm font-semibold mb-2">เหตุผล <span class="text-red-600" aria-hidden="true">*</span></label>
                <textarea pTextarea id="reject-reason" rows="2" class="w-full" placeholder="เช่น ไม่ใช่บุคลากรของบริษัท" [ngModel]="rejectReason()" (ngModelChange)="rejectReason.set($event)" [attr.aria-invalid]="!!rejectError()"></textarea>
                @if (rejectError()) {
                    <small class="text-red-600 dark:text-red-400">{{ rejectError() }}</small>
                }
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closeReject()"></button>
                <button pButton type="button" icon="pi pi-times" label="ปฏิเสธคำขอ" severity="danger" [loading]="busy()" (click)="reject()"></button>
            </ng-template>
        </p-dialog>

        <p-dialog [visible]="!!suspending()" (visibleChange)="!$event && closeSuspend()" [modal]="true" [draggable]="false" [style]="{ width: 'min(32rem, 95vw)' }" header="ระงับบัญชีผู้ใช้">
            @if (suspending(); as item) {
                <p class="mt-0">
                    ระงับบัญชีของ <strong>{{ item.name }}</strong> ผู้ใช้จะออกจากระบบทุกอุปกรณ์ทันทีและเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้อีกครั้ง ประวัติการทำงานยังเก็บไว้ครบ
                </p>
                <label for="suspend-reason" class="block text-sm font-semibold mb-2">เหตุผล</label>
                <textarea pTextarea id="suspend-reason" rows="2" class="w-full" placeholder="เช่น ลาออก พักงาน" [ngModel]="suspendReason()" (ngModelChange)="suspendReason.set($event)"></textarea>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closeSuspend()"></button>
                <button pButton type="button" icon="pi pi-ban" label="ระงับบัญชี" severity="danger" [loading]="busy()" (click)="suspend()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class Users {
    readonly auth = inject(AuthService);
    private readonly service = inject(UserAccountService);
    private readonly personnelService = inject(PersonnelService);
    private readonly messages = inject(MessageService);
    private readonly confirmation = inject(ConfirmationService);

    readonly info = PERMISSION_INFO;
    readonly permissions = PERMISSIONS;
    readonly stateLabel = { role: 'มีสิทธิ์ตามบทบาท', granted: 'ให้เพิ่มรายคน', revoked: 'ถอนสิทธิ์ของบทบาทออก', none: 'ไม่มีสิทธิ์' } as const;
    readonly viewOptions = [
        { value: 'list', label: 'รายชื่อและรายละเอียด' },
        { value: 'matrix', label: 'ตารางสิทธิ์' }
    ];
    readonly view = signal<'list' | 'matrix'>('list');
    /** แถวที่เปิดดูรายละเอียดอยู่ (dataKey → true) */
    expandedRows: Record<string, boolean> = {};
    readonly statusInfo = ACCOUNT_STATUS;
    readonly statusOptions = (Object.keys(ACCOUNT_STATUS) as UserAccountStatus[]).map((value) => ({ value, label: ACCOUNT_STATUS[value].label }));
    readonly roleOptions = computed(() => (this.auth.roleCatalog()?.roles ?? []).filter((role) => role.group !== 'external').map((role) => ({ value: role.id, label: role.label })));
    readonly canManage = computed(() => this.auth.can('user.manage'));
    readonly currentUserId = computed(() => this.auth.currentUser()?.id);

    readonly query = signal('');
    readonly roleId = signal<RoleId | null>(null);
    readonly status = signal<UserAccountStatus | null>(null);
    private readonly debouncedQuery = toSignal(toObservable(this.query).pipe(debounceTime(250)), { initialValue: '' });
    readonly accounts = apiResource({
        params: () => (this.canManage() ? { q: this.debouncedQuery() || undefined, roleId: this.roleId(), status: this.status() } : undefined),
        stream: ({ params }) => this.service.list(params),
        defaultValue: []
    });

    /** ใช้หาบุคลากรที่ยังไม่มีบัญชี (ไม่ขึ้นกับตัวกรองของตาราง) */
    private readonly allAccounts = apiResource({ params: () => (this.canManage() ? true : undefined), stream: () => this.service.list(), defaultValue: [] });
    private readonly personnel = apiResource({ params: () => (this.canManage() ? true : undefined), stream: () => this.personnelService.list(), defaultValue: [] });
    readonly statusTiles = computed(() => {
        const all = this.allAccounts.value();
        const count = (status: UserAccountStatus) => all.filter((account) => account.status === status).length;
        return [
            { label: 'ผู้ใช้ทั้งหมด', icon: 'pi-users', status: null, count: all.length },
            { label: ACCOUNT_STATUS.active.label, icon: 'pi-check-circle', status: 'active' as const, count: count('active') },
            { label: ACCOUNT_STATUS.invited.label, icon: 'pi-envelope', status: 'invited' as const, count: count('invited') },
            { label: ACCOUNT_STATUS.suspended.label, icon: 'pi-ban', status: 'suspended' as const, count: count('suspended') }
        ];
    });
    readonly withoutAccount = computed(() => {
        const taken = new Set(this.allAccounts.value().map((account) => account.personnelId));
        return this.personnel.value().filter((person) => !taken.has(person.id) && !person.endDate);
    });
    readonly withoutAccountNames = computed(() => {
        const names = this.withoutAccount().map((person) => person.fullName);
        return names.length > 4 ? `${names.slice(0, 4).join(', ')} และอีก ${names.length - 4} คน` : names.join(', ');
    });

    readonly formOpen = signal(false);
    readonly editing = signal<UserAccount | null>(null);
    readonly formPersonnel = signal<AccountPersonnel | null>(null);
    readonly approving = signal<Registration | null>(null);

    /** อนุมัติ/ปฏิเสธการสมัครสมาชิกได้เฉพาะบทบาทแอดมินหรือเจ้าของบริษัท (หลังบ้านตรวจซ้ำ) */
    readonly canApprove = computed(() => ['admin', 'owner'].includes(this.auth.currentUser()?.roleId ?? ''));
    private readonly registrations = apiResource({ params: () => (this.canManage() ? true : undefined), stream: () => this.service.registrations('pending'), defaultValue: [] });
    readonly pendingRegistrations = this.registrations.value;
    readonly rejecting = signal<Registration | null>(null);
    readonly rejectReason = signal('');
    readonly rejectError = signal('');

    readonly suspending = signal<UserAccount | null>(null);
    readonly suspendReason = signal('');
    readonly busy = signal(false);

    asAccount(row: UserAccount) {
        return row;
    }

    /** ที่มาของสิทธิ์: ตามบทบาท / ให้เพิ่มรายคน / ถอนออก / ไม่มี */
    permissionState(account: UserAccount, permission: Permission): 'role' | 'granted' | 'revoked' | null {
        if (account.grantedPermissions.includes(permission)) return 'granted';
        if (account.revokedPermissions.includes(permission)) return 'revoked';
        return account.permissions.includes(permission) ? 'role' : null;
    }

    personnelName(id: string) {
        return this.personnel.value().find((person) => person.id === id)?.fullName ?? id;
    }

    openApprove(registration: Registration) {
        this.editing.set(null);
        this.formPersonnel.set(null);
        this.approving.set(registration);
        this.formOpen.set(true);
    }

    openReject(registration: Registration) {
        this.rejectReason.set('');
        this.rejectError.set('');
        this.rejecting.set(registration);
    }

    closeReject() {
        if (!this.busy()) this.rejecting.set(null);
    }

    reject() {
        const registration = this.rejecting();
        if (!registration) return;
        const reason = this.rejectReason().trim();
        if (!reason) {
            this.rejectError.set('กรุณาระบุเหตุผล');
            return;
        }
        this.busy.set(true);
        this.service.rejectRegistration(registration.id, reason).subscribe({
            next: () => {
                this.busy.set(false);
                this.rejecting.set(null);
                this.registrations.reload();
                this.messages.add({ severity: 'warn', summary: 'ปฏิเสธคำขอแล้ว', detail: registration.fullName });
            },
            error: (error) => {
                this.busy.set(false);
                this.rejectError.set(problemMessage(error, 'ปฏิเสธไม่สำเร็จ'));
            }
        });
    }

    openCreate(personnel: AccountPersonnel | null) {
        this.approving.set(null);
        this.editing.set(null);
        this.formPersonnel.set(personnel);
        this.formOpen.set(true);
    }

    openEdit(account: UserAccount) {
        this.approving.set(null);
        this.editing.set(account);
        this.formPersonnel.set(null);
        this.formOpen.set(true);
    }

    onSaved(account: UserAccount) {
        const created = !this.editing();
        this.formOpen.set(false);
        this.reload();
        if (this.approving()) {
            this.approving.set(null);
            this.messages.add({ severity: 'success', summary: 'อนุมัติแล้ว', detail: `${account.name} เข้าสู่ระบบได้แล้วในบทบาท ${account.roleLabel}` });
            return;
        }
        this.messages.add(created ? { severity: 'success', summary: 'สร้างบัญชีแล้ว', detail: `ส่งคำเชิญตั้งรหัสผ่านไปที่ ${account.email}` } : { severity: 'success', summary: 'บันทึกสิทธิ์แล้ว', detail: `${account.name} · ${account.roleLabel}` });
    }

    confirmReset(account: UserAccount) {
        const invited = account.status === 'invited';
        this.confirmation.confirm({
            header: invited ? 'ส่งคำเชิญซ้ำ' : 'รีเซ็ตรหัสผ่าน',
            message: invited ? `ส่งลิงก์ตั้งรหัสผ่านไปที่ ${account.email} อีกครั้ง?` : `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${account.email}? รหัสผ่านเดิมยังใช้ได้จนกว่าจะตั้งใหม่`,
            icon: invited ? 'pi pi-send' : 'pi pi-key',
            acceptLabel: 'ส่งลิงก์',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () =>
                this.service.resetPassword(account.id).subscribe({
                    next: (updated) => {
                        this.reload();
                        this.messages.add({ severity: 'success', summary: 'ส่งลิงก์แล้ว', detail: updated.email });
                    },
                    error: (error) => this.messages.add({ severity: 'error', summary: 'ส่งลิงก์ไม่สำเร็จ', detail: problemMessage(error) })
                })
        });
    }

    confirmActivate(account: UserAccount) {
        this.confirmation.confirm({
            header: 'เปิดใช้บัญชี',
            message: `เปิดใช้บัญชีของ ${account.name} ให้เข้าสู่ระบบได้อีกครั้งด้วยบทบาท ${account.roleLabel}?`,
            icon: 'pi pi-check-circle',
            acceptLabel: 'เปิดใช้',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () =>
                this.service.activate(account.id).subscribe({
                    next: (updated) => {
                        this.reload();
                        this.messages.add({ severity: 'success', summary: 'เปิดใช้บัญชีแล้ว', detail: updated.name });
                    },
                    error: (error) => this.messages.add({ severity: 'error', summary: 'เปิดใช้ไม่สำเร็จ', detail: problemMessage(error) })
                })
        });
    }

    openSuspend(account: UserAccount) {
        this.suspendReason.set('');
        this.suspending.set(account);
    }

    closeSuspend() {
        if (!this.busy()) this.suspending.set(null);
    }

    suspend() {
        const account = this.suspending();
        if (!account) return;
        this.busy.set(true);
        this.service.suspend(account.id, this.suspendReason().trim()).subscribe({
            next: (updated) => {
                this.busy.set(false);
                this.suspending.set(null);
                this.reload();
                this.messages.add({ severity: 'warn', summary: 'ระงับบัญชีแล้ว', detail: updated.name });
            },
            error: (error) => {
                this.busy.set(false);
                this.messages.add({ severity: 'error', summary: 'ระงับไม่สำเร็จ', detail: problemMessage(error) });
            }
        });
    }

    errorText(error: unknown) {
        return problemMessage(error);
    }

    private reload() {
        this.accounts.reload();
        this.allAccounts.reload();
        this.registrations.reload();
    }
}
