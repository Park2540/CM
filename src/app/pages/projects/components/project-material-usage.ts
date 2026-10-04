import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { AuthService } from '@/app/pages/service/auth.service';
import { MaterialUsageRow, ProcurementService, USAGE_STATUS } from '@/app/pages/service/procurement.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { BoqEditor } from './boq-editor';
import { materialKey, materialLabel } from './material-picker';

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());

interface MovementForm {
    type: 'return' | 'issue';
    text: string;
    materialCode?: string;
    name: string;
    unit: string;
    quantity: number | null;
    date: string;
    note: string;
}

/** เทียบวัสดุที่ใช้จริงกับ BOQ + ส่งของเหลือเข้าคลังหลัก / เบิกจากคลังหลัก */
@Component({
    selector: 'app-project-material-usage',
    standalone: true,
    imports: [BoqEditor, ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, NgClass, TagModule, ThaiDatePipe],
    template: `
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div class="text-sm text-muted-color max-w-2xl">
                ใช้จริง = รับเข้าหน้างาน + เบิกจากคลังหลัก − ส่งของเหลือเข้าคลังหลัก · เกณฑ์ส่วนต่าง ±{{ usage().tolerancePercent }}%
                @if (!usage().projectCompleted) {
                    — โครงการยังไม่เสร็จ วัสดุที่ใช้ยังไม่ครบแสดงเป็น "ยังใช้ไม่ครบ"
                }
            </div>
            <div class="flex flex-wrap gap-2">
                @if (canReceive()) {
                    <button pButton type="button" [outlined]="true" icon="pi pi-download" label="เบิกจากคลังหลัก" (click)="openMovement('issue')"></button>
                    <button pButton type="button" [outlined]="true" icon="pi pi-upload" label="ส่งของเหลือเข้าคลัง" (click)="openMovement('return')"></button>
                }
                @if (canEditBoq()) {
                    <button pButton type="button" icon="pi pi-list" [label]="boq().items.length ? 'แก้ไข BOQ' : 'ใส่ BOQ'" (click)="boqOpen.set(true)"></button>
                }
            </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            @for (card of summary(); track card.label) {
                <div class="rounded-lg border border-surface px-3 py-2">
                    <div class="text-xs text-muted-color">{{ card.label }}</div>
                    <div class="text-xl font-bold" [ngClass]="card.className">{{ card.value }}</div>
                </div>
            }
        </div>

        @if (loadError()) {
            <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ loadError() }}</div>
        }
        @if (!boq().items.length && !boqResource.isLoading()) {
            <div class="rounded-lg px-4 py-3 mb-4 bg-surface-100 dark:bg-surface-800 text-sm" role="status">
                <i class="pi pi-info-circle mr-1"></i>ยังไม่มี BOQ ของโครงการนี้ — {{ canEditBoq() ? 'กด "ใส่ BOQ" เพื่อกรอกหรือวางจาก Excel แล้วระบบจะเทียบกับวัสดุที่รับเข้าหน้างาน' : 'ผู้จัดการโครงการใส่ BOQ ได้ที่ปุ่มนี้' }}
            </div>
        }

        <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse" style="min-width: 56rem">
                <thead>
                    <tr class="text-left text-muted-color border-b border-surface">
                        <th class="py-2 pr-2 font-semibold">วัสดุ</th>
                        <th class="py-2 pr-2 font-semibold text-right">BOQ</th>
                        <th class="py-2 pr-2 font-semibold text-right">สั่งซื้อ</th>
                        <th class="py-2 pr-2 font-semibold text-right">รับเข้า</th>
                        <th class="py-2 pr-2 font-semibold text-right">เบิกคลัง</th>
                        <th class="py-2 pr-2 font-semibold text-right">คืนคลัง</th>
                        <th class="py-2 pr-2 font-semibold text-right">ใช้จริง</th>
                        <th class="py-2 pr-2 font-semibold w-40">เทียบ BOQ</th>
                        <th class="py-2 font-semibold">สถานะ</th>
                    </tr>
                </thead>
                <tbody>
                    @for (row of usage().rows; track row.key) {
                        <tr class="border-b border-surface align-middle">
                            <td class="py-2 pr-2">
                                <div class="font-semibold">{{ row.name }}</div>
                                <div class="text-xs text-muted-color">{{ row.materialCode ?? 'ไม่อยู่ในรายการวัสดุ' }}{{ row.category ? ' · ' + row.category : '' }}{{ row.spent ? ' · ฿' + (row.spent | number: '1.0-0') : '' }}</div>
                            </td>
                            <td class="py-2 pr-2 text-right tabular-nums">{{ row.boqQuantity ? (row.boqQuantity | number: '1.0-2') : '-' }}</td>
                            <td class="py-2 pr-2 text-right tabular-nums">{{ row.orderedQuantity | number: '1.0-2' }}</td>
                            <td class="py-2 pr-2 text-right tabular-nums">{{ row.receivedQuantity | number: '1.0-2' }}</td>
                            <td class="py-2 pr-2 text-right tabular-nums">{{ row.issuedQuantity ? (row.issuedQuantity | number: '1.0-2') : '-' }}</td>
                            <td class="py-2 pr-2 text-right tabular-nums">{{ row.returnedQuantity ? (row.returnedQuantity | number: '1.0-2') : '-' }}</td>
                            <td class="py-2 pr-2 text-right tabular-nums font-semibold whitespace-nowrap">{{ row.usedQuantity | number: '1.0-2' }} {{ row.unit }}</td>
                            <td class="py-2 pr-2">
                                @if (row.boqQuantity > 0) {
                                    <div class="h-2 rounded-full bg-emphasis overflow-hidden" role="img" [attr.aria-label]="'ใช้ไป ' + percentUsed(row) + '% ของ BOQ'">
                                        <div class="h-full rounded-full" [ngClass]="barClass(row)" [style.width.%]="min(percentUsed(row), 100)"></div>
                                    </div>
                                    <div class="text-xs mt-1 tabular-nums" [ngClass]="row.status === 'over' ? 'text-red-700 dark:text-red-300 font-semibold' : row.status === 'under' ? 'text-orange-700 dark:text-orange-300' : 'text-muted-color'">
                                        {{ percentUsed(row) }}% · {{ row.variance > 0 ? '+' : '' }}{{ row.variance | number: '1.0-2' }} {{ row.unit }}{{ row.variancePercent !== null && row.variancePercent !== undefined ? ' (' + (row.variancePercent > 0 ? '+' : '') + row.variancePercent + '%)' : '' }}
                                    </div>
                                } @else {
                                    <span class="text-xs text-muted-color">ไม่มีใน BOQ</span>
                                }
                            </td>
                            <td class="py-2"><p-tag [value]="statusInfo[row.status].label" [severity]="statusInfo[row.status].severity" /></td>
                        </tr>
                    } @empty {
                        <tr>
                            <td colspan="9" class="text-center text-muted-color py-8">{{ usageResource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มีข้อมูลวัสดุ' }}</td>
                        </tr>
                    }
                </tbody>
            </table>
        </div>

        @if (movements().length) {
            <details class="mt-4">
                <summary class="text-sm cursor-pointer font-semibold">ประวัติรับเข้า/เบิกคลังหลักของโครงการ ({{ movements().length }})</summary>
                <ul class="list-none p-0 m-0 mt-2 flex flex-col gap-1 text-sm">
                    @for (movement of movements(); track movement.id) {
                        <li class="flex flex-wrap gap-x-2 rounded-lg px-3 py-2 bg-emphasis">
                            <span [ngClass]="movement.type === 'return' ? 'text-green-700 dark:text-green-400' : 'text-blue-700 dark:text-blue-300'"><i class="pi mr-1" [ngClass]="movement.type === 'return' ? 'pi-upload' : 'pi-download'"></i>{{ movement.type === 'return' ? 'ส่งเข้าคลัง' : 'เบิกจากคลัง' }}</span>
                            <span class="font-semibold">{{ movement.name }} {{ movement.quantity | number: '1.0-2' }} {{ movement.unit }}</span>
                            <span class="text-muted-color">{{ movement.date | thaiDate }} · {{ movement.recordedBy.name }}{{ movement.note ? ' · ' + movement.note : '' }}</span>
                            <span class="text-xs text-muted-color ml-auto">{{ movement.id }}</span>
                        </li>
                    }
                </ul>
            </details>
        }

        @if (boqOpen()) {
            <app-boq-editor [projectCode]="projectCode()" [boq]="boq()" [phases]="phases()" [materials]="materials()" (saved)="onBoqSaved()" (closed)="boqOpen.set(false)" />
        }

        @if (movementForm(); as form) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && movementForm.set(null)" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(32rem, 96vw)' }" [header]="form.type === 'return' ? 'ส่งของเหลือเข้าคลังหลัก' : 'เบิกจากคลังหลัก'">
                <p class="mt-0 text-sm text-muted-color">{{ form.type === 'return' ? 'ของที่เหลือหลังใช้งานที่หน้างาน — จำนวนจะถูกหักออกจาก "ใช้จริง" ของโครงการ และเพิ่มในคลังหลักของบริษัท' : 'ของจากคลังหลักนำมาใช้ที่หน้างาน — จำนวนจะนับเป็น "ใช้จริง" ของโครงการ' }}</p>
                <label class="text-sm font-semibold block">วัสดุ <span class="text-red-600">*</span>
                    <input pInputText class="w-full mt-1 font-normal" list="movement-materials" placeholder="พิมพ์หรือเลือกจากรายการ" [ngModel]="form.text" (ngModelChange)="pickMaterial($event)" [attr.aria-invalid]="!!errors()['name']" />
                    <datalist id="movement-materials">
                        @for (option of movementOptions(); track option.label) {
                            <option [value]="option.label">{{ option.hint }}</option>
                        }
                    </datalist>
                </label>
                @if (!form.materialCode) {
                    <label class="text-sm font-semibold block mt-3">หน่วย <span class="text-red-600">*</span>
                        <input pInputText class="w-full mt-1 font-normal" maxlength="30" [ngModel]="form.unit" (ngModelChange)="patch({ unit: $event })" [attr.aria-invalid]="!!errors()['unit']" />
                    </label>
                }
                @if (available(); as info) {
                    <p class="text-xs mt-2 mb-0" [ngClass]="info.className">{{ info.text }}</p>
                }
                <div class="grid grid-cols-2 gap-3 mt-3">
                    <label class="text-sm font-semibold">จำนวน <span class="text-red-600">*</span>
                        <input pInputText type="number" min="0" step="any" class="w-full mt-1 font-normal text-right" [ngModel]="form.quantity" (ngModelChange)="patch({ quantity: $event })" [attr.aria-invalid]="!!errors()['quantity']" />
                    </label>
                    <label class="text-sm font-semibold">วันที่ <span class="text-red-600">*</span>
                        <input pInputText type="date" class="w-full mt-1 font-normal" [max]="today" [ngModel]="form.date" (ngModelChange)="patch({ date: $event })" />
                    </label>
                </div>
                <label class="text-sm font-semibold block mt-3">หมายเหตุ
                    <input pInputText class="w-full mt-1 font-normal" maxlength="500" [placeholder]="form.type === 'return' ? 'เช่น เหลือจากเทพื้นชั้น 1 สภาพดี' : 'เช่น ใช้ซ่อมผนังห้องน้ำ'" [ngModel]="form.note" (ngModelChange)="patch({ note: $event })" />
                </label>
                @if (actionError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ actionError() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="movementForm.set(null)"></button>
                    <button pButton type="button" icon="pi pi-check" label="บันทึก" [loading]="saving()" (click)="saveMovement(form)"></button>
                </ng-template>
            </p-dialog>
        }
    `
})
export class ProjectMaterialUsage {
    private readonly service = inject(ProcurementService);
    private readonly auth = inject(AuthService);

