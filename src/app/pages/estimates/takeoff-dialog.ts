import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { EstimateItem, REBAR_SIZES, TAKEOFF_METHODS, TakeoffLine, TakeoffMethod, lineResult, newId, rebarKgPerMeter, takeoffQuantity } from '@/app/pages/service/estimate.service';

export interface TakeoffResult {
    takeoff: TakeoffLine[];
    waste: number;
}

/** ช่องที่ใช้ของแต่ละวิธีถอดปริมาณ */
const FIELDS: Record<TakeoffMethod, Array<'width' | 'length' | 'height' | 'count' | 'diameter' | 'kgPerMeter'>> = {
    volume: ['width', 'length', 'height', 'count'],
    area: ['width', 'length', 'count'],
    length: ['length', 'count'],
    count: ['count'],
    rebar: ['diameter', 'length', 'count'],
    steel: ['kgPerMeter', 'length', 'count'],
    model: ['count']
};

const FIELD_LABEL = { width: 'กว้าง (ม.)', length: 'ยาว (ม.)', height: 'สูง/ลึก (ม.)', count: 'จำนวน/ปริมาณ', diameter: 'ขนาด', kgPerMeter: 'กก./ม.' } as const;

/** ถอดปริมาณของรายการ: หลายบรรทัด (บวก/หัก) × เผื่อเสีย → ปริมาณ */
@Component({
    selector: 'app-takeoff-dialog',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && closed.emit()" [modal]="true" [draggable]="false" [maximizable]="true" [style]="{ width: 'min(68rem, 98vw)' }" header="ถอดปริมาณ">
            <p class="mt-0 mb-3 text-sm">
                <span class="font-semibold">{{ item().description || 'รายการ' }}</span>
                <span class="text-muted-color"> · หน่วยในใบ BOQ: {{ item().unit || '-' }}</span>
            </p>

            <div class="flex flex-wrap gap-2 mb-3" role="group" aria-label="เพิ่มบรรทัดถอดปริมาณ">
                @for (method of methods; track method.key) {
                    <button pButton type="button" size="small" [outlined]="true" icon="pi pi-plus" [label]="method.label" [disabled]="readonly()" [attr.title]="method.formula" (click)="add(method.key)"></button>
                }
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-sm border-collapse" style="min-width: 60rem">
                    <thead>
                        <tr class="text-left text-muted-color border-b border-surface">
                            <th class="py-2 pr-2 font-semibold w-8">#</th>
                            <th class="py-2 pr-2 font-semibold">ตำแหน่ง/รายละเอียด</th>
                            <th class="py-2 pr-2 font-semibold w-28">วิธี</th>
                            <th class="py-2 pr-2 font-semibold">ค่าที่ใช้คำนวณ</th>
                            <th class="py-2 pr-2 font-semibold w-16 text-center">หัก</th>
                            <th class="py-2 pr-2 font-semibold w-28 text-right">ผลลัพธ์</th>
                            <th class="w-8"></th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (line of lines(); track line.id; let i = $index) {
                            <tr class="border-b border-surface align-top" [class.text-red-700]="line.deduct">
                                <td class="py-2 pr-2 text-muted-color">{{ i + 1 }}</td>
                                <td class="py-1 pr-2">
                                    <input pInputText class="w-full" maxlength="200" placeholder="เช่น F1 1.20x1.20 ม." [attr.aria-label]="'รายละเอียดบรรทัด ' + (i + 1)" [disabled]="readonly()" [value]="line.label ?? ''" (input)="patch(i, { label: $any($event.target).value })" />
                                </td>
                                <td class="py-1 pr-2">
                                    @if (line.method === 'model') {
                                        <span class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emphasis"><i class="pi pi-box text-[0.65rem]"></i>{{ methodLabel(line.method) }}</span>
                                    } @else {
                                        <select class="native-select w-full" [attr.aria-label]="'วิธีบรรทัด ' + (i + 1)" [disabled]="readonly()" (change)="patch(i, { method: $any($event.target).value })">
                                            @for (method of methods; track method.key) {
                                                <option [value]="method.key" [selected]="method.key === line.method">{{ method.label }}</option>
                                            }
                                        </select>
                                    }
                                </td>
                                <td class="py-1 pr-2">
                                    <div class="flex flex-wrap items-end gap-2">
                                        @for (field of fields[line.method]; track field) {
                                            <label class="text-xs text-muted-color">{{ fieldLabel[field] }}
                                                @if (field === 'diameter') {
                                                    <select class="native-select block w-24 mt-0.5" [disabled]="readonly()" (change)="patch(i, { diameter: +$any($event.target).value })">
                                                        @for (size of rebarSizes; track size.diameter) {
                                                            <option [value]="size.diameter" [selected]="size.diameter === line.diameter">{{ size.label }} ({{ size.kgPerMeter }})</option>
                                                        }
                                                    </select>
                                                } @else {
                                                    <input pInputText type="number" min="0" step="any" class="block w-20 mt-0.5 text-right" [disabled]="readonly()" [value]="line[field] ?? ''" (input)="setNumber(i, field, $any($event.target).value)" />
                                                }
                                            </label>
                                        }
                                        @if (line.method === 'rebar') {
                                            <span class="text-xs text-muted-color pb-2">{{ kgPerMeter(line.diameter ?? 0) }} กก./ม.</span>
                                        }
                                    </div>
                                </td>
                                <td class="py-2 pr-2 text-center">
                                    <input type="checkbox" class="accent-[var(--p-primary-color)]" [attr.aria-label]="'หักบรรทัด ' + (i + 1)" [disabled]="readonly()" [checked]="!!line.deduct" (change)="patch(i, { deduct: $any($event.target).checked })" />
                                </td>
                                <td class="py-2 pr-2 text-right tabular-nums font-semibold whitespace-nowrap">{{ result(line) | number: '1.2-2' }} {{ unitOf(line.method) || item().unit }}</td>
                                <td class="py-1">
                                    @if (!readonly()) {
                                        <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" size="small" [attr.aria-label]="'ลบบรรทัด ' + (i + 1)" (click)="remove(i)"></button>
                                    }
                                </td>
                            </tr>
                        } @empty {
                            <tr>
                                <td colspan="7" class="py-6 text-center text-muted-color">กดปุ่มด้านบนเพื่อเพิ่มบรรทัดถอดปริมาณ เช่น ฐานราก F1 ขนาด 1.20 × 1.20 × 0.30 ม. จำนวน 8 ฐาน</td>
                            </tr>
                        }
                    </tbody>
                </table>
            </div>

            <div class="flex flex-wrap items-end justify-end gap-x-6 gap-y-2 mt-4 text-sm">
                <span class="text-muted-color">รวมจากการถอด <span class="font-semibold text-color tabular-nums">{{ sum() | number: '1.2-2' }}</span></span>
                <label class="flex items-center gap-2">เผื่อเสีย
                    <input pInputText type="number" min="0" max="100" step="any" class="w-20 text-right" [disabled]="readonly()" [ngModel]="waste()" (ngModelChange)="waste.set(+$event || 0)" aria-label="เผื่อเสีย (%)" /> %
                </label>
                <span>ปริมาณ <span class="text-xl font-bold tabular-nums">{{ quantity() | number: '1.2-2' }}</span> {{ item().unit }}</span>
            </div>
            @if (unitMismatch(); as hint) {
                <p class="text-xs text-orange-700 dark:text-orange-300 text-right mt-1 mb-0"><i class="pi pi-info-circle mr-1"></i>{{ hint }}</p>
            }

            <ng-template #footer>
                @if (!readonly() && item().takeoff?.length) {
                    <button pButton type="button" [text]="true" severity="danger" icon="pi pi-times" label="เลิกใช้การถอด (กรอกปริมาณเอง)" class="mr-auto" (click)="applied.emit({ takeoff: [], waste: 0 })"></button>
                }
                <button pButton type="button" label="ปิด" [text]="true" severity="secondary" (click)="closed.emit()"></button>
                @if (!readonly()) {
                    <button pButton type="button" icon="pi pi-check" label="ใช้ปริมาณนี้" [disabled]="!lines().length" (click)="applied.emit({ takeoff: lines(), waste: waste() })"></button>
                }
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .native-select {
            padding: 0.45rem 0.5rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
    `
})
export class TakeoffDialog implements OnInit {
    readonly item = input.required<EstimateItem>();
    readonly readonly = input(false);
    readonly applied = output<TakeoffResult>();
    readonly closed = output<void>();

    /** "จากโมเดล" มาจากการถอดอัตโนมัติเท่านั้น ไม่มีปุ่มเพิ่ม */
    readonly methods = (Object.keys(TAKEOFF_METHODS) as TakeoffMethod[]).filter((key) => key !== 'model').map((key) => ({ key, ...TAKEOFF_METHODS[key] }));
    readonly methodLabel = (method: TakeoffMethod) => TAKEOFF_METHODS[method].label;
    readonly fields = FIELDS;
    readonly fieldLabel = FIELD_LABEL;
    readonly rebarSizes = REBAR_SIZES;
    readonly kgPerMeter = rebarKgPerMeter;
    readonly result = lineResult;

    readonly lines = signal<TakeoffLine[]>([]);
    readonly waste = signal(0);
    readonly sum = computed(() => Math.round(this.lines().reduce((total, line) => total + lineResult(line), 0) * 100) / 100);
    readonly quantity = computed(() => takeoffQuantity(this.lines(), this.waste()));
    /** หน่วยของการถอดไม่ตรงกับหน่วยในใบ BOQ (เช่น ถอดเป็น ลบ.ม. แต่รายการเป็น ตร.ม.) */
    readonly unitMismatch = computed(() => {
        const unit = this.item().unit;
        const units = new Set(this.lines().map((line) => TAKEOFF_METHODS[line.method].unit));
        if (!unit || units.size !== 1 || this.lines().some((line) => line.method === 'count')) return '';
        const used = [...units][0]!;
        return used === unit ? '' : `ผลการถอดเป็น ${used} แต่รายการใช้หน่วย ${unit} — ตรวจวิธีถอดหรือหน่วยอีกครั้ง`;
    });

    ngOnInit() {
        this.lines.set((this.item().takeoff ?? []).map((line) => ({ ...line })));
        this.waste.set(this.item().waste ?? 0);
        if (!this.lines().length && !this.readonly()) this.add(this.defaultMethod());
    }

    unitOf(method: TakeoffMethod) {
        return TAKEOFF_METHODS[method].unit;
    }

    /** วิธีเริ่มต้นตามหน่วยของรายการ */
    private defaultMethod(): TakeoffMethod {
        const unit = this.item().unit ?? '';
        if (unit.includes('ลบ.ม')) return 'volume';
        if (unit.includes('ตร.ม')) return 'area';
        if (unit.includes('เมตร') || unit === 'ม.') return 'length';
        if (unit.includes('กก')) return /RB|DB|เหล็กเส้น|เสริม/.test(this.item().description) ? 'rebar' : 'steel';
        return 'count';
    }

    add(method: TakeoffMethod) {
        this.lines.update((lines) => [...lines, { id: newId('t'), method, count: 1, ...(method === 'rebar' ? { diameter: this.guessDiameter() } : {}) }]);
    }

    /** ขนาดเหล็กจากชื่อรายการ เช่น "DB 12 mm." */
    private guessDiameter() {
        const match = this.item().description.match(/(?:RB|DB)\s*(\d+)/i);
        const size = match ? Number(match[1]) : 12;
        return REBAR_SIZES.some((item) => item.diameter === size) ? size : 12;
    }

    remove(index: number) {
        this.lines.update((lines) => lines.filter((_, i) => i !== index));
    }

    patch(index: number, change: Partial<TakeoffLine>) {
        this.lines.update((lines) =>
            lines.map((line, i) => {
                if (i !== index) return line;
                const next = { ...line, ...change };
                if (change.method === 'rebar' && !next.diameter) next.diameter = this.guessDiameter();
                return next;
            })
        );
    }

    setNumber(index: number, field: 'width' | 'length' | 'height' | 'count' | 'kgPerMeter', raw: string) {
        const value = raw === '' ? undefined : Number(raw);
        this.patch(index, { [field]: value !== undefined && Number.isFinite(value) ? value : undefined } as Partial<TakeoffLine>);
    }
}
