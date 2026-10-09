import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, HostListener, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { AuthService } from '@/app/pages/service/auth.service';
import {
    Estimate,
    EstimateCategory,
    EstimateDraft,
    EstimateGroup,
    EstimateItem,
    EstimateRate,
    EstimateService,
    UNITS,
    computeTotals,
    groupTotal,
    itemLabor,
    itemMaterial,
    newId,
    saveEstimateExcel,
    takeoffQuantity
} from '@/app/pages/service/estimate.service';
import { ProjectService } from '@/app/pages/service/project.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { StatementEditor } from './statement-editor';
import { TakeoffDialog, TakeoffResult } from './takeoff-dialog';

/** สีแท็บหมวดงาน (แบบ sheet ใน Excel) */
const TAB_COLORS = ['#eab308', '#16a34a', '#7c3aed', '#ea580c', '#64748b', '#0ea5e9', '#db2777', '#0d9488'];

const toDraft = (estimate: Estimate | undefined): EstimateDraft | null => {
    if (!estimate) return null;
    const { totals: _totals, id: _id, createdBy: _createdBy, createdAt: _createdAt, updatedBy: _updatedBy, updatedAt: _updatedAt, ...input } = estimate;
    return structuredClone({ ...input, status: estimate.status ?? 'draft', overheadPercent: estimate.overheadPercent ?? 0, profitPercent: estimate.profitPercent ?? 0, vatPercent: estimate.vatPercent ?? 0, notes: estimate.notes ?? [] });
};

