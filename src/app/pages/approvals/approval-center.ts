import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, map } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DrawerModule } from 'primeng/drawer';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableLazyLoadEvent, TableModule } from 'primeng/table';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { problemMessage } from '@/app/api/api';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { APPROVAL_STATUS_LABEL, APPROVAL_STEP_LABEL, APPROVAL_TYPE_LABEL, ApprovalRequest, ApprovalService, ApprovalStatus, ApprovalType } from '@/app/pages/service/approval.service';
import { ProjectService } from '@/app/pages/service/project.service';

type StatusFilter = ApprovalStatus | 'all';

const PAGE_SIZE = 10;

const STATUS_PILL: Record<ApprovalStatus, string> = {
    pending: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
    approved: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    rejected: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
};

@Component({
    selector: 'app-approval-center',
    standalone: true,
    imports: [ButtonModule, ConfirmDialogModule, DecimalPipe, DrawerModule, FormsModule, IconFieldModule, InputIconModule, InputTextModule, NgClass, RouterLink, SelectModule, TableModule, TextareaModule, ThaiDatePipe, ToastModule],
    providers: [ConfirmationService, MessageService],
    template: `
        <p-toast />
        <p-confirmdialog />

        <div class="mb-6">
            <h1 class="text-2xl font-bold m-0">ศูนย์อนุมัติ</h1>
            <p class="text-muted-color mt-1 mb-0">คำขอจากทุกโครงการ · ในฐานะเจ้าของบริษัท คุณอนุมัติได้ทุกยอด และทุกการตัดสินใจจะถูกบันทึกใน Audit Log</p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div class="card m-0">
                <div class="text-sm text-muted-color">รออนุมัติทั้งหมด</div>
                <div class="text-2xl font-bold mt-2">{{ summary()?.pending ?? '–' }} รายการ</div>
                <div class="text-sm text-muted-color mt-1">รวม ฿{{ summary()?.pendingAmount ?? 0 | number: '1.0-0' }}</div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">ต้องให้เจ้าของบริษัทอนุมัติ</div>
                <div class="text-2xl font-bold mt-2">{{ summary()?.ownerPending ?? '–' }} รายการ</div>
                <div class="text-sm text-muted-color mt-1">
                    เกินวงเงินผู้จัดการโครงการ
                    @if (settings(); as settings) {
                        ฿{{ settings.projectManagerLimit | number }}
                    }
                    @if (settings()?.changeOrderRequiresOwner) {
                        หรือเป็นงานเพิ่ม-ลด
                    }
                </div>
            </div>
            <div class="card m-0">
                <div class="text-sm text-muted-color">อยู่ในวงเงินผู้จัดการโครงการ</div>
                <div class="text-2xl font-bold mt-2">{{ withinManagerLimit() ?? '–' }} รายการ</div>
                <div class="text-sm text-muted-color mt-1">รอผู้จัดการโครงการ แต่คุณอนุมัติแทนได้</div>
            </div>
        </div>

        <div class="card">
            <div class="flex flex-wrap items-center gap-3 mb-4">
                <div class="inline-flex rounded-full border border-surface p-1" role="group" aria-label="กรองตามสถานะ">
                    @for (option of statusOptions(); track option.value) {
                        <button
                            type="button"
                            class="px-3 py-1.5 rounded-full border-0 text-sm cursor-pointer"
                            [ngClass]="statusFilter() === option.value ? 'bg-primary text-primary-contrast font-semibold' : 'bg-transparent text-muted-color hover:text-color'"
                            [attr.aria-pressed]="statusFilter() === option.value"
                            (click)="statusFilter.set(option.value)"
                        >
                            {{ option.label }} {{ option.count ?? '' }}
                        </button>
                    }
                </div>
                <p-select [options]="typeOptions" [ngModel]="typeFilter()" (ngModelChange)="typeFilter.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกประเภท" [showClear]="true" ariaLabel="กรองตามประเภท" class="w-48" />
                <p-select [options]="projectOptions()" [ngModel]="projectFilter()" (ngModelChange)="projectFilter.set($event)" placeholder="ทุกโครงการ" [showClear]="true" ariaLabel="กรองตามโครงการ" class="w-40" />
                <p-select [options]="sortOptions" [ngModel]="sort()" (ngModelChange)="sort.set($event)" optionLabel="label" optionValue="value" ariaLabel="เรียงลำดับ" class="w-44" />
                <p-iconfield iconPosition="left" class="ml-auto w-full sm:w-72">
                    <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                    <input pInputText type="search" class="w-full" placeholder="ค้นหาเลขที่ รายการ หรือผู้ขอ" aria-label="ค้นหาคำขอ" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                </p-iconfield>
            </div>

            @if (selected().length) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-primary-50 dark:bg-primary-500/10">
                    <span>เลือก {{ selected().length }} รายการ · รวม ฿{{ selectedAmount() | number: '1.0-0' }}</span>
                    <div class="flex gap-2">
                        <button pButton type="button" [text]="true" label="ยกเลิกการเลือก" (click)="selected.set([])"></button>
                        <button pButton type="button" icon="pi pi-check" [label]="'อนุมัติที่เลือก (' + selected().length + ')'" [loading]="busy()" (click)="confirmBulkApprove()"></button>
                    </div>
                </div>
            }

            @if (approvals.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดรายการไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="approvals.reload()"></button>
                </div>
            }

            <p-table
                [value]="approvals.value().items"
                [lazy]="true"
                (onLazyLoad)="onPage($event)"
                [totalRecords]="approvals.value().total"
                [first]="(page() - 1) * pageSize"
                [rows]="pageSize"
                [paginator]="approvals.value().total > pageSize"
                [loading]="approvals.isLoading()"
                dataKey="id"
                [selection]="selected()"
                (selectionChange)="selected.set($event)"
                [rowSelectable]="isRowSelectable"
                [rowHover]="true"
                [tableStyle]="{ 'min-width': '72rem' }"
            >
                <ng-template #header>
                    <tr>
                        <th style="width: 3rem"><p-tableHeaderCheckbox [disabled]="statusFilter() !== 'pending'" ariaLabel="เลือกทั้งหมดในหน้านี้" /></th>
                        <th>เลขที่</th>
                        <th>ประเภท</th>
                        <th>โครงการ</th>
                        <th>รายการ</th>
                        <th>ผู้ขอ</th>
                        <th>วันที่ขอ</th>
                        <th class="text-right">จำนวนเงิน (บาท)</th>
                        <th>ผู้มีอำนาจอนุมัติ</th>
                        <th>สถานะ</th>
                    </tr>
                </ng-template>
                <ng-template #body let-row>
                    @let item = asRequest(row);
                    <tr class="cursor-pointer" (click)="open(item)" (keydown.enter)="open(item)" tabindex="0" [attr.aria-label]="'เปิดคำขอ ' + item.id">
                        <td (click)="$event.stopPropagation()"><p-tableCheckbox [value]="item" [disabled]="item.status !== 'pending'" [ariaLabel]="'เลือก ' + item.id" /></td>
                        <td class="font-semibold whitespace-nowrap">{{ item.id }}</td>
                        <td class="whitespace-nowrap">{{ typeLabel[item.type] }}</td>
                        <td>{{ item.projectCode }}</td>
                        <td>{{ item.title }}</td>
                        <td>
                            <div>{{ item.requestedBy.name }}</div>
                            <div class="text-xs text-muted-color">{{ item.requestedBy.roleLabel }}</div>
                        </td>
                        <td class="whitespace-nowrap">{{ item.requestedAt | thaiDate: 'dateTime' }}</td>
                        <td class="text-right font-semibold tabular-nums">{{ item.amount | number: '1.0-0' }}</td>
                        <td class="whitespace-nowrap">{{ item.approvalLevel === 'owner' ? 'เจ้าของบริษัท' : 'ผู้จัดการโครงการ' }}</td>
                        <td>
                            <span class="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" [ngClass]="statusPill[item.status]">{{ statusLabel[item.status] }}</span>
                        </td>
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td colspan="10" class="text-center text-muted-color py-8">{{ approvals.isLoading() ? 'กำลังโหลด...' : 'ไม่มีคำขอที่ตรงกับตัวกรอง' }}</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>

        <p-drawer [visible]="!!active()" (visibleChange)="!$event && active.set(null)" position="right" [style]="{ width: 'min(36rem, 100vw)' }" [header]="active()?.id ?? ''">
            @if (active(); as item) {
                <div class="flex flex-wrap items-center gap-2 mb-2">
                    <span class="px-2 py-1 rounded-md bg-emphasis text-sm">{{ typeLabel[item.type] }}</span>
                    <span class="px-2 py-1 rounded-full text-xs font-semibold" [ngClass]="statusPill[item.status]">{{ statusLabel[item.status] }}</span>
                </div>
                <h2 class="text-xl font-semibold mt-3 mb-1">{{ item.title }}</h2>
                <a [routerLink]="['/projects', item.projectCode]" class="text-primary">โครงการ {{ item.projectCode }}</a>

                <dl class="grid grid-cols-2 gap-4 my-5">
                    <div>
                        <dt class="text-sm text-muted-color">ผู้ขอ</dt>
                        <dd class="m-0 mt-1">
                            {{ item.requestedBy.name }} <span class="text-sm text-muted-color">({{ item.requestedBy.roleLabel }})</span>
                        </dd>
                    </div>
                    <div>
                        <dt class="text-sm text-muted-color">วันที่ขอ</dt>
                        <dd class="m-0 mt-1">{{ item.requestedAt | thaiDate: 'dateTime' }}</dd>
                    </div>
                    @if (item.reason) {
                        <div class="col-span-2">
                            <dt class="text-sm text-muted-color">เหตุผล</dt>
                            <dd class="m-0 mt-1">{{ item.reason }}</dd>
                        </div>
                    }
                </dl>

                <table class="w-full text-sm border-collapse mb-2">
                    <thead>
                        <tr class="border-b border-surface text-muted-color text-left">
                            <th class="py-2 font-semibold">รายการ</th>
                            <th class="py-2 font-semibold text-right">จำนวน</th>
                            <th class="py-2 font-semibold text-right">ราคา/หน่วย</th>
                            <th class="py-2 font-semibold text-right">รวม</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (line of item.items; track $index) {
                            <tr class="border-b border-surface">
                                <td class="py-2 pr-2">{{ line.name }}</td>
                                <td class="py-2 text-right whitespace-nowrap">{{ line.quantity | number }} {{ line.unit }}</td>
                                <td class="py-2 text-right tabular-nums">{{ line.unitPrice | number: '1.0-2' }}</td>
                                <td class="py-2 text-right tabular-nums">{{ line.quantity * line.unitPrice | number: '1.0-0' }}</td>
                            </tr>
                        }
                    </tbody>
                    <tfoot>
                        <tr class="font-semibold">
                            <td class="py-2" colspan="3">รวมทั้งสิ้น (บาท)</td>
                            <td class="py-2 text-right tabular-nums">{{ item.amount | number: '1.0-0' }}</td>
                        </tr>
                    </tfoot>
                </table>

                <p class="text-sm rounded-lg px-3 py-2 bg-surface-100 dark:bg-surface-800 mb-5">
                    <i class="pi pi-info-circle mr-1"></i>
                    @if (item.approvalLevel === 'owner') {
                        {{ item.type === 'change-order' ? 'งานเพิ่ม-ลดกระทบสัญญากับลูกค้า ต้องผ่านเจ้าของบริษัท' : 'ยอดเกินวงเงินผู้จัดการโครงการ ต้องให้เจ้าของบริษัทอนุมัติ' }}
                    } @else {
                        อยู่ในวงเงินผู้จัดการโครงการ คุณอนุมัติแทนได้ในฐานะเจ้าของบริษัท
                    }
                </p>

                <h3 class="text-sm font-semibold mb-3">ประวัติการอนุมัติ</h3>
                <ol class="list-none p-0 m-0 mb-5">
                    @for (step of item.history; track $index; let last = $last) {
                        <li class="relative pl-7 pb-4">
                            @if (!last) {
                                <span class="absolute left-[7px] top-5 bottom-0 border-l border-surface" aria-hidden="true"></span>
                            }
                            <span class="absolute left-0 top-1 w-4 h-4 rounded-full" [ngClass]="step.action === 'approved' ? 'bg-green-500' : step.action === 'rejected' ? 'bg-red-500' : 'bg-surface-300 dark:bg-surface-600'" aria-hidden="true"></span>
                            <div>
                                <span class="font-semibold">{{ stepLabel[step.action] }}</span> · {{ step.user.name }} <span class="text-sm text-muted-color">({{ step.user.roleLabel }})</span>
                            </div>
                            <div class="text-xs text-muted-color">{{ step.at | thaiDate: 'dateTime' }}</div>
                            @if (step.note) {
                                <div class="text-sm mt-1">“{{ step.note }}”</div>
                            }
                        </li>
                    }
                </ol>

                @if (item.status === 'pending') {
                    <label for="decision-note" class="block text-sm font-semibold mb-2">หมายเหตุ <span class="font-normal text-muted-color">(จำเป็นเมื่อไม่อนุมัติ)</span></label>
                    <textarea pTextarea id="decision-note" rows="3" class="w-full" [ngModel]="note()" (ngModelChange)="note.set($event); noteError.set('')" [attr.aria-invalid]="!!noteError()" aria-describedby="decision-note-error"></textarea>
                    @if (noteError()) {
                        <small id="decision-note-error" class="text-red-600 dark:text-red-400">{{ noteError() }}</small>
                    }
                    <div class="flex gap-2 mt-4">
                        <button pButton type="button" severity="danger" [outlined]="true" icon="pi pi-times" label="ไม่อนุมัติ" class="flex-1" [disabled]="busy()" (click)="reject(item)"></button>
                        <button pButton type="button" icon="pi pi-check" label="อนุมัติ" class="flex-1" [loading]="busy()" (click)="approve(item)"></button>
                    </div>
                }
            }
        </p-drawer>
    `
})
export class ApprovalCenter {
    private readonly approvalService = inject(ApprovalService);
    private readonly confirmation = inject(ConfirmationService);
    private readonly messages = inject(MessageService);

