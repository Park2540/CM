import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { EstimateService, OverheadStatement, StatementBlock, clauseStarts, newId } from '@/app/pages/service/estimate.service';

/** ตำแหน่งของชุดเนื้อหา: หัวข้อ s (และหัวข้อย่อย j ถ้ามี) */
interface Place {
    s: number;
    j: number | null;
}

/**
 * แก้เอกสารชี้แจงรายละเอียดค่าดำเนินการ (แนบท้าย BOQ)
 * หัวข้อ → หัวข้อย่อย → เนื้อหา (ย่อหน้า / รายการ / ตารางแบ่งความรับผิดชอบ) — เพิ่ม ลบ ย้าย แก้ข้อความได้ทุกส่วน เลขหัวข้อนับให้อัตโนมัติ
 * ทุกการแก้ส่งเอกสารฉบับใหม่ออกทาง (changed) ให้หน้า BOQ เก็บเป็นฉบับร่างและบันทึกพร้อม BOQ
 */
@Component({
    selector: 'app-statement-editor',
    standalone: true,
    imports: [ButtonModule, NgTemplateOutlet],
    template: `
        @let doc = statement();
        <div class="flex flex-wrap items-start gap-3 mb-4">
            <div class="flex-1 min-w-72 flex flex-col gap-2">
                <input class="doc-title-input" aria-label="ชื่อเอกสาร" maxlength="300" [disabled]="readonly()" [value]="doc.title" (input)="update((d) => (d.title = value($event)))" />
                <input class="cell" aria-label="คำอธิบายใต้ชื่อเอกสาร" maxlength="300" placeholder="คำอธิบายใต้ชื่อเอกสาร" [disabled]="readonly()" [value]="doc.subtitle ?? ''" (input)="update((d) => (d.subtitle = value($event) || undefined))" />
            </div>
            <div class="flex flex-wrap gap-2">
                <button pButton type="button" [text]="true" size="small" icon="pi pi-angle-double-down" label="ขยายทั้งหมด" (click)="expandAll()"></button>
                <button pButton type="button" [text]="true" size="small" icon="pi pi-angle-double-up" label="ย่อทั้งหมด" (click)="collapseAll()"></button>
                @if (!readonly()) {
                    <button pButton type="button" [outlined]="true" size="small" icon="pi pi-download" label="ใช้แม่แบบบริษัท" [loading]="busy() === 'load'" (click)="loadTemplate()"></button>
                }
                @if (canManageTemplate()) {
                    <button pButton type="button" [outlined]="true" size="small" icon="pi pi-upload" label="บันทึกเป็นแม่แบบบริษัท" [loading]="busy() === 'save'" (click)="saveTemplate()"></button>
                }
            </div>
        </div>
        <p class="text-sm text-muted-color m-0 mb-4">
            <i class="pi pi-info-circle mr-1"></i>เอกสารนี้แนบท้าย BOQ ฉบับนี้ (พิมพ์และส่งออก Excel พร้อม BOQ) — แก้แล้วกด "บันทึก" ด้านบนเหมือนแก้ BOQ · เลขหัวข้อนับให้อัตโนมัติ · หัวข้อ/ชื่อโครงการ/ยอดค่าดำเนินการดึงจาก BOQ
        </p>

        @for (section of doc.sections; track section.id; let s = $index; let lastSection = $last) {
            <section class="doc-card">
                <div class="flex items-center gap-2">
                    <span class="no">{{ s + 1 }}.</span>
                    <input class="cell font-semibold flex-1" [attr.aria-label]="'หัวข้อที่ ' + (s + 1)" maxlength="300" [disabled]="readonly()" [value]="section.title" (input)="update((d) => (d.sections[s].title = value($event)))" />
                    <ng-container *ngTemplateOutlet="moveButtons; context: { $implicit: 'section', s, index: s, last: lastSection, label: 'หัวข้อ ' + (s + 1) }" />
                </div>
                <ng-container *ngTemplateOutlet="blockList; context: { $implicit: section.blocks, place: { s, j: null }, prefix: s + 1 + '' }" />

                @for (subsection of section.subsections; track subsection.id; let j = $index; let lastSub = $last) {
                    <div class="sub-card">
                        <div class="flex items-center gap-2">
                            <button type="button" class="toggle" [attr.aria-expanded]="open().has(subsection.id)" [attr.aria-label]="(open().has(subsection.id) ? 'ย่อ ' : 'ขยาย ') + subsection.title" (click)="toggle(subsection.id)">
                                <i class="pi" [class.pi-chevron-down]="open().has(subsection.id)" [class.pi-chevron-right]="!open().has(subsection.id)"></i>
                            </button>
                            <span class="no">{{ s + 1 }}.{{ j + 1 }}</span>
                            <input class="cell font-semibold flex-1" [attr.aria-label]="'หัวข้อย่อย ' + (s + 1) + '.' + (j + 1)" maxlength="300" [disabled]="readonly()" [value]="subsection.title" (input)="update((d) => (d.sections[s].subsections[j].title = value($event)))" />
                            @if (!open().has(subsection.id)) {
                                <span class="text-xs text-muted-color whitespace-nowrap">{{ summary(subsection.blocks) }}</span>
                            }
                            <ng-container *ngTemplateOutlet="moveButtons; context: { $implicit: 'subsection', s, j, index: j, last: lastSub, label: 'หัวข้อย่อย ' + (s + 1) + '.' + (j + 1) }" />
                        </div>
                        @if (open().has(subsection.id)) {
                            <ng-container *ngTemplateOutlet="blockList; context: { $implicit: subsection.blocks, place: { s, j }, prefix: s + 1 + '.' + (j + 1) }" />
                        }
                    </div>
                }
                @if (!readonly()) {
                    <button pButton type="button" [text]="true" size="small" icon="pi pi-plus" [label]="'หัวข้อย่อย ' + (s + 1) + '.' + (section.subsections.length + 1)" (click)="addSubsection(s)"></button>
                }
            </section>
        }
        @if (!readonly()) {
            <button pButton type="button" [outlined]="true" icon="pi pi-plus" [label]="'เพิ่มหัวข้อที่ ' + (doc.sections.length + 1)" (click)="addSection()"></button>
        }

        <!-- เนื้อหาของหัวข้อ/หัวข้อย่อย -->
        <ng-template #blockList let-blocks let-place="place" let-prefix="prefix">
            @let starts = clauses(blocks);
            <div class="blocks">
                @for (block of asBlocks(blocks); track block.id; let b = $index; let lastBlock = $last) {
                    <div class="block">
                        <div class="block-head">
                            <span class="kind">{{ kindLabel(block) }}</span>
                            @if (block.kind === 'list') {
                                <select class="mini-select" aria-label="รูปแบบเลขรายการ" [disabled]="readonly()" (change)="update((d) => (blocksAt(d, place)[b].style = $any($event.target).value))">
                                    <option value="number" [selected]="block.style === 'number'">1. 2. 3.</option>
                                    <option value="clause" [selected]="block.style === 'clause'">{{ prefix }}.1 {{ prefix }}.2</option>
                                    <option value="bullet" [selected]="block.style === 'bullet'">• จุด</option>
                                </select>
                                <input class="cell flex-1" aria-label="หัวรายการ (ไม่บังคับ)" maxlength="300" placeholder="หัวรายการ (ไม่บังคับ)" [disabled]="readonly()" [value]="block.title ?? ''" (input)="update((d) => (blocksAt(d, place)[b].title = value($event) || undefined))" />
                            } @else {
                                <span class="flex-1"></span>
                            }
                            <ng-container *ngTemplateOutlet="moveButtons; context: { $implicit: 'block', place, index: b, last: lastBlock, label: kindLabel(block) }" />
                        </div>
                        @switch (block.kind) {
                            @case ('paragraph') {
                                <textarea class="cell area" aria-label="ย่อหน้า" maxlength="3000" [rows]="rows(block.text)" [disabled]="readonly()" [value]="block.text ?? ''" (input)="update((d) => (blocksAt(d, place)[b].text = value($event)))"></textarea>
                            }
                            @case ('list') {
                                @for (item of block.items; track $index; let k = $index; let lastItem = $last) {
                                    <div class="flex items-start gap-1">
                                        <span class="marker">{{ block.style === 'bullet' ? '•' : block.style === 'clause' ? prefix + '.' + (starts[block.id] + k + 1) : k + 1 + '.' }}</span>
                                        <textarea class="cell area flex-1" [attr.aria-label]="'รายการที่ ' + (k + 1)" maxlength="3000" [rows]="rows(item)" [disabled]="readonly()" [value]="item" (input)="update((d) => (blocksAt(d, place)[b].items![k] = value($event)))"></textarea>
                                        @if (!readonly()) {
                                            <button type="button" class="icon-btn" aria-label="เลื่อนรายการขึ้น" [disabled]="k === 0" (click)="moveItem(place, b, k, -1)"><i class="pi pi-arrow-up"></i></button>
                                            <button type="button" class="icon-btn" aria-label="เลื่อนรายการลง" [disabled]="lastItem" (click)="moveItem(place, b, k, 1)"><i class="pi pi-arrow-down"></i></button>
                                            <button type="button" class="icon-btn danger" aria-label="ลบรายการ" (click)="update((d) => blocksAt(d, place)[b].items!.splice(k, 1))"><i class="pi pi-times"></i></button>
                                        }
                                    </div>
                                }
                                @if (!readonly()) {
                                    <button type="button" class="link-btn ml-8" (click)="update((d) => blocksAt(d, place)[b].items!.push(''))"><i class="pi pi-plus text-xs"></i>เพิ่มรายการ</button>
                                }
                            }
                            @case ('responsibility') {
                                <div class="overflow-x-auto">
                                    <table class="resp">
                                        <thead>
                                            <tr>
                                                <th>รายการ</th>
                                                <th class="w-24">ผู้รับเหมา</th>
                                                <th class="w-28">เจ้าของโครงการ</th>
                                                <th class="w-48">หมายเหตุ</th>
                                                @if (!readonly()) {
                                                    <th class="w-10"></th>
                                                }
                                            </tr>
                                        </thead>
                                        <tbody>
                                            @for (row of block.rows; track row.id; let r = $index) {
                                                <tr>
                                                    <td><input class="cell" aria-label="รายการค่าใช้จ่าย" maxlength="300" [disabled]="readonly()" [value]="row.item" (input)="update((d) => (blocksAt(d, place)[b].rows![r].item = value($event)))" /></td>
                                                    <td class="text-center"><input type="checkbox" [attr.aria-label]="'ผู้รับเหมารับผิดชอบ ' + row.item" [disabled]="readonly()" [checked]="row.contractor" (change)="update((d) => (blocksAt(d, place)[b].rows![r].contractor = $any($event.target).checked))" /></td>
                                                    <td class="text-center"><input type="checkbox" [attr.aria-label]="'เจ้าของโครงการรับผิดชอบ ' + row.item" [disabled]="readonly()" [checked]="row.owner" (change)="update((d) => (blocksAt(d, place)[b].rows![r].owner = $any($event.target).checked))" /></td>
                                                    <td><input class="cell" aria-label="หมายเหตุ" maxlength="300" [disabled]="readonly()" [value]="row.note ?? ''" (input)="update((d) => (blocksAt(d, place)[b].rows![r].note = value($event) || undefined))" /></td>
                                                    @if (!readonly()) {
                                                        <td class="text-center"><button type="button" class="icon-btn danger" aria-label="ลบแถว" (click)="update((d) => blocksAt(d, place)[b].rows!.splice(r, 1))"><i class="pi pi-times"></i></button></td>
                                                    }
                                                </tr>
                                            }
                                        </tbody>
                                    </table>
                                </div>
                                @if (!readonly()) {
                                    <button type="button" class="link-btn" (click)="update((d) => blocksAt(d, place)[b].rows!.push({ id: newId('st'), item: '', contractor: false, owner: false }))"><i class="pi pi-plus text-xs"></i>เพิ่มแถว</button>
                                }
                            }
                        }
                    </div>
                }
                @if (!readonly()) {
                    <div class="flex flex-wrap gap-1">
                        <button type="button" class="link-btn" (click)="addBlock(place, 'paragraph')"><i class="pi pi-align-left text-xs"></i>ย่อหน้า</button>
                        <button type="button" class="link-btn" (click)="addBlock(place, 'list')"><i class="pi pi-list text-xs"></i>รายการ</button>
                        <button type="button" class="link-btn" (click)="addBlock(place, 'responsibility')"><i class="pi pi-table text-xs"></i>ตารางแบ่งความรับผิดชอบ</button>
                    </div>
                }
            </div>
        </ng-template>

        <!-- ปุ่มเลื่อน/ลบ -->
        <ng-template #moveButtons let-kind let-s="s" let-j="j" let-place="place" let-index="index" let-last="last" let-label="label">
            @if (!readonly()) {
                <span class="flex gap-0.5 flex-none">
                    <button type="button" class="icon-btn" [attr.aria-label]="'เลื่อน ' + label + ' ขึ้น'" [disabled]="index === 0" (click)="move(kind, { s, j, place }, index, -1)"><i class="pi pi-arrow-up"></i></button>
                    <button type="button" class="icon-btn" [attr.aria-label]="'เลื่อน ' + label + ' ลง'" [disabled]="last" (click)="move(kind, { s, j, place }, index, 1)"><i class="pi pi-arrow-down"></i></button>
                    <button type="button" class="icon-btn danger" [attr.aria-label]="'ลบ ' + label" (click)="remove(kind, { s, j, place }, index, label)"><i class="pi pi-trash"></i></button>
                </span>
            }
        </ng-template>
    `,
    styles: `
        .doc-title-input {
            font-size: 1.15rem;
            font-weight: 700;
            border: 1px solid var(--p-content-border-color);
            border-radius: 6px;
            padding: 0.4rem 0.6rem;
            background: transparent;
            color: var(--p-text-color);
        }
        .doc-card {
            border: 1px solid var(--p-content-border-color);
            border-radius: 8px;
            padding: 0.75rem;
            margin-bottom: 0.75rem;
        }
        .sub-card {
            border-left: 3px solid color-mix(in srgb, var(--p-primary-color) 45%, transparent);
            padding: 0.35rem 0 0.35rem 0.6rem;
            margin: 0.4rem 0 0.4rem 1.2rem;
        }
        .no {
            flex: 0 0 auto;
            min-width: 2.2rem;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
        }
        .blocks {
            margin: 0.4rem 0 0.2rem 2.4rem;
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
        }
        .block {
            border: 1px dashed var(--p-content-border-color);
            border-radius: 6px;
            padding: 0.4rem;
        }
        .block-head {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            margin-bottom: 0.25rem;
        }
        .kind {
            font-size: 0.7rem;
            font-weight: 600;
            text-transform: uppercase;
            color: var(--p-text-muted-color);
            white-space: nowrap;
        }
        .marker {
            flex: 0 0 auto;
            min-width: 2.2rem;
            padding-top: 0.3rem;
            text-align: right;
            font-variant-numeric: tabular-nums;
            color: var(--p-text-muted-color);
        }
        .cell {
            width: 100%;
            border: 1px solid transparent;
            border-radius: 4px;
            padding: 0.25rem 0.4rem;
            background: transparent;
            color: var(--p-text-color);
            font: inherit;
        }
        .cell:hover:not(:disabled),
        .cell:focus {
            border-color: var(--p-primary-color);
            background: var(--p-content-background);
            outline: none;
        }
        .area {
            resize: vertical;
            line-height: 1.5;
        }
        .mini-select {
            padding: 0.15rem 0.3rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 4px;
            background: transparent;
            color: var(--p-text-color);
            font: inherit;
            font-size: 0.8rem;
        }
        .icon-btn,
        .toggle {
            border: 0;
            background: transparent;
            color: var(--p-text-muted-color);
            padding: 0.25rem 0.35rem;
            border-radius: 4px;
            cursor: pointer;
        }
        .icon-btn:hover:not(:disabled),
        .toggle:hover {
            background: var(--p-content-hover-background);
            color: var(--p-text-color);
        }
        .icon-btn:disabled {
            opacity: 0.35;
            cursor: default;
        }
        .icon-btn.danger:hover {
            color: #dc2626;
        }
        .link-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.3rem;
            margin-right: 0.75rem;
            border: 0;
            background: transparent;
            color: var(--p-primary-color);
            font: inherit;
            font-size: 0.8rem;
            cursor: pointer;
            padding: 0.2rem 0;
        }
        table.resp {
            width: 100%;
            min-width: 40rem;
            border-collapse: collapse;
            font-size: 0.875rem;
        }
        .resp th,
        .resp td {
            border: 1px solid var(--p-content-border-color);
            padding: 0.15rem 0.3rem;
        }
        .resp th {
            background: var(--p-content-hover-background);
            font-weight: 600;
        }
    `
})
export class StatementEditor {
    private readonly service = inject(EstimateService);
    private readonly auth = inject(AuthService);
    private readonly messages = inject(MessageService);
    private readonly confirmation = inject(ConfirmationService);