/** ใบถอดปริมาณ/BOQ: หมวดงาน (แท็บ) → กลุ่มงาน → รายการ พร้อมถอดปริมาณและสรุปราคา */
@Component({
    selector: 'app-estimate-editor',
    standalone: true,
    imports: [ButtonModule, ConfirmDialogModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, RouterLink, StatementEditor, TagModule, TakeoffDialog, ThaiDatePipe, ToastModule],
    providers: [ConfirmationService, MessageService],
    template: `
        <p-toast />
        <p-confirmdialog />
        <a routerLink="/estimates" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4 no-underline"><i class="pi pi-arrow-left"></i>ถอดปริมาณและ BOQ</a>

        @if (loadError()) {
            <div class="card text-red-700 dark:text-red-300" role="alert">{{ loadError() }}</div>
        } @else if (draft(); as est) {
            <!-- หัวเอกสาร -->
            <section class="card mb-4" aria-labelledby="estimate-title">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2 mb-2">
                            <span class="px-2 py-1 rounded-md bg-emphasis text-sm font-semibold">{{ estimate()?.id }}</span>
                            <p-tag [value]="est.status === 'final' ? 'ส่งลูกค้าแล้ว' : 'ร่าง'" [severity]="est.status === 'final' ? 'success' : 'secondary'" />
                            @if (dirty()) {
                                <span class="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200"><i class="pi pi-circle-fill text-[0.45rem] mr-1"></i>ยังไม่บันทึก</span>
                            } @else if (estimate()?.updatedAt) {
                                <span class="text-xs text-muted-color">บันทึกล่าสุด {{ estimate()!.updatedAt | thaiDate }}{{ estimate()!.updatedBy ? ' · ' + estimate()!.updatedBy!.name : '' }}</span>
                            }
                        </div>
                        <h1 id="estimate-title" class="sr-only">{{ est.title }}</h1>
                        <input class="title-input" aria-label="ชื่องาน" maxlength="200" [disabled]="!canEdit()" [ngModel]="est.title" (ngModelChange)="setField('title', $event)" />
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <a pButton [routerLink]="['/print/estimate', estimate()?.id]" target="_blank" [outlined]="true" icon="pi pi-print" label="พิมพ์" [attr.title]="dirty() ? 'พิมพ์ฉบับที่บันทึกล่าสุด' : null"></a>
                        <button pButton type="button" [outlined]="true" icon="pi pi-file-excel" label="Excel" [loading]="exporting()" [attr.title]="dirty() ? 'ส่งออกฉบับที่บันทึกล่าสุด' : 'ส่งออกเป็นไฟล์ Excel'" (click)="exportExcel()"></button>
                        @if (canEdit()) {
                            <button pButton type="button" [outlined]="true" icon="pi pi-copy" label="คัดลอก" [loading]="copying()" (click)="duplicate()"></button>
                            <button pButton type="button" [text]="true" severity="danger" icon="pi pi-trash" aria-label="ลบ BOQ" (click)="confirmDelete()"></button>
                            <button pButton type="button" icon="pi pi-save" label="บันทึก" [disabled]="!dirty()" [loading]="saving()" (click)="save()"></button>
                        }
                    </div>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mt-4">
                    <label class="field col-span-2">โครงการ
                        <select class="native-select w-full" [disabled]="!canEdit()" (change)="setProject($any($event.target).value)">
                            <option value="">— ไม่ผูกโครงการ —</option>
                            @for (project of projects.value(); track project.code) {
                                <option [value]="project.code" [selected]="project.code === est.projectCode">{{ project.code }} · {{ project.name }}</option>
                            }
                        </select>
                    </label>
                    <label class="field col-span-2">สถานที่ก่อสร้าง
                        <input pInputText class="w-full" maxlength="300" [disabled]="!canEdit()" [ngModel]="est.location ?? ''" (ngModelChange)="setField('location', $event)" />
                    </label>
                    <label class="field col-span-2">เจ้าของโครงการ
                        <input pInputText class="w-full" maxlength="200" [disabled]="!canEdit()" [ngModel]="est.ownerName ?? ''" (ngModelChange)="setField('ownerName', $event)" />
                    </label>
                    <label class="field">ผู้เสนอราคา
                        <input pInputText class="w-full" maxlength="200" [disabled]="!canEdit()" [ngModel]="est.estimator ?? ''" (ngModelChange)="setField('estimator', $event)" />
                    </label>
                    <label class="field">วันที่
                        <input pInputText type="date" class="w-full" [disabled]="!canEdit()" [ngModel]="est.estimateDate ?? ''" (ngModelChange)="setField('estimateDate', $event || undefined)" />
                    </label>
                </div>
            </section>

            <!-- แท็บหมวดงาน -->
            <div class="flex items-end gap-1 overflow-x-auto" role="tablist" aria-label="หมวดงาน">
                @for (category of est.categories; track category.id; let c = $index) {
                    <button type="button" role="tab" class="sheet-tab" [class.sheet-active]="tab() === category.id" [attr.aria-selected]="tab() === category.id" [style.--tab-color]="color(c)" (click)="tab.set(category.id)">
                        <span class="sheet-dot"></span>{{ category.name || 'หมวดใหม่' }}
                        @if (category.excluded) {
                            <i class="pi pi-eye-slash text-xs" title="ไม่รวมในสรุป"></i>
                        }
                    </button>
                }
                @if (canEdit()) {
                    <button type="button" class="sheet-tab" aria-label="เพิ่มหมวดงาน" (click)="addCategory()"><i class="pi pi-plus text-xs"></i></button>
                }
                @if (estimate()?.source) {
                    <button type="button" role="tab" class="sheet-tab ml-auto" [class.sheet-active]="tab() === 'model'" [attr.aria-selected]="tab() === 'model'" [style.--tab-color]="'#0f766e'" (click)="tab.set('model')"><i class="pi pi-box text-xs"></i>จากโมเดล IFC</button>
                }
                <button type="button" role="tab" class="sheet-tab" [class.ml-auto]="!estimate()?.source" [class.sheet-active]="tab() === 'summary'" [attr.aria-selected]="tab() === 'summary'" [style.--tab-color]="'#dc2626'" (click)="tab.set('summary')"><span class="sheet-dot"></span>สรุปราคางาน</button>
                <button type="button" role="tab" class="sheet-tab" [class.sheet-active]="tab() === 'statement'" [attr.aria-selected]="tab() === 'statement'" title="เอกสารชี้แจงรายละเอียดค่าดำเนินการ (แนบท้าย BOQ)" [style.--tab-color]="'#7c3aed'" (click)="tab.set('statement')"><i class="pi pi-file-edit text-xs"></i>คำชี้แจง</button>
            </div>

            @if (activeCategory(); as category) {
                <section class="card mt-0 rounded-tl-none" [attr.aria-label]="category.name">
                    <div class="flex flex-wrap items-center gap-3 mb-4">
                        <input class="category-input flex-1 min-w-60" aria-label="ชื่อหมวดงาน" maxlength="200" placeholder="ชื่อหมวดงาน" [disabled]="!canEdit()" [ngModel]="category.name" (ngModelChange)="updateCategory(category.id, { name: $event })" />
                        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" [disabled]="!canEdit()" [checked]="!category.excluded" (change)="updateCategory(category.id, { excluded: !$any($event.target).checked })" />รวมในสรุปราคา</label>
                        @if (canEdit()) {
                            <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-left" aria-label="ย้ายหมวดไปทางซ้าย" [disabled]="categoryIndex() === 0" (click)="moveCategory(-1)"></button>
                            <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-right" aria-label="ย้ายหมวดไปทางขวา" [disabled]="categoryIndex() === est.categories.length - 1" (click)="moveCategory(1)"></button>
                            <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-trash" label="ลบหมวด" (click)="confirmDeleteCategory(category)"></button>
                        }
                    </div>

                    <div class="overflow-x-auto">
                        <table class="boq" [attr.aria-label]="'รายการ ' + category.name">
                            <thead>
                                <tr>
                                    <th rowspan="2" class="w-12">ลำดับ</th>
                                    <th rowspan="2" class="min-w-80">รายการ</th>
                                    <th rowspan="2" class="w-24">หน่วย</th>
                                    <th rowspan="2" class="w-32">ปริมาณ</th>
                                    <th colspan="2">ราคาวัสดุ</th>
                                    <th colspan="2">ราคาค่าแรง</th>
                                    <th rowspan="2" class="w-32">รวมราคา</th>
                                    @if (canEdit()) {
                                        <th rowspan="2" class="w-36"><span class="sr-only">จัดการ</span></th>
                                    }
                                </tr>
                                <tr>
                                    <th class="w-28">ราคา/หน่วย</th>
                                    <th class="w-32">ราคารวม</th>
                                    <th class="w-28">ราคา/หน่วย</th>
                                    <th class="w-32">ราคารวม</th>
                                </tr>
                            </thead>
                            @for (group of category.groups; track group.id; let g = $index) {
                                <tbody>
                                    <tr class="group-row">
                                        <td class="text-center font-semibold">{{ g + 1 }}</td>
                                        <td colspan="7">
                                            <input class="group-input" aria-label="ชื่อกลุ่มงาน" maxlength="200" placeholder="ชื่อกลุ่มงาน เช่น ฐานราก-ต่อม่อ" [disabled]="!canEdit()" [ngModel]="group.title" (ngModelChange)="updateGroup(category.id, group.id, { title: $event })" />
                                        </td>
                                        <td class="num font-semibold">{{ groupSum(group) | number: '1.2-2' }}</td>
                                        @if (canEdit()) {
                                            <td class="whitespace-nowrap">
                                                <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-up" aria-label="เลื่อนกลุ่มขึ้น" [disabled]="g === 0" (click)="moveGroup(category.id, g, -1)"></button>
                                                <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-down" aria-label="เลื่อนกลุ่มลง" [disabled]="g === category.groups.length - 1" (click)="moveGroup(category.id, g, 1)"></button>
                                                <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-trash" aria-label="ลบกลุ่ม" (click)="confirmDeleteGroup(category.id, group)"></button>
                                            </td>
                                        }
                                    </tr>
                                    @for (item of group.items; track item.id; let i = $index) {
                                        <tr [class.heading-row]="item.kind === 'heading'">
                                            <td></td>
                                            <td [class.pl-6]="item.indent">
                                                <input class="cell" [class.font-semibold]="item.kind === 'heading'" maxlength="300" [placeholder]="item.kind === 'heading' ? 'หัวข้อย่อย เช่น งานเหล็กเสริมคอนกรีต' : 'รายการ'" [attr.aria-label]="'รายการ ' + (i + 1)" [disabled]="!canEdit()" [value]="(item.indent ? '- ' : '') + item.description" (change)="setDescription(category.id, group.id, item.id, $any($event.target).value)" />
                                            </td>
                                            @if (item.kind === 'item') {
                                                <td><input class="cell text-center" list="boq-units" maxlength="30" [attr.aria-label]="'หน่วย ' + item.description" [disabled]="!canEdit()" [value]="item.unit ?? ''" (change)="updateItem(category.id, group.id, item.id, { unit: $any($event.target).value.trim() || undefined })" /></td>
                                                <td>
                                                    <div class="flex items-center gap-1">
                                                        <input class="cell num" type="number" min="0" step="any" [attr.aria-label]="'ปริมาณ ' + item.description" [readonly]="!!item.takeoff?.length" [disabled]="!canEdit()" [value]="item.quantity" (input)="setNumber(category.id, group.id, item.id, 'quantity', $any($event.target).value)" [title]="item.takeoff?.length ? 'ปริมาณจากการถอด ' + item.takeoff!.length + ' บรรทัด' : ''" />
                                                        <button type="button" class="takeoff-btn" [class.takeoff-on]="!!item.takeoff?.length" [attr.aria-label]="'ถอดปริมาณ ' + item.description" [title]="item.takeoff?.length ? 'ถอดปริมาณ ' + item.takeoff!.length + ' บรรทัด' : 'ถอดปริมาณ'" (click)="openTakeoff(category.id, group.id, item)"><i class="pi pi-calculator"></i></button>
                                                    </div>
                                                </td>
                                                <td><input class="cell num" type="number" min="0" step="any" [attr.aria-label]="'ราคาวัสดุต่อหน่วย ' + item.description" [disabled]="!canEdit()" [value]="item.materialPrice" (input)="setNumber(category.id, group.id, item.id, 'materialPrice', $any($event.target).value)" /></td>
                                                <td class="num">{{ material(item) | number: '1.2-2' }}</td>
                                                <td><input class="cell num" type="number" min="0" step="any" [attr.aria-label]="'ค่าแรงต่อหน่วย ' + item.description" [disabled]="!canEdit()" [value]="item.laborPrice" (input)="setNumber(category.id, group.id, item.id, 'laborPrice', $any($event.target).value)" /></td>
                                                <td class="num">{{ labor(item) | number: '1.2-2' }}</td>
                                                <td class="num font-semibold">{{ material(item) + labor(item) | number: '1.2-2' }}</td>
                                            } @else {
                                                <td colspan="7"></td>
                                            }
                                            @if (canEdit()) {
                                                <td class="whitespace-nowrap">
                                                    <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-up" aria-label="เลื่อนขึ้น" [disabled]="i === 0" (click)="moveItem(category.id, group.id, i, -1)"></button>
                                                    <button pButton type="button" [text]="true" size="small" icon="pi pi-arrow-down" aria-label="เลื่อนลง" [disabled]="i === group.items.length - 1" (click)="moveItem(category.id, group.id, i, 1)"></button>
                                                    @if (item.kind === 'item') {
                                                        <button pButton type="button" [text]="true" size="small" [icon]="item.indent ? 'pi pi-angle-double-left' : 'pi pi-angle-double-right'" [attr.aria-label]="item.indent ? 'ยกเลิกรายการย่อย' : 'ทำเป็นรายการย่อย'" (click)="updateItem(category.id, group.id, item.id, { indent: !item.indent || undefined })"></button>
                                                    }
                                                    <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-times" aria-label="ลบรายการ" (click)="removeItem(category.id, group.id, item.id)"></button>
                                                </td>
                                            }
                                        </tr>
                                    }
                                    @if (canEdit()) {
                                        <tr class="add-row">
                                            <td></td>
                                            <td colspan="9">
                                                <button type="button" class="link-btn" (click)="addItem(category.id, group.id, 'item')"><i class="pi pi-plus"></i>รายการ</button>
                                                <button type="button" class="link-btn" (click)="openRates(category.id, group.id)"><i class="pi pi-book"></i>เลือกจากคลังราคา</button>
                                                <button type="button" class="link-btn" (click)="addItem(category.id, group.id, 'heading')"><i class="pi pi-bars"></i>หัวข้อย่อย</button>
                                            </td>
                                        </tr>
                                    }
                                </tbody>
                            }
                            <tfoot>
                                <tr>
                                    <td></td>
                                    <td class="text-center">รวมราคา{{ category.name }}</td>
                                    <td></td>
                                    <td></td>
                                    <td></td>
                                    <td class="num">{{ categoryTotal(category.id)?.material | number: '1.2-2' }}</td>
                                    <td></td>
                                    <td class="num">{{ categoryTotal(category.id)?.labor | number: '1.2-2' }}</td>
                                    <td class="num">{{ categoryTotal(category.id)?.total | number: '1.2-2' }}</td>
                                    @if (canEdit()) {
                                        <td></td>
                                    }
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    @if (canEdit()) {
                        <button pButton type="button" [outlined]="true" size="small" icon="pi pi-plus" label="เพิ่มกลุ่มงาน" class="mt-3" (click)="addGroup(category.id)"></button>
                    }
                    <datalist id="boq-units">
                        @for (unit of units; track unit) {
                            <option [value]="unit"></option>
                        }
                    </datalist>
                </section>
            } @else if (tab() === 'model' && estimate()?.source; as source) {
                <!-- ที่มาจากโมเดล IFC: รายการวัสดุ ชิ้นงาน คำเตือน -->
                <section class="card mt-0" aria-label="ถอดจากโมเดล IFC">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h2 class="text-lg font-semibold m-0"><i class="pi pi-box mr-2 text-primary"></i>{{ estimate()!.source!.fileName }}</h2>
                            <p class="text-sm text-muted-color mt-1 mb-0">
                                {{ estimate()!.source!.modelTitle }} · {{ estimate()!.source!.application }} · {{ estimate()!.source!.schema }} · {{ estimate()!.source!.elements }} ชิ้นงาน · อ่าน {{ estimate()!.source!.seconds }} วินาที · {{ estimate()!.source!.analyzedAt | thaiDate }}
                            </p>
                        </div>
                        <a pButton [routerLink]="['/projects', estimate()!.source!.projectCode]" [queryParams]="{ tab: 'plan' }" [outlined]="true" size="small" icon="pi pi-eye" label="ดูโมเดล 3 มิติ"></a>
                    </div>

                    @if (estimate()!.source!.warnings.length) {
                        <ul class="mt-4 mb-0 pl-0 list-none flex flex-col gap-2">
                            @for (warning of estimate()!.source!.warnings; track $index) {
                                <li class="rounded-lg px-3 py-2 text-sm bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100"><i class="pi pi-exclamation-triangle mr-2"></i>{{ warning }}</li>
                            }
                        </ul>
                    }

                    <div class="flex flex-wrap items-center justify-between gap-3 mt-6 mb-2">
                        <h3 class="text-base font-semibold m-0">รายการวัสดุ (เผื่อเสียแล้ว)</h3>
                        <div class="flex items-center gap-2">
                            @if (estimate()!.source!.appliedAt) {
                                <span class="text-xs text-muted-color">ส่งเข้าโครงการแล้ว {{ estimate()!.source!.appliedAt | thaiDate }}</span>
                            }
                            @if (canApplyMaterials()) {
                                <button pButton type="button" size="small" icon="pi pi-send" [label]="'ส่งเข้า BOQ วัสดุของ ' + estimate()!.source!.projectCode" [loading]="applying()" (click)="confirmApplyMaterials()"></button>
                            }
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="boq" style="min-width: 48rem">
                            <thead>
                                <tr>
                                    <th class="w-28">รหัสวัสดุ</th>
                                    <th>วัสดุ</th>
                                    <th class="w-28">จำนวน</th>
                                    <th class="w-20">หน่วย</th>
                                    <th>ที่มาของจำนวน</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (material of estimate()!.source!.materials; track $index) {
                                    <tr>
                                        <td class="text-muted-color">{{ material.materialCode ?? '-' }}</td>
                                        <td>{{ material.name }}</td>
                                        <td class="num font-semibold">{{ material.quantity | number: '1.0-2' }}</td>
                                        <td class="text-center">{{ material.unit }}</td>
                                        <td class="text-xs text-muted-color">{{ material.basis }}</td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>

                    <details class="mt-6">
                        <summary class="text-base font-semibold cursor-pointer">ชิ้นงานในโมเดล ({{ estimate()!.source!.components.length }} กลุ่ม) — ตรวจที่มาของตัวเลข</summary>
                        <div class="overflow-x-auto mt-2">
                            <table class="boq" style="min-width: 60rem">
                                <thead>
                                    <tr>
                                        <th>ชั้น</th>
                                        <th>ชิ้นงาน</th>
                                        <th>วัสดุในโมเดล</th>
                                        <th class="w-20">จำนวน</th>
                                        <th class="w-28">ปริมาตร (ลบ.ม.)</th>
                                        <th class="w-28">พื้นที่ (ตร.ม.)</th>
                                        <th class="w-28">ความยาว (ม.)</th>
                                        <th class="w-28">น้ำหนัก (กก.)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    @for (component of estimate()!.source!.components; track $index) {
                                        <tr>
                                            <td class="whitespace-nowrap">{{ component.storey }}</td>
                                            <td>{{ component.label }}</td>
                                            <td class="text-xs text-muted-color">{{ component.material ?? '-' }}</td>
                                            <td class="num">{{ component.count }}</td>
                                            <td class="num">{{ component.volume ? (component.volume | number: '1.3-3') : '-' }}</td>
                                            <td class="num">{{ component.area ? (component.area | number: '1.2-2') : '-' }}</td>
                                            <td class="num">{{ component.length ? (component.length | number: '1.2-2') : '-' }}</td>
                                            <td class="num">{{ component.weight ? (component.weight | number: '1.1-1') : '-' }}</td>
                                        </tr>
                                    }
                                </tbody>
                            </table>
                        </div>
                    </details>
                </section>
            } @else if (tab() === 'statement' && est.statement) {
                <!-- เอกสารชี้แจงค่าดำเนินการ (แนบท้าย BOQ) -->
                <section class="card mt-0 rounded-tr-none" aria-label="เอกสารชี้แจงรายละเอียดค่าดำเนินการ">
                    <app-statement-editor [statement]="est.statement" [readonly]="!canEdit()" (changed)="setField('statement', $event)" />
                </section>
            } @else {
                <!-- สรุปราคางาน -->
                <section class="card mt-0 rounded-tr-none" aria-label="สรุปราคางาน">
                    <div class="overflow-x-auto">
                        <table class="boq summary">
                            <thead>
                                <tr>
                                    <th class="w-12">ลำดับ</th>
                                    <th>สรุปราคาค่าก่อสร้าง</th>
                                    <th class="w-36">ราคาวัสดุ</th>
                                    <th class="w-36">ราคาค่าแรง</th>
                                    <th class="w-40">รวมราคา</th>
                                    <th class="w-24">สัดส่วน</th>
                                    <th class="w-28">รวมในสรุป</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (category of est.categories; track category.id; let c = $index) {
                                    <tr [class.opacity-50]="category.excluded">
                                        <td class="text-center">{{ c + 1 }}</td>
                                        <td><button type="button" class="link-btn text-left" (click)="tab.set(category.id)">{{ category.name }}</button></td>
                                        <td class="num">{{ categoryTotal(category.id)?.material | number: '1.2-2' }}</td>
                                        <td class="num">{{ categoryTotal(category.id)?.labor | number: '1.2-2' }}</td>
                                        <td class="num font-semibold">{{ categoryTotal(category.id)?.total | number: '1.2-2' }}</td>
                                        <td>
                                            @if (!category.excluded && totals().subtotal) {
                                                <div class="flex items-center gap-2">
                                                    <div class="flex-1 h-1.5 rounded-full bg-emphasis overflow-hidden"><div class="h-full bg-primary" [style.width.%]="share(category.id)"></div></div>
                                                    <span class="text-xs tabular-nums">{{ share(category.id) | number: '1.1-1' }}%</span>
                                                </div>
                                            }
                                        </td>
                                        <td class="text-center"><input type="checkbox" [attr.aria-label]="'รวม ' + category.name + ' ในสรุป'" [disabled]="!canEdit()" [checked]="!category.excluded" (change)="updateCategory(category.id, { excluded: !$any($event.target).checked })" /></td>
                                    </tr>
                                }
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td></td>
                                    <td class="text-center">รวม {{ includedCount() }} รายการ</td>
                                    <td class="num">{{ totals().material | number: '1.2-2' }}</td>
                                    <td class="num">{{ totals().labor | number: '1.2-2' }}</td>
                                    <td class="num">{{ totals().subtotal | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-center">
                                        <span class="inline-flex items-center gap-1">
                                            ค่าดำเนินการ
                                            <input class="cell num" style="width: 4.5rem" type="number" min="0" max="100" step="any" aria-label="ค่าดำเนินการ (%)" [disabled]="!canEdit()" [value]="est.overheadPercent" (input)="setField('overheadPercent', +$any($event.target).value || 0)" />%
                                        </span>
                                    </td>
                                    <td colspan="2"></td>
                                    <td class="num">{{ totals().overhead | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-center">
                                        <span class="inline-flex items-center gap-1">
                                            กำไร
                                            <input class="cell num" style="width: 4.5rem" type="number" min="0" max="100" step="any" aria-label="กำไร (%)" [disabled]="!canEdit()" [value]="est.profitPercent" (input)="setField('profitPercent', +$any($event.target).value || 0)" />%
                                        </span>
                                    </td>
                                    <td colspan="2"></td>
                                    <td class="num">{{ totals().profit | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-center">รวมก่อนภาษีมูลค่าเพิ่ม</td>
                                    <td colspan="2"></td>
                                    <td class="num">{{ totals().beforeVat | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-center">
                                        <span class="inline-flex items-center gap-1">
                                            ภาษีมูลค่าเพิ่ม
                                            <input class="cell num" style="width: 4.5rem" type="number" min="0" max="100" step="any" aria-label="ภาษีมูลค่าเพิ่ม (%)" [disabled]="!canEdit()" [value]="est.vatPercent" (input)="setField('vatPercent', +$any($event.target).value || 0)" />%
                                        </span>
                                    </td>
                                    <td colspan="2"></td>
                                    <td class="num">{{ totals().vat | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr class="grand">
                                    <td></td>
                                    <td class="text-center">รวมเป็นเงินทั้งสิ้น</td>
                                    <td colspan="2"></td>
                                    <td class="num">{{ totals().grandTotal | number: '1.2-2' }}</td>
                                    <td colspan="2"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-right">พื้นที่ทั้งหมด</td>
                                    <td><input class="cell num" type="number" min="0" step="any" aria-label="พื้นที่ทั้งหมด (ตร.ม.)" [disabled]="!canEdit()" [value]="est.area ?? ''" (input)="setField('area', +$any($event.target).value || undefined)" /></td>
                                    <td>ตร.ม.</td>
                                    <td colspan="3"></td>
                                </tr>
                                <tr>
                                    <td></td>
                                    <td class="text-right">ราคาเฉลี่ย</td>
                                    <td class="num">{{ totals().pricePerSqm !== null && totals().pricePerSqm !== undefined ? (totals().pricePerSqm | number: '1.2-2') : '-' }}</td>
                                    <td>บาท / ตร.ม.</td>
                                    <td colspan="3"></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                        <div>
                            <h2 class="text-base font-semibold m-0 mb-2">หมายเหตุ (แสดงท้ายสรุป)</h2>
                            @for (note of est.notes; track $index; let n = $index) {
                                <div class="flex gap-2 mb-2">
                                    <input pInputText class="flex-1" maxlength="300" [attr.aria-label]="'หมายเหตุ ' + (n + 1)" [disabled]="!canEdit()" [value]="note" (change)="setNote(n, $any($event.target).value)" />
                                    @if (canEdit()) {
                                        <button pButton type="button" [text]="true" severity="secondary" icon="pi pi-times" aria-label="ลบหมายเหตุ" (click)="removeNote(n)"></button>
                                    }
                                </div>
                            }
                            @if (canEdit()) {
                                <button pButton type="button" [text]="true" size="small" icon="pi pi-plus" label="เพิ่มหมายเหตุ เช่น ไม่รวมปั๊มน้ำ" (click)="addNote()"></button>
                            }
                        </div>
                        <div>
                            <h2 class="text-base font-semibold m-0 mb-2">สถานะ</h2>
                            <div class="flex gap-4">
                                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="estimate-status" [disabled]="!canEdit()" [checked]="est.status === 'draft'" (change)="setField('status', 'draft')" />ร่าง</label>
                                <label class="flex items-center gap-2 cursor-pointer"><input type="radio" name="estimate-status" [disabled]="!canEdit()" [checked]="est.status === 'final'" (change)="setField('status', 'final')" />ส่งลูกค้าแล้ว</label>
                            </div>
                        </div>
                    </div>
                </section>
            }
        } @else {
            <div class="card text-center text-muted-color py-12"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด BOQ...</div>
        }

        @if (takeoffTarget(); as target) {
            <app-takeoff-dialog [item]="target.item" [readonly]="!canEdit()" (applied)="applyTakeoff($event)" (closed)="takeoffTarget.set(null)" />
        }

        @if (rateTarget()) {
            <p-dialog [visible]="true" (visibleChange)="!$event && rateTarget.set(null)" [modal]="true" [draggable]="false" [style]="{ width: 'min(56rem, 96vw)' }" header="เลือกจากคลังราคาต่อหน่วย">
                <div class="flex flex-wrap gap-2 mb-3">
                    <input pInputText type="search" class="flex-1 min-w-60" placeholder="ค้นหารายการ เช่น คอนกรีต ไม้แบบ DB 12" aria-label="ค้นหาในคลังราคา" [ngModel]="rateQuery()" (ngModelChange)="rateQuery.set($event)" />
                    <select class="native-select" aria-label="หมวดงาน" (change)="rateCategory.set($any($event.target).value)">
                        <option value="">ทุกหมวด</option>
                        @for (name of rateCategories(); track name) {
                            <option [value]="name" [selected]="name === rateCategory()">{{ name }}</option>
                        }
                    </select>
                </div>
                <div class="overflow-y-auto" style="max-height: 55vh">
                    <table class="w-full text-sm border-collapse">
                        <thead class="sticky top-0 bg-[var(--p-content-background)]">
                            <tr class="text-left text-muted-color border-b border-surface">
                                <th class="py-2 pr-2 font-semibold">รายการ</th>
                                <th class="py-2 pr-2 font-semibold">หน่วย</th>
                                <th class="py-2 pr-2 font-semibold text-right">วัสดุ/หน่วย</th>
                                <th class="py-2 pr-2 font-semibold text-right">ค่าแรง/หน่วย</th>
                                <th class="w-24"></th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (rate of filteredRates(); track rate.description + rate.unit) {
                                <tr class="border-b border-surface">
                                    <td class="py-1.5 pr-2">{{ rate.description }}<div class="text-xs text-muted-color">{{ rate.category }}{{ rate.group ? ' · ' + rate.group : '' }}</div></td>
                                    <td class="py-1.5 pr-2">{{ rate.unit }}</td>
                                    <td class="py-1.5 pr-2 text-right tabular-nums">{{ rate.materialPrice | number: '1.2-2' }}</td>
                                    <td class="py-1.5 pr-2 text-right tabular-nums">{{ rate.laborPrice | number: '1.2-2' }}</td>
                                    <td class="py-1.5 text-right"><button pButton type="button" size="small" [outlined]="true" icon="pi pi-plus" label="เพิ่ม" (click)="addRate(rate)"></button></td>
                                </tr>
                            } @empty {
                                <tr>
                                    <td colspan="5" class="py-6 text-center text-muted-color">{{ ratesResource.isLoading() ? 'กำลังโหลด...' : 'ไม่พบรายการ' }}</td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </div>
                <ng-template #footer>
                    @if (ratesAdded()) {
                        <span class="text-sm text-muted-color mr-auto">เพิ่มแล้ว {{ ratesAdded() }} รายการ (ปริมาณเริ่มที่ 0)</span>
                    }
                    <button pButton type="button" label="เสร็จ" (click)="rateTarget.set(null)"></button>
                </ng-template>
            </p-dialog>
        }
    `,
    styles: `
        .title-input {
            width: 100%;
            font-size: 1.5rem;
            font-weight: 700;
            border: 1px solid transparent;
            border-radius: 6px;
            padding: 0.15rem 0.4rem;
            margin-left: -0.4rem;
            background: transparent;
            color: var(--p-text-color);
        }
        .title-input:hover:not(:disabled),
        .title-input:focus {
            border-color: var(--p-content-border-color);
            outline: none;
        }
        .category-input {
            font-size: 1.1rem;
            font-weight: 600;
            border: 1px solid var(--p-content-border-color);
            border-radius: 6px;
            padding: 0.4rem 0.6rem;
            background: transparent;
            color: var(--p-text-color);
        }
        .field {
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--p-text-muted-color);
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }
        .native-select {
            padding: 0.5rem 0.6rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
            font-weight: 400;
        }
        .sheet-tab {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.55rem 0.9rem;
            border: 1px solid var(--p-content-border-color);
            border-bottom: 0;
            border-radius: 8px 8px 0 0;
            background: var(--p-content-hover-background, transparent);
            color: var(--p-text-muted-color);
            font: inherit;
            font-size: 0.875rem;
            white-space: nowrap;
            cursor: pointer;
        }
        .sheet-dot {
            width: 0.6rem;
            height: 0.6rem;
            border-radius: 999px;
            background: var(--tab-color, var(--p-primary-color));
        }
        .sheet-active {
            background: var(--p-content-background);
            color: var(--p-text-color);
            font-weight: 600;
            box-shadow: inset 0 3px 0 var(--tab-color, var(--p-primary-color));
        }
        table.boq {
            width: 100%;
            min-width: 72rem;
            border-collapse: collapse;
            font-size: 0.875rem;
        }
        .boq th,
        .boq td {
            border: 1px solid var(--p-content-border-color);
            padding: 0.2rem 0.35rem;
        }
        .boq thead th {
            background: var(--p-content-hover-background, #f1f5f9);
            font-weight: 600;
            text-align: center;
        }
        .boq .group-row td {
            background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
        }
        .boq .heading-row td {
            background: color-mix(in srgb, var(--p-text-color) 3%, transparent);
        }
        .boq tfoot td {
            font-weight: 700;
            background: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
        }
        .boq tfoot .grand td {
            font-size: 1rem;
            background: color-mix(in srgb, #16a34a 18%, transparent);
        }
        .boq .num {
            text-align: right;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
        .cell,
        .group-input {
            width: 100%;
            border: 1px solid transparent;
            border-radius: 4px;
            padding: 0.25rem 0.35rem;
            background: transparent;
            color: var(--p-text-color);
            font: inherit;
        }
        .group-input {
            font-weight: 700;
        }
        .cell:hover:not(:disabled),
        .group-input:hover:not(:disabled),
        .cell:focus,
        .group-input:focus {
            border-color: var(--p-primary-color);
            background: var(--p-content-background);
            outline: none;
        }
        .cell[readonly] {
            color: var(--p-primary-color);
            font-weight: 600;
        }
        .cell.num {
            text-align: right;
        }
        .takeoff-btn {
            border: 1px solid var(--p-content-border-color);
            border-radius: 4px;
            background: transparent;
            color: var(--p-text-muted-color);
            padding: 0.2rem 0.35rem;
            cursor: pointer;
        }
        .takeoff-on {
            border-color: var(--p-primary-color);
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
        }
        .add-row td {
            border-top-style: dashed;
        }
        .link-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            margin-right: 1rem;
            border: 0;
            background: transparent;
            color: var(--p-primary-color);
            font: inherit;
            font-size: 0.8rem;
            cursor: pointer;
            padding: 0.2rem 0;
        }
    `
})
export class EstimateEditor {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly service = inject(EstimateService);
    private readonly projectService = inject(ProjectService);
    private readonly auth = inject(AuthService);
    private readonly messages = inject(MessageService);
    private readonly confirmation = inject(ConfirmationService);

