import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { Observable } from 'rxjs';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { PersonnelService } from '@/app/pages/service/personnel.service';
import { ProjectTeamService, STAFF_ROLES, STAFF_ROLE_LABEL, SUB_STATUS_LABEL, StaffAssignment, StaffAssignmentInput, StaffRole, SubcontractorAssignment, SubcontractorAssignmentInput } from '@/app/pages/service/project-team.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { Subcontractor, SubcontractorService, TRADE_LABEL, TRADE_PHASES } from '@/app/pages/service/subcontractor.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { initials } from './project-ui';
import { apiResource } from '@/app/api/api-resource';

/** ขั้นตอนที่เป็นงานของบริษัทเอง (สำรวจ ออกแบบ ขออนุญาต) ไม่ต้องมีผู้รับเหมาช่วง */
const IN_HOUSE_PHASES = ['01', '02', '03'];

const SUB_STATUS_SEVERITY: Record<SubcontractorAssignment['status'], 'secondary' | 'info' | 'success'> = { upcoming: 'secondary', working: 'info', done: 'success' };

interface StaffForm {
    personnelId: string | null;
    role: StaffRole | null;
    note: string;
}

interface SubForm {
    subcontractorId: string | null;
    scope: string;
    phaseCodes: string[];
    contractValue: number | null;
    note: string;
}

