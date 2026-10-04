import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { ProcurementItem, ProcurementService, PurchaseRequest } from '@/app/pages/service/procurement.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const emptyItem = (): ProcurementItem => ({ name: '', quantity: 1, unit: '', unitPrice: 0 });

/** ขอซื้อวัสดุ (ใบขอซื้อ PR) → ส่งเข้าศูนย์อนุมัติ */
@Component({
    selector: 'app-purchase-request-form',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(52rem, 96vw)' }" header="ขอซื้อวัสดุ">
            <form id="purchase-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4" (ngSubmit)="submit()" novalidate>
                <div class="sm:col-span-2">
                    <label for="pr-title" class="block text-sm font-semibold mb-2">เรื่อง <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="pr-title" name="title" class="w-full" maxlength="200" placeholder="เช่น ทรายและหินสำหรับเทพื้นชั้น 1" [ngModel]="title()" (ngModelChange)="title.set($event)" [attr.aria-invalid]="!!errors()['title']" />
                    @if (errors()['title']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['title'] }}</small>
                    }
                </div>
                <div>
                    <label for="pr-needed" class="block text-sm font-semibold mb-2">ต้องการใช้วันที่ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="pr-needed" name="neededDate" type="date" class="w-full" [ngModel]="neededDate()" (ngModelChange)="neededDate.set($event)" [attr.aria-invalid]="!!errors()['neededDate']" />
                    @if (errors()['neededDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['neededDate'] }}</small>
                    }
                </div>
                <div>
                    <label for="pr-phase" class="block text-sm font-semibold mb-2">ใช้กับขั้นตอน</label>
                    <select id="pr-phase" name="phaseCode" class="native-select w-full" [value]="phaseCode()" (change)="phaseCode.set($any($event.target).value)">
                        <option value="">ไม่ระบุ</option>
                        @for (phase of phases(); track phase.code) {
                            <option [value]="phase.code" [selected]="phase.code === phaseCode()">{{ phase.step }}. {{ phase.shortName }}</option>
                        }
                    </select>
                </div>
                <div class="sm:col-span-2">
                    <label for="pr-supplier" class="block text-sm font-semibold mb-2">ร้านค้าที่เสนอ</label>
                    <input pInputText id="pr-supplier" name="supplier" class="w-full" maxlength="200" placeholder="ไม่บังคับ — ฝ่ายจัดซื้อเลือกร้านตอนสั่งซื้อได้" [ngModel]="supplier()" (ngModelChange)="supplier.set($event)" />
                </div>

                <div class="sm:col-span-2">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-sm font-semibold">รายการ <span class="text-red-600" aria-hidden="true">*</span></span>
                        <button pButton type="button" [text]="true" size="small" icon="pi pi-plus" label="เพิ่มรายการ" [disabled]="items().length >= 50" (click)="addItem()"></button>
                    </div>
                    @if (errors()['items']) {
                        <small class="block mb-2 text-red-600 dark:text-red-400">{{ errors()['items'] }}</small>
                    }
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm border-collapse" style="min-width: 36rem">
                            <thead>
                                <tr class="text-left text-muted-color border-b border-surface">
                                    <th class="py-2 pr-2 font-semibold">รายการ</th>
                                    <th class="py-2 pr-2 font-semibold w-24 text-right">จำนวน</th>
                                    <th class="py-2 pr-2 font-semibold w-24">หน่วย</th>
                                    <th class="py-2 pr-2 font-semibold w-28 text-right">ราคา/หน่วย</th>
                                    <th class="py-2 pr-2 font-semibold w-28 text-right">รวม</th>
                                    <th class="w-8"></th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (item of items(); track $index; let i = $index) {
                                    <tr class="border-b border-surface align-top">
                                        <td class="py-1 pr-2">
                                            <input pInputText class="w-full" maxlength="200" [attr.aria-label]="'ชื่อรายการที่ ' + (i + 1)" [value]="item.name" (input)="patch(i, { name: $any($event.target).value })" [attr.aria-invalid]="!!errors()['items.' + i + '.name']" />
                                        </td>
                                        <td class="py-1 pr-2">
                                            <input pInputText type="number" min="0" step="any" class="w-full text-right" [attr.aria-label]="'จำนวนรายการที่ ' + (i + 1)" [value]="item.quantity" (input)="patch(i, { quantity: +$any($event.target).value })" [attr.aria-invalid]="!!errors()['items.' + i + '.quantity']" />
                                        </td>
                                        <td class="py-1 pr-2">
                                            <input pInputText class="w-full" maxlength="30" placeholder="ถุง" [attr.aria-label]="'หน่วยรายการที่ ' + (i + 1)" [value]="item.unit" (input)="patch(i, { unit: $any($event.target).value })" [attr.aria-invalid]="!!errors()['items.' + i + '.unit']" />
                                        </td>
                                        <td class="py-1 pr-2">
                                            <input pInputText type="number" min="0" step="any" class="w-full text-right" [attr.aria-label]="'ราคาต่อหน่วยรายการที่ ' + (i + 1)" [value]="item.unitPrice" (input)="patch(i, { unitPrice: +$any($event.target).value })" />
                                        </td>
                                        <td class="py-1 pr-2 text-right tabular-nums align-middle">{{ (item.quantity || 0) * (item.unitPrice || 0) | number: '1.0-2' }}</td>
                                        <td class="py-1 align-middle">
                                            <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" size="small" [disabled]="items().length === 1" [attr.aria-label]="'ลบรายการที่ ' + (i + 1)" (click)="removeItem(i)"></button>
                                        </td>
                                    </tr>
                                }
                            </tbody>
                            <tfoot>
                                <tr class="font-semibold">
                                    <td class="py-2" colspan="4">รวมโดยประมาณ</td>
                                    <td class="py-2 pr-2 text-right tabular-nums">฿{{ total() | number: '1.0-2' }}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
                <div class="sm:col-span-2">
                    <label for="pr-note" class="block text-sm font-semibold mb-2">เหตุผล / หมายเหตุถึงผู้อนุมัติ</label>
                    <textarea pTextarea id="pr-note" name="note" rows="2" maxlength="1000" class="w-full" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
                </div>
            </form>
            <p class="text-xs text-muted-color mt-3 mb-0"><i class="pi pi-info-circle mr-1"></i>ใบขอซื้อจะเข้าศูนย์อนุมัติ ({{ total() > 0 ? 'ยอด ฿' + (total() | number: '1.0-0') : '' }}) เมื่ออนุมัติแล้วฝ่ายจัดซื้อสั่งซื้อและบันทึกรับของได้ที่แท็บนี้</p>
            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="submit" form="purchase-form" icon="pi pi-send" label="ส่งขออนุมัติ" [loading]="saving()"></button>
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .native-select {
            padding: 0.5rem 0.75rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
    `
})
export class PurchaseRequestForm {
    private readonly service = inject(ProcurementService);

    readonly projectCode = input.required<string>();
    readonly phases = input<TimelinePhase[]>([]);
    readonly saved = output<PurchaseRequest>();
    readonly closed = output<void>();

    readonly title = signal('');
    readonly neededDate = signal(todayLocal());
    readonly phaseCode = signal('');
    readonly supplier = signal('');
    readonly note = signal('');
    readonly items = signal<ProcurementItem[]>([emptyItem()]);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');
    readonly total = computed(() => this.items().reduce((sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0), 0));

    addItem() {
        this.items.update((items) => [...items, emptyItem()]);
    }

    removeItem(index: number) {
        this.items.update((items) => items.filter((_, i) => i !== index));
    }

    patch(index: number, change: Partial<ProcurementItem>) {
        this.items.update((items) => items.map((item, i) => (i === index ? { ...item, ...change } : item)));
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.title().trim()) errors['title'] = 'กรุณาระบุเรื่องที่ขอซื้อ';
        if (!this.neededDate()) errors['neededDate'] = 'กรุณาระบุวันที่ต้องการใช้';
        this.items().forEach((item, i) => {
            if (!item.name.trim()) errors[`items.${i}.name`] = 'กรุณาระบุชื่อรายการ';
            if (!(item.quantity > 0)) errors[`items.${i}.quantity`] = 'จำนวนต้องมากกว่า 0';
            if (!item.unit.trim()) errors[`items.${i}.unit`] = 'กรุณาระบุหน่วย';
        });
        if (Object.keys(errors).some((key) => key.startsWith('items.'))) errors['items'] = 'กรอกชื่อ จำนวน และหน่วยให้ครบทุกรายการ';
        this.errors.set(errors);
        if (Object.keys(errors).length) return;

        this.saving.set(true);
        this.generalError.set('');
        this.service
            .createPurchase(this.projectCode(), {
                title: this.title().trim(),
                neededDate: this.neededDate(),
                items: this.items().map((item) => ({ ...item, name: item.name.trim(), unit: item.unit.trim(), unitPrice: item.unitPrice || 0 })),
                ...(this.phaseCode() ? { phaseCode: this.phaseCode() } : {}),
                ...(this.supplier().trim() ? { supplier: this.supplier().trim() } : {}),
                ...(this.note().trim() ? { note: this.note().trim() } : {})
            })
            .subscribe({
                next: (purchase) => {
                    this.saving.set(false);
                    this.saved.emit(purchase);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'ส่งใบขอซื้อไม่สำเร็จ'));
                }
            });
    }
}