    readonly statement = input.required<OverheadStatement>();
    readonly readonly = input(false);
    readonly changed = output<OverheadStatement>();

    /** หัวข้อย่อยที่ขยายอยู่ */
    readonly open = signal(new Set<string>());
    readonly busy = signal<'' | 'load' | 'save'>('');
    readonly canManageTemplate = computed(() => this.auth.can('project.manage'));
    readonly newId = newId;
    readonly clauses = clauseStarts;
    readonly asBlocks = (blocks: StatementBlock[]) => blocks;

    value(event: Event) {
        return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    }

    /** ความสูงช่องข้อความตามความยาว (ประมาณ 150 ตัวอักษรต่อบรรทัด) */
    rows(text: string | undefined) {
        return Math.min(12, Math.max(1, Math.ceil((text ?? '').length / 150) + (text ?? '').split('\n').length - 1));
    }

    kindLabel(block: StatementBlock) {
        return block.kind === 'paragraph' ? 'ย่อหน้า' : block.kind === 'list' ? 'รายการ' : 'ตารางแบ่งความรับผิดชอบ';
    }

    summary(blocks: StatementBlock[]) {
        const items = blocks.reduce((sum, block) => sum + (block.items?.length ?? 0) + (block.rows?.length ?? 0), 0);
        return items ? `${items} รายการ` : `${blocks.length} ย่อหน้า`;
    }