/** แท็บ "ทีมงานและผู้รับเหมา": ผู้รับผิดชอบโครงการ (บุคลากร) และผู้รับเหมาช่วงตามขั้นตอนงาน */
@Component({
    selector: 'app-project-team-tab',
    standalone: true,
    imports: [ButtonModule, ConfirmDialogModule, DecimalPipe, DialogModule, FormsModule, InputNumberModule, InputTextModule, NgClass, ProgressBarModule, RouterLink, SelectModule, TagModule, TextareaModule, ThaiDatePipe, ToastModule],
    providers: [ConfirmationService, MessageService],
    template: `
        <p-toast />
        <p-confirmdialog />

        @if (assignments.error(); as error) {
            <div class="card flex flex-wrap items-center justify-between gap-3" role="alert">
                <span class="text-red-700 dark:text-red-300"><i class="pi pi-exclamation-triangle mr-2"></i>โหลดทีมงานไม่สำเร็จ: {{ errorText(error) }}</span>
                <button pButton type="button" [outlined]="true" icon="pi pi-refresh" label="ลองใหม่" (click)="assignments.reload()"></button>
            </div>
        } @else {
            <div class="flex flex-col gap-6">
                <!-- ผู้รับผิดชอบโครงการ -->
                <section class="card m-0" aria-labelledby="staff-heading">
                    <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                        <div>
                            <h2 id="staff-heading" class="text-xl font-semibold m-0">ผู้รับผิดชอบโครงการ</h2>
                            <p class="text-sm text-muted-color mt-1 mb-0">บุคลากรของบริษัทที่รับผิดชอบโครงการนี้ · ผู้จัดการโครงการคนแรกแสดงเป็นผู้รับผิดชอบหลักของโครงการ</p>
                        </div>
                        @if (canManage()) {
                            <button pButton type="button" icon="pi pi-user-plus" label="เพิ่มผู้รับผิดชอบ" (click)="openStaffForm(null)"></button>
                        }
                    </div>
                    <ul class="list-none p-0 m-0">
                        @for (member of staff(); track member.id) {
                            <li class="flex flex-wrap items-center gap-3 py-3 border-b border-surface last:border-b-0">
                                <span class="w-10 h-10 shrink-0 rounded-full bg-emphasis flex items-center justify-center font-semibold" aria-hidden="true">{{ initials(member.name) }}</span>
                                <div class="flex-1 min-w-48">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <a [routerLink]="['/master/personnel', member.personnelId]" class="font-semibold text-color hover:text-primary">{{ member.name }}</a>
                                        <p-tag [value]="roleLabel[member.role]" [severity]="member.role === 'project-manager' ? 'info' : 'secondary'" />
                                    </div>
                                    <div class="text-sm text-muted-color">
                                        {{ member.position || '-' }}
                                        @if (member.note) {
                                            · {{ member.note }}
                                        }
                                    </div>
                                </div>
                                @if (member.phone) {
                                    <a [href]="'tel:' + member.phone" class="text-sm text-primary whitespace-nowrap"><i class="pi pi-phone text-xs mr-1"></i>{{ member.phone }}</a>
                                }
                                @if (canManage()) {
                                    <div class="flex">
                                        <button pButton type="button" icon="pi pi-pencil" [text]="true" [rounded]="true" [attr.aria-label]="'แก้ไข ' + member.name" (click)="openStaffForm(member)"></button>
                                        <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="danger" [attr.aria-label]="'นำ ' + member.name + ' ออกจากโครงการ'" (click)="confirmRemoveStaff(member)"></button>
                                    </div>
                                }
                            </li>
                        } @empty {
                            <li class="py-6 text-center text-muted-color">{{ assignments.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีผู้รับผิดชอบ' }}</li>
                        }
                    </ul>
                </section>

                <!-- ผู้รับเหมาช่วง -->
                <section class="card m-0" aria-labelledby="subs-heading">
                    <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                        <div>
                            <h2 id="subs-heading" class="text-xl font-semibold m-0">ผู้รับเหมาช่วง</h2>
                            <p class="text-sm text-muted-color mt-1 mb-0">
                                {{ subs().length }} ราย
                                @if (totalValue() !== null) {
                                    · มูลค่าจ้างรวม ฿{{ totalValue() | number: '1.0-0' }}
                                }
                                · ความคืบหน้าคำนวณจากขั้นตอนที่รับผิดชอบในไทม์ไลน์
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <a pButton routerLink="/master/subcontractors" [text]="true" icon="pi pi-list" label="ทะเบียนผู้รับเหมา"></a>
                            @if (canManage()) {
                                <button pButton type="button" icon="pi pi-plus" label="มอบหมายผู้รับเหมา" (click)="openSubForm(null)"></button>
                            }
                        </div>
                    </div>
                    <ul class="list-none p-0 m-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        @for (item of subs(); track item.id) {
                            <li class="rounded-lg border border-surface p-4 flex flex-col gap-3">
                                <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0">
                                        <div class="font-semibold">{{ item.subcontractor.name }}</div>
                                        <div class="text-xs text-muted-color">
                                            {{ item.subcontractor.code }} · {{ item.subcontractor.contactName }} · <a [href]="'tel:' + item.subcontractor.phone" class="text-primary">{{ item.subcontractor.phone }}</a>
                                        </div>
                                    </div>
                                    <p-tag [value]="subStatusLabel[item.status]" [severity]="subStatusSeverity[item.status]" />
                                </div>
                                <div class="flex flex-wrap gap-1">
                                    @for (trade of item.subcontractor.trades; track trade) {
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis">{{ tradeLabel[trade] }}</span>
                                    }
                                </div>
                                <p class="m-0 text-sm">{{ item.scope }}</p>
                                <div class="flex flex-wrap gap-1 text-xs">
                                    @for (code of item.phaseCodes; track code) {
                                        <span class="px-2 py-0.5 rounded border border-surface">{{ phaseLabel(code) }}</span>
                                    }
                                </div>
                                <div>
                                    <div class="flex justify-between text-xs text-muted-color mb-1">
                                        <span>{{ item.start ? (item.start | thaiDate) + ' – ' + (item.end | thaiDate) : '-' }}</span>
                                        <span>{{ item.progress }}%</span>
                                    </div>
                                    <p-progressbar [value]="item.progress" [showValue]="false" [style]="{ height: '0.5rem' }" [attr.aria-label]="'ความคืบหน้า ' + item.subcontractor.name + ' ' + item.progress + '%'" />
                                </div>
                                <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-surface">
                                    <span class="text-sm">
                                        @if (item.contractValue !== undefined) {
                                            มูลค่าจ้าง <span class="font-semibold">฿{{ item.contractValue | number: '1.0-0' }}</span>
                                        }
                                        @if (item.note) {
                                            <span class="block text-xs text-muted-color">{{ item.note }}</span>
                                        }
                                    </span>
                                    @if (canManage()) {
                                        <div class="flex">
                                            <button pButton type="button" icon="pi pi-pencil" [text]="true" [rounded]="true" [attr.aria-label]="'แก้ไขการมอบหมาย ' + item.subcontractor.name" (click)="openSubForm(item)"></button>
                                            <button
                                                pButton
                                                type="button"
                                                icon="pi pi-trash"
                                                [text]="true"
                                                [rounded]="true"
                                                severity="danger"
                                                [disabled]="item.progress > 0"
                                                [attr.aria-label]="item.progress > 0 ? 'เริ่มงานแล้ว ยกเลิกไม่ได้' : 'ยกเลิกการมอบหมาย ' + item.subcontractor.name"
                                                [attr.title]="item.progress > 0 ? 'เริ่มงานแล้ว ยกเลิกไม่ได้ ให้แก้ไขแทน' : null"
                                                (click)="confirmRemoveSub(item)"
                                            ></button>
                                        </div>
                                    }
                                </div>
                            </li>
                        } @empty {
                            <li class="lg:col-span-2 py-6 text-center text-muted-color">{{ assignments.isLoading() ? 'กำลังโหลด...' : 'ยังไม่ได้มอบหมายผู้รับเหมาช่วง' }}</li>
                        }
                    </ul>
                </section>

                <!-- ผู้รับเหมาตามขั้นตอนงาน -->
                <section class="card m-0" aria-labelledby="coverage-heading">
                    <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                        <div>
                            <h2 id="coverage-heading" class="text-xl font-semibold m-0">ผู้รับผิดชอบตามขั้นตอนงาน</h2>
                            <p class="text-sm text-muted-color mt-1 mb-0">ตรวจว่าขั้นตอนก่อสร้างทุกขั้นตอนมีผู้รับเหมาแล้ว</p>
                        </div>
                        @if (uncoveredCount()) {
                            <span class="text-sm font-semibold text-orange-700 dark:text-orange-300"><i class="pi pi-exclamation-triangle mr-1"></i>{{ uncoveredCount() }} ขั้นตอนยังไม่มีผู้รับเหมา</span>
                        } @else if (subs().length) {
                            <span class="text-sm font-semibold text-green-700 dark:text-green-300"><i class="pi pi-check-circle mr-1"></i>ครบทุกขั้นตอนก่อสร้าง</span>
                        }
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm border-collapse" style="min-width: 40rem">
                            <thead>
                                <tr class="border-b border-surface text-left text-muted-color">
                                    <th scope="col" class="py-2 pr-3 font-semibold">ขั้นตอน</th>
                                    <th scope="col" class="py-2 pr-3 font-semibold">ช่วงเวลา</th>
                                    <th scope="col" class="py-2 pr-3 font-semibold text-right">ความคืบหน้า</th>
                                    <th scope="col" class="py-2 font-semibold">ผู้รับเหมาช่วง</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (row of coverage(); track row.phase.code) {
                                    <tr class="border-b border-surface last:border-b-0 align-top">
                                        <th scope="row" class="py-2 pr-3 text-left font-normal">
                                            <span class="font-semibold">{{ row.phase.step }}. {{ row.phase.shortName }}</span>
                                        </th>
                                        <td class="py-2 pr-3 whitespace-nowrap">{{ row.phase.start | thaiDate: 'dayMonth' }} – {{ row.phase.end | thaiDate: 'dayMonth' }}</td>
                                        <td class="py-2 pr-3 text-right tabular-nums">{{ row.phase.progress }}%</td>
                                        <td class="py-2">
                                            @if (row.names.length) {
                                                {{ row.names.join(', ') }}
                                            } @else if (row.inHouse) {
                                                <span class="text-muted-color">งานของบริษัท (ไม่ใช้ผู้รับเหมาช่วง)</span>
                                            } @else {
                                                <span class="text-orange-700 dark:text-orange-300"><i class="pi pi-exclamation-circle text-xs mr-1"></i>ยังไม่มีผู้รับเหมา</span>
                                            }
                                        </td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        }

        <!-- ฟอร์มผู้รับผิดชอบ -->
        <p-dialog [visible]="staffFormOpen()" (visibleChange)="!$event && closeForms()" [modal]="true" [draggable]="false" [style]="{ width: 'min(32rem, 95vw)' }" [header]="editingStaff() ? 'แก้ไขผู้รับผิดชอบ' : 'เพิ่มผู้รับผิดชอบ'">
            <form id="staff-form" class="flex flex-col gap-4" (ngSubmit)="saveStaff()" novalidate>
                <div>
                    <label for="staff-person" class="block text-sm font-semibold mb-2">บุคลากร <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-select
                        inputId="staff-person"
                        name="personnelId"
                        [options]="personnelOptions()"
                        [(ngModel)]="staffForm.personnelId"
                        optionLabel="label"
                        optionValue="value"
                        [filter]="true"
                        filterBy="label"
                        placeholder="เลือกบุคลากร"
                        class="w-full"
                        appendTo="body"
                        [invalid]="!!formErrors()['personnelId']"
                    />
                    @if (formErrors()['personnelId']) {
                        <small class="text-red-600 dark:text-red-400">{{ formErrors()['personnelId'] }}</small>
                    }
                </div>
                <div>
                    <label for="staff-role" class="block text-sm font-semibold mb-2">บทบาทในโครงการ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-select inputId="staff-role" name="role" [options]="roleOptions" [(ngModel)]="staffForm.role" optionLabel="label" optionValue="value" placeholder="เลือกบทบาท" class="w-full" appendTo="body" [invalid]="!!formErrors()['role']" />
                    @if (formErrors()['role']) {
                        <small class="text-red-600 dark:text-red-400">{{ formErrors()['role'] }}</small>
                    }
                </div>
                <div>
                    <label for="staff-note" class="block text-sm font-semibold mb-2">หน้าที่ในโครงการนี้</label>
                    <textarea pTextarea id="staff-note" name="note" rows="2" class="w-full" placeholder="เช่น ควบคุมงานโครงสร้างและตรวจรับเสาเข็ม" [(ngModel)]="staffForm.note"></textarea>
                </div>
            </form>
            @if (formError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ formError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closeForms()"></button>
                <button pButton type="submit" form="staff-form" icon="pi pi-check" label="บันทึก" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>

        <!-- ฟอร์มมอบหมายผู้รับเหมา -->
        <p-dialog
            [visible]="subFormOpen()"
            (visibleChange)="!$event && closeForms()"
            [modal]="true"
            [draggable]="false"
            [style]="{ width: 'min(44rem, 95vw)' }"
            [header]="editingSub() ? 'แก้ไขการมอบหมาย ' + editingSub()!.subcontractor.name : 'มอบหมายผู้รับเหมาช่วง'"
        >
            <form id="sub-form" class="flex flex-col gap-4" (ngSubmit)="saveSub()" novalidate>
                <div>
                    <label for="sub-pick" class="block text-sm font-semibold mb-2">ผู้รับเหมา <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-select
                        inputId="sub-pick"
                        name="subcontractorId"
                        [options]="subcontractorOptions()"
                        [ngModel]="subForm.subcontractorId"
                        (ngModelChange)="pickSubcontractor($event)"
                        optionLabel="label"
                        optionValue="value"
                        [filter]="true"
                        filterBy="label"
                        placeholder="เลือกจากทะเบียนผู้รับเหมา"
                        class="w-full"
                        appendTo="body"
                        [disabled]="!!editingSub()"
                        [invalid]="!!formErrors()['subcontractorId']"
                    />
                    @if (formErrors()['subcontractorId']) {
                        <small class="text-red-600 dark:text-red-400">{{ formErrors()['subcontractorId'] }}</small>
                    } @else if (!editingSub()) {
                        <small class="text-muted-color">ไม่มีในรายการ? เพิ่มได้ที่ <a routerLink="/master/subcontractors" [queryParams]="{ new: 1 }" class="text-primary">ทะเบียนผู้รับเหมาช่วง</a></small>
                    }
                </div>
                <div>
                    <label for="sub-scope" class="block text-sm font-semibold mb-2">ขอบเขตงานที่จ้าง <span class="text-red-600" aria-hidden="true">*</span></label>
                    <textarea pTextarea id="sub-scope" name="scope" rows="2" class="w-full" [(ngModel)]="subForm.scope" [attr.aria-invalid]="!!formErrors()['scope']"></textarea>
                    @if (formErrors()['scope']) {
                        <small class="text-red-600 dark:text-red-400">{{ formErrors()['scope'] }}</small>
                    }
                </div>
                <fieldset class="border-0 p-0 m-0 min-w-0">
                    <legend class="block text-sm font-semibold mb-1 p-0">ขั้นตอนที่รับผิดชอบ <span class="text-red-600" aria-hidden="true">*</span></legend>
                    <p class="text-xs text-muted-color mt-0 mb-2">เลือกให้อัตโนมัติตามสาขางานของผู้รับเหมา แก้ไขได้</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        @for (phase of phases(); track phase.code) {
                            <label class="phase-option" [ngClass]="{ 'phase-option-active': subForm.phaseCodes.includes(phase.code) }">
                                <input type="checkbox" class="mt-0.5 accent-[var(--p-primary-color)]" [checked]="subForm.phaseCodes.includes(phase.code)" (change)="togglePhase(phase.code)" />
                                <span class="min-w-0">
                                    <span class="block font-semibold">{{ phase.step }}. {{ phase.shortName }}</span>
                                    <span class="block text-xs text-muted-color">{{ phase.start | thaiDate: 'dayMonth' }} – {{ phase.end | thaiDate: 'dayMonth' }} · {{ phase.progress }}%</span>
                                </span>
                            </label>
                        }
                    </div>
                    @if (formErrors()['phaseCodes']) {
                        <small class="text-red-600 dark:text-red-400">{{ formErrors()['phaseCodes'] }}</small>
                    }
                </fieldset>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label for="sub-value" class="block text-sm font-semibold mb-2">มูลค่าจ้าง (บาท)</label>
                        <p-inputnumber inputId="sub-value" name="contractValue" [(ngModel)]="subForm.contractValue" [min]="0" locale="th-TH" class="w-full" [inputStyle]="{ width: '100%' }" [invalid]="!!formErrors()['contractValue']" />
                        @if (formErrors()['contractValue']) {
                            <small class="text-red-600 dark:text-red-400">{{ formErrors()['contractValue'] }}</small>
                        }
                    </div>
                    <div>
                        <label for="sub-note" class="block text-sm font-semibold mb-2">หมายเหตุ</label>
                        <input pInputText id="sub-note" name="note" class="w-full" placeholder="เช่น เงื่อนไขการจ่ายเงิน" [(ngModel)]="subForm.note" />
                    </div>
                </div>
            </form>
            @if (formError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ formError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closeForms()"></button>
                <button pButton type="submit" form="sub-form" icon="pi pi-check" label="บันทึก" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .phase-option {
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
            padding: 0.5rem 0.75rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: var(--p-content-border-radius);
            cursor: pointer;
        }
        .phase-option:hover {
            border-color: var(--p-primary-color);
        }
        .phase-option-active {
            border-color: var(--p-primary-color);
            background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
        }
    `
})
export class ProjectTeamTab {
    private readonly teamService = inject(ProjectTeamService);
    private readonly subcontractorService = inject(SubcontractorService);
    private readonly personnelService = inject(PersonnelService);
    private readonly confirmation = inject(ConfirmationService);
    private readonly messages = inject(MessageService);

