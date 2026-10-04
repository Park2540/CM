import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { BoqItem, Material, ProcurementService, ProjectBoq } from '@/app/pages/service/procurement.service';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { findMaterialByText, materialLabel } from './material-picker';

interface Row {
    text: string;
    materialCode?: string;
    name: string;
    unit: string;
    quantity: number | null;
    phaseCode: string;
    note: string;
}

const emptyRow = (): Row => ({ text: '', name: '', unit: '', quantity: null, phaseCode: '', note: '' });

/** แก้ไข BOQ วัสดุของโครงการ: กรอกทีละแถว หรือวางจาก Excel (ชื่อ · ปริมาณ · หน่วย) */
@Component({
    selector: 'app-boq-editor',
    standalone: true,
    imports: [ButtonModule, DialogModule, FormsModule, InputTextModule, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [maximizable]="true" [style]="{ width: 'min(64rem, 98vw)' }" header="BOQ วัสดุของโครงการ">
            <p class="mt-0 text-sm text-muted-color">ปริมาณตาม BOQ (รวมเผื่อเสียแล้ว) ใช้เทียบกับวัสดุที่ใช้จริงที่หน้างาน — เลือกจากรายการวัสดุเพื่อให้จับคู่กับใบขอซื้อได้ตรง</p>

            <details class="mb-4 rounded-lg border border-surface px-3 py-2" [open]="pasteOpen()" (toggle)="pasteOpen.set($any($event.target).open)">
                <summary class="text-sm font-semibold cursor-pointer"><i class="pi pi-file-excel mr-1 text-green-600"></i>วางจาก Excel</summary>
                <p class="text-xs text-muted-color mt-2 mb-2">คัดลอก 3 คอลัมน์จาก Excel: <strong>ชื่อวัสดุ · ปริมาณ · หน่วย</strong> (คอลัมน์ที่ 4 = รหัสขั้นตอน ถ้ามี) แล้ววางด้านล่าง ระบบจับคู่กับรายการวัสดุให้อัตโนมัติ</p>
                <textarea pTextarea rows="4" class="w-full font-mono text-xs" placeholder="ปูนซีเมนต์ปอร์ตแลนด์&#9;320&#9;ถุง" [ngModel]="pasteText()" (ngModelChange)="pasteText.set($event)" aria-label="ข้อมูลที่วางจาก Excel"></textarea>
                <div class="flex flex-wrap items-center gap-2 mt-2">
                    <button pButton type="button" size="small" icon="pi pi-plus" label="เพิ่มเข้าตาราง" [disabled]="!pasteText().trim()" (click)="importPaste(false)"></button>
                    <button pButton type="button" size="small" [outlined]="true" icon="pi pi-refresh" label="แทนที่ทั้งตาราง" [disabled]="!pasteText().trim()" (click)="importPaste(true)"></button>
                    @if (pasteResult()) {
                        <span class="text-xs text-muted-color">{{ pasteResult() }}</span>
                    }
                </div>
            </details>

            <datalist id="boq-materials">
                @for (material of materials(); track material.code) {
                    <option [value]="label(material)">{{ material.category }}</option>
                }
            </datalist>

            <div class="overflow-x-auto">
                <table class="w-full text-sm border-collapse" style="min-width: 52rem">
                    <thead>
                        <tr class="text-left text-muted-color border-b border-surface">
                            <th class="py-2 pr-2 font-semibold w-8">#</th>
                            <th class="py-2 pr-2 font-semibold">วัสดุ</th>
                            <th class="py-2 pr-2 font-semibold w-24">หน่วย</th>
                            <th class="py-2 pr-2 font-semibold w-28 text-right">ปริมาณ</th>
                            <th class="py-2 pr-2 font-semibold w-48">ขั้นตอนงาน</th>
                            <th class="py-2 pr-2 font-semibold w-40">หมายเหตุ</th>
                            <th class="w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (row of rows(); track $index; let i = $index) {
                            <tr class="border-b border-surface align-top">
                                <td class="py-2 pr-2 text-muted-color">{{ i + 1 }}</td>
                                <td class="py-1 pr-2">
                                    <input pInputText class="w-full" list="boq-materials" maxlength="200" [attr.aria-label]="'วัสดุแถวที่ ' + (i + 1)" [value]="row.text" (input)="setText(i, $any($event.target).value)" [attr.aria-invalid]="!!rowError(i, 'name') || !!rowError(i, 'materialCode')" />
                                    @if (row.materialCode) {
                                        <small class="text-xs text-green-700 dark:text-green-400"><i class="pi pi-check text-[0.6rem] mr-1"></i>{{ row.materialCode }}</small>
                                    } @else if (row.name) {
                                        <small class="text-xs text-orange-700 dark:text-orange-300">ไม่อยู่ในรายการวัสดุ</small>
                                    }
                                    @if (rowError(i, 'name') || rowError(i, 'materialCode'); as message) {
                                        <small class="block text-red-600 dark:text-red-400">{{ message }}</small>
                                    }
                                </td>
                                <td class="py-1 pr-2">
                                    <input pInputText class="w-full" maxlength="30" [attr.aria-label]="'หน่วยแถวที่ ' + (i + 1)" [value]="row.unit" [readonly]="!!row.materialCode" (input)="patch(i, { unit: $any($event.target).value })" [attr.aria-invalid]="!!rowError(i, 'unit')" />
                                </td>
                                <td class="py-1 pr-2">
                                    <input pInputText type="number" min="0" step="any" class="w-full text-right" [attr.aria-label]="'ปริมาณแถวที่ ' + (i + 1)" [value]="row.quantity" (input)="patch(i, { quantity: $any($event.target).value === '' ? null : +$any($event.target).value })" [attr.aria-invalid]="!!rowError(i, 'quantity')" />
                                </td>
                                <td class="py-1 pr-2">
                                    <select class="native-select w-full" [attr.aria-label]="'ขั้นตอนแถวที่ ' + (i + 1)" [value]="row.phaseCode" (change)="patch(i, { phaseCode: $any($event.target).value })">
                                        <option value="">ทั้งโครงการ</option>
                                        @for (phase of phases(); track phase.code) {
                                            <option [value]="phase.code" [selected]="phase.code === row.phaseCode">{{ phase.step }}. {{ phase.shortName }}</option>
                                        }
                                    </select>
                                </td>
                                <td class="py-1 pr-2">
                                    <input pInputText class="w-full" maxlength="300" [attr.aria-label]="'หมายเหตุแถวที่ ' + (i + 1)" [value]="row.note" (input)="patch(i, { note: $any($event.target).value })" />
                                </td>
                                <td class="py-1">
                                    <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" size="small" [attr.aria-label]="'ลบแถวที่ ' + (i + 1)" (click)="remove(i)"></button>
                                </td>
                            </tr>
                        }
                    </tbody>
                </table>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-2">
                <button pButton type="button" [text]="true" size="small" icon="pi pi-plus" label="เพิ่มแถว" (click)="add()"></button>
                <span class="text-xs text-muted-color">{{ filled().length }} รายการ · จับคู่กับรายการวัสดุ {{ matched() }} รายการ</span>
            </div>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }
            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="button" icon="pi pi-check" label="บันทึก BOQ" [loading]="saving()" (click)="save()"></button>
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .native-select {
            padding: 0.5rem 0.5rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
    `
})
export class BoqEditor implements OnInit {
    private readonly service = inject(ProcurementService);

    readonly projectCode = input.required<string>();
    readonly boq = input.required<ProjectBoq>();
    readonly phases = input<TimelinePhase[]>([]);
    readonly materials = input<Material[]>([]);
    readonly saved = output<ProjectBoq>();
    readonly closed = output<void>();

    readonly label = materialLabel;
    readonly rows = signal<Row[]>([emptyRow()]);
    readonly pasteOpen = signal(false);
    readonly pasteText = signal('');
    readonly pasteResult = signal('');
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    /** แถวที่กรอกแล้ว (แถวว่างไม่ส่ง) */
    readonly filled = computed(() => this.rows().filter((row) => row.text.trim() || row.quantity !== null));
    readonly matched = computed(() => this.filled().filter((row) => row.materialCode).length);

    ngOnInit() {
        const items = this.boq().items;
        this.pasteOpen.set(!items.length);
        if (items.length) this.rows.set(items.map((item) => ({ text: item.materialCode ? materialLabel(item) : item.name, materialCode: item.materialCode, name: item.name, unit: item.unit, quantity: item.quantity, phaseCode: item.phaseCode ?? '', note: item.note ?? '' })));
    }

    /** ข้อผิดพลาดของแถว (ดัชนีตามแถวที่ส่ง) */
    rowError(index: number, field: string) {
        const sentIndex = this.filled().indexOf(this.rows()[index]!);
        return sentIndex >= 0 ? this.errors()[`items.${sentIndex}.${field}`] : undefined;
    }

    setText(index: number, text: string) {
        const material = findMaterialByText(this.materials(), text);
        this.patch(index, material ? { text: materialLabel(material), materialCode: material.code, name: material.name, unit: material.unit } : { text, materialCode: undefined, name: text.trim(), unit: this.rows()[index]!.materialCode ? '' : this.rows()[index]!.unit });
    }

    patch(index: number, change: Partial<Row>) {
        this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
    }

    add() {
        this.rows.update((rows) => [...rows, emptyRow()]);
    }

    remove(index: number) {
        this.rows.update((rows) => (rows.length === 1 ? [emptyRow()] : rows.filter((_, i) => i !== index)));
    }

    /** วางจาก Excel: แยกคอลัมน์ด้วย tab (หรือ , / ;) — ชื่อ · ปริมาณ · หน่วย · ขั้นตอน */
    importPaste(replace: boolean) {
        const phaseCodes = new Set(this.phases().map((phase) => phase.code));
        const imported: Row[] = [];
        let skipped = 0;
        for (const line of this.pasteText().split(/\r?\n/)) {
            if (!line.trim()) continue;
            const cells = (line.includes('\t') ? line.split('\t') : line.split(/[,;]/)).map((cell) => cell.trim());
            const quantity = Number((cells[1] ?? '').replace(/,/g, ''));
            // แถวหัวตาราง/ไม่มีตัวเลข: ข้าม
            if (!cells[0] || !Number.isFinite(quantity) || cells[1] === '') {
                skipped++;
                continue;
            }
            const unit = cells[2] ?? '';
            const material = findMaterialByText(this.materials(), unit ? `${cells[0]} (${unit})` : cells[0]) ?? (unit ? undefined : findMaterialByText(this.materials(), cells[0]));
            const phaseCode = cells[3] && phaseCodes.has(cells[3]) ? cells[3] : '';
            imported.push(material ? { text: materialLabel(material), materialCode: material.code, name: material.name, unit: material.unit, quantity, phaseCode, note: '' } : { text: cells[0], name: cells[0], unit, quantity, phaseCode, note: '' });
        }
        if (imported.length) {
            const kept = replace ? [] : this.rows().filter((row) => row.text.trim() || row.quantity !== null);
            this.rows.set([...kept, ...imported]);
            this.pasteText.set('');
        }
        const matched = imported.filter((row) => row.materialCode).length;
        this.pasteResult.set(`นำเข้า ${imported.length} แถว (ตรงกับรายการวัสดุ ${matched})${skipped ? ` · ข้าม ${skipped} แถวที่ไม่มีปริมาณ` : ''}`);
    }

    save() {
        const items: BoqItem[] = this.filled().map((row) => ({
            ...(row.materialCode ? { materialCode: row.materialCode } : {}),
            name: row.name.trim(),
            unit: row.unit.trim(),
            quantity: row.quantity ?? -1,
            ...(row.phaseCode ? { phaseCode: row.phaseCode } : {}),
            ...(row.note.trim() ? { note: row.note.trim() } : {})
        }));
        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        this.service.saveBoq(this.projectCode(), items).subscribe({
            next: (boq) => {
                this.saving.set(false);
                this.saved.emit(boq);
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'บันทึก BOQ ไม่สำเร็จ'));
            }
        });
    }
}
