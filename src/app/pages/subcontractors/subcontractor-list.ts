import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { debounceTime } from 'rxjs';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { Subcontractor, SubcontractorInput, SubcontractorService, SubcontractorTrade, TRADES, TRADE_LABEL } from '@/app/pages/service/subcontractor.service';
import { apiResource } from '@/app/api/api-resource';

const blankForm = (): SubcontractorInput => ({ name: '', trades: [], contactName: '', phone: '', email: '', lineId: '', taxId: '', address: '', note: '', status: 'active' });

/** ทะเบียนผู้รับเหมาช่วง: ค้นหา เพิ่ม แก้ไข เปิด/ปิดใช้งาน (มอบหมายงานรายโครงการที่แท็บ "ทีมงานและผู้รับเหมา" ของโครงการ) */
@Component({
    selector: 'app-subcontractor-list',
    standalone: true,
    imports: [ButtonModule, DialogModule, FormsModule, IconFieldModule, InputIconModule, InputTextModule, NgClass, SelectModule, TableModule, TagModule, TextareaModule, ToastModule],
    providers: [MessageService],
    template: `
        <p-toast />
        <div class="card">
            <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div>
                    <h1 class="text-2xl font-bold m-0">ผู้รับเหมาช่วง</h1>
                    <p class="text-muted-color mt-1 mb-0">ทะเบียนผู้รับเหมาช่วงของบริษัท · มอบหมายงานรายโครงการได้ที่แท็บ "ทีมงานและผู้รับเหมา" ในหน้าโครงการ</p>
                </div>
                @if (canManage()) {
                    <button pButton type="button" icon="pi pi-plus" label="เพิ่มผู้รับเหมาช่วง" (click)="openForm(null)"></button>
                }
            </div>

            <div class="flex flex-wrap gap-3 mb-4">
                <p-iconfield iconPosition="left" class="grow sm:grow-0">
                    <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                    <input pInputText type="search" class="w-full sm:w-72" placeholder="ค้นหาชื่อ รหัส ผู้ติดต่อ" aria-label="ค้นหาผู้รับเหมา" [ngModel]="query()" (ngModelChange)="query.set($event)" />
                </p-iconfield>
                <p-select [options]="tradeOptions" [ngModel]="trade()" (ngModelChange)="trade.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกสาขางาน" [showClear]="true" ariaLabel="กรองตามสาขางาน" class="w-48" />
                <p-select [options]="statusOptions" [ngModel]="status()" (ngModelChange)="status.set($event)" optionLabel="label" optionValue="value" placeholder="ทุกสถานะ" [showClear]="true" ariaLabel="กรองตามสถานะ" class="w-40" />
            </div>

            @if (list.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลไม่สำเร็จ: {{ errorText(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="list.reload()"></button>
                </div>
            }

            <p-table [value]="list.value()" [loading]="list.isLoading()" dataKey="id" [rows]="10" [paginator]="list.value().length > 10" [rowHover]="true" [tableStyle]="{ 'min-width': '60rem' }">
                <ng-template #header>
                    <tr>
                        <th pSortableColumn="code" style="width: 8rem">รหัส <p-sortIcon field="code" /></th>
                        <th pSortableColumn="name">ชื่อผู้รับเหมา <p-sortIcon field="name" /></th>
                        <th>สาขางาน</th>
                        <th>ผู้ติดต่อ</th>
                        <th pSortableColumn="activeProjects" style="width: 9rem">โครงการที่ทำอยู่ <p-sortIcon field="activeProjects" /></th>
                        <th style="width: 8rem">สถานะ</th>
                        @if (canManage()) {
                            <th style="width: 4rem"><span class="sr-only">แก้ไข</span></th>
                        }
                    </tr>
                </ng-template>
                <ng-template #body let-item>
                    <tr [ngClass]="{ 'opacity-60': item.status === 'inactive' }">
                        <td class="font-semibold">{{ item.code }}</td>
                        <td>
                            <div class="font-semibold">{{ item.name }}</div>
                            @if (item.note) {
                                <div class="text-xs text-muted-color">{{ item.note }}</div>
                            }
                        </td>
                        <td>
                            <div class="flex flex-wrap gap-1">
                                @for (trade of asSub(item).trades; track trade) {
                                    <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis">{{ tradeLabel[trade] }}</span>
                                }
                            </div>
                        </td>
                        <td>
                            <div>{{ item.contactName }}</div>
                            <a [href]="'tel:' + item.phone" class="text-sm text-primary">{{ item.phone }}</a>
                        </td>
                        <td class="tabular-nums">{{ item.activeProjects }}</td>
                        <td><p-tag [value]="item.status === 'active' ? 'ใช้งาน' : 'ปิดใช้งาน'" [severity]="item.status === 'active' ? 'success' : 'secondary'" /></td>
                        @if (canManage()) {
                            <td><button pButton type="button" icon="pi pi-pencil" [text]="true" [rounded]="true" [attr.aria-label]="'แก้ไข ' + item.name" (click)="openForm(item)"></button></td>
                        }
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td [attr.colspan]="canManage() ? 7 : 6" class="text-center text-muted-color py-6">{{ list.isLoading() ? 'กำลังโหลด...' : 'ไม่พบผู้รับเหมาตามเงื่อนไข' }}</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>

        <p-dialog [visible]="formOpen()" (visibleChange)="!$event && closeForm()" [modal]="true" [draggable]="false" [style]="{ width: 'min(44rem, 95vw)' }" [header]="editing() ? 'แก้ไขผู้รับเหมาช่วง ' + editing()!.code : 'เพิ่มผู้รับเหมาช่วง'">
            <form id="subcontractor-form" class="grid grid-cols-1 md:grid-cols-2 gap-4" (ngSubmit)="save()" novalidate>
                <div class="md:col-span-2">
                    <label for="sub-name" class="block text-sm font-semibold mb-2">ชื่อบริษัท/ทีมช่าง <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="sub-name" name="name" class="w-full" [(ngModel)]="form.name" [attr.aria-invalid]="!!errors()['name']" />
                    @if (errors()['name']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['name'] }}</small>
                    }
                </div>
                <fieldset class="md:col-span-2 border-0 p-0 m-0 min-w-0">
                    <legend class="block text-sm font-semibold mb-2 p-0">สาขางาน <span class="text-red-600" aria-hidden="true">*</span></legend>
                    <div class="flex flex-wrap gap-2">
                        @for (trade of trades; track trade) {
                            <label class="trade-chip" [ngClass]="{ 'trade-chip-active': form.trades.includes(trade) }">
                                <input type="checkbox" class="sr-only" [checked]="form.trades.includes(trade)" (change)="toggleTrade(trade)" />
                                {{ tradeLabel[trade] }}
                            </label>
                        }
                    </div>
                    @if (errors()['trades']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['trades'] }}</small>
                    }
                </fieldset>
                <div>
                    <label for="sub-contact" class="block text-sm font-semibold mb-2">ผู้ติดต่อ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="sub-contact" name="contactName" class="w-full" [(ngModel)]="form.contactName" [attr.aria-invalid]="!!errors()['contactName']" />
                    @if (errors()['contactName']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['contactName'] }}</small>
                    }
                </div>
                <div>
                    <label for="sub-phone" class="block text-sm font-semibold mb-2">เบอร์โทร <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="sub-phone" name="phone" type="tel" class="w-full" placeholder="08x-xxx-xxxx" [(ngModel)]="form.phone" [attr.aria-invalid]="!!errors()['phone']" />
                    @if (errors()['phone']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['phone'] }}</small>
                    }
                </div>
                <div>
                    <label for="sub-email" class="block text-sm font-semibold mb-2">อีเมล</label>
                    <input pInputText id="sub-email" name="email" type="email" class="w-full" [(ngModel)]="form.email" [attr.aria-invalid]="!!errors()['email']" />
                    @if (errors()['email']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['email'] }}</small>
                    }
                </div>
                <div>
                    <label for="sub-line" class="block text-sm font-semibold mb-2">LINE ID</label>
                    <input pInputText id="sub-line" name="lineId" class="w-full" [(ngModel)]="form.lineId" />
                </div>
                <div>
                    <label for="sub-tax" class="block text-sm font-semibold mb-2">เลขประจำตัวผู้เสียภาษี</label>
                    <input pInputText id="sub-tax" name="taxId" inputmode="numeric" class="w-full" placeholder="13 หลัก" [(ngModel)]="form.taxId" [attr.aria-invalid]="!!errors()['taxId']" />
                    @if (errors()['taxId']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['taxId'] }}</small>
                    }
                </div>
                @if (editing()) {
                    <div>
                        <span class="block text-sm font-semibold mb-2">สถานะ</span>
                        <label class="flex items-center gap-2 cursor-pointer py-2">
                            <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="form.status === 'active'" (change)="form.status = form.status === 'active' ? 'inactive' : 'active'" />
                            ใช้งาน (ปิดแล้วมอบหมายงานใหม่ไม่ได้)
                        </label>
                    </div>
                }
                <div class="md:col-span-2">
                    <label for="sub-address" class="block text-sm font-semibold mb-2">ที่อยู่</label>
                    <textarea pTextarea id="sub-address" name="address" rows="2" class="w-full" [(ngModel)]="form.address"></textarea>
                </div>
                <div class="md:col-span-2">
                    <label for="sub-note" class="block text-sm font-semibold mb-2">หมายเหตุ</label>
                    <textarea pTextarea id="sub-note" name="note" rows="2" class="w-full" placeholder="เช่น จุดเด่น เงื่อนไขการจ้าง" [(ngModel)]="form.note"></textarea>
                </div>
            </form>
            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closeForm()"></button>
                <button pButton type="submit" form="subcontractor-form" icon="pi pi-check" label="บันทึก" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .trade-chip {
            padding: 0.375rem 0.75rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 999px;
            font-size: 0.875rem;
            cursor: pointer;
        }
        .trade-chip:hover,
        .trade-chip:focus-within {
            border-color: var(--p-primary-color);
        }
        .trade-chip:focus-within {
            outline: 2px solid var(--p-primary-color);
            outline-offset: 2px;
        }
        .trade-chip-active {
            background: var(--p-primary-color);
            border-color: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
        }
    `
})
export class SubcontractorList {
    private readonly service = inject(SubcontractorService);
    private readonly auth = inject(AuthService);
    private readonly messages = inject(MessageService);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);

    readonly tradeLabel = TRADE_LABEL;
    readonly trades = TRADES;
    readonly tradeOptions = TRADES.map((value) => ({ value, label: TRADE_LABEL[value] }));
    readonly statusOptions = [
        { value: 'active', label: 'ใช้งาน' },
        { value: 'inactive', label: 'ปิดใช้งาน' }
    ];
    readonly canManage = computed(() => this.auth.can('project.manage'));

    readonly query = signal('');
    readonly trade = signal<SubcontractorTrade | null>(null);
    readonly status = signal<'active' | 'inactive' | null>(null);
    private readonly debouncedQuery = toSignal(toObservable(this.query).pipe(debounceTime(250)), { initialValue: '' });
    readonly list = apiResource({
        params: () => ({ q: this.debouncedQuery() || undefined, trade: this.trade(), status: this.status() }),
        stream: ({ params }) => this.service.list(params),
        defaultValue: []
    });

    readonly formOpen = signal(false);
    readonly editing = signal<Subcontractor | null>(null);
    form: SubcontractorInput = blankForm();
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    constructor() {
        // เมนู "เพิ่มผู้รับเหมาช่วง" เปิดหน้านี้พร้อม ?new=1
        this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
            if (params.get('new') && this.canManage()) {
                this.openForm(null);
                this.router.navigate([], { relativeTo: this.route, queryParams: { new: null }, queryParamsHandling: 'merge', replaceUrl: true });
            }
        });
    }

    asSub(item: Subcontractor) {
        return item;
    }

    openForm(item: Subcontractor | null) {
        this.editing.set(item);
        this.form = item
            ? {
                  name: item.name,
                  trades: [...item.trades],
                  contactName: item.contactName,
                  phone: item.phone,
                  email: item.email ?? '',
                  lineId: item.lineId ?? '',
                  taxId: item.taxId ?? '',
                  address: item.address ?? '',
                  note: item.note ?? '',
                  status: item.status
              }
            : blankForm();
        this.errors.set({});
        this.generalError.set('');
        this.formOpen.set(true);
    }

    closeForm() {
        if (!this.saving()) this.formOpen.set(false);
    }

    toggleTrade(trade: SubcontractorTrade) {
        this.form.trades = this.form.trades.includes(trade) ? this.form.trades.filter((item) => item !== trade) : [...this.form.trades, trade];
    }

    save() {
        const editing = this.editing();
        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        const request = editing ? this.service.update(editing.id, this.form) : this.service.create(this.form);
        request.subscribe({
            next: (saved) => {
                this.saving.set(false);
                this.formOpen.set(false);
                this.list.reload();
                this.messages.add({ severity: 'success', summary: editing ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มผู้รับเหมาแล้ว', detail: `${saved.code} ${saved.name}` });
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
            }
        });
    }

    errorText(error: unknown) {
        return problemMessage(error);
    }
}