    readonly projectCode = input.required<string>();
    readonly phases = input.required<TimelinePhase[]>();
    readonly canManage = input(false);
    /** แจ้งหน้าโครงการให้โหลดรายชื่อติดต่อ/ผู้รับผิดชอบหลักใหม่ */
    readonly changed = output<void>();

    readonly initials = initials;
    readonly roleLabel = STAFF_ROLE_LABEL;
    readonly tradeLabel = TRADE_LABEL;
    readonly subStatusLabel = SUB_STATUS_LABEL;
    readonly subStatusSeverity = SUB_STATUS_SEVERITY;
    readonly roleOptions = STAFF_ROLES.map((value) => ({ value, label: STAFF_ROLE_LABEL[value] }));

    readonly assignments = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.teamService.assignments(code) });
    readonly staff = computed(() => this.assignments.value()?.staff ?? []);
    readonly subs = computed(() => this.assignments.value()?.subcontractors ?? []);
    /** null เมื่อไม่มีสิทธิ์เห็นมูลค่าจ้าง (หลังบ้านไม่ส่ง contractValue) */
    readonly totalValue = computed(() => {
        const values = this.subs().map((item) => item.contractValue);
        return values.length && values.every((value) => value !== undefined) ? values.reduce((sum, value) => sum! + value!, 0)! : null;
    });

    readonly coverage = computed(() =>
        this.phases().map((phase) => ({
            phase,
            inHouse: IN_HOUSE_PHASES.includes(phase.code),
            names: this.subs()
                .filter((item) => item.phaseCodes.includes(phase.code))
                .map((item) => item.subcontractor.name)
        }))
    );
    readonly uncoveredCount = computed(() => this.coverage().filter((row) => !row.inHouse && !row.names.length).length);

    // ---------- ตัวเลือกในฟอร์ม (โหลดเมื่อเปิดฟอร์มครั้งแรก) ----------
    private readonly formsUsed = signal(false);
    private readonly personnelResource = apiResource({ params: () => this.formsUsed() || undefined, stream: () => this.personnelService.list(), defaultValue: [] });
    private readonly subcontractorResource = apiResource({ params: () => this.formsUsed() || undefined, stream: () => this.subcontractorService.list(), defaultValue: [] });
    readonly personnelOptions = computed(() => this.personnelResource.value().map((person) => ({ value: person.id, label: person.position ? `${person.fullName} · ${person.position}` : person.fullName })));
    readonly subcontractorOptions = computed(() => {
        const editingId = this.editingSub()?.subcontractor.id;
        return this.subcontractorResource
            .value()
            .filter((item) => item.status === 'active' || item.id === editingId)
            .map((item) => ({ value: item.id, label: `${item.name} (${item.trades.map((trade) => TRADE_LABEL[trade]).join(', ')})` }));
    });

    readonly staffFormOpen = signal(false);
    readonly subFormOpen = signal(false);
    readonly editingStaff = signal<StaffAssignment | null>(null);
    readonly editingSub = signal<SubcontractorAssignment | null>(null);
    staffForm: StaffForm = { personnelId: null, role: null, note: '' };
    subForm: SubForm = { subcontractorId: null, scope: '', phaseCodes: [], contractValue: null, note: '' };
    readonly saving = signal(false);
    readonly formErrors = signal<Record<string, string>>({});
    readonly formError = signal('');

    phaseLabel(code: string) {
        const phase = this.phases().find((item) => item.code === code);
        return phase ? `${phase.step}. ${phase.shortName}` : code;
    }

    openStaffForm(member: StaffAssignment | null) {
        this.formsUsed.set(true);
        this.editingStaff.set(member);
        this.staffForm = member ? { personnelId: member.personnelId, role: member.role, note: member.note ?? '' } : { personnelId: null, role: this.staff().length ? null : 'project-manager', note: '' };
        this.resetErrors();
        this.staffFormOpen.set(true);
    }

    openSubForm(item: SubcontractorAssignment | null) {
        this.formsUsed.set(true);
        this.editingSub.set(item);
        this.subForm = item
            ? { subcontractorId: item.subcontractor.id, scope: item.scope, phaseCodes: [...item.phaseCodes], contractValue: item.contractValue ?? null, note: item.note ?? '' }
            : { subcontractorId: null, scope: '', phaseCodes: [], contractValue: null, note: '' };
        this.resetErrors();
        this.subFormOpen.set(true);
    }

    /** เลือกผู้รับเหมาแล้วเติมขั้นตอนและขอบเขตงานตามสาขางาน (ถ้ายังไม่ได้กรอก) */
    pickSubcontractor(id: string | null) {
        this.subForm.subcontractorId = id;
        const sub: Subcontractor | undefined = this.subcontractorResource.value().find((item) => item.id === id);
        if (!sub) return;
        const available = new Set(this.phases().map((phase) => phase.code));
        if (!this.subForm.phaseCodes.length) this.subForm.phaseCodes = [...new Set(sub.trades.flatMap((trade) => TRADE_PHASES[trade]))].filter((code) => available.has(code)).sort();
        if (!this.subForm.scope.trim()) this.subForm.scope = `งาน${sub.trades.map((trade) => TRADE_LABEL[trade]).join(' ')}`;
    }

    togglePhase(code: string) {
        this.subForm.phaseCodes = this.subForm.phaseCodes.includes(code) ? this.subForm.phaseCodes.filter((item) => item !== code) : [...this.subForm.phaseCodes, code].sort();
    }

    closeForms() {
        if (this.saving()) return;
        this.staffFormOpen.set(false);
        this.subFormOpen.set(false);
    }

    saveStaff() {
        const editing = this.editingStaff();
        const input: StaffAssignmentInput = { personnelId: this.staffForm.personnelId ?? '', role: this.staffForm.role ?? ('' as StaffRole), ...(this.staffForm.note.trim() ? { note: this.staffForm.note.trim() } : {}) };
        const request = editing ? this.teamService.updateStaff(this.projectCode(), editing.id, input) : this.teamService.addStaff(this.projectCode(), input);
        this.submit(request, editing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มผู้รับผิดชอบแล้ว');
    }

    saveSub() {
        const editing = this.editingSub();
        const input: SubcontractorAssignmentInput = {
            subcontractorId: this.subForm.subcontractorId ?? '',
            scope: this.subForm.scope.trim(),
            phaseCodes: this.subForm.phaseCodes,
            ...(this.subForm.contractValue !== null ? { contractValue: this.subForm.contractValue } : {}),
            ...(this.subForm.note.trim() ? { note: this.subForm.note.trim() } : {})
        };
        const request = editing ? this.teamService.updateSubcontractor(this.projectCode(), editing.id, input) : this.teamService.addSubcontractor(this.projectCode(), input);
        this.submit(request, editing ? 'บันทึกการแก้ไขแล้ว' : 'มอบหมายผู้รับเหมาแล้ว');
    }

    confirmRemoveStaff(member: StaffAssignment) {
        this.confirmation.confirm({
            header: 'นำผู้รับผิดชอบออก',
            message: `นำ ${member.name} (${STAFF_ROLE_LABEL[member.role]}) ออกจากโครงการนี้?`,
            acceptLabel: 'นำออก',
            rejectLabel: 'ยกเลิก',
            acceptButtonProps: { severity: 'danger' },
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () => this.remove(this.teamService.removeStaff(this.projectCode(), member.id), `นำ ${member.name} ออกแล้ว`)
        });
    }

    confirmRemoveSub(item: SubcontractorAssignment) {
        this.confirmation.confirm({
            header: 'ยกเลิกการมอบหมาย',
            message: `ยกเลิกการมอบหมาย ${item.subcontractor.name} ในโครงการนี้?`,
            acceptLabel: 'ยกเลิกการมอบหมาย',
            rejectLabel: 'ไม่ใช่',
            acceptButtonProps: { severity: 'danger' },
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () => this.remove(this.teamService.removeSubcontractor(this.projectCode(), item.id), `ยกเลิกการมอบหมาย ${item.subcontractor.name} แล้ว`)
        });
    }

    errorText(error: unknown) {
        return problemMessage(error);
    }

    private resetErrors() {
        this.formErrors.set({});
        this.formError.set('');
    }

    private submit(request: Observable<unknown>, success: string) {
        this.saving.set(true);
        this.resetErrors();
        request.subscribe({
            next: () => {
                this.saving.set(false);
                this.staffFormOpen.set(false);
                this.subFormOpen.set(false);
                this.afterChange(success);
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.formErrors.set(problem.errors);
                this.formError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }

    private remove(request: Observable<void>, success: string) {
        request.subscribe({
            next: () => this.afterChange(success),
            error: (error) => this.messages.add({ severity: 'error', summary: 'ทำรายการไม่สำเร็จ', detail: problemMessage(error) })
        });
    }

    private afterChange(success: string) {
        this.assignments.reload();
        this.messages.add({ severity: 'success', summary: success });
        this.changed.emit();
    }
}