    private readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') ?? '')), { initialValue: '' });
    readonly resource = apiResource({ params: () => this.id() || undefined, stream: ({ params: id }) => this.service.get(id) });
    readonly projects = apiResource({ stream: () => this.projectService.list(), defaultValue: [] });
    readonly estimate = computed(() => this.resource.value());
    readonly loadError = computed(() => (this.resource.error() ? problemMessage(this.resource.error(), 'ไม่พบ BOQ') : ''));

    /** ฉบับที่แก้อยู่ (เริ่มจากที่โหลด/บันทึกล่าสุด) */
    readonly draft = linkedSignal(() => toDraft(this.estimate()));
    private readonly savedJson = computed(() => JSON.stringify(toDraft(this.estimate())));
    readonly dirty = computed(() => !!this.draft() && JSON.stringify(this.draft()) !== this.savedJson());
    readonly totals = computed(() => (this.draft() ? computeTotals(this.draft()!) : { categories: [], material: 0, labor: 0, subtotal: 0, overhead: 0, profit: 0, beforeVat: 0, vat: 0, grandTotal: 0, pricePerSqm: null }));
    readonly canEdit = computed(() => this.auth.can('estimate.manage'));

    readonly units = UNITS;
    readonly material = itemMaterial;
    readonly labor = itemLabor;
    readonly groupSum = groupTotal;

