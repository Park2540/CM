import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { ApprovalService } from '@/app/pages/service/approval.service';
import { AuthService } from '@/app/pages/service/auth.service';
import { CompanyProfile, ProcurementService } from '@/app/pages/service/procurement.service';
import { ProjectService } from '@/app/pages/service/project.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { CompanyLetterhead } from '@/app/pages/shared/company-letterhead';
import { CompanyProfileDialog } from '@/app/pages/shared/company-profile-dialog';

const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** อ่านจำนวนเต็มเป็นภาษาไทย (รองรับหลักล้านซ้อน) */
function readNumber(value: number): string {
    if (value === 0) return '';
    if (value >= 1_000_000) {
        const rest = value % 1_000_000;
        return `${readNumber(Math.floor(value / 1_000_000))}ล้าน${rest === 1 ? 'เอ็ด' : readNumber(rest)}`;
    }
    const digits = String(value).split('').map(Number);
    return digits
        .map((digit, index) => {
            const place = digits.length - index - 1;
            if (digit === 0) return '';
            if (place === 0 && digit === 1 && digits.length > 1) return 'เอ็ด';
            if (place === 1 && digit === 2) return 'ยี่สิบ';
            if (place === 1 && digit === 1) return 'สิบ';
            return DIGITS[digit] + PLACES[place];
        })
        .join('');
}

/** จำนวนเงินเป็นตัวอักษร เช่น 19,710.50 → หนึ่งหมื่นเก้าพันเจ็ดร้อยสิบบาทห้าสิบสตางค์ */
export function bahtText(amount: number): string {
    const satang = Math.round(amount * 100);
    const baht = Math.floor(satang / 100);
    const rest = satang % 100;
    const bahtWords = baht ? `${readNumber(baht)}บาท` : rest ? '' : 'ศูนย์บาท';
    return rest ? `${bahtWords}${readNumber(rest)}สตางค์` : `${bahtWords}ถ้วน`;
}

