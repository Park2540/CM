import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { EstimateCategory, EstimateService, itemLabor, itemMaterial, saveEstimateExcel } from '@/app/pages/service/estimate.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { ProcurementService } from '@/app/pages/service/procurement.service';
import { AuthService } from '@/app/pages/service/auth.service';
import { CompanyLetterhead } from '@/app/pages/shared/company-letterhead';
import { CompanyProfileDialog } from '@/app/pages/shared/company-profile-dialog';
import { StatementDocument } from './statement-document';

/** พิมพ์ BOQ: รายละเอียดบัญชีแสดงปริมาณงานและราคา (หน้าละหมวดงาน) + สรุปราคางาน — A4 แนวนอน + เอกสารชี้แจงค่าดำเนินการ — A4 แนวตั้ง */
@Component({
    selector: 'app-estimate-print',
    standalone: true,
    imports: [ButtonModule, CompanyLetterhead, CompanyProfileDialog, DecimalPipe, NgTemplateOutlet, StatementDocument, ThaiDatePipe],
    template: `
        <div class="toolbar no-print">
            <span class="font-semibold">{{ estimate()?.id }} · {{ estimate()?.title }}</span>
            <span class="flex-1"></span>
            @if (canEditCompany()) {
                <button pButton type="button" [text]="true" icon="pi pi-building" label="แก้ไขข้อมูลบริษัท" [disabled]="!company.value()" (click)="editingCompany.set(true)"></button>
            }
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" [checked]="withStatement()" (change)="withStatement.set($any($event.target).checked)" />แนบคำชี้แจงค่าดำเนินการ</label>
            @if (exportError()) {
                <span class="text-red-600 text-sm">{{ exportError() }}</span>
            }
            <button pButton type="button" [outlined]="true" icon="pi pi-file-excel" label="ส่งออก Excel" [loading]="exporting()" [disabled]="!estimate()" (click)="exportExcel()"></button>
            <button pButton type="button" icon="pi pi-print" label="พิมพ์ / บันทึก PDF" [disabled]="!estimate()" (click)="print()"></button>
        </div>

        @if (error()) {
            <div class="sheet"><p>{{ error() }}</p></div>
        } @else if (estimate(); as est) {
            @for (category of est.categories; track category.id; let c = $index) {
                <article class="sheet">
                    <ng-container *ngTemplateOutlet="header" />
                    <table class="boq">
                        <ng-container *ngTemplateOutlet="tableHead" />
                        <tbody>
                            <tr class="category-row"><td></td><td class="font-semibold"><span class="mark">{{ category.name }}</span></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                            @for (group of category.groups; track group.id; let g = $index) {
                                @if (group.title) {
                                    <tr><td class="center">{{ g + 1 }}</td><td class="font-semibold">{{ group.title }}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                                }
                                @for (item of group.items; track item.id) {
                                    @if (item.kind === 'heading') {
                                        <tr><td></td><td>{{ item.description }}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                                    } @else {
                                        <tr>
                                            <td></td>
                                            <td [class.indent]="item.indent">{{ item.indent ? '- ' : '' }}{{ item.description }}</td>
                                            <td class="center">{{ item.unit }}</td>
                                            <td class="num">{{ dash(item.quantity) }}</td>
                                            <td class="num">{{ dash(item.materialPrice) }}</td>
                                            <td class="num">{{ dash(material(item)) }}</td>
                                            <td class="num">{{ dash(item.laborPrice) }}</td>
                                            <td class="num">{{ dash(labor(item)) }}</td>
                                            <td class="num">{{ dash(material(item) + labor(item)) }}</td>
                                        </tr>
                                    }
                                }
                            }
                        </tbody>
                        <tfoot>
                            <tr>
                                <td></td>
                                <td class="center">รวมราคา{{ category.name }}{{ category.excluded ? ' (ไม่รวมในสรุป)' : '' }}</td>
                                <td></td><td></td><td></td>
                                <td class="num">{{ dash(totalOf(category).material) }}</td>
                                <td></td>
                                <td class="num">{{ dash(totalOf(category).labor) }}</td>
                                <td class="num">{{ dash(totalOf(category).total) }}</td>
                            </tr>
                        </tfoot>
                    </table>
                </article>
            }

            <article class="sheet">
                <ng-container *ngTemplateOutlet="header" />
                <table class="boq">
                    <ng-container *ngTemplateOutlet="tableHead" />
                    <tbody>
                        <tr><td></td><td class="font-semibold underline">สรุปราคาค่าก่อสร้าง</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                        @for (category of included(); track category.id; let c = $index) {
                            <tr>
                                <td class="center">{{ c + 1 }}</td>
                                <td>{{ category.name }}</td>
                                <td class="center">งาน</td>
                                <td class="num">1.00</td>
                                <td></td>
                                <td class="num">{{ dash(totalOf(category).material) }}</td>
                                <td></td>
                                <td class="num">{{ dash(totalOf(category).labor) }}</td>
                                <td class="num">{{ dash(totalOf(category).total) }} <span class="share">{{ share(category) | number: '1.1-1' }}%</span></td>
                            </tr>
                        }
                        @for (note of est.notes; track $index) {
                            <tr><td></td><td class="note">- {{ note }}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                        }
                    </tbody>
                    <tfoot>
                        <tr>
                            <td></td>
                            <td class="center">รวม {{ included().length }} รายการ</td>
                            <td></td><td></td><td></td>
                            <td class="num">{{ est.totals.material | number: '1.2-2' }}</td>
                            <td></td>
                            <td class="num">{{ est.totals.labor | number: '1.2-2' }}</td>
                            <td class="num">{{ est.totals.subtotal | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <td class="center">ค่าดำเนินการ {{ est.overheadPercent | number: '1.0-2' }}%</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td>
                            <td class="num">{{ est.totals.overhead | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <td class="center">กำไร {{ est.profitPercent | number: '1.0-2' }}%</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td>
                            <td class="num">{{ est.totals.profit | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <td class="center">รวมก่อนภาษีมูลค่าเพิ่ม</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td>
                            <td class="num">{{ est.totals.beforeVat | number: '1.2-2' }}</td>
                        </tr>
                        <tr>
                            <td></td>
                            <td class="center">ภาษีมูลค่าเพิ่ม {{ est.vatPercent | number: '1.0-2' }}%</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td>
                            <td class="num">{{ est.totals.vat | number: '1.2-2' }}</td>
                        </tr>
                        <tr class="grand">
                            <td></td>
                            <td class="center" colspan="7">รวมเป็นเงินทั้งสิ้น</td>
                            <td class="num">{{ est.totals.grandTotal | number: '1.2-2' }}</td>
                        </tr>
                        @if (est.area) {
                            <tr>
                                <td></td>
                                <td class="right" colspan="2">พื้นที่ทั้งหมด = {{ est.area | number: '1.2-2' }} ตารางเมตร</td>
                                <td colspan="6">ราคาเฉลี่ย = {{ est.totals.pricePerSqm | number: '1.2-2' }} บาท / ตารางเมตร</td>
                            </tr>
                        }
                    </tfoot>
                </table>
            </article>

            @if (withStatement() && est.statement) {
                <article class="sheet portrait">
                    <app-statement-document [estimate]="est" [company]="company.value()" />
                </article>
            }

            <ng-template #header>
                <app-company-letterhead class="letterhead" [company]="company.value()" />
                <h1 class="title">รายละเอียดบัญชีแสดงปริมาณงานและราคา</h1>
                <div class="meta">
                    <div><span class="label">โครงการ</span>: {{ est.title }}</div>
                    <div><span class="label">เจ้าของโครงการ</span>: {{ est.ownerName ?? '' }}</div>
                    <div><span class="label">สถานที่ก่อสร้าง</span>: {{ est.location ?? '' }}</div>
                    <div><span class="label">วันที่</span>: {{ est.estimateDate ? (est.estimateDate | thaiDate) : '' }}</div>
                    <div><span class="label">เลขที่</span>: {{ est.id }}{{ est.projectCode ? ' · โครงการ ' + est.projectCode : '' }}</div>
                    <div><span class="label">ผู้เสนอราคา</span>: {{ est.estimator ?? '' }}</div>
                </div>
            </ng-template>
            <ng-template #tableHead>
                <thead>
                    <tr>
                        <th rowspan="2" class="w-no">ลำดับ</th>
                        <th rowspan="2">รายการ</th>
                        <th rowspan="2" class="w-unit">หน่วย</th>
                        <th rowspan="2" class="w-qty">ปริมาณ</th>
                        <th colspan="2">ราคาวัสดุ</th>
                        <th colspan="2">ราคาค่าแรง</th>
                        <th rowspan="2" class="w-sum">รวมราคา</th>
                    </tr>
                    <tr>
                        <th class="w-price">ราคา/หน่วย</th>
                        <th class="w-sum">ราคารวม</th>
                        <th class="w-price">ราคา/หน่วย</th>
                        <th class="w-sum">ราคารวม</th>
                    </tr>
                </thead>
            </ng-template>
        } @else {
            <div class="sheet"><p>กำลังโหลด...</p></div>
        }

        @if (editingCompany() && company.value(); as current) {
            <app-company-profile-dialog [company]="current" (saved)="company.set($event); editingCompany.set(false)" (closed)="editingCompany.set(false)" />
        }
    `,
    styles: `
        :host {
            display: block;
            min-height: 100vh;
            background: #e5e7eb;
            color: #111;
            font-size: 12px;
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
            box-sizing: border-box;
            width: 297mm;
            max-width: calc(100% - 32px);
            min-height: 210mm;
            margin: 1.5rem auto 0;
            padding: 10mm 10mm;
            background: #fff;
            box-shadow: 0 2px 12px rgb(0 0 0 / 0.15);
        }
        .sheet.portrait {
            width: 210mm;
            min-height: 297mm;
            padding: 15mm 16mm;
        }
        .letterhead {
            margin-bottom: 0.4rem;
        }
        .title {
            margin: 0 0 0.5rem;
            text-align: center;
            font-size: 20px;
            font-weight: 700;
            border: 1.5px solid #111;
            padding: 0.25rem;
        }
        .meta {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 0.15rem 1rem;
            margin-bottom: 0.4rem;
            padding-bottom: 0.4rem;
            border-bottom: 4px solid #5b8bd6;
            font-size: 13px;
        }
        .label {
            display: inline-block;
            min-width: 7.5rem;
            font-weight: 600;
        }
        table.boq {
            width: 100%;
            border-collapse: collapse;
        }
        .boq th,
        .boq td {
            border-left: 1px solid #555;
            border-right: 1px solid #555;
            border-bottom: 1px dotted #9ca3af;
            padding: 2px 5px;
            vertical-align: top;
        }
        .boq thead th {
            background: #d1d5db;
            border: 1px solid #555;
            font-weight: 700;
            text-align: center;
        }
        .boq tfoot td {
            background: #dbe4ef;
            border: 1px solid #555;
            font-weight: 700;
        }
        .boq tfoot .grand td {
            background: #c6d9a8;
            font-size: 14px;
        }
        .mark {
            background: #ffff00;
            padding: 0 0.3rem;
        }
        .num {
            text-align: right;
            white-space: nowrap;
            font-variant-numeric: tabular-nums;
        }
        .center {
            text-align: center;
        }
        .right {
            text-align: right;
        }
        .indent {
            padding-left: 1.2rem !important;
        }
        .note {
            color: #dc2626;
            font-style: italic;
        }
        .share {
            display: inline-block;
            min-width: 3rem;
            color: #555;
            font-weight: 400;
        }
        .w-no {
            width: 2.5rem;
        }
        .w-unit {
            width: 4.5rem;
        }
        .w-qty {
            width: 5.5rem;
        }
        .w-price {
            width: 5.5rem;
        }
        .w-sum {
            width: 7rem;
        }
        @media print {
            @page {
                size: A4 landscape;
                margin: 0;
            }
            /* เอกสารชี้แจงยาวหลายหน้า: ใช้ขอบกระดาษของหน้าแนวตั้งแทน padding ของแผ่น */
            @page statement {
                size: A4 portrait;
                margin: 14mm 0;
            }
            .sheet.portrait {
                page: statement;
                min-height: 0;
                padding: 0 16mm;
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
                break-after: page;
            }
            .sheet:last-of-type {
                break-after: auto;
            }
            .boq thead {
                display: table-header-group;
            }
            .boq tr {
                break-inside: avoid;
            }
        }
    `
})
export class EstimatePrint {
    private readonly route = inject(ActivatedRoute);
    private readonly service = inject(EstimateService);