    /** แท็บเริ่มต้น: ?tab=model (หลังถอดจากโมเดล) หรือหมวดแรก */
    private readonly initialTab = this.route.snapshot.queryParamMap.get('tab');
    readonly tab = linkedSignal<string>(() => (this.initialTab === 'model' && this.estimate()?.source ? 'model' : (this.draft()?.categories[0]?.id ?? 'summary')));
    readonly activeCategory = computed(() => this.draft()?.categories.find((category) => category.id === this.tab()));
    readonly categoryIndex = computed(() => this.draft()?.categories.findIndex((category) => category.id === this.tab()) ?? -1);
    readonly includedCount = computed(() => this.draft()?.categories.filter((category) => !category.excluded).length ?? 0);
    readonly saving = signal(false);
    readonly copying = signal(false);
    readonly exporting = signal(false);

    @HostListener('window:beforeunload', ['$event'])
    warnUnsaved(event: BeforeUnloadEvent) {
        if (this.dirty()) event.preventDefault();
    }

    color(index: number) {
        return TAB_COLORS[index % TAB_COLORS.length];
    }

    categoryTotal(id: string) {
        return this.totals().categories.find((item) => item.id === id);
    }

    share(id: string) {
        const subtotal = this.totals().subtotal;
        return subtotal ? ((this.categoryTotal(id)?.total ?? 0) / subtotal) * 100 : 0;
    }

