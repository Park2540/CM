import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { Installment, InstallmentStatus } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { INSTALLMENT_LABEL, INSTALLMENT_PILL_CLASS } from './project-ui';

@Component({
    selector: 'app-project-payments-tab',
    standalone: true,
    imports: [DecimalPipe, NgClass, ThaiDatePipe],
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
            <p class="text-sm text-muted-color mt-0 mb-4">เบิกงวดได้เมื่องานในงวดเสร็จและผ่านการตรวจรับแล้ว ชำระภายใน 7 วันหลังได้รับใบแจ้งหนี้</p>
            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mb-6">
                <div class="h-full rounded-full bg-green-500" [style.width.%]="paidPercent()"></div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse" style="min-width: 48rem">
                    <thead>
                        <tr class="border-b border-surface text-sm text-muted-color">
                            <th class="py-3 pr-3 font-semibold">งวด</th>
                            <th class="py-3 pr-3 font-semibold">รายละเอียดงาน</th>
                            <th class="py-3 pr-3 font-semibold text-right">สัดส่วน</th>
                            <th class="py-3 pr-3 font-semibold text-right">จำนวนเงิน</th>
                            <th class="py-3 pr-3 font-semibold">กำหนดชำระ</th>
                            <th class="py-3 font-semibold">สถานะ</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of installments(); track item.no) {
                            <tr class="border-b border-surface last:border-b-0" [ngClass]="{ 'bg-orange-50/60 dark:bg-orange-500/5': item.status === 'due' }">
                                <td class="py-4 pr-3 font-semibold">{{ item.no }}</td>
                                <td class="py-4 pr-3">
                                    <div>{{ item.title }}</div>
                                    <div class="text-xs text-muted-color mt-1">ขั้นตอนที่ {{ item.phaseSteps.join(', ') }}</div>
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
                                <td class="py-4">
                                    <span class="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" [ngClass]="pillClass[item.status]">{{ label[item.status] }}</span>
                                </td>
                            </tr>
                        }
                    </tbody>
                    <tfoot>
                        <tr class="border-t-2 border-surface font-semibold">
                            <td class="py-4 pr-3" colspan="2">รวมมูลค่าสัญญา</td>
                            <td class="py-4 pr-3 text-right">{{ totalPercent() }}%</td>
                            <td class="py-4 pr-3 text-right">฿{{ contractValue() | number: '1.0-0' }}</td>
                            <td colspan="2"></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `
})
export class ProjectPaymentsTab {
    readonly installments = input.required<Installment[]>();
    readonly contractValue = input.required<number>();

    readonly label = INSTALLMENT_LABEL;
    readonly pillClass = INSTALLMENT_PILL_CLASS;

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
}
