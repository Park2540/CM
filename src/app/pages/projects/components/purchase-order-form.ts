import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import { ProcurementService, PurchaseRequest, Vendor, splitVat } from '@/app/pages/service/procurement.service';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const PAYMENT_TERMS = ['เงินสด', 'เครดิต 15 วัน', 'เครดิต 30 วัน', 'เครดิต 45 วัน'];

/** ออกใบสั่งซื้อจากใบขอซื้อที่อนุมัติแล้ว: ราคาจากใบเสนอราคาที่ดีที่สุด (รวม VAT) → ส่งเข้าศูนย์อนุมัติ */
@Component({
    selector: 'app-purchase-order-form',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(52rem, 96vw)' }" header="ออกใบสั่งซื้อ">
            <p class="mt-0 text-sm text-muted-color">
                อ้างอิงใบขอซื้อ <span class="font-semibold text-color">{{ purchase().id }}</span> · {{ purchase().title }} — ใส่ราคาจากใบเสนอราคาที่ดีที่สุด <strong>(รวม VAT แล้ว)</strong> ระบบจะส่งใบสั่งซื้อเข้าศูนย์อนุมัติด้วยวงเงินเดียวกับใบขอซื้อ
            </p>
            @if (lastRejected(); as rejected) {
                <div class="rounded-lg px-3 py-2 mb-4 text-sm bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100" role="status">
                    <i class="pi pi-info-circle mr-1"></i>ใบสั่งซื้อ {{ rejected.poNumber }} ({{ rejected.supplier }}) ไม่ผ่านอนุมัติ{{ rejected.decisionNote ? ': ' + rejected.decisionNote : '' }}
                </div>
            }

            <fieldset class="border border-surface rounded-lg p-4 m-0">
                <legend class="text-sm font-semibold px-1">ผู้ขาย</legend>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label class="text-sm font-semibold md:col-span-2">ชื่อร้าน/บริษัท <span class="text-red-600">*</span>
                        <input pInputText class="w-full mt-1 font-normal" maxlength="200" [ngModel]="vendor().name" (ngModelChange)="patchVendor({ name: $event })" [attr.aria-invalid]="!!errors()['vendor.name']" />
                        @if (errors()['vendor.name']) {
                            <small class="block font-normal text-red-600 dark:text-red-400">{{ errors()['vendor.name'] }}</small>
                        }
                    </label>
                    <label class="text-sm font-semibold">เลขประจำตัวผู้เสียภาษี
                        <input pInputText class="w-full mt-1 font-normal" inputmode="numeric" maxlength="17" placeholder="13 หลัก" [ngModel]="vendor().taxId" (ngModelChange)="patchVendor({ taxId: $event })" [attr.aria-invalid]="!!errors()['vendor.taxId']" />
                        @if (errors()['vendor.taxId']) {
                            <small class="block font-normal text-red-600 dark:text-red-400">{{ errors()['vendor.taxId'] }}</small>
                        }
                    </label>
                    <label class="text-sm font-semibold">เบอร์โทร
                        <input pInputText type="tel" class="w-full mt-1 font-normal" maxlength="30" [ngModel]="vendor().phone" (ngModelChange)="patchVendor({ phone: $event })" />
                    </label>
                    <label class="text-sm font-semibold">ผู้ติดต่อ
                        <input pInputText class="w-full mt-1 font-normal" maxlength="100" [ngModel]="vendor().contactName" (ngModelChange)="patchVendor({ contactName: $event })" />
                    </label>
                    <label class="text-sm font-semibold">ที่อยู่
                        <input pInputText class="w-full mt-1 font-normal" maxlength="500" [ngModel]="vendor().address" (ngModelChange)="patchVendor({ address: $event })" />
                    </label>
                </div>
            </fieldset>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                <label class="text-sm font-semibold">วันที่สั่งซื้อ <span class="text-red-600">*</span>
                    <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [ngModel]="orderDate()" (ngModelChange)="orderDate.set($event)" [attr.aria-invalid]="!!errors()['orderDate']" />
                </label>
                <label class="text-sm font-semibold">กำหนดส่งถึงหน้างาน
                    <input pInputText type="date" class="w-full mt-1 font-normal" [min]="orderDate()" [ngModel]="expectedDate()" (ngModelChange)="expectedDate.set($event)" [attr.aria-invalid]="!!errors()['expectedDate']" />
                </label>
                <label class="text-sm font-semibold">เงื่อนไขชำระเงิน
                    <input pInputText class="w-full mt-1 font-normal" maxlength="200" list="po-payment-terms" placeholder="เช่น เครดิต 30 วัน" [ngModel]="paymentTerms()" (ngModelChange)="paymentTerms.set($event)" />
                    <datalist id="po-payment-terms">
                        @for (term of paymentTermOptions; track term) {
                            <option [value]="term"></option>
                        }
                    </datalist>
                </label>
            </div>

            <div class="overflow-x-auto mt-4">
                <table class="w-full text-sm border-collapse" style="min-width: 38rem">
                    <thead>
                        <tr class="text-left text-muted-color border-b border-surface">
                            <th class="py-2 pr-2 font-semibold">รายการ</th>
                            <th class="py-2 pr-2 font-semibold text-right">จำนวน</th>
                            <th class="py-2 pr-2 font-semibold text-right">ราคาประมาณ</th>
                            <th class="py-2 pr-2 font-semibold text-right w-36">ราคา/หน่วย (รวม VAT)</th>
                            <th class="py-2 font-semibold text-right">รวม</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of purchase().items; track $index; let i = $index) {
                            <tr class="border-b border-surface">
                                <td class="py-1 pr-2">{{ item.name }}</td>
                                <td class="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{{ item.quantity | number: '1.0-2' }} {{ item.unit }}</td>
                                <td class="py-1 pr-2 text-right tabular-nums text-muted-color">{{ item.unitPrice | number: '1.0-2' }}</td>
                                <td class="py-1 pr-2 text-right">
                                    <input pInputText type="number" min="0" step="any" class="w-32 text-right" [attr.aria-label]="'ราคาต่อหน่วยรวม VAT ' + item.name" [value]="prices()[i]" (input)="setPrice(i, +$any($event.target).value)" [attr.aria-invalid]="!!errors()['unitPrices.' + i]" />
                                </td>
                                <td class="py-1 text-right tabular-nums">{{ item.quantity * (prices()[i] || 0) | number: '1.2-2' }}</td>
                            </tr>
                        }
                    </tbody>
                    <tfoot class="tabular-nums">
                        <tr>
                            <td colspan="4" class="pt-2 pr-2 text-right text-muted-color">ราคาก่อน VAT</td>
                            <td class="pt-2 text-right">{{ vat().beforeVat | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td colspan="4" class="pr-2 text-right text-muted-color">VAT 7%</td>
                            <td class="text-right">{{ vat().vat | number: '1.2-2' }}</td>
                        </tr>
                        <tr class="font-semibold">
                            <td colspan="4" class="pr-2 text-right">ยอดรวมทั้งสิ้น (รวม VAT)</td>
                            <td class="text-right text-lg">฿{{ total() | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td colspan="5" class="text-right text-xs" [class]="total() > purchase().amount ? 'text-orange-700 dark:text-orange-300' : 'text-muted-color'">
                                ใบขอซื้อประมาณ ฿{{ purchase().amount | number: '1.0-2' }} · {{ total() > purchase().amount ? 'สูงกว่า' : 'ต่ำกว่า' }}ประมาณ ฿{{ difference() | number: '1.0-2' }}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div class="text-sm font-semibold mt-4 mb-1">ใบเสนอราคาที่เลือก</div>
            <div class="flex flex-wrap gap-2 items-center">
                @for (file of files(); track file.id) {
                    <span class="text-xs px-2 py-1 rounded-full bg-emphasis"><i class="pi pi-paperclip text-[0.65rem] mr-1"></i>{{ file.name }}
                        <button type="button" class="bg-transparent border-0 p-0 ml-1 cursor-pointer text-muted-color" [attr.aria-label]="'นำออก ' + file.name" (click)="removeFile(file.id)"><i class="pi pi-times text-[0.6rem]"></i></button>
                    </span>
                }
                @if (uploading()) {
                    <span class="text-xs text-muted-color"><i class="pi pi-spin pi-spinner mr-1"></i>กำลังอัปโหลด</span>
                }
                <label class="text-xs px-2 py-1 rounded-full border border-dashed border-surface cursor-pointer hover:border-primary hover:text-primary">
                    <i class="pi pi-upload text-[0.65rem] mr-1"></i>แนบใบเสนอราคา
                    <input type="file" multiple class="sr-only" accept="image/jpeg,image/png,image/webp,.pdf" (change)="addFiles($event)" />
                </label>
            </div>

            <label class="text-sm font-semibold block mt-4">หมายเหตุถึงผู้ขาย
                <textarea pTextarea rows="2" maxlength="1000" class="w-full mt-1 font-normal" placeholder="เช่น ส่งของช่วงเช้า โทรแจ้งโฟร์แมนก่อนเข้าหน้างาน" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
            </label>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="button" icon="pi pi-send" label="ส่งใบสั่งซื้อเข้าศูนย์อนุมัติ" [loading]="saving()" [disabled]="uploading() > 0" (click)="submit()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class PurchaseOrderForm implements OnInit {
    private readonly service = inject(ProcurementService);
    private readonly uploads = inject(FileUploadService);

    readonly projectCode = input.required<string>();
    readonly purchase = input.required<PurchaseRequest>();
    readonly saved = output<PurchaseRequest>();
    readonly closed = output<void>();

    readonly today = todayLocal();
    readonly paymentTermOptions = PAYMENT_TERMS;
    readonly vendor = signal<Vendor>({ name: '' });
    readonly orderDate = signal(todayLocal());
    readonly expectedDate = signal('');
    readonly paymentTerms = signal('');
    readonly note = signal('');
    readonly prices = signal<number[]>([]);
    readonly files = signal<UploadedFile[]>([]);
    readonly uploading = signal(0);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    readonly lastRejected = computed(() => this.purchase().rejectedOrders?.at(-1));
    readonly total = computed(() => Math.round(this.purchase().items.reduce((sum, item, i) => sum + item.quantity * (this.prices()[i] || 0), 0) * 100) / 100);
    readonly vat = computed(() => splitVat(this.total()));
    readonly difference = computed(() => Math.abs(this.total() - this.purchase().amount));

    ngOnInit() {
        const purchase = this.purchase();
        const previous = this.lastRejected();
        // ใบที่ไม่ผ่านอนุมัติ: เติมข้อมูลผู้ขายเดิมไว้ให้แก้ · ครั้งแรก: ใช้ร้านที่เสนอในใบขอซื้อ
        this.vendor.set(previous?.vendor ? { ...previous.vendor } : { name: purchase.supplier ?? '' });
        this.paymentTerms.set(previous?.paymentTerms ?? '');
        this.prices.set(purchase.items.map((item) => item.unitPrice));
        this.expectedDate.set(purchase.neededDate >= todayLocal() ? purchase.neededDate : '');
    }

    patchVendor(change: Partial<Vendor>) {
        this.vendor.update((vendor) => ({ ...vendor, ...change }));
    }

    setPrice(index: number, value: number) {
        this.prices.update((prices) => prices.map((price, i) => (i === index ? value : price)));
    }

    addFiles(event: Event) {
        const element = event.target as HTMLInputElement;
        const selected = Array.from(element.files ?? []);
        element.value = '';
        for (const file of selected.slice(0, Math.max(0, 10 - this.files().length))) {
            this.uploading.update((n) => n + 1);
            this.uploads.upload(file).subscribe({
                next: (uploaded) => {
                    this.uploading.update((n) => n - 1);
                    this.files.update((list) => [...list, uploaded]);
                },
                error: (error) => {
                    this.uploading.update((n) => n - 1);
                    this.generalError.set(`${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`);
                }
            });
        }
    }

    removeFile(id: string) {
        this.files.update((list) => list.filter((file) => file.id !== id));
    }

    submit() {
        const vendor = this.vendor();
        const errors: Record<string, string> = {};
        if (!vendor.name.trim()) errors['vendor.name'] = 'กรุณาระบุร้านค้า/ผู้ขาย';
        const taxId = (vendor.taxId ?? '').replace(/[\s-]/g, '');
        if (taxId && !/^\d{13}$/.test(taxId)) errors['vendor.taxId'] = 'เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก';
        this.prices().forEach((price, i) => {
            if (!(price >= 0)) errors[`unitPrices.${i}`] = 'ราคาต้องไม่ติดลบ';
        });
        this.errors.set(errors);
        if (Object.keys(errors).length) {
            this.generalError.set(Object.values(errors)[0]!);
            return;
        }
        const trimmed: Vendor = { name: vendor.name.trim() };
        for (const field of ['taxId', 'address', 'contactName', 'phone'] as const) if (vendor[field]?.trim()) trimmed[field] = vendor[field]!.trim();
        this.saving.set(true);
        this.generalError.set('');
        this.service
            .order(this.projectCode(), this.purchase().id, {
                vendor: trimmed,
                orderDate: this.orderDate(),
                ...(this.expectedDate() ? { expectedDate: this.expectedDate() } : {}),
                unitPrices: this.prices().map((price) => price || 0),
                ...(this.paymentTerms().trim() ? { paymentTerms: this.paymentTerms().trim() } : {}),
                ...(this.note().trim() ? { note: this.note().trim() } : {}),
                quotationFileIds: this.files().map((file) => file.id)
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
                    this.generalError.set(problemMessage(error, 'ออกใบสั่งซื้อไม่สำเร็จ'));
                }
            });
    }
}