    // ---------- แก้ข้อมูล (สำเนาใหม่ทุกครั้ง) ----------

    private mutate(change: (draft: EstimateDraft) => void) {
        this.draft.update((draft) => {
            if (!draft) return draft;
            const next = structuredClone(draft);
            change(next);
            return next;
        });
    }

    private findGroup(draft: EstimateDraft, categoryId: string, groupId: string) {
        return draft.categories.find((category) => category.id === categoryId)?.groups.find((group) => group.id === groupId);
    }

    setField<K extends keyof EstimateDraft>(key: K, value: EstimateDraft[K]) {
        this.mutate((draft) => {
            if (value === undefined || value === '') delete draft[key];
            else draft[key] = value;
        });
    }

    setProject(code: string) {
        const project = this.projects.value().find((item) => item.code === code);
        this.mutate((draft) => {
            if (!project) return void delete draft.projectCode;
            draft.projectCode = project.code;
            // เติมสถานที่และเจ้าของจากโครงการ ถ้ายังว่าง
            if (!draft.location && project.location) draft.location = project.location;
            if (!draft.ownerName) draft.ownerName = project.customerName;
        });
    }

    updateCategory(id: string, change: Partial<EstimateCategory>) {
        this.mutate((draft) => {
            const category = draft.categories.find((item) => item.id === id);
            if (!category) return;
            Object.assign(category, change);
            if (!category.excluded) delete category.excluded;
        });
    }