    readonly pageSize = PAGE_SIZE;
    readonly typeLabel = APPROVAL_TYPE_LABEL;
    readonly statusLabel = APPROVAL_STATUS_LABEL;
    readonly stepLabel = APPROVAL_STEP_LABEL;
    readonly statusPill = STATUS_PILL;
    readonly typeOptions = (Object.keys(APPROVAL_TYPE_LABEL) as ApprovalType[]).map((value) => ({ value, label: APPROVAL_TYPE_LABEL[value] }));
    readonly projectOptions = toSignal(
        inject(ProjectService)
            .list()
            .pipe(map((projects) => projects.map((project) => project.code))),
        { initialValue: [] as string[] }
    );
    readonly sortOptions = [
        { value: 'newest', label: 'ล่าสุดก่อน' },
        { value: 'priority', label: 'สำคัญก่อน (ยอดสูง)' }
    ];
    readonly isRowSelectable = ({ data }: { data: ApprovalRequest }) => data.status === 'pending';
    readonly summary = this.approvalService.summary;
    readonly settings = this.approvalService.settings;
    readonly withinManagerLimit = computed(() => {
        const summary = this.summary();
        return summary ? summary.pending - summary.ownerPending : null;
    });

    readonly statusFilter = signal<StatusFilter>('pending');
    readonly typeFilter = signal<ApprovalType | null>(null);
    readonly projectFilter = signal<string | null>(null);
    readonly sort = signal<'newest' | 'priority'>('newest');
    readonly query = signal('');
    private readonly debouncedQuery = toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' });

