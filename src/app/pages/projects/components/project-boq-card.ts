import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { EstimateService, EstimateSummary, saveEstimateExcel } from '@/app/pages/service/estimate.service';
import { ThaiDatePipe } from '../thai-date.pipe';

/**
 * BOQ ของโครงการ (แท็บเอกสาร) — แสดงฉบับที่ทำเสร็จแล้ว (สถานะ "ส่งลูกค้าแล้ว") พร้อมเปิด พิมพ์/PDF และส่งออก Excel
 * ฉบับร่างของโครงการแสดงเป็นจำนวนพร้อมลิงก์ไปแก้ต่อ — BOQ ผูกกับโครงการที่ช่อง "โครงการ" ในหน้า BOQ
 */
@Component({
    selector: 'app-project-boq-card',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, RouterLink, TagModule, ThaiDatePipe],
    template: `
        <section class="card" aria-labelledby="project-boq-title">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                    <h2 id="project-boq-title" class="text-xl font-semibold m-0">BOQ (ใบแสดงปริมาณงานและราคา)</h2>
                    <p class="text-muted-color mt-1 mb-0 text-sm">ฉบับที่ทำเสร็จแล้ว (สถานะ "ส่งลูกค้าแล้ว") ของโครงการนี้ พร้อมเอกสารชี้แจงค่าดำเนินการแนบท้าย</p>
                </div>
                <a pButton routerLink="/estimates" [outlined]="true" size="small" icon="pi pi-calculator" label="ไปที่ถอดปริมาณและ BOQ"></a>
            </div>

            @if (resource.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลด BOQ ไม่สำเร็จ: {{ message(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="resource.reload()"></button>
                </div>
            } @else if (resource.isLoading() && !resource.value().length) {
                <p class="text-muted-color m-0"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด BOQ...</p>
            } @else {
                @if (finals().length) {
                    <ul class="list-none p-0 m-0 border border-surface rounded-lg">
                        @for (boq of finals(); track boq.id) {
                            <li class="flex flex-wrap items-center gap-3 p-3 border-b border-surface last:border-b-0">
                                <span class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden="true">
                                    <i class="pi pi-calculator"></i>
                                </span>
                                <div class="flex-1 min-w-60">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <a class="font-medium hover:text-primary" [routerLink]="['/estimates', boq.id]">{{ boq.title }}</a>
                                        <p-tag value="ส่งลูกค้าแล้ว" severity="success" />
                                        @if (boq.fromModel) {
                                            <p-tag value="ถอดจากโมเดล IFC" severity="info" />
                                        }
                                    </div>
                                    <div class="text-xs text-muted-color mt-1">
                                        {{ boq.id }} · {{ boq.itemCount }} รายการ · แก้ไขล่าสุด {{ boq.updatedAt | thaiDate }}
                                        @if (boq.pricePerSqm) {
                                            <span> · {{ boq.pricePerSqm | number: '1.0-0' }} บาท/ตร.ม.</span>
                                        }
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="text-xs text-muted-color">รวมเป็นเงินทั้งสิ้น</div>
                                    <div class="text-lg font-bold tabular-nums">฿{{ boq.grandTotal | number: '1.2-2' }}</div>
                                </div>
                                <div class="flex gap-1">
                                    <a pButton [routerLink]="['/print/estimate', boq.id]" target="_blank" [text]="true" severity="secondary" icon="pi pi-print" [attr.aria-label]="'พิมพ์/PDF ' + boq.title" title="พิมพ์ / บันทึก PDF"></a>
                                    <button pButton type="button" [text]="true" severity="secondary" icon="pi pi-file-excel" [loading]="exporting() === boq.id" [attr.aria-label]="'ส่งออก Excel ' + boq.title" title="ส่งออก Excel" (click)="exportExcel(boq)"></button>
                                </div>
                            </li>
                        }
                    </ul>
                } @else {
                    <div class="rounded-lg border border-dashed border-surface p-4 text-center text-muted-color">
                        <i class="pi pi-calculator text-2xl mb-2"></i>
                        <p class="m-0">ยังไม่มี BOQ ที่ทำเสร็จของโครงการนี้</p>
                        <p class="m-0 mt-1 text-xs">ผูก BOQ กับโครงการที่ช่อง "โครงการ" ในหน้า BOQ แล้วตั้งสถานะเป็น "ส่งลูกค้าแล้ว"</p>
                    </div>
                }
                @if (drafts().length) {
                    <p class="text-sm text-muted-color mt-3 mb-0">
                        <i class="pi pi-pencil mr-1"></i>ฉบับร่างของโครงการนี้:
                        @for (boq of drafts(); track boq.id; let last = $last) {
                            <a class="hover:text-primary" [routerLink]="['/estimates', boq.id]">{{ boq.id }} {{ boq.title }}</a>{{ last ? '' : ', ' }}
                        }
                    </p>
                }
            }
            @if (exportError()) {
                <p class="text-sm text-red-600 mt-2 mb-0" role="alert">{{ exportError() }}</p>
            }
        </section>
    `
})
export class ProjectBoqCard {
    private readonly service = inject(EstimateService);

    readonly projectCode = input.required<string>();
    /** เปลี่ยนค่าเพื่อให้โหลดใหม่ */
    readonly refreshKey = input(0);

    readonly resource = apiResource({
        params: () => ({ code: this.projectCode(), refresh: this.refreshKey() }),
        stream: ({ params }) => this.service.list(params.code),
        defaultValue: []
    });
    readonly finals = computed(() => this.resource.value().filter((boq) => boq.status === 'final'));
    readonly drafts = computed(() => this.resource.value().filter((boq) => boq.status !== 'final'));
    readonly exporting = signal('');
    readonly exportError = signal('');

    message(error: unknown) {
        return problemMessage(error);
    }

    exportExcel(boq: EstimateSummary) {
        this.exporting.set(boq.id);
        this.exportError.set('');
        this.service.exportExcel(boq.id).subscribe({
            next: (blob) => {
                this.exporting.set('');
                saveEstimateExcel(blob, boq);
            },
            error: (error) => {
                this.exporting.set('');
                this.exportError.set(`ส่งออก Excel ไม่สำเร็จ: ${problemMessage(error)}`);
            }
        });
    }
}