    addCategory() {
        const id = newId('c');
        this.mutate((draft) => draft.categories.push({ id, name: 'หมวดงานใหม่', groups: [{ id: newId('g'), title: '', items: [] }] }));
        this.tab.set(id);
    }

    moveCategory(step: number) {
        const index = this.categoryIndex();
        this.mutate((draft) => {
            const [category] = draft.categories.splice(index, 1);
            draft.categories.splice(index + step, 0, category!);
        });
    }

    confirmDeleteCategory(category: EstimateCategory) {
        this.confirmation.confirm({
            header: 'ลบหมวดงาน',
            message: `ลบ "${category.name}" และรายการทั้งหมดในหมวดนี้? (ยังกู้คืนได้ถ้ายังไม่กดบันทึก)`,
            acceptLabel: 'ลบ',
            rejectLabel: 'ยกเลิก',
            acceptButtonStyleClass: 'p-button-danger',
            accept: () => {
                this.mutate((draft) => (draft.categories = draft.categories.filter((item) => item.id !== category.id)));
                this.tab.set(this.draft()?.categories[0]?.id ?? 'summary');
            }
        });
    }

    addGroup(categoryId: string) {
        this.mutate((draft) => draft.categories.find((item) => item.id === categoryId)?.groups.push({ id: newId('g'), title: '', items: [] }));
    }