    private readonly filters = computed(() => ({
        status: this.statusFilter() === 'all' ? null : (this.statusFilter() as ApprovalStatus),
        type: this.typeFilter(),
        projectCode: this.projectFilter(),
        sort: this.sort(),
        q: this.debouncedQuery()
    }));
    // Back to the first page whenever a filter changes.
    readonly page = linkedSignal({ source: this.filters, computation: () => 1 });

    readonly approvals = rxResource({
        params: () => ({ ...this.filters(), page: this.page(), pageSize: PAGE_SIZE }),
        stream: ({ params }) => this.approvalService.list(params),
        defaultValue: { items: [], total: 0, page: 1, pageSize: PAGE_SIZE }
    });

    // Selection is per loaded page and resets whenever the list reloads.
    readonly selected = linkedSignal<unknown, ApprovalRequest[]>({ source: () => this.approvals.value(), computation: () => [] });
    readonly active = signal<ApprovalRequest | null>(null);
    readonly note = signal('');
    readonly noteError = signal('');
    readonly busy = signal(false);

    readonly selectedAmount = computed(() => this.selected().reduce((sum, item) => sum + item.amount, 0));
    readonly statusOptions = computed(() => {
        const summary = this.summary();
        return [
            { value: 'pending' as StatusFilter, label: 'รออนุมัติ', count: summary?.pending },
            { value: 'approved' as StatusFilter, label: 'อนุมัติแล้ว', count: summary?.approved },
            { value: 'rejected' as StatusFilter, label: 'ไม่อนุมัติ', count: summary?.rejected },
            { value: 'all' as StatusFilter, label: 'ทั้งหมด', count: summary ? summary.pending + summary.approved + summary.rejected : undefined }
        ];
    });

