import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TextareaModule } from 'primeng/textarea';
import { problemMessage } from '@/app/api/api';
import { Installment, InstallmentStatus, PAYMENT_METHOD_LABEL, ProjectRecordsService } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { PaymentRecordDialog } from './payment-record-dialog';
import { INSTALLMENT_LABEL, INSTALLMENT_PILL_CLASS } from './project-ui';

export type PaymentChange = { kind: 'recorded' | 'cancelled'; installment: Installment };

@Component({
    selector: 'app-project-payments-tab',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, NgClass, PaymentRecordDialog, TextareaModule, ThaiDatePipe],
    template: `
        <div class="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            @for (stat of stats(); track stat.label) {
                <div class="card m-0">
                    <div class="text-sm text-muted-color">{{ stat.label }}</div>
                    <div class="text-2xl font-bold mt-2" [ngClass]="stat.className">฿{{ stat.amount | number: '1.0-0' }}</div>
                    <div class="text-sm text-muted-color mt-1">{{ stat.hint }}</div>
                </div>
            }
        </div>

        <div class="card">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-2">
                <h2 class="text-xl font-semibold m-0">งวดงานและการชำระเงิน</h2>
                <span class="text-sm text-muted-color">ชำระแล้ว {{ paidPercent() }}% ของมูลค่าสัญญา</span>
            </div>
            <p class="text-sm text-muted-color mt-0 mb-4">
                เบิกงวดได้เมื่องานในงวดเสร็จและผ่านการตรวจรับแล้ว ชำระภายใน 7 วันหลังได้รับใบแจ้งหนี้
                @if (canRecord()) {
                    · งวดจะเป็น "ชำระแล้ว" เมื่อบันทึกรับชำระพร้อมหลักฐาน
                }
            </p>
            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mb-6">
                <div class="h-full rounded-full bg-green-500" [style.width.%]="paidPercent()"></div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse" style="min-width: 60rem">
                    <thead>
                        <tr class="border-b border-surface text-sm text-muted-color">
                            <th class="py-3 pr-3 font-semibold">งวด</th>
                            <th class="py-3 pr-3 font-semibold">รายละเอียดงาน</th>
                            <th class="py-3 pr-3 font-semibold text-right">สัดส่วน</th>
                            <th class="py-3 pr-3 font-semibold text-right">จำนวนเงิน</th>
                            <th class="py-3 pr-3 font-semibold">กำหนดชำระ</th>
                            <th class="py-3 pr-3 font-semibold">สถานะ</th>
                            <th class="py-3 font-semibold">การรับชำระ</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of installments(); track item.no) {
                            <tr class="border-b border-surface last:border-b-0 align-top" [ngClass]="{ 'bg-orange-50/60 dark:bg-orange-500/5': item.status === 'due' }">
                                <td class="py-4 pr-3 font-semibold">{{ item.no }}</td>
                                <td class="py-4 pr-3">
                                    <div>{{ item.title }}</div>
                                    @if (item.phaseSteps.length) {
                                        <div class="text-xs text-muted-color mt-1">ขั้นตอนที่ {{ item.phaseSteps.join(', ') }}</div>
                                    }
                                </td>
                                <td class="py-4 pr-3 text-right">{{ item.percent }}%</td>
                                <td class="py-4 pr-3 text-right font-semibold">฿{{ item.amount | number: '1.0-0' }}</td>
                                <td class="py-4 pr-3 text-sm">
                                    @if (item.paidDate) {
                                        <div>ชำระเมื่อ {{ item.paidDate | thaiDate }}</div>
                                    } @else {
                                        <div>{{ item.dueDate | thaiDate }}</div>
                                        @if (item.status !== 'due') {
                                            <div class="text-xs text-muted-color">ตามแผนงาน</div>
                                        }
                                    }
                                </td>
                                <td class="py-4 pr-3">
                                    <span class="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" [ngClass]="pillClass[item.status]">{{ label[item.status] }}</span>
                                </td>
                                <td class="py-4 text-sm">
                                    @if (item.payment; as payment) {
                                        <div>
                                            {{ methodLabel[payment.method] }} ฿{{ payment.amount | number: '1.0-2' }}
                                            @if (payment.reference) {
                                                <span class="text-muted-color">· {{ payment.reference }}</span>
                                            }
                                        </div>
                                        @if (payment.withholdingTax) {
                                            <div class="text-xs text-muted-color">หัก ณ ที่จ่าย ฿{{ payment.withholdingTax | number: '1.0-2' }}</div>
                                        }
                                        @if (payment.note) {
                                            <div class="text-xs text-muted-color">{{ payment.note }}</div>
                                        }
                                        @if (payment.evidence.length) {
                                            <ul class="list-none p-0 m-0 mt-1 flex flex-col gap-0.5">
                                                @for (file of payment.evidence; track file.id) {
                                                    <li class="truncate max-w-56">
                                                        <a [href]="file.url" target="_blank" rel="noopener" class="text-primary text-xs"><i class="pi pi-paperclip text-[0.65rem] mr-1"></i>{{ file.name }}</a>
                                                    </li>
                                                }
                                            </ul>
                                        }
                                        <div class="text-xs text-muted-color mt-1">บันทึกโดย {{ payment.recordedBy.name }}</div>
                                        @if (canRecord()) {
                                            <button pButton type="button" class="mt-1 -ml-2" [text]="true" size="small" severity="danger" icon="pi pi-undo" label="ยกเลิกการรับชำระ" (click)="startCancel(item)"></button>
                                        }
                                    } @else if (canRecord() && item.amount > 0) {
                                        <button
                                            pButton
                                            type="button"
                                            size="small"
                                            icon="pi pi-wallet"
                                            label="บันทึกรับชำระ"
                                            [outlined]="item.status !== 'due'"
                                            [attr.aria-label]="'บันทึกรับชำระงวดที่ ' + item.no"
                                            (click)="recording.set(item)"
                                        ></button>
                                    } @else {
                                        <span class="text-muted-color">-</span>
                                    }
                                </td>
                            </tr>
                        }
                    </tbody>
                    <tfoot>
                        <tr class="border-t-2 border-surface font-semibold">
                            <td class="py-4 pr-3" colspan="2">รวมมูลค่าสัญญา</td>
                            <td class="py-4 pr-3 text-right">{{ totalPercent() }}%</td>
                            <td class="py-4 pr-3 text-right">฿{{ contractValue() | number: '1.0-0' }}</td>
                            <td colspan="3"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        @if (recording(); as item) {
            <app-payment-record-dialog [projectCode]="projectCode()" [installment]="item" (saved)="onRecorded($event)" (closed)="recording.set(null)" />
        }

        @if (cancelling(); as item) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !cancelSaving() && cancelling.set(null)" [modal]="true" [draggable]="false" [closable]="!cancelSaving()" [style]="{ width: 'min(32rem, 95vw)' }" header="ยกเลิกการรับชำระ">
                <p class="mt-0">
                    ยกเลิกการรับชำระงวดที่ {{ item.no }} (฿{{ item.payment?.amount | number: '1.0-2' }} ได้รับ {{ item.paidDate | thaiDate }}) — งวดจะกลับเป็นสถานะตามความคืบหน้า และระบบเก็บประวัติไว้ใน Audit Log
                </p>
                <label for="cancel-payment-reason" class="block text-sm font-semibold mb-2">เหตุผล <span class="text-red-600" aria-hidden="true">*</span></label>
                <textarea pTextarea id="cancel-payment-reason" rows="3" maxlength="500" class="w-full" placeholder="เช่น บันทึกผิดงวด เช็คเด้ง" [ngModel]="cancelReason()" (ngModelChange)="cancelReason.set($event); cancelError.set('')" [attr.aria-invalid]="!!cancelError()"></textarea>
                @if (cancelError()) {
                    <small class="block text-red-600 dark:text-red-400" role="alert">{{ cancelError() }}</small>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ไม่ยกเลิก" [text]="true" severity="secondary" [disabled]="cancelSaving()" (click)="cancelling.set(null)"></button>
                    <button pButton type="button" severity="danger" icon="pi pi-undo" label="ยืนยันยกเลิก" [loading]="cancelSaving()" (click)="confirmCancel()"></button>
                </ng-template>
            </p-dialog>
        }
    `
})
export class ProjectPaymentsTab {
    private readonly records = inject(ProjectRecordsService);