    updateGroup(categoryId: string, groupId: string, change: Partial<EstimateGroup>) {
        this.mutate((draft) => Object.assign(this.findGroup(draft, categoryId, groupId) ?? {}, change));
    }

    moveGroup(categoryId: string, index: number, step: number) {
        this.mutate((draft) => {
            const groups = draft.categories.find((item) => item.id === categoryId)!.groups;
            const [group] = groups.splice(index, 1);
            groups.splice(index + step, 0, group!);
        });
    }

    confirmDeleteGroup(categoryId: string, group: EstimateGroup) {
        const remove = () => this.mutate((draft) => {
            const category = draft.categories.find((item) => item.id === categoryId)!;
            category.groups = category.groups.filter((item) => item.id !== group.id);
        });
        if (!group.items.length) return remove();
        this.confirmation.confirm({ header: 'ลบกลุ่มงาน', message: `ลบ "${group.title || 'กลุ่มงาน'}" และ ${group.items.length} รายการ?`, acceptLabel: 'ลบ', rejectLabel: 'ยกเลิก', acceptButtonStyleClass: 'p-button-danger', accept: remove });
    }

    addItem(categoryId: string, groupId: string, kind: 'item' | 'heading') {
        this.mutate((draft) => this.findGroup(draft, categoryId, groupId)?.items.push({ id: newId('i'), kind, description: '', quantity: 0, materialPrice: 0, laborPrice: 0 }));
    }

    updateItem(categoryId: string, groupId: string, itemId: string, change: Partial<EstimateItem>) {
        this.mutate((draft) => {
            const item = this.findGroup(draft, categoryId, groupId)?.items.find((entry) => entry.id === itemId);
            if (!item) return;
            Object.assign(item, change);
            for (const key of Object.keys(change) as Array<keyof EstimateItem>) if (change[key] === undefined) delete item[key];
        });
    }

    /** "- " นำหน้า = รายการย่อย (แบบในไฟล์ Excel) */
    setDescription(categoryId: string, groupId: string, itemId: string, value: string) {
        const indent = /^\s*-\s+/.test(value);
        this.updateItem(categoryId, groupId, itemId, { description: value.replace(/^\s*-\s+/, '').trim(), ...(indent ? { indent: true } : {}) });
    }

    setNumber(categoryId: string, groupId: string, itemId: string, field: 'quantity' | 'materialPrice' | 'laborPrice', raw: string) {
        const value = Number(raw);
        this.updateItem(categoryId, groupId, itemId, { [field]: Number.isFinite(value) && value > 0 ? value : 0 });
    }

    moveItem(categoryId: string, groupId: string, index: number, step: number) {
        this.mutate((draft) => {
            const items = this.findGroup(draft, categoryId, groupId)!.items;
            const [item] = items.splice(index, 1);
            items.splice(index + step, 0, item!);
        });
    }

    removeItem(categoryId: string, groupId: string, itemId: string) {
        this.mutate((draft) => {
            const group = this.findGroup(draft, categoryId, groupId)!;
            group.items = group.items.filter((item) => item.id !== itemId);
        });
    }

    setNote(index: number, value: string) {
        this.mutate((draft) => (draft.notes[index] = value));
    }

    addNote() {
        this.mutate((draft) => draft.notes.push(''));
    }

    removeNote(index: number) {
        this.mutate((draft) => draft.notes.splice(index, 1));
    }

    // ---------- ถอดปริมาณ ----------

    readonly takeoffTarget = signal<{ categoryId: string; groupId: string; item: EstimateItem } | null>(null);

    openTakeoff(categoryId: string, groupId: string, item: EstimateItem) {
        this.takeoffTarget.set({ categoryId, groupId, item });
    }