    /** p-table rows are untyped in the template; this restores the type. */
    asRequest(row: ApprovalRequest): ApprovalRequest {
        return row;
    }

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    onPage(event: TableLazyLoadEvent) {
        this.page.set(Math.floor((event.first ?? 0) / PAGE_SIZE) + 1);
    }

    open(item: ApprovalRequest) {
        this.active.set(item);
        this.note.set('');
        this.noteError.set('');
    }

    approve(item: ApprovalRequest) {
        this.busy.set(true);
        this.approvalService.approve(item.id, this.note().trim()).subscribe({
            next: (updated) => {
                this.afterDecision(updated);
                this.messages.add({ severity: 'success', summary: 'อนุมัติแล้ว', detail: `${updated.id} · ฿${updated.amount.toLocaleString('th-TH')}` });
            },
            error: (error) => this.onDecisionError(error)
        });
    }

    reject(item: ApprovalRequest) {
        const note = this.note().trim();
        if (!note) {
            this.noteError.set('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
            return;
        }
        this.busy.set(true);
        this.approvalService.reject(item.id, note).subscribe({
            next: (updated) => {
                this.afterDecision(updated);
                this.messages.add({ severity: 'warn', summary: 'ไม่อนุมัติ', detail: updated.id });
            },
            error: (error) => this.onDecisionError(error)
        });
    }

    confirmBulkApprove() {
        const items = this.selected();
        this.confirmation.confirm({
            header: 'ยืนยันการอนุมัติ',
            message: `อนุมัติ ${items.length} รายการ รวม ฿${this.selectedAmount().toLocaleString('th-TH')} ใช่หรือไม่?`,
            icon: 'pi pi-check-circle',
            acceptLabel: 'อนุมัติทั้งหมด',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { text: true, severity: 'secondary' },
            accept: () => {
                this.busy.set(true);
                this.approvalService.bulkApprove(items.map((item) => item.id)).subscribe({
                    next: ({ approved, skipped }) => {
                        this.busy.set(false);
                        this.approvals.reload();
                        if (approved.length) this.messages.add({ severity: 'success', summary: 'อนุมัติแล้ว', detail: `${approved.length} รายการ` });
                        for (const item of skipped) this.messages.add({ severity: 'warn', summary: `ข้าม ${item.id}`, detail: item.reason });
                    },
                    error: (error) => {
                        this.busy.set(false);
                        this.messages.add({ severity: 'error', summary: 'อนุมัติไม่สำเร็จ', detail: problemMessage(error) });
                    }
                });
            }
        });
    }

    private afterDecision(updated: ApprovalRequest) {
        this.busy.set(false);
        this.note.set('');
        this.active.set(updated);
        this.approvals.reload();
    }

    private onDecisionError(error: unknown) {
        this.busy.set(false);
        const message = problemMessage(error);
        if (error instanceof HttpErrorResponse && error.status === 422) {
            this.noteError.set(message);
            return;
        }
        this.messages.add({ severity: 'error', summary: 'ดำเนินการไม่สำเร็จ', detail: message });
        // 409: someone else decided first — refresh to show the current state.
        if (error instanceof HttpErrorResponse && error.status === 409) this.approvals.reload();
    }
}