    toggle(id: string) {
        this.open.update((open) => {
            const next = new Set(open);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    collapseAll() {
        this.open.set(new Set());
    }

    expandAll() {
        this.open.set(new Set(this.statement().sections.flatMap((section) => section.subsections.map((subsection) => subsection.id))));
    }

    // ---------- แก้เอกสาร (สำเนาใหม่ทุกครั้ง) ----------

    update(change: (draft: OverheadStatement) => unknown) {
        if (this.readonly()) return;
        const draft = structuredClone(this.statement());
        change(draft);
        this.changed.emit(draft);
    }

    blocksAt(draft: OverheadStatement, place: Place): StatementBlock[] {
        const section = draft.sections[place.s];
        return place.j === null ? section.blocks : section.subsections[place.j].blocks;
    }

    private listOf(draft: OverheadStatement, kind: 'section' | 'subsection' | 'block', at: { s: number; j: number | null; place?: Place }): unknown[] {
        if (kind === 'section') return draft.sections;
        if (kind === 'subsection') return draft.sections[at.s].subsections;
        return this.blocksAt(draft, at.place!);
    }

    move(kind: 'section' | 'subsection' | 'block', at: { s: number; j: number | null; place?: Place }, index: number, step: -1 | 1) {
        this.update((draft) => {
            const list = this.listOf(draft, kind, at);
            const target = index + step;
            if (target < 0 || target >= list.length) return;
            [list[index], list[target]] = [list[target], list[index]];
        });
    }

    moveItem(place: Place, block: number, index: number, step: -1 | 1) {
        this.update((draft) => {
            const items = this.blocksAt(draft, place)[block].items!;
            const target = index + step;
            if (target < 0 || target >= items.length) return;
            [items[index], items[target]] = [items[target], items[index]];
        });
    }

    remove(kind: 'section' | 'subsection' | 'block', at: { s: number; j: number | null; place?: Place }, index: number, label: string) {
        const run = () => this.update((draft) => this.listOf(draft, kind, at).splice(index, 1));
        if (kind === 'block') return run();
        this.confirmation.confirm({
            header: `ลบ${label}`,
            message: kind === 'section' ? 'ลบหัวข้อนี้พร้อมหัวข้อย่อยและเนื้อหาทั้งหมด? (ยกเลิกได้โดยไม่กดบันทึก BOQ)' : 'ลบหัวข้อย่อยนี้พร้อมเนื้อหา? (ยกเลิกได้โดยไม่กดบันทึก BOQ)',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'ลบ',
            rejectLabel: 'ยกเลิก',
            acceptButtonProps: { severity: 'danger' },
            rejectButtonProps: { severity: 'secondary', outlined: true },
            accept: run
        });
    }

    addSection() {
        this.update((draft) => draft.sections.push({ id: newId('st'), title: 'หัวข้อใหม่', blocks: [{ id: newId('st'), kind: 'paragraph', text: '' }], subsections: [] }));
    }

    addSubsection(s: number) {
        const id = newId('st');
        this.update((draft) => draft.sections[s].subsections.push({ id, title: 'หัวข้อย่อยใหม่', blocks: [{ id: newId('st'), kind: 'list', style: 'number', items: [''] }] }));
        this.open.update((open) => new Set(open).add(id));
    }

    addBlock(place: Place, kind: StatementBlock['kind']) {
        const block: StatementBlock =
            kind === 'paragraph' ? { id: newId('st'), kind, text: '' }
            : kind === 'list' ? { id: newId('st'), kind, style: 'number', items: [''] }
            : { id: newId('st'), kind, rows: [{ id: newId('st'), item: '', contractor: false, owner: false }] };
        this.update((draft) => this.blocksAt(draft, place).push(block));
    }

    // ---------- แม่แบบบริษัท ----------

    loadTemplate() {
        this.confirmation.confirm({
            header: 'ใช้แม่แบบบริษัท',
            message: 'แทนที่เอกสารชี้แจงของ BOQ นี้ด้วยแม่แบบล่าสุดของบริษัท? (ยกเลิกได้โดยไม่กดบันทึก BOQ)',
            icon: 'pi pi-question-circle',
            acceptLabel: 'แทนที่',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { severity: 'secondary', outlined: true },
            accept: () => {
                this.busy.set('load');
                this.service.statementTemplate().subscribe({
                    next: (template) => {
                        this.busy.set('');
                        this.changed.emit(template);
                        this.messages.add({ severity: 'info', summary: 'ใช้แม่แบบบริษัทแล้ว', detail: 'กดบันทึกเพื่อเก็บใน BOQ นี้' });
                    },
                    error: (error) => {
                        this.busy.set('');
                        this.messages.add({ severity: 'error', summary: problemMessage(error, 'โหลดแม่แบบไม่สำเร็จ') });
                    }
                });
            }
        });
    }

    saveTemplate() {
        this.confirmation.confirm({
            header: 'บันทึกเป็นแม่แบบบริษัท',
            message: 'ใช้เอกสารชี้แจงนี้เป็นแม่แบบของ BOQ ที่สร้างใหม่ต่อจากนี้? (BOQ ที่มีอยู่แล้วไม่เปลี่ยน)',
            icon: 'pi pi-question-circle',
            acceptLabel: 'บันทึกแม่แบบ',
            rejectLabel: 'ยกเลิก',
            rejectButtonProps: { severity: 'secondary', outlined: true },
            accept: () => {
                this.busy.set('save');
                this.service.saveStatementTemplate(this.statement()).subscribe({
                    next: () => {
                        this.busy.set('');
                        this.messages.add({ severity: 'success', summary: 'บันทึกแม่แบบบริษัทแล้ว', detail: 'BOQ ใหม่จะใช้เอกสารชี้แจงนี้' });
                    },
                    error: (error) => {
                        this.busy.set('');
                        this.messages.add({ severity: 'error', summary: problemMessage(error, 'บันทึกแม่แบบไม่สำเร็จ') });
                    }
                });
            }
        });
    }
}
