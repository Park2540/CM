import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import { Installment, PAYMENT_METHOD_LABEL, PaymentMethod, ProjectRecordsService } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const MAX_EVIDENCE = 10;
const ACCEPT = '.pdf,image/jpeg,image/png,image/webp';
const round2 = (value: number) => Math.round(value * 100) / 100;

/** บันทึกรับชำระงวดงานพร้อมหลักฐาน (POST /projects/{code}/installments/{no}/payment) */
@Component({
    selector: 'app-payment-record-dialog',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputNumberModule, InputTextModule, NgClass, TextareaModule, ThaiDatePipe],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(38rem, 95vw)' }" header="บันทึกรับชำระเงิน">
            <div class="rounded-lg px-4 py-3 mb-4 bg-emphasis">
                <div class="text-sm text-muted-color">งวดที่ {{ installment().no }} · กำหนดชำระ {{ installment().dueDate | thaiDate }}</div>
                <div class="font-semibold mt-1">{{ installment().title }}</div>
                <div class="text-xl font-bold mt-1">฿{{ installment().amount | number: '1.0-2' }}</div>
            </div>

            <form id="payment-form" class="grid grid-cols-1 sm:grid-cols-2 gap-4" (ngSubmit)="submit()" novalidate>
                <div>
                    <label for="paid-date" class="block text-sm font-semibold mb-2">วันที่ได้รับเงิน <span class="text-red-600" aria-hidden="true">*</span></label>
                    <input pInputText id="paid-date" name="paidDate" type="date" class="w-full" [max]="today" [ngModel]="paidDate()" (ngModelChange)="paidDate.set($event)" [attr.aria-invalid]="!!errors()['paidDate']" />
                    @if (errors()['paidDate']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['paidDate'] }}</small>
                    }
                </div>
                <fieldset class="border-0 p-0 m-0 min-w-0">
                    <legend class="block text-sm font-semibold mb-2 p-0">วิธีชำระ <span class="text-red-600" aria-hidden="true">*</span></legend>
                    <div class="flex gap-2">
                        @for (option of methods; track option.value) {
                            <button
                                type="button"
                                class="flex-1 px-2 py-2 rounded-lg border-2 cursor-pointer bg-transparent text-sm text-color"
                                [ngClass]="method() === option.value ? 'border-primary font-semibold' : 'border-surface'"
                                [attr.aria-pressed]="method() === option.value"
                                (click)="method.set(option.value)"
                            >
                                {{ option.label }}
                            </button>
                        }
                    </div>
                    @if (errors()['method']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['method'] }}</small>
                    }
                </fieldset>

                <div>
                    <label for="paid-amount" class="block text-sm font-semibold mb-2">ยอดที่ได้รับจริง (บาท) <span class="text-red-600" aria-hidden="true">*</span></label>
                    <p-inputnumber inputId="paid-amount" name="amount" [ngModel]="amount()" (ngModelChange)="amount.set($event)" [min]="0" [maxFractionDigits]="2" locale="th-TH" class="w-full" [inputStyle]="{ width: '100%' }" [invalid]="!!errors()['amount']" />
                    @if (errors()['amount']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['amount'] }}</small>
                    }
                </div>
                <div>
                    <label for="withholding-tax" class="block text-sm font-semibold mb-2">ภาษีหัก ณ ที่จ่าย (บาท)</label>
                    <div class="flex gap-2">
                        <p-inputnumber inputId="withholding-tax" name="withholdingTax" [ngModel]="withholdingTax()" (ngModelChange)="setWithholdingTax($event)" [min]="0" [maxFractionDigits]="2" locale="th-TH" class="flex-1 min-w-0" [inputStyle]="{ width: '100%' }" [invalid]="!!errors()['withholdingTax']" />
                        <button pButton type="button" [outlined]="true" size="small" label="หัก 3%" (click)="applyWithholding(3)" aria-label="คำนวณภาษีหัก ณ ที่จ่าย 3% ของยอดงวด"></button>
                    </div>
                    @if (errors()['withholdingTax']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['withholdingTax'] }}</small>
                    }
                </div>

                <div class="sm:col-span-2 rounded-lg px-3 py-2 text-sm" [ngClass]="difference() === 0 ? 'bg-green-50 text-green-800 dark:bg-green-500/15 dark:text-green-200' : 'bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100'" role="status">
                    รับจริง ฿{{ amount() ?? 0 | number: '1.0-2' }} + ภาษีหัก ณ ที่จ่าย ฿{{ withholdingTax() ?? 0 | number: '1.0-2' }} = ฿{{ total() | number: '1.0-2' }}
                    @if (difference() > 0) {
                        · <strong>น้อยกว่ายอดงวด ฿{{ difference() | number: '1.0-2' }}</strong> (ระบุเหตุผลในหมายเหตุ)
                    } @else if (difference() < 0) {
                        · <strong>เกินยอดงวด ฿{{ -difference() | number: '1.0-2' }}</strong>
                    } @else {
                        · ครบยอดงวด
                    }
                </div>

                <div class="sm:col-span-2">
                    <label for="payment-reference" class="block text-sm font-semibold mb-2">เลขที่อ้างอิง</label>
                    <input pInputText id="payment-reference" name="reference" class="w-full" maxlength="100" placeholder="เช่น เลขที่ใบเสร็จ เลขเช็ค เลขอ้างอิงการโอน" [ngModel]="reference()" (ngModelChange)="reference.set($event)" />
                </div>
                <div class="sm:col-span-2">
                    <label for="payment-note" class="block text-sm font-semibold mb-2">หมายเหตุ {{ difference() > 0 ? '(จำเป็น)' : '' }}</label>
                    <textarea pTextarea id="payment-note" name="note" rows="2" maxlength="500" class="w-full" [ngModel]="note()" (ngModelChange)="note.set($event)" [attr.aria-invalid]="!!errors()['note']"></textarea>
                    @if (errors()['note']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['note'] }}</small>
                    }
                </div>

                <div class="sm:col-span-2">
                    <div class="text-sm font-semibold mb-2">หลักฐานการชำระ <span class="text-red-600" aria-hidden="true">*</span></div>
                    <ul class="list-none p-0 m-0 flex flex-col gap-2">
                        @for (file of evidence(); track file.id) {
                            <li class="flex items-center gap-2 p-2 rounded-lg border border-surface">
                                <i class="pi ml-1" [ngClass]="file.contentType.startsWith('image/') ? 'pi-image text-violet-500' : 'pi-file-pdf text-red-600'" aria-hidden="true"></i>
                                <a class="flex-1 min-w-0 truncate text-sm" [href]="file.url" target="_blank" rel="noopener">{{ file.name }}</a>
                                <span class="text-xs text-muted-color shrink-0">{{ file.sizeKb | number }} KB</span>
                                <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" [attr.aria-label]="'นำออก ' + file.name" (click)="removeEvidence(file.id)"></button>
                            </li>
                        }
                        @for (i of pendingSlots(); track $index) {
                            <li class="flex items-center gap-2 p-3 rounded-lg border border-dashed border-surface text-sm text-muted-color"><i class="pi pi-spin pi-spinner"></i>กำลังอัปโหลด...</li>
                        }
                    </ul>
                    @if (evidence().length + uploading() < maxEvidence) {
                        <label
                            class="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer text-sm hover:border-primary hover:text-primary focus-within:outline-2 focus-within:outline-primary"
                            [ngClass]="errors()['evidenceIds'] ? 'border-red-400 text-red-600 dark:text-red-400' : 'border-surface text-muted-color'"
                        >
                            <i class="pi pi-paperclip"></i>
                            แนบสลิปโอนเงิน สำเนาเช็ค หรือใบเสร็จ (รูปหรือ PDF)
                            <input type="file" [accept]="accept" multiple class="sr-only" (change)="onSelect($event)" />
                        </label>
                    }
                    @for (message of uploadErrors(); track $index) {
                        <small class="block text-red-600 dark:text-red-400 mt-1" role="alert">{{ message }}</small>
                    }
                    @if (errors()['evidenceIds']) {
                        <small class="block text-red-600 dark:text-red-400 mt-1">{{ errors()['evidenceIds'] }}</small>
                    }
                </div>
            </form>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }

            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="submit" form="payment-form" icon="pi pi-check" label="บันทึกรับชำระ" [loading]="saving()" [disabled]="uploading() > 0"></button>
            </ng-template>
        </p-dialog>
    `
})
export class PaymentRecordDialog implements OnInit {
    private readonly records = inject(ProjectRecordsService);
    private readonly files = inject(FileUploadService);

    readonly projectCode = input.required<string>();
    readonly installment = input.required<Installment>();
    readonly saved = output<Installment>();
    readonly closed = output<void>();

    readonly today = todayLocal();
    readonly accept = ACCEPT;
    readonly maxEvidence = MAX_EVIDENCE;
    readonly methods = (Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((value) => ({ value, label: PAYMENT_METHOD_LABEL[value] }));

    readonly paidDate = signal(todayLocal());
    readonly method = signal<PaymentMethod>('transfer');
    readonly amount = signal<number | null>(null);
    readonly withholdingTax = signal<number | null>(0);
    readonly reference = signal('');
    readonly note = signal('');
    readonly evidence = signal<UploadedFile[]>([]);
    readonly uploading = signal(0);
    readonly uploadErrors = signal<string[]>([]);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');
    readonly pendingSlots = () => Array.from({ length: this.uploading() });

    readonly total = computed(() => round2((this.amount() ?? 0) + (this.withholdingTax() ?? 0)));
    readonly difference = computed(() => round2(this.installment().amount - this.total()));

    ngOnInit() {
        this.amount.set(this.installment().amount);
    }

    /** ภาษีหัก ณ ที่จ่ายเปลี่ยน: ปรับยอดรับให้รวมแล้วเท่ายอดงวด */
    setWithholdingTax(value: number | null) {
        this.withholdingTax.set(value);
        this.amount.set(round2(this.installment().amount - (value ?? 0)));
    }

    applyWithholding(percent: number) {
        this.setWithholdingTax(round2((this.installment().amount * percent) / 100));
    }

    onSelect(event: Event) {
        const element = event.target as HTMLInputElement;
        const selected = Array.from(element.files ?? []);
        element.value = '';
        this.uploadErrors.set([]);
        const room = MAX_EVIDENCE - this.evidence().length - this.uploading();
        if (selected.length > room) this.uploadErrors.update((list) => [...list, `แนบได้อีก ${room} ไฟล์ (สูงสุด ${MAX_EVIDENCE} ไฟล์)`]);
        for (const file of selected.slice(0, Math.max(0, room))) {
            this.uploading.update((count) => count + 1);
            this.files.upload(file).subscribe({
                next: (uploaded) => {
                    this.uploading.update((count) => count - 1);
                    this.evidence.update((list) => [...list, uploaded]);
                    this.errors.update(({ evidenceIds: _, ...rest }) => rest);
                },
                error: (error) => {
                    this.uploading.update((count) => count - 1);
                    this.uploadErrors.update((list) => [...list, `${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`]);
                }
            });
        }
    }

    removeEvidence(id: string) {
        this.evidence.update((list) => list.filter((file) => file.id !== id));
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.paidDate()) errors['paidDate'] = 'กรุณาระบุวันที่ได้รับเงิน';
        if (!((this.amount() ?? 0) > 0)) errors['amount'] = 'ยอดที่ได้รับต้องมากกว่า 0';
        if (this.difference() < 0) errors['amount'] = 'ยอดรับรวมภาษีหัก ณ ที่จ่ายเกินยอดงวด';
        if (this.difference() > 0 && !this.note().trim()) errors['note'] = 'ยอดรับน้อยกว่ายอดงวด กรุณาระบุเหตุผล';
        if (!this.evidence().length) errors['evidenceIds'] = 'กรุณาแนบหลักฐานการชำระอย่างน้อย 1 ไฟล์';
        this.errors.set(errors);
        this.generalError.set('');
        if (Object.keys(errors).length) return;

        this.saving.set(true);
        this.records
            .recordPayment(this.projectCode(), this.installment().no, {
                paidDate: this.paidDate(),
                amount: this.amount()!,
                withholdingTax: this.withholdingTax() ?? 0,
                method: this.method(),
                reference: this.reference().trim() || undefined,
                note: this.note().trim() || undefined,
                evidenceIds: this.evidence().map((file) => file.id)
            })
            .subscribe({
                next: (installment) => {
                    this.saving.set(false);
                    this.saved.emit(installment);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'บันทึกรับชำระไม่สำเร็จ'));
                }
            });
    }
}
