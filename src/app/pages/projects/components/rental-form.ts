import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { ProcurementService, Rental, estimateRent } from '@/app/pages/service/procurement.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** ขอเช่าอุปกรณ์จากภายนอก (ส่งเข้าศูนย์อนุมัติ) หรือขอยืมจากคลังบริษัท (ไม่ต้องอนุมัติ) */
@Component({
    selector: 'app-rental-form',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, NgClass, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(40rem, 96vw)' }" header="ขอเช่า / ยืมอุปกรณ์">
            <div class="grid grid-cols-2 gap-2 mb-4" role="radiogroup" aria-label="ประเภท">
                @for (option of sources; track option.value) {
                    <button
                        type="button"
                        role="radio"
                        class="p-3 rounded-lg border-2 cursor-pointer bg-transparent text-color text-left"
                        [ngClass]="source() === option.value ? 'border-primary' : 'border-surface'"
                        [attr.aria-checked]="source() === option.value"
                        (click)="source.set(option.value)"
                    >
                        <span class="block font-semibold"><i class="pi mr-1" [ngClass]="option.icon"></i>{{ option.label }}</span>
                        <span class="block text-xs text-muted-color mt-1">{{ option.hint }}</span>
                    </button>
                }
            </div>

            <form id="rental-form" class="grid grid-cols-1 sm:grid-cols-6 gap-4" (ngSubmit)="submit()" novalidate>
                <div class="sm:col-span-6">
                    <label for="rt-equipment" class="block text-sm font-semibold mb-2">อุปกรณ์ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="rt-equipment" name="equipment" class="w-full" maxlength="200" placeholder="เช่น นั่งร้านเหล็ก, เครื่องตบดิน, รถเครน 25 ตัน" [ngModel]="equipment()" (ngModelChange)="equipment.set($event)" [attr.aria-invalid]="!!errors()['equipment']" />
                    @if (errors()['equipment']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['equipment'] }}</small>
                    }
                </div>
                <div class="sm:col-span-3">
                    <label for="rt-qty" class="block text-sm font-semibold mb-2">จำนวน <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="rt-qty" name="quantity" type="number" min="0" step="any" class="w-full" [ngModel]="quantity()" (ngModelChange)="quantity.set(+$event)" [attr.aria-invalid]="!!errors()['quantity']" />
                </div>
                <div class="sm:col-span-3">
                    <label for="rt-unit" class="block text-sm font-semibold mb-2">หน่วย <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="rt-unit" name="unit" class="w-full" maxlength="30" placeholder="ชุด / เครื่อง / คัน" [ngModel]="unit()" (ngModelChange)="unit.set($event)" [attr.aria-invalid]="!!errors()['unit']" />
                </div>
                <div class="sm:col-span-3">
                    <label for="rt-start" class="block text-sm font-semibold mb-2">เริ่มใช้ <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="rt-start" name="startDate" type="date" class="w-full" [ngModel]="startDate()" (ngModelChange)="startDate.set($event)" />
                </div>
                <div class="sm:col-span-3">
                    <label for="rt-end" class="block text-sm font-semibold mb-2">กำหนดคืน <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="rt-end" name="endDate" type="date" class="w-full" [min]="startDate()" [ngModel]="endDate()" (ngModelChange)="endDate.set($event)" [attr.aria-invalid]="!!errors()['endDate']" />
                    @if (errors()['endDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['endDate'] }}</small>
                    }
                </div>
                <div class="sm:col-span-6">
                    <label for="rt-vendor" class="block text-sm font-semibold mb-2">{{ source() === 'rent' ? 'ร้านให้เช่า' : 'ยืมจาก (คลัง / รหัสครุภัณฑ์)' }} @if (source() === 'rent') {<span class="text-red-600" aria-hidden="true">*</span>}</label>
                    <input pInputText id="rt-vendor" name="vendor" class="w-full" maxlength="200" [placeholder]="source() === 'rent' ? 'ชื่อร้าน / เบอร์โทร' : 'เช่น คลังสำนักงานใหญ่, AS-0123'" [ngModel]="vendor()" (ngModelChange)="vendor.set($event)" [attr.aria-invalid]="!!errors()['vendor']" />
                    @if (errors()['vendor']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['vendor'] }}</small>
                    }
                </div>
                @if (source() === 'rent') {
                    <div class="sm:col-span-3">
                        <label for="rt-rate" class="block text-sm font-semibold mb-2">ค่าเช่าต่อหน่วย (บาท) <span class="text-red-600" aria-hidden="true">*</span></label>
                        <input pInputText id="rt-rate" name="rate" type="number" min="0" step="any" class="w-full" [ngModel]="rate()" (ngModelChange)="rate.set(+$event)" [attr.aria-invalid]="!!errors()['rate']" />
                        @if (errors()['rate']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['rate'] }}</small>
                        }
                    </div>
                    <fieldset class="sm:col-span-3 border-0 p-0 m-0">
                        <legend class="block text-sm font-semibold mb-2 p-0">คิดค่าเช่า</legend>
                        <div class="flex gap-4 pt-2">
                            @for (option of rateUnits; track option.value) {
                                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="rateUnit" class="accent-[var(--p-primary-color)]" [checked]="rateUnit() === option.value" (change)="rateUnit.set(option.value)" />{{ option.label }}</label>
                            }
                        </div>
                    </fieldset>
                    <div class="sm:col-span-6 rounded-lg px-3 py-2 text-sm bg-emphasis" role="status">
                        ค่าเช่าตามแผนประมาณ <strong>฿{{ estimate() | number: '1.0-2' }}</strong>
                        <span class="text-muted-color">({{ quantity() || 0 }} {{ unit() || 'หน่วย' }} × ฿{{ rate() || 0 | number }} × {{ periods() }} {{ rateUnit() === 'month' ? 'เดือน' : 'วัน' }})</span>
                    </div>
                }
                <div class="sm:col-span-6">
                    <label for="rt-phase" class="block text-sm font-semibold mb-2">ใช้กับขั้นตอน</label>
                    <select id="rt-phase" name="phaseCode" class="native-select w-full" [value]="phaseCode()" (change)="phaseCode.set($any($event.target).value)">
                        <option value="">ไม่ระบุ</option>
                        @for (phase of phases(); track phase.code) {
                            <option [value]="phase.code" [selected]="phase.code === phaseCode()">{{ phase.step }}. {{ phase.shortName }}</option>
                        }
                    </select>
                </div>
                <div class="sm:col-span-6">
                    <label for="rt-note" class="block text-sm font-semibold mb-2">หมายเหตุ</label>
                    <textarea pTextarea id="rt-note" name="note" rows="2" maxlength="1000" class="w-full" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
                </div>
            </form>
            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="submit" form="rental-form" [icon]="source() === 'rent' ? 'pi pi-send' : 'pi pi-check'" [label]="source() === 'rent' ? 'ส่งขออนุมัติเช่า' : 'บันทึกการยืม'" [loading]="saving()"></button>
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
export class RentalForm {
    private readonly service = inject(ProcurementService);