/** ใบสั่งซื้อสำหรับพิมพ์/บันทึก PDF (เปิดในแท็บใหม่ ไม่มีเมนูระบบ) */
@Component({
    selector: 'app-purchase-order-print',
    standalone: true,
    imports: [ButtonModule, CompanyLetterhead, CompanyProfileDialog, DecimalPipe, ThaiDatePipe],
    template: `
        <div class="toolbar no-print">
            <span class="font-semibold">ใบสั่งซื้อ {{ order()?.poNumber }}</span>
            <span class="flex-1"></span>
            @if (canEditCompany()) {
                <button pButton type="button" [text]="true" icon="pi pi-building" label="แก้ไขข้อมูลบริษัท" (click)="editingCompany.set(true)"></button>
            }
            <button pButton type="button" icon="pi pi-print" label="พิมพ์ / บันทึก PDF" [disabled]="!order()" (click)="print()"></button>
        </div>

        @if (loadError()) {
            <div class="sheet"><p class="text-red-700">{{ loadError() }}</p></div>
        } @else if (order(); as po) {
            <article class="sheet" [attr.aria-label]="'ใบสั่งซื้อ ' + po.poNumber">
                @if (po.status !== 'approved') {
                    <div class="watermark" aria-hidden="true">{{ po.status === 'pending' ? 'รออนุมัติ' : 'ไม่อนุมัติ' }}</div>
                }
                <header class="head">
                    <app-company-letterhead class="letterhead" [company]="company()" />
                    <div class="title-box">
                        <div class="title">ใบสั่งซื้อ</div>
                        <div class="subtitle">PURCHASE ORDER</div>
                        <table class="meta">
                            <tr><th>เลขที่</th><td>{{ po.poNumber }}</td></tr>
                            <tr><th>วันที่</th><td>{{ po.orderDate | thaiDate }}</td></tr>
                            <tr><th>อ้างอิงใบขอซื้อ</th><td>{{ purchase()!.id }}</td></tr>
                        </table>
                    </div>
                </header>

                <section class="parties">
                    <div class="box">
                        <div class="box-title">ผู้ขาย</div>
                        <div class="font-semibold">{{ po.vendor?.name ?? po.supplier }}</div>
                        @if (po.vendor?.address) {
                            <div>{{ po.vendor!.address }}</div>
                        }
                        @if (po.vendor?.taxId) {
                            <div>เลขประจำตัวผู้เสียภาษี {{ po.vendor!.taxId }}</div>
                        }
                        @if (po.vendor?.contactName || po.vendor?.phone) {
                            <div>ติดต่อ {{ po.vendor?.contactName }} {{ po.vendor?.phone ? 'โทร ' + po.vendor!.phone : '' }}</div>
                        }
                    </div>
                    <div class="box">
                        <div class="box-title">ส่งของที่</div>
                        <div class="font-semibold">โครงการ {{ project()?.name }} ({{ project()?.code }})</div>
                        <div>{{ project()?.location ?? '-' }}</div>
                        @if (project()?.siteCoordinates; as point) {
                            <div>พิกัด {{ point.lat }}, {{ point.lng }}</div>
                        }
                        <div>กำหนดส่ง {{ po.expectedDate ? (po.expectedDate | thaiDate) : 'ตามตกลง' }} · ชำระเงิน {{ po.paymentTerms || 'ตามตกลง' }}</div>
                    </div>
                </section>

                <table class="items">
                    <thead>
                        <tr>
                            <th class="w-no">ลำดับ</th>
                            <th>รายการ</th>
                            <th class="num">จำนวน</th>
                            <th>หน่วย</th>
                            <th class="num">ราคา/หน่วย</th>
                            <th class="num">จำนวนเงิน</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (item of purchase()!.items; track $index; let i = $index) {
                            <tr>
                                <td class="center">{{ i + 1 }}</td>
                                <td>{{ item.name }}</td>
                                <td class="num">{{ item.quantity | number: '1.0-2' }}</td>
                                <td>{{ item.unit }}</td>
                                <td class="num">{{ po.unitPrices?.[i] ?? item.unitPrice | number: '1.2-2' }}</td>
                                <td class="num">{{ item.quantity * (po.unitPrices?.[i] ?? item.unitPrice) | number: '1.2-2' }}</td>
                            </tr>
                        }
                        @for (blank of blanks(); track $index) {
                            <tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                        }
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="3" rowspan="3" class="words">
                                <div class="muted">จำนวนเงินตัวอักษร</div>
                                <div class="font-semibold">({{ words() }})</div>
                            </td>
                            <th colspan="2">ราคาก่อนภาษีมูลค่าเพิ่ม</th>
                            <td class="num">{{ po.amountBeforeVat ?? 0 | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <th colspan="2">ภาษีมูลค่าเพิ่ม 7%</th>
                            <td class="num">{{ po.vatAmount ?? 0 | number: '1.2-2' }}</td>
                        </tr>
                        <tr class="grand">
                            <th colspan="2">รวมทั้งสิ้น</th>
                            <td class="num">{{ po.amount ?? 0 | number: '1.2-2' }}</td>
                        </tr>
                    </tfoot>
                </table>

                <section class="terms">
                    <div class="font-semibold">หมายเหตุและเงื่อนไข</div>
                    @if (po.note) {
                        <p class="m-0">{{ po.note }}</p>
                    }
                    <ol>
                        <li>ราคาข้างต้นรวมภาษีมูลค่าเพิ่มแล้ว</li>
                        <li>ส่งของถึงหน้างานตามสถานที่และกำหนดส่งข้างต้น โปรดแจ้งล่วงหน้าก่อนเข้าส่งของ</li>
                        <li>บริษัทตรวจรับของที่หน้างาน ของที่ไม่ตรงตามรายการหรือชำรุดจะส่งคืน</li>
                        <li>โปรดระบุเลขที่ใบสั่งซื้อนี้ในใบส่งของและใบแจ้งหนี้ทุกครั้ง</li>
                    </ol>
                </section>

                <section class="signs">
                    <div class="sign">
                        <div class="line"></div>
                        <div>ผู้สั่งซื้อ</div>
                        <div class="muted">{{ po.orderedBy.name }}</div>
                        <div class="muted">วันที่ {{ po.orderDate | thaiDate }}</div>
                    </div>
                    <div class="sign">
                        <div class="line"></div>
                        <div>ผู้อนุมัติ</div>
                        <div class="muted">{{ approver()?.name ?? '' }}</div>
                        <div class="muted">วันที่ {{ approver()?.at ? (approver()!.at | thaiDate) : '' }}</div>
                    </div>
                    <div class="sign">
                        <div class="line"></div>
                        <div>ผู้ขายยืนยันรับคำสั่งซื้อ</div>
                        <div class="muted">&nbsp;</div>
                        <div class="muted">วันที่ ........................</div>
                    </div>
                </section>
            </article>
        } @else {
            <div class="sheet"><p>กำลังโหลด...</p></div>
        }

        @if (editingCompany()) {
            <app-company-profile-dialog [company]="company()" (saved)="companyResource.set($event); editingCompany.set(false)" (closed)="editingCompany.set(false)" />
        }
    `,
    styles: `
        :host {
            display: block;
            min-height: 100vh;
            background: #e5e7eb;
            color: #111;
            font-size: 13px;
            padding-bottom: 2rem;
        }
        .toolbar {
            position: sticky;
            top: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            background: #fff;
            border-bottom: 1px solid #d1d5db;
        }
        .sheet {
            position: relative;
            box-sizing: border-box;
            width: 210mm;
            max-width: calc(100% - 32px);
            min-height: 297mm;
            margin: 1.5rem auto 0;
            padding: 14mm 14mm 12mm;
            background: #fff;
            box-shadow: 0 2px 12px rgb(0 0 0 / 0.15);
            overflow: hidden;
        }
        .watermark {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 90px;
            font-weight: 700;
            color: rgb(220 38 38 / 0.1);
            transform: rotate(-30deg);
            pointer-events: none;
        }
        .head {
            display: flex;
            justify-content: space-between;
            gap: 1rem;
            padding-bottom: 0.75rem;
            border-bottom: 2px solid #111;
        }
        .letterhead {
            align-self: flex-start;
        }
        .title-box {
            text-align: right;
            min-width: 15rem;
        }
        .title {
            font-size: 22px;
            font-weight: 700;
        }
        .subtitle {
            font-size: 11px;
            letter-spacing: 0.15em;
            color: #555;
        }
        .meta {
            margin-left: auto;
            margin-top: 0.4rem;
            border-collapse: collapse;
        }
        .meta th {
            text-align: left;
            font-weight: 400;
            color: #555;
            padding: 1px 0.75rem 1px 0;
        }
        .meta td {
            font-weight: 600;
            text-align: right;
        }
        .parties {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.75rem;
            margin: 0.9rem 0;
        }
        .box {
            border: 1px solid #9ca3af;
            border-radius: 4px;
            padding: 0.5rem 0.7rem;
            line-height: 1.55;
        }
        .box-title {
            font-size: 11px;
            color: #555;
        }
        table.items {
            width: 100%;
            border-collapse: collapse;
        }
        .items th,
        .items td {
            border: 1px solid #9ca3af;
            padding: 4px 6px;
            vertical-align: top;
        }
        .items thead th {
            background: #f3f4f6;
            font-weight: 600;
        }
        .items .blank td {
            height: 22px;
        }
        .items tfoot th {
            text-align: right;
            font-weight: 400;
        }
        .items .grand th,
        .items .grand td {
            font-weight: 700;
            background: #f3f4f6;
        }
        .words {
            vertical-align: middle !important;
        }
        .num {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }
        .center {
            text-align: center;
        }
        .w-no {
            width: 3rem;
        }
        .muted {
            color: #555;
        }
        .terms {
            margin-top: 0.9rem;
            line-height: 1.6;
        }
        .terms ol {
            margin: 0.2rem 0 0;
            padding-left: 1.2rem;
        }
        .signs {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.5rem;
            margin-top: 2.5rem;
            text-align: center;
        }
        .sign .line {
            border-bottom: 1px dotted #111;
            height: 2.5rem;
            margin-bottom: 0.3rem;
        }
        @media print {
            @page {
                size: A4;
                margin: 0;
            }
            :host {
                background: #fff;
                padding: 0;
            }
            .no-print {
                display: none !important;
            }
            .sheet {
                margin: 0;
                box-shadow: none;
                max-width: none;
            }
        }
    `
})
export class PurchaseOrderPrint {
    private readonly route = inject(ActivatedRoute);
    private readonly service = inject(ProcurementService);
    private readonly projects = inject(ProjectService);
    private readonly approvals = inject(ApprovalService);
    private readonly auth = inject(AuthService);