    readonly projectCode = input.required<string>();
    readonly installments = input.required<Installment[]>();
    readonly contractValue = input.required<number>();
    /** สิทธิ์ payment.record (หลังบ้านตรวจซ้ำ) */
    readonly canRecord = input(false);
    readonly changed = output<PaymentChange>();

    readonly label = INSTALLMENT_LABEL;
    readonly pillClass = INSTALLMENT_PILL_CLASS;
    readonly methodLabel = PAYMENT_METHOD_LABEL;

    readonly recording = signal<Installment | null>(null);
    readonly cancelling = signal<Installment | null>(null);
    readonly cancelReason = signal('');
    readonly cancelError = signal('');
    readonly cancelSaving = signal(false);

    private sum(status: InstallmentStatus[]) {
        return this.installments()
            .filter((item) => status.includes(item.status))
            .reduce((total, item) => total + item.amount, 0);
    }

    readonly paidPercent = computed(() => (this.contractValue() ? Math.round((this.sum(['paid']) / this.contractValue()) * 100) : 0));
    readonly totalPercent = computed(() => this.installments().reduce((total, item) => total + item.percent, 0));
    readonly stats = computed(() => {
        const dueCount = this.installments().filter((item) => item.status === 'due').length;
        return [
            { label: 'มูลค่าสัญญา', amount: this.contractValue(), hint: `${this.installments().length} งวด`, className: '' },
            { label: 'ชำระแล้ว', amount: this.sum(['paid']), hint: `${this.paidPercent()}% ของสัญญา`, className: 'text-green-600 dark:text-green-400' },
            { label: 'รอชำระ', amount: this.sum(['due']), hint: dueCount ? `${dueCount} งวดครบกำหนด` : 'ไม่มียอดค้างชำระ', className: dueCount ? 'text-orange-600 dark:text-orange-400' : '' },
            { label: 'คงเหลือตามสัญญา', amount: this.sum(['working', 'upcoming']), hint: 'งวดที่ยังไม่ถึงกำหนด', className: '' }
        ];
    });

    onRecorded(installment: Installment) {
        this.recording.set(null);
        this.changed.emit({ kind: 'recorded', installment });
    }

    startCancel(item: Installment) {
        this.cancelReason.set('');
        this.cancelError.set('');
        this.cancelling.set(item);
    }

    confirmCancel() {
        const item = this.cancelling();
        const reason = this.cancelReason().trim();
        if (!item) return;
        if (!reason) {
            this.cancelError.set('กรุณาระบุเหตุผลที่ยกเลิก');
            return;
        }
        this.cancelSaving.set(true);
        this.records.cancelPayment(this.projectCode(), item.no, reason).subscribe({
            next: (installment) => {
                this.cancelSaving.set(false);
                this.cancelling.set(null);
                this.changed.emit({ kind: 'cancelled', installment });
            },
            error: (error) => {
                this.cancelSaving.set(false);
                this.cancelError.set(problemMessage(error, 'ยกเลิกไม่สำเร็จ'));
            }
        });
    }
}
