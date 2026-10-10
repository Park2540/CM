import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, input } from '@angular/core';
import { Estimate, StatementBlock, clauseStarts } from '@/app/pages/service/estimate.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { CompanyProfile } from '@/app/pages/service/procurement.service';
import { CompanyLetterhead } from '@/app/pages/shared/company-letterhead';

/** เอกสารชี้แจงรายละเอียดค่าดำเนินการ (แนบท้าย BOQ) — รูปแบบพิมพ์ A4 แนวตั้ง เลขหัวข้อนับอัตโนมัติ */
@Component({
    selector: 'app-statement-document',
    standalone: true,
    imports: [CompanyLetterhead, DecimalPipe, NgTemplateOutlet, ThaiDatePipe],
    template: `
        @let est = estimate();
        @let doc = est.statement!;
        <app-company-letterhead class="doc-letterhead" [company]="company()" />
        <h1 class="doc-title">{{ doc.title }}</h1>
        @if (doc.subtitle) {
            <p class="doc-subtitle">{{ doc.subtitle }}</p>
        }
        <dl class="doc-meta">
            <dt>ชื่อโครงการ</dt><dd>{{ est.title }}</dd>
            <dt>สถานที่ก่อสร้าง</dt><dd>{{ est.location || dots }}</dd>
            <dt>เจ้าของโครงการ</dt><dd>{{ est.ownerName || dots }}</dd>
            <dt>ผู้รับเหมาก่อสร้าง</dt><dd>{{ company()?.name || dots }}</dd>
            <dt>เลขที่เอกสาร BOQ</dt><dd>{{ est.id }}{{ est.estimateDate ? ' ลงวันที่ ' : '' }}{{ est.estimateDate ? (est.estimateDate | thaiDate) : '' }}</dd>
        </dl>
        <p class="doc-amount">
            ค่าดำเนินการตาม BOQ ฉบับนี้ {{ est.overheadPercent | number: '1.0-2' }}% ของค่าวัสดุและค่าแรง ({{ est.totals.subtotal | number: '1.2-2' }} บาท) เป็นเงิน <strong>{{ est.totals.overhead | number: '1.2-2' }} บาท</strong>
        </p>

        @for (section of doc.sections; track section.id; let s = $index) {
            <section class="doc-section">
                <h2><span class="no">{{ s + 1 }}.</span>{{ section.title }}</h2>
                <ng-container *ngTemplateOutlet="blocks; context: { $implicit: section.blocks, prefix: s + 1 + '' }" />
                @for (subsection of section.subsections; track subsection.id; let j = $index) {
                    <h3><span class="no">{{ s + 1 }}.{{ j + 1 }}</span>{{ subsection.title }}</h3>
                    <ng-container *ngTemplateOutlet="blocks; context: { $implicit: subsection.blocks, prefix: s + 1 + '.' + (j + 1) }" />
                }
            </section>
        }

        <div class="doc-signatures">
            @for (party of ['ผู้รับเหมาก่อสร้าง', 'เจ้าของโครงการ']; track party) {
                <div>
                    <p>ลงชื่อ ................................................ {{ party }}</p>
                    <p>(................................................)</p>
                    <p>วันที่ ........... / ........... / ...........</p>
                </div>
            }
        </div>

        <ng-template #blocks let-blocks let-prefix="prefix">
            @let starts = clauses(blocks);
            @for (block of asBlocks(blocks); track block.id) {
                @switch (block.kind) {
                    @case ('paragraph') {
                        <p class="doc-paragraph">{{ block.text }}</p>
                    }
                    @case ('list') {
                        @if (block.title) {
                            <p class="doc-list-title">{{ block.title }}</p>
                        }
                        <ol class="doc-list" [class.bullet]="block.style === 'bullet'">
                            @for (item of block.items; track $index; let k = $index) {
                                <li>
                                    <span class="marker">{{ block.style === 'bullet' ? '•' : block.style === 'clause' ? prefix + '.' + (starts[block.id] + k + 1) : k + 1 + '.' }}</span>
                                    <span>{{ item }}</span>
                                </li>
                            }
                        </ol>
                    }
                    @case ('responsibility') {
                        <table class="doc-table">
                            <thead>
                                <tr>
                                    <th>รายการ</th>
                                    <th class="w-check">ผู้รับเหมา</th>
                                    <th class="w-check">เจ้าของโครงการ</th>
                                    <th class="w-note">หมายเหตุ</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (row of block.rows; track row.id) {
                                    <tr>
                                        <td>{{ row.item }}</td>
                                        <td class="check">{{ row.contractor ? '☑' : '☐' }}</td>
                                        <td class="check">{{ row.owner ? '☑' : '☐' }}</td>
                                        <td>{{ row.note }}</td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    }
                }
            }
        </ng-template>
    `,
    styles: `
        :host {
            display: block;
            font-size: 13px;
            line-height: 1.6;
            color: #111;
        }
        .doc-letterhead {
            padding-bottom: 0.5rem;
            margin-bottom: 0.75rem;
            border-bottom: 3px solid #5b8bd6;
        }
        .doc-title {
            margin: 0;
            text-align: center;
            font-size: 19px;
            font-weight: 700;
        }
        .doc-subtitle {
            margin: 0.1rem 0 0.8rem;
            text-align: center;
            font-weight: 600;
        }
        .doc-meta {
            display: grid;
            grid-template-columns: 9rem 1fr;
            gap: 0.1rem 0.5rem;
            margin: 0 0 0.6rem;
        }
        .doc-meta dt {
            font-weight: 600;
        }
        .doc-meta dt::after {
            content: ':';
            float: right;
        }
        .doc-meta dd {
            margin: 0;
        }
        .doc-amount {
            margin: 0 0 0.8rem;
            padding: 0.4rem 0.6rem;
            border: 1px solid #555;
            background: #dbe4ef;
        }
        .doc-section h2 {
            margin: 0.9rem 0 0.3rem;
            font-size: 15px;
            font-weight: 700;
            break-after: avoid;
        }
        .doc-section h3 {
            margin: 0.6rem 0 0.2rem;
            font-size: 13.5px;
            font-weight: 700;
            break-after: avoid;
        }
        .no {
            display: inline-block;
            min-width: 2.4rem;
        }
        .doc-paragraph {
            margin: 0.2rem 0 0.35rem;
            text-indent: 2.4rem;
            text-align: left;
            white-space: pre-line;
        }
        .doc-list-title {
            margin: 0.35rem 0 0.1rem 2.4rem;
            font-weight: 600;
            text-decoration: underline;
        }
        .doc-list {
            list-style: none;
            margin: 0.1rem 0 0.35rem;
            padding-left: 2.4rem;
        }
        .doc-list li {
            display: flex;
            gap: 0.4rem;
            break-inside: avoid;
        }
        .doc-list .marker {
            flex: 0 0 auto;
            min-width: 1.6rem;
            text-align: right;
        }
        .doc-table {
            width: calc(100% - 2.4rem);
            margin: 0.3rem 0 0.4rem 2.4rem;
            border-collapse: collapse;
        }
        .doc-table th,
        .doc-table td {
            border: 1px solid #555;
            padding: 2px 6px;
        }
        .doc-table th {
            background: #d1d5db;
        }
        .doc-table tr {
            break-inside: avoid;
        }
        .check {
            text-align: center;
            font-size: 16px;
        }
        .w-check {
            width: 6.5rem;
        }
        .w-note {
            width: 9rem;
        }
        .doc-signatures {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-top: 2.5rem;
            text-align: center;
            break-inside: avoid;
        }
        .doc-signatures p {
            margin: 0.3rem 0;
        }
    `
})
export class StatementDocument {
    readonly estimate = input.required<Estimate>();
    readonly company = input<CompanyProfile | undefined>();
    readonly dots = '.................................................';
    readonly clauses = clauseStarts;
    readonly asBlocks = (blocks: StatementBlock[]) => blocks;
}