    private readonly params = toSignal(this.route.paramMap.pipe(map((params) => ({ code: params.get('code') ?? '', id: params.get('id') ?? '' }))), { initialValue: { code: '', id: '' } });

    readonly purchasesResource = apiResource({ params: () => this.params().code || undefined, stream: ({ params: code }) => this.service.purchases(code) });
    readonly projectResource = apiResource({ params: () => this.params().code || undefined, stream: ({ params: code }) => this.projects.get(code) });
    readonly companyResource = apiResource({ stream: () => this.service.company() });

    readonly purchase = computed(() => this.purchasesResource.value()?.find((item) => item.id === this.params().id));
    readonly order = computed(() => this.purchase()?.order);
    readonly project = computed(() => this.projectResource.value());
    readonly company = computed<CompanyProfile>(() => this.companyResource.value() ?? { name: '', address: '', taxId: '', phone: '' });
    readonly words = computed(() => bahtText(this.order()?.amount ?? 0));
    /** เติมแถวว่างให้ตารางดูเต็มหน้า */
    readonly blanks = computed(() => Array.from({ length: Math.max(0, 10 - (this.purchase()?.items.length ?? 0)) }));
    readonly loadError = computed(() => {
        const error = this.purchasesResource.error() ?? this.projectResource.error();
        if (error) return problemMessage(error, 'โหลดใบสั่งซื้อไม่สำเร็จ');
        return this.purchasesResource.value() && !this.order() ? 'ไม่พบใบสั่งซื้อของใบขอซื้อนี้' : '';
    });

    /** ผู้อนุมัติจากประวัติในศูนย์อนุมัติ (ไม่มีสิทธิ์ดู = เว้นว่างให้เซ็น) */
    readonly approvalResource = apiResource({
        params: () => (this.order()?.status === 'approved' ? this.order()!.approvalId : undefined),
        stream: ({ params: id }) => this.approvals.get(id).pipe(catchError(() => of(null)))
    });
    readonly approver = computed(() => {
        const step = this.approvalResource.value()?.history.filter((item) => item.action === 'approved').at(-1);
        return step ? { name: step.user.name, at: step.at.toISOString().slice(0, 10) } : null;
    });

    print() {
        window.print();
    }

    // ---------- ข้อมูลบริษัท ----------
    readonly canEditCompany = computed(() => this.auth.can('user.manage'));
    readonly editingCompany = signal(false);
}