    readonly projectCode = input.required<string>();
    readonly phases = input<TimelinePhase[]>([]);
    readonly saved = output<Rental>();
    readonly closed = output<void>();

    readonly sources: Array<{ value: Rental['source']; label: string; hint: string; icon: string }> = [
        { value: 'rent', label: 'เช่าจากภายนอก', hint: 'มีค่าเช่า ต้องผ่านการอนุมัติ', icon: 'pi-shopping-cart' },
        { value: 'borrow', label: 'ยืมจากคลังบริษัท', hint: 'อุปกรณ์ของบริษัท ไม่ต้องอนุมัติ', icon: 'pi-box' }
    ];
    readonly rateUnits: Array<{ value: 'day' | 'month'; label: string }> = [
        { value: 'day', label: 'รายวัน' },
        { value: 'month', label: 'รายเดือน' }
    ];

    readonly source = signal<Rental['source']>('rent');
    readonly equipment = signal('');
    readonly quantity = signal(1);
    readonly unit = signal('');
    readonly startDate = signal(todayLocal());
    readonly endDate = signal(plusDays(todayLocal(), 6));
    readonly vendor = signal('');
    readonly rate = signal(0);
    readonly rateUnit = signal<'day' | 'month'>('day');
    readonly phaseCode = signal('');
    readonly note = signal('');
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    readonly estimate = computed(() => estimateRent(this.rate(), this.quantity(), this.rateUnit(), this.startDate(), this.endDate()));
    readonly periods = computed(() => {
        if (!this.startDate() || !this.endDate() || this.endDate() < this.startDate()) return 0;
        const days = Math.round((Date.parse(this.endDate()) - Date.parse(this.startDate())) / 86_400_000) + 1;
        return this.rateUnit() === 'month' ? Math.ceil(days / 30) : days;
    });

    submit() {
        const rent = this.source() === 'rent';
        const errors: Record<string, string> = {};
        if (!this.equipment().trim()) errors['equipment'] = 'กรุณาระบุอุปกรณ์';
        if (!(this.quantity() > 0)) errors['quantity'] = 'จำนวนต้องมากกว่า 0';
        if (!this.unit().trim()) errors['unit'] = 'กรุณาระบุหน่วย';
        if (!this.endDate() || this.endDate() < this.startDate()) errors['endDate'] = 'กำหนดคืนต้องไม่ก่อนวันเริ่มใช้';
        if (rent && !this.vendor().trim()) errors['vendor'] = 'กรุณาระบุร้านให้เช่า';
        if (rent && !(this.rate() > 0)) errors['rate'] = 'กรุณาระบุค่าเช่า';
        this.errors.set(errors);
        if (Object.keys(errors).length) return;

        this.saving.set(true);
        this.generalError.set('');
        this.service
            .createRental(this.projectCode(), {
                source: this.source(),
                equipment: this.equipment().trim(),
                quantity: this.quantity(),
                unit: this.unit().trim(),
                startDate: this.startDate(),
                endDate: this.endDate(),
                ...(this.vendor().trim() ? { vendor: this.vendor().trim() } : {}),
                ...(rent ? { rate: this.rate(), rateUnit: this.rateUnit() } : {}),
                ...(this.phaseCode() ? { phaseCode: this.phaseCode() } : {}),
                ...(this.note().trim() ? { note: this.note().trim() } : {})
            })
            .subscribe({
                next: (rental) => {
                    this.saving.set(false);
                    this.saved.emit(rental);
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