    readonly projectCode = input.required<string>();
    readonly phases = input<TimelinePhase[]>([]);
    /** เปลี่ยนค่าเมื่อมีการรับของ → โหลดใหม่ */
    readonly refreshKey = input(0);
    readonly notify = output<string>();

    readonly statusInfo = USAGE_STATUS;
    readonly today = todayLocal();
    readonly min = Math.min;

    readonly usageResource = apiResource({ params: () => ({ code: this.projectCode(), key: this.refreshKey() }), stream: ({ params }) => this.service.usage(params.code), defaultValue: { tolerancePercent: 5, projectCompleted: false, rows: [] } });
    readonly boqResource = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.service.boq(code), defaultValue: { items: [] } });
    readonly movementsResource = apiResource({ params: () => ({ code: this.projectCode(), key: this.refreshKey() }), stream: ({ params }) => this.service.stockMovements(params.code), defaultValue: [] });
    readonly materialsResource = apiResource({ stream: () => this.service.materials(), defaultValue: [] });
    readonly stockResource = apiResource({ params: () => (this.movementForm()?.type === 'issue' ? true : undefined), stream: () => this.service.warehouseStock(), defaultValue: [] });

    readonly usage = this.usageResource.value;
    readonly boq = this.boqResource.value;
    readonly movements = this.movementsResource.value;
    readonly materials = computed(() => this.materialsResource.value().filter((item) => item.active));
    readonly loadError = computed(() => {
        const error = this.usageResource.error() ?? this.boqResource.error();
        return error ? problemMessage(error, 'โหลดข้อมูลวัสดุไม่สำเร็จ') : '';
    });

    readonly canReceive = computed(() => this.auth.can('procurement.receive') || this.auth.can('procurement.manage'));
    readonly canEditBoq = computed(() => this.auth.can('project.manage'));

    readonly summary = computed(() => {
        const rows = this.usage().rows;
        const count = (status: string) => rows.filter((row) => row.status === status).length;
        return [
            { label: 'วัสดุใน BOQ', value: `${rows.filter((row) => row.status !== 'not-in-boq').length} รายการ`, className: '' },
            { label: 'ใช้เกิน BOQ', value: `${count('over')} รายการ`, className: count('over') ? 'text-red-600 dark:text-red-400' : '' },
            { label: this.usage().projectCompleted ? 'ใช้น้อยกว่า BOQ' : 'ยังใช้ไม่ครบ', value: `${count(this.usage().projectCompleted ? 'under' : 'in-progress')} รายการ`, className: count('under') ? 'text-orange-600 dark:text-orange-400' : '' },
            { label: 'ไม่มีใน BOQ', value: `${count('not-in-boq')} รายการ`, className: count('not-in-boq') ? 'text-orange-600 dark:text-orange-400' : '' }
        ];
    });

    percentUsed(row: MaterialUsageRow) {
        return row.boqQuantity > 0 ? Math.round((row.usedQuantity / row.boqQuantity) * 100) : 0;
    }

    barClass(row: MaterialUsageRow) {
        return row.status === 'over' ? 'bg-red-500' : row.status === 'ok' ? 'bg-green-500' : row.status === 'under' ? 'bg-orange-500' : 'bg-primary';
    }

    // ---------- BOQ ----------
    readonly boqOpen = signal(false);

    onBoqSaved() {
        this.boqOpen.set(false);
        this.boqResource.reload();
        this.usageResource.reload();
        this.notify.emit('บันทึก BOQ แล้ว');
    }

    // ---------- คลังหลัก ----------
    readonly movementForm = signal<MovementForm | null>(null);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly actionError = signal('');

    /** ตัวเลือก: ส่งคืน = วัสดุที่โครงการใช้อยู่ · เบิก = ของในคลังหลัก (ตามด้วยรายการวัสดุทั้งหมด) */
    readonly movementOptions = computed(() => {
        const form = this.movementForm();
        const options = new Map<string, { label: string; hint: string; materialCode?: string; name: string; unit: string }>();
        if (form?.type === 'return') {
            for (const row of this.usage().rows.filter((item) => item.usedQuantity > 0)) options.set(materialLabel(row), { label: materialLabel(row), hint: `ใช้อยู่ ${row.usedQuantity} ${row.unit}`, materialCode: row.materialCode, name: row.name, unit: row.unit });
        } else {
            for (const stock of this.stockResource.value()) options.set(materialLabel(stock), { label: materialLabel(stock), hint: `คงเหลือ ${stock.quantity} ${stock.unit}`, materialCode: stock.materialCode, name: stock.name, unit: stock.unit });
            for (const material of this.materials()) if (!options.has(materialLabel(material))) options.set(materialLabel(material), { label: materialLabel(material), hint: material.code, materialCode: material.code, name: material.name, unit: material.unit });
        }
        return [...options.values()];
    });

    readonly available = computed(() => {
        const form = this.movementForm();
        if (!form || !form.name) return null;
        const key = materialKey(form);
        if (form.type === 'issue') {
            const stock = this.stockResource.value().find((item) => item.key === key);
            return stock ? { text: `คงเหลือในคลังหลัก ${stock.quantity} ${stock.unit}`, className: 'text-muted-color' } : { text: 'ไม่มีวัสดุนี้ในคลังหลัก', className: 'text-orange-700 dark:text-orange-300' };
        }
        const row = this.usage().rows.find((item) => item.key === key);
        return row ? { text: `โครงการนี้ใช้อยู่ ${row.usedQuantity} ${row.unit}`, className: 'text-muted-color' } : null;
    });

    openMovement(type: 'return' | 'issue') {
        this.errors.set({});
        this.actionError.set('');
        this.movementForm.set({ type, text: '', name: '', unit: '', quantity: null, date: todayLocal(), note: '' });
    }

    patch(change: Partial<MovementForm>) {
        this.movementForm.update((form) => (form ? { ...form, ...change } : form));
    }

    pickMaterial(text: string) {
        const option = this.movementOptions().find((item) => item.label === text) ?? this.materialsResource.value().map((item) => ({ label: materialLabel(item), materialCode: item.code, name: item.name, unit: item.unit })).find((item) => item.label === text);
        this.patch(option ? { text, materialCode: option.materialCode, name: option.name, unit: option.unit } : { text, materialCode: undefined, name: text.trim(), unit: this.movementForm()?.materialCode ? '' : (this.movementForm()?.unit ?? '') });
    }

    saveMovement(form: MovementForm) {
        this.saving.set(true);
        this.errors.set({});
        this.actionError.set('');
        this.service
            .createStockMovement(this.projectCode(), {
                type: form.type,
                ...(form.materialCode ? { materialCode: form.materialCode } : {}),
                name: form.name,
                unit: form.unit.trim(),
                quantity: Number(form.quantity) || 0,
                date: form.date,
                ...(form.note.trim() ? { note: form.note.trim() } : {})
            })
            .subscribe({
                next: (movement) => {
                    this.saving.set(false);
                    this.movementForm.set(null);
                    this.usageResource.reload();
                    this.movementsResource.reload();
                    this.notify.emit(`${movement.type === 'return' ? 'ส่งเข้าคลังหลัก' : 'เบิกจากคลังหลัก'} ${movement.name} ${movement.quantity} ${movement.unit} แล้ว`);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.actionError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
                }
            });
    }
}

