import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { CHANGE_SOURCE, ChangeOrder, ChangeOrderItem, ChangeOrderService, ChangeOrderSource } from '@/app/pages/service/change-order.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';

const blankItem = (): ChangeOrderItem => ({ name: '', kind: 'add', quantity: 1, unit: 'งาน', unitPrice: 0 });

/** ฟอร์มขอเพิ่ม-ลดงาน: รายการงาน (เพิ่ม/ลด) ผลต่อกำหนดส่งมอบ และงานที่จะเพิ่มเข้าไทม์ไลน์เมื่ออนุมัติ */
@Component({
    selector: 'app-change-order-form',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputNumberModule, InputTextModule, NgClass, SelectModule, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && close()" [modal]="true" [draggable]="false" [style]="{ width: 'min(60rem, 96vw)' }" header="ขอเพิ่ม-ลดงาน">
            <form id="change-order-form" class="flex flex-col gap-5" (ngSubmit)="save()" novalidate>
                <div>
                    <label for="co-title" class="block text-sm font-semibold mb-2">ชื่อรายการ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="co-title" name="title" class="w-full" placeholder="เช่น ลูกค้าขอเพิ่มหลังคากันสาดหน้าบ้าน" [(ngModel)]="title" [attr.aria-invalid]="!!errors()['title']" />
                    @if (errors()['title']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['title'] }}</small>
                    }
                </div>

                <fieldset class="border-0 p-0 m-0 min-w-0">
                    <legend class="block text-sm font-semibold mb-2 p-0">ที่มาของการเปลี่ยนแปลง <span class="text-red-600" aria-hidden="true">*</span></legend>
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        @for (option of sources; track option.value) {
                            <label class="flex flex-col gap-1 rounded-lg border p-3 cursor-pointer" [ngClass]="source() === option.value ? 'border-primary bg-primary-50 dark:bg-primary-500/10' : 'border-surface hover:border-primary'">
                                <span class="flex items-center gap-2 font-semibold">
                                    <input type="radio" name="source" class="accent-[var(--p-primary-color)]" [value]="option.value" [checked]="source() === option.value" (change)="source.set(option.value)" />
                                    {{ option.label }}
                                </span>
                                <span class="text-xs text-muted-color">{{ option.hint }}</span>
                            </label>
                        }
                    </div>
                    @if (errors()['source']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['source'] }}</small>
                    }
                </fieldset>

                <div>
                    <label for="co-reason" class="block text-sm font-semibold mb-2">เหตุผล / รายละเอียด <span class="text-red-600" aria-hidden="true">*</span></label>
                    <textarea pTextarea id="co-reason" name="reason" rows="2" class="w-full" placeholder="เช่น ลูกค้าแจ้งความต้องการเพิ่มหลังเห็นงานโครงสร้าง" [(ngModel)]="reason" [attr.aria-invalid]="!!errors()['reason']"></textarea>
                    @if (errors()['reason']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['reason'] }}</small>
                    }
                </div>

                <fieldset class="border-0 p-0 m-0 min-w-0">
                    <legend class="block text-sm font-semibold mb-2 p-0">รายการงาน <span class="text-red-600" aria-hidden="true">*</span></legend>
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm border-collapse" style="min-width: 48rem">
                            <thead>
                                <tr class="text-left text-muted-color border-b border-surface">
                                    <th class="py-2 pr-2 font-semibold">รายละเอียดงาน</th>
                                    <th class="py-2 pr-2 font-semibold w-28">ประเภท</th>
                                    <th class="py-2 pr-2 font-semibold w-24">จำนวน</th>
                                    <th class="py-2 pr-2 font-semibold w-24">หน่วย</th>
                                    <th class="py-2 pr-2 font-semibold w-32">ราคา/หน่วย</th>
                                    <th class="py-2 pr-2 font-semibold w-32 text-right">รวม (บาท)</th>
                                    <th class="w-10"><span class="sr-only">ลบ</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (item of items(); track $index; let i = $index) {
                                    <tr class="border-b border-surface align-top">
                                        <td class="py-2 pr-2">
                                            <input pInputText class="w-full" [name]="'item-name-' + i" [attr.aria-label]="'รายละเอียดงานแถว ' + (i + 1)" [(ngModel)]="item.name" (ngModelChange)="touch()" />
                                            @if (errors()['items.' + i]) {
                                                <small class="text-red-600 dark:text-red-400">{{ errors()['items.' + i] }}</small>
                                            }
                                        </td>
                                        <td class="py-2 pr-2">
                                            <p-select [options]="kinds" optionLabel="label" optionValue="value" [name]="'item-kind-' + i" [ariaLabel]="'ประเภทแถว ' + (i + 1)" [(ngModel)]="item.kind" (ngModelChange)="touch()" class="w-full" />
                                        </td>
                                        <td class="py-2 pr-2">
                                            <p-inputnumber [name]="'item-qty-' + i" [ariaLabel]="'จำนวนแถว ' + (i + 1)" [(ngModel)]="item.quantity" (ngModelChange)="touch()" [min]="0" [maxFractionDigits]="2" inputStyleClass="w-full" class="w-full" />
                                        </td>
                                        <td class="py-2 pr-2">
                                            <input pInputText class="w-full" [name]="'item-unit-' + i" [attr.aria-label]="'หน่วยแถว ' + (i + 1)" [(ngModel)]="item.unit" />
                                        </td>
                                        <td class="py-2 pr-2">
                                            <p-inputnumber
                                                [name]="'item-price-' + i"
                                                [ariaLabel]="'ราคาต่อหน่วยแถว ' + (i + 1)"
                                                [(ngModel)]="item.unitPrice"
                                                (ngModelChange)="touch()"
                                                [min]="0"
                                                [maxFractionDigits]="2"
                                                inputStyleClass="w-full"
                                                class="w-full"
                                            />
                                        </td>
                                        <td class="py-2 pr-2 text-right tabular-nums pt-4" [ngClass]="item.kind === 'deduct' ? 'text-orange-700 dark:text-orange-300' : ''">
                                            {{ item.kind === 'deduct' ? '−' : '' }}{{ (item.quantity || 0) * (item.unitPrice || 0) | number: '1.0-2' }}
                                        </td>
                                        <td class="py-2">
                                            <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="danger" [disabled]="items().length === 1" [attr.aria-label]="'ลบแถว ' + (i + 1)" (click)="removeItem(i)"></button>
                                        </td>
                                    </tr>
                                }
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colspan="5" class="pt-3">
                                        <button pButton type="button" icon="pi pi-plus" label="เพิ่มรายการ" [text]="true" size="small" (click)="addItem()"></button>
                                    </td>
                                    <td class="pt-3 text-right text-sm" colspan="2">
                                        <div class="text-muted-color">งานเพิ่ม {{ totals().add | number: '1.0-2' }} · งานลด {{ totals().deduct | number: '1.0-2' }}</div>
                                        <div class="font-semibold text-base">สุทธิ {{ totals().net >= 0 ? '+' : '−' }}฿{{ abs(totals().net) | number: '1.0-2' }}</div>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    @if (errors()['items']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['items'] }}</small>
                    }
                </fieldset>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label for="co-days" class="block text-sm font-semibold mb-2">ผลต่อกำหนดส่งมอบ (วัน)</label>
                        <p-inputnumber inputId="co-days" name="scheduleImpactDays" [(ngModel)]="scheduleImpactDays" [min]="-60" [max]="365" [showButtons]="true" inputStyleClass="w-full" class="w-full" />
                        @if (errors()['scheduleImpactDays']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['scheduleImpactDays'] }}</small>
                        } @else {
                            <small class="text-muted-color">{{ scheduleHint() }}</small>
                        }
                    </div>
                    <div class="md:col-span-2">
                        <span class="block text-sm font-semibold mb-2">งานในไทม์ไลน์</span>
                        <label class="flex items-center gap-2 cursor-pointer py-2">
                            <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="addTask()" (change)="addTask.set(!addTask())" />
                            เพิ่มงานเข้าไทม์ไลน์เมื่ออนุมัติ (ติดตามความคืบหน้าได้)
                        </label>
                    </div>
                </div>

                @if (addTask()) {
                    <div class="grid grid-cols-1 md:grid-cols-6 gap-4 rounded-lg border border-surface p-3">
                        <div class="md:col-span-2">
                            <label for="co-phase" class="block text-sm font-semibold mb-2">ขั้นตอน</label>
                            <p-select inputId="co-phase" name="phaseCode" [options]="phaseOptions()" optionLabel="label" optionValue="value" [(ngModel)]="taskPhase" placeholder="เลือกขั้นตอน" class="w-full" />
                        </div>
                        <div class="md:col-span-3">
                            <label for="co-task" class="block text-sm font-semibold mb-2">ชื่องาน</label>
                            <input pInputText id="co-task" name="taskName" class="w-full" [(ngModel)]="taskName" [placeholder]="title || 'ชื่องานที่จะแสดงในไทม์ไลน์'" />
                        </div>
                        <div>
                            <label for="co-duration" class="block text-sm font-semibold mb-2">ระยะเวลา (วัน)</label>
                            <p-inputnumber inputId="co-duration" name="taskDuration" [(ngModel)]="taskDuration" [min]="1" [max]="120" inputStyleClass="w-full" class="w-full" />
                        </div>
                        @if (errors()['newTask']) {
                            <small class="md:col-span-6 text-red-600 dark:text-red-400">{{ errors()['newTask'] }}</small>
                        } @else {
                            <small class="md:col-span-6 text-muted-color">งานจะต่อท้ายขั้นตอนที่เลือก (ก่อนหมุดหมาย) เริ่มวันนี้หรือหลังงานสุดท้ายของขั้นตอน</small>
                        }
                    </div>
                }

                <label class="flex items-start gap-2 cursor-pointer rounded-lg p-3" [ngClass]="source() === 'customer' && !customerConfirmed ? 'bg-orange-50 dark:bg-orange-500/10' : 'bg-emphasis'">
                    <input type="checkbox" class="mt-1 accent-[var(--p-primary-color)]" [checked]="customerConfirmed" (change)="customerConfirmed = !customerConfirmed" />
                    <span>
                        <span class="font-semibold">ลูกค้ายืนยันรายการและราคาแล้ว</span>
                        <span class="block text-xs text-muted-color">
                            เช่น ลงนามใบเสนอราคางานเพิ่ม-ลด
                            @if (source() === 'customer') {
                                · งานที่ลูกค้าขอจะอนุมัติได้หลังลูกค้ายืนยัน (บันทึกภายหลังได้)
                            }
                        </span>
                    </span>
                </label>
            </form>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="close()"></button>
                <button pButton type="submit" form="change-order-form" icon="pi pi-send" label="ส่งขออนุมัติ" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class ChangeOrderForm {
    private readonly service = inject(ChangeOrderService);

    readonly projectCode = input.required<string>();
    readonly phases = input.required<TimelinePhase[]>();
    readonly saved = output<ChangeOrder>();
    readonly closed = output<void>();

    readonly sources = (Object.keys(CHANGE_SOURCE) as ChangeOrderSource[]).map((value) => ({ value, ...CHANGE_SOURCE[value] }));
    readonly kinds = [
        { value: 'add', label: 'งานเพิ่ม' },
        { value: 'deduct', label: 'งานลด' }
    ];
    readonly abs = Math.abs;

    title = '';
    reason = '';
    readonly source = signal<ChangeOrderSource>('customer');
    readonly items = signal<ChangeOrderItem[]>([blankItem()]);
    /** เพิ่มค่าทุกครั้งที่แก้รายการ ให้ยอดรวมคำนวณใหม่ (ngModel แก้ค่าในอ็อบเจกต์เดิม) */
    private readonly version = signal(0);
    scheduleImpactDays = 0;
    readonly addTask = signal(false);
    taskPhase: string | null = null;
    taskName = '';
    taskDuration = 3;
    customerConfirmed = false;

    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    readonly phaseOptions = computed(() => this.phases().map((phase) => ({ value: phase.code, label: `ขั้นตอนที่ ${phase.step} · ${phase.shortName}${phase.status === 'done' ? ' (เสร็จแล้ว)' : ''}` })));
    readonly totals = computed(() => {
        this.version();
        const sum = (kind: 'add' | 'deduct') => this.items().reduce((total, item) => total + (item.kind === kind ? (item.quantity || 0) * (item.unitPrice || 0) : 0), 0);
        const add = sum('add');
        const deduct = sum('deduct');
        return { add, deduct, net: add - deduct };
    });

    scheduleHint() {
        const days = this.scheduleImpactDays || 0;
        return days > 0 ? `เลื่อนกำหนดส่งมอบออกไป ${days} วัน` : days < 0 ? `ส่งมอบเร็วขึ้น ${-days} วัน` : 'ไม่กระทบกำหนดส่งมอบ';
    }

    touch() {
        this.version.update((value) => value + 1);
    }

    addItem() {
        this.items.update((items) => [...items, blankItem()]);
    }

    removeItem(index: number) {
        this.items.update((items) => items.filter((_, i) => i !== index));
    }

    close() {
        if (!this.saving()) this.closed.emit();
    }

    save() {
        const taskName = this.taskName.trim() || this.title.trim();
        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        this.service
            .create(this.projectCode(), {
                title: this.title,
                source: this.source(),
                reason: this.reason,
                items: this.items(),
                scheduleImpactDays: this.scheduleImpactDays || 0,
                ...(this.addTask() ? { newTask: { phaseCode: this.taskPhase ?? '', name: taskName, durationDays: this.taskDuration || 0 } } : {}),
                customerConfirmed: this.customerConfirmed
            })
            .subscribe({
                next: (order) => {
                    this.saving.set(false);
                    this.saved.emit(order);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'ส่งขออนุมัติไม่สำเร็จ'));
                }
            });
    }
}