    private readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), { initialValue: '' });
    readonly resource = apiResource({ params: () => this.id() || undefined, stream: ({ params: id }) => this.service.get(id) });
    readonly estimate = computed(() => this.resource.value());
    readonly error = computed(() => (this.resource.error() ? problemMessage(this.resource.error(), 'ไม่พบ BOQ') : ''));
    readonly included = computed(() => this.estimate()?.categories.filter((category) => !category.excluded) ?? []);
    private readonly procurement = inject(ProcurementService);
    readonly company = apiResource({ stream: () => this.procurement.company() });
    readonly withStatement = signal(true);
    private readonly auth = inject(AuthService);
    readonly canEditCompany = computed(() => this.auth.can('user.manage'));
    readonly editingCompany = signal(false);
    readonly material = itemMaterial;
    readonly labor = itemLabor;

    totalOf(category: EstimateCategory) {
        return this.estimate()?.totals.categories.find((item) => item.id === category.id) ?? { material: 0, labor: 0, total: 0 };
    }

    share(category: EstimateCategory) {
        const subtotal = this.estimate()?.totals.subtotal ?? 0;
        return subtotal ? (this.totalOf(category).total / subtotal) * 100 : 0;
    }

    /** ศูนย์แสดงเป็น "-" แบบในไฟล์ Excel */
    dash(value: number) {
        return value ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
    }

    readonly exporting = signal(false);
    readonly exportError = signal('');

    exportExcel() {
        const estimate = this.estimate();
        if (!estimate) return;
        this.exporting.set(true);
        this.exportError.set('');
        this.service.exportExcel(estimate.id).subscribe({
            next: (blob) => {
                this.exporting.set(false);
                saveEstimateExcel(blob, estimate);
            },
            error: (error) => {
                this.exporting.set(false);
                this.exportError.set(problemMessage(error, 'ส่งออก Excel ไม่สำเร็จ'));
            }
        });
    }

    print() {
        window.print();
    }
}