    applyTakeoff(result: TakeoffResult) {
        const target = this.takeoffTarget();
        if (!target) return;
        const change: Partial<EstimateItem> = result.takeoff.length ? { takeoff: result.takeoff, waste: result.waste || undefined, quantity: takeoffQuantity(result.takeoff, result.waste) } : { takeoff: undefined, waste: undefined };
        this.updateItem(target.categoryId, target.groupId, target.item.id, change);
        this.takeoffTarget.set(null);
    }

    // ---------- คลังราคา ----------

    readonly rateTarget = signal<{ categoryId: string; groupId: string } | null>(null);
    readonly ratesResource = apiResource({ params: () => (this.rateTarget() ? true : undefined), stream: () => this.service.rates(), defaultValue: [] });
    readonly rateQuery = signal('');
    readonly rateCategory = signal('');
    readonly ratesAdded = signal(0);
    readonly rateCategories = computed(() => [...new Set(this.ratesResource.value().map((rate) => rate.category))]);
    readonly filteredRates = computed(() => {
        const words = this.rateQuery().trim().toLowerCase().split(/\s+/).filter(Boolean);
        return this.ratesResource
            .value()
            .filter((rate) => !this.rateCategory() || rate.category === this.rateCategory())
            .filter((rate) => words.every((word) => `${rate.description} ${rate.group ?? ''}`.toLowerCase().includes(word)))
            .slice(0, 200);
    });

    openRates(categoryId: string, groupId: string) {
        this.ratesAdded.set(0);
        this.rateQuery.set('');
        this.rateCategory.set(this.activeCategory()?.name && this.rateCategories().includes(this.activeCategory()!.name) ? this.activeCategory()!.name : '');
        this.rateTarget.set({ categoryId, groupId });
    }

    addRate(rate: EstimateRate) {
        const target = this.rateTarget();
        if (!target) return;
        this.mutate((draft) => this.findGroup(draft, target.categoryId, target.groupId)?.items.push({ id: newId('i'), kind: 'item', description: rate.description, unit: rate.unit || undefined, quantity: 0, materialPrice: rate.materialPrice, laborPrice: rate.laborPrice }));
        this.ratesAdded.update((n) => n + 1);
    }

    // ---------- รายการวัสดุจากโมเดล → BOQ วัสดุของโครงการ ----------

    readonly canApplyMaterials = computed(() => this.auth.can('project.manage') && !!this.estimate()?.source?.materials.length);
    readonly applying = signal(false);

    confirmApplyMaterials() {
        const source = this.estimate()?.source;
        if (!source) return;
        this.confirmation.confirm({
            header: 'ส่งรายการวัสดุเข้าโครงการ',
            message: `แทนที่ BOQ วัสดุของโครงการ ${source.projectCode} ด้วย ${source.materials.length} รายการนี้? ใช้เทียบการใช้วัสดุจริงในแท็บจัดซื้อ/เช่า → วัสดุเทียบ BOQ`,
            acceptLabel: 'ส่งเข้าโครงการ',
            rejectLabel: 'ยกเลิก',
            accept: () => {
                this.applying.set(true);
                this.service.applyMaterials(this.estimate()!.id).subscribe({
                    next: (boq) => {
                        this.applying.set(false);
                        this.resource.reload();
                        this.messages.add({ severity: 'success', summary: 'ส่งรายการวัสดุเข้าโครงการแล้ว', detail: `BOQ วัสดุของ ${source.projectCode} มี ${boq.items.length} รายการ` });
                    },
                    error: (error) => {
                        this.applying.set(false);
                        this.messages.add({ severity: 'error', summary: problemMessage(error, 'ส่งไม่สำเร็จ') });
                    }
                });
            }
        });
    }

    // ---------- บันทึก / คัดลอก / ลบ ----------

    save() {
        const draft = this.draft();
        const id = this.estimate()?.id;
        if (!draft || !id) return;
        this.saving.set(true);
        this.service.save(id, draft).subscribe({
            next: (estimate) => {
                this.saving.set(false);
                this.resource.set(estimate);
                this.messages.add({ severity: 'success', summary: 'บันทึก BOQ แล้ว', detail: `รวมเป็นเงินทั้งสิ้น ฿${estimate.totals.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}` });
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                this.messages.add({ severity: 'error', summary: 'บันทึกไม่สำเร็จ', detail: problem?.detail ?? problemMessage(error, '') });
            }
        });
    }

    exportExcel() {
        const saved = this.estimate();
        if (!saved) return;
        if (this.dirty()) this.messages.add({ severity: 'warn', summary: 'ยังไม่บันทึก', detail: 'ไฟล์ Excel ใช้ฉบับที่บันทึกล่าสุด' });
        this.exporting.set(true);
        this.service.exportExcel(saved.id).subscribe({
            next: (blob) => {
                this.exporting.set(false);
                saveEstimateExcel(blob, saved);
            },
            error: (error) => {
                this.exporting.set(false);
                this.messages.add({ severity: 'error', summary: problemMessage(error, 'ส่งออก Excel ไม่สำเร็จ') });
            }
        });
    }

    duplicate() {
        const source = this.estimate();
        if (!source) return;
        if (this.dirty()) {
            this.messages.add({ severity: 'warn', summary: 'บันทึกก่อนคัดลอก', detail: 'คัดลอกจะใช้ฉบับที่บันทึกล่าสุด' });
            return;
        }
        this.copying.set(true);
        this.service.create({ title: `${source.title} (สำเนา)`, copyFrom: source.id }).subscribe({
            next: (copy) => {
                this.copying.set(false);
                this.router.navigate(['/estimates', copy.id]);
            },
            error: (error) => {
                this.copying.set(false);
                this.messages.add({ severity: 'error', summary: problemMessage(error, 'คัดลอกไม่สำเร็จ') });
            }
        });
    }

    confirmDelete() {
        const estimate = this.estimate();
        if (!estimate) return;
        this.confirmation.confirm({
            header: 'ลบ BOQ',
            message: `ลบ ${estimate.id} "${estimate.title}" ถาวร?`,
            acceptLabel: 'ลบ',
            rejectLabel: 'ยกเลิก',
            acceptButtonStyleClass: 'p-button-danger',
            accept: () =>
                this.service.remove(estimate.id).subscribe({
                    next: () => {
                        this.draft.set(null);
                        this.router.navigate(['/estimates']);
                    },
                    error: (error) => this.messages.add({ severity: 'error', summary: problemMessage(error, 'ลบไม่สำเร็จ') })
                })
        });
    }
}

