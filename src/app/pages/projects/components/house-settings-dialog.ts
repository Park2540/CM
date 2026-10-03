import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import { ProjectHouse, ProjectHouseInput, ProjectHouseService, RENDER_VIEWS, RenderView } from '@/app/pages/service/project-house.service';

type NumberKey = 'usableArea' | 'width' | 'depth' | 'floors' | 'bedrooms' | 'bathrooms' | 'kitchens' | 'parking';
interface FloorPlanRow {
    key: number;
    label: string;
    image: UploadedFile;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const NUMBER_FIELDS: Array<{ key: NumberKey; label: string; unit: string; step: number }> = [
    { key: 'usableArea', label: 'พื้นที่ใช้สอย', unit: 'ตร.ม.', step: 0.5 },
    { key: 'width', label: 'ความกว้าง', unit: 'ม.', step: 0.1 },
    { key: 'depth', label: 'ความลึก', unit: 'ม.', step: 0.1 },
    { key: 'floors', label: 'จำนวนชั้น', unit: 'ชั้น', step: 1 },
    { key: 'bedrooms', label: 'ห้องนอน', unit: 'ห้อง', step: 1 },
    { key: 'bathrooms', label: 'ห้องน้ำ', unit: 'ห้อง', step: 1 },
    { key: 'kitchens', label: 'ห้องครัว', unit: 'ห้อง', step: 1 },
    { key: 'parking', label: 'ที่จอดรถ', unit: 'คัน', step: 1 }
];

/** ตั้งค่าแบบบ้าน: รายละเอียดที่ผู้ตั้งค่ากรอกเอง ภาพแปลนรายชั้น และภาพทัศนียภาพ 4 มุม (PUT /projects/{code}/house) */
@Component({
    selector: 'app-house-settings-dialog',
    standalone: true,
    imports: [ButtonModule, DialogModule, FormsModule, InputTextModule, NgClass, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && closed.emit()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(56rem, 96vw)' }" header="ตั้งค่าแบบบ้าน">
            @if (!house().configured && house().name) {
                <p class="text-sm rounded-lg px-3 py-2 mt-0 mb-4 bg-blue-50 text-blue-900 dark:bg-blue-500/15 dark:text-blue-100"><i class="pi pi-info-circle mr-1"></i>กรอกค่าเริ่มต้นจากแบบบ้านในคลังให้แล้ว แก้ไขให้ตรงกับแบบจริงของโครงการนี้ได้</p>
            }

            <section aria-labelledby="house-detail-heading">
                <h3 id="house-detail-heading" class="text-base font-semibold mt-0 mb-3">รายละเอียด</h3>
                <div class="grid grid-cols-1 gap-4">
                    <div>
                        <label for="house-name" class="block text-sm font-semibold mb-2">ชื่อแบบบ้าน <span class="text-red-600" aria-hidden="true">*</span></label>
                        <input pInputText id="house-name" class="w-full" maxlength="200" [ngModel]="name()" (ngModelChange)="name.set($event)" [attr.aria-invalid]="!!errors()['name']" />
                        @if (errors()['name']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['name'] }}</small>
                        }
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        @for (field of numberFields; track field.key) {
                            <div>
                                <label [for]="'house-' + field.key" class="block text-sm font-semibold mb-2">{{ field.label }} <span class="font-normal text-muted-color">({{ field.unit }})</span></label>
                                <input
                                    pInputText
                                    type="number"
                                    min="0"
                                    [step]="field.step"
                                    [id]="'house-' + field.key"
                                    class="w-full"
                                    [value]="numbers()[field.key] ?? ''"
                                    (input)="setNumber(field.key, $any($event.target).value)"
                                    [attr.aria-invalid]="!!errors()[field.key]"
                                />
                                @if (errors()[field.key]) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()[field.key] }}</small>
                                }
                            </div>
                        }
                    </div>
                    <div>
                        <label for="house-description" class="block text-sm font-semibold mb-2">คำอธิบาย</label>
                        <textarea pTextarea id="house-description" rows="3" maxlength="2000" class="w-full" placeholder="เช่น บ้านเดี่ยว 2 ชั้น โถงนั่งเล่นเพดานสูง ห้องนอนผู้สูงอายุชั้นล่าง" [ngModel]="description()" (ngModelChange)="description.set($event)"></textarea>
                    </div>
                </div>
            </section>

            <section class="mt-6" aria-labelledby="house-plans-heading">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h3 id="house-plans-heading" class="text-base font-semibold m-0">ภาพแปลนรายชั้น</h3>
                    @if (floorPlans().length < 10) {
                        <label class="p-button p-button-outlined p-button-sm cursor-pointer inline-flex items-center gap-2">
                            <i class="pi pi-plus"></i>เพิ่มภาพแปลน
                            <input type="file" multiple class="sr-only" [accept]="imageAccept" (change)="addFloorPlans($event)" />
                        </label>
                    }
                </div>
                @if (errors()['floorPlans']) {
                    <small class="block mb-2 text-red-600 dark:text-red-400">{{ errors()['floorPlans'] }}</small>
                }
                <ol class="list-none p-0 m-0 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    @for (row of floorPlans(); track row.key; let i = $index; let first = $first; let last = $last) {
                        <li class="flex gap-3 p-2 rounded-lg border" [ngClass]="errors()['floorPlans.' + i] || errors()['floorPlans.' + i + '.label'] ? 'border-red-400' : 'border-surface'">
                            <img [src]="row.image.url" [alt]="'แปลน ' + row.label" class="w-24 h-20 object-contain rounded bg-surface-100 dark:bg-surface-800 shrink-0" />
                            <div class="flex-1 min-w-0 flex flex-col gap-1">
                                <input pInputText class="w-full" maxlength="60" [attr.aria-label]="'ชื่อชั้นของภาพแปลนที่ ' + (i + 1)" [ngModel]="row.label" (ngModelChange)="renameFloor(i, $event)" />
                                <span class="text-xs text-muted-color truncate">{{ row.image.name }}</span>
                                @if (errors()['floorPlans.' + i + '.label'] || errors()['floorPlans.' + i]; as message) {
                                    <small class="text-red-600 dark:text-red-400">{{ message }}</small>
                                }
                                <div class="flex gap-1 mt-auto">
                                    <button pButton type="button" icon="pi pi-arrow-up" [text]="true" size="small" severity="secondary" [disabled]="first" [attr.aria-label]="'เลื่อน ' + row.label + ' ขึ้น'" (click)="moveFloor(i, -1)"></button>
                                    <button pButton type="button" icon="pi pi-arrow-down" [text]="true" size="small" severity="secondary" [disabled]="last" [attr.aria-label]="'เลื่อน ' + row.label + ' ลง'" (click)="moveFloor(i, 1)"></button>
                                    <button pButton type="button" icon="pi pi-trash" [text]="true" size="small" severity="danger" class="ml-auto" [attr.aria-label]="'นำภาพแปลน ' + row.label + ' ออก'" (click)="removeFloor(i)"></button>
                                </div>
                            </div>
                        </li>
                    }
                    @for (i of pendingSlots(); track $index) {
                        <li class="flex items-center justify-center gap-2 p-4 rounded-lg border border-dashed border-surface text-sm text-muted-color"><i class="pi pi-spin pi-spinner"></i>กำลังอัปโหลด...</li>
                    }
                </ol>
                @if (!floorPlans().length && !uploading()) {
                    <p class="text-sm text-muted-color m-0">ยังไม่มีภาพแปลน — อัปโหลดภาพแปลนแต่ละชั้น (JPG, PNG, WebP ไม่เกิน 10 MB) แล้วตั้งชื่อชั้น</p>
                }
            </section>

            <section class="mt-6" aria-labelledby="house-renders-heading">
                <h3 id="house-renders-heading" class="text-base font-semibold mt-0 mb-3">ภาพทัศนียภาพ 4 มุม</h3>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    @for (view of renderViews; track view.value) {
                        <div>
                            <div class="text-sm font-semibold mb-1">{{ view.label }}</div>
                            @if (renders()[view.value]; as image) {
                                <div class="relative rounded-lg overflow-hidden border border-surface">
                                    <img [src]="image.url" [alt]="'ทัศนียภาพ' + view.label" class="w-full h-28 object-cover block" />
                                    <div class="absolute top-1 right-1 flex gap-1">
                                        <label class="render-action" [attr.aria-label]="'เปลี่ยนภาพ' + view.label" [title]="'เปลี่ยนภาพ' + view.label">
                                            <i class="pi pi-refresh"></i>
                                            <input type="file" class="sr-only" [accept]="imageAccept" (change)="setRender(view.value, $event)" />
                                        </label>
                                        <button type="button" class="render-action" [attr.aria-label]="'นำภาพ' + view.label + 'ออก'" (click)="clearRender(view.value)"><i class="pi pi-trash"></i></button>
                                    </div>
                                </div>
                            } @else if (renderUploading()[view.value]) {
                                <div class="h-28 flex items-center justify-center gap-2 rounded-lg border border-dashed border-surface text-sm text-muted-color"><i class="pi pi-spin pi-spinner"></i>กำลังอัปโหลด</div>
                            } @else {
                                <label
                                    class="h-28 flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed cursor-pointer text-sm hover:border-primary hover:text-primary focus-within:outline-2 focus-within:outline-primary"
                                    [ngClass]="errors()['renders.' + view.value] ? 'border-red-400 text-red-600' : 'border-surface text-muted-color'"
                                >
                                    <i class="pi pi-image"></i>อัปโหลดภาพ
                                    <input type="file" class="sr-only" [accept]="imageAccept" (change)="setRender(view.value, $event)" />
                                </label>
                            }
                            @if (errors()['renders.' + view.value]; as message) {
                                <small class="text-red-600 dark:text-red-400">{{ message }}</small>
                            }
                        </div>
                    }
                </div>
            </section>

            @for (message of uploadErrors(); track $index) {
                <small class="block mt-3 text-red-600 dark:text-red-400" role="alert">{{ message }}</small>
            }
            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }

            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="closed.emit()"></button>
                <button pButton type="button" icon="pi pi-check" label="บันทึก" [loading]="saving()" [disabled]="uploading() > 0 || renderBusy()" (click)="save()"></button>
            </ng-template>
        </p-dialog>
    `,
    styles: `
        .render-action {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.75rem;
            height: 1.75rem;
            border-radius: 999px;
            border: 0;
            background: color-mix(in srgb, var(--p-content-background) 90%, transparent);
            color: var(--p-text-color);
            cursor: pointer;
            font-size: 0.75rem;
        }
    `
})
export class HouseSettingsDialog implements OnInit {
    private readonly service = inject(ProjectHouseService);
    private readonly files = inject(FileUploadService);

    readonly projectCode = input.required<string>();
    readonly house = input.required<ProjectHouse>();
    readonly saved = output<ProjectHouse>();
    readonly closed = output<void>();

    readonly numberFields = NUMBER_FIELDS;
    readonly renderViews = RENDER_VIEWS;
    readonly imageAccept = IMAGE_ACCEPT;

    readonly name = signal('');
    readonly description = signal('');
    readonly numbers = signal<Partial<Record<NumberKey, number>>>({});
    readonly floorPlans = signal<FloorPlanRow[]>([]);
    readonly renders = signal<Partial<Record<RenderView, UploadedFile>>>({});
    readonly uploading = signal(0);
    readonly renderUploading = signal<Partial<Record<RenderView, boolean>>>({});
    readonly uploadErrors = signal<string[]>([]);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');
    readonly pendingSlots = () => Array.from({ length: this.uploading() });
    readonly renderBusy = () => Object.values(this.renderUploading()).some(Boolean);
    private nextKey = 0;

    ngOnInit() {
        const house = this.house();
        this.name.set(house.name);
        this.description.set(house.description ?? '');
        this.numbers.set(Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, house[key]]).filter(([, value]) => value !== undefined)));
        this.floorPlans.set(house.floorPlans.map((plan) => ({ key: this.nextKey++, label: plan.label, image: plan.image })));
        this.renders.set({ ...house.renders });
    }

    setNumber(key: NumberKey, raw: string) {
        this.numbers.update((numbers) => {
            const next = { ...numbers };
            if (raw.trim() === '') delete next[key];
            else next[key] = Number(raw);
            return next;
        });
    }

    addFloorPlans(event: Event) {
        const element = event.target as HTMLInputElement;
        const selected = Array.from(element.files ?? []);
        element.value = '';
        this.uploadErrors.set([]);
        const room = 10 - this.floorPlans().length - this.uploading();
        if (selected.length > room) this.uploadErrors.update((list) => [...list, `เพิ่มภาพแปลนได้อีก ${room} ภาพ (สูงสุด 10 ชั้น)`]);
        for (const file of selected.slice(0, Math.max(0, room))) {
            this.uploading.update((count) => count + 1);
            this.files.upload(file).subscribe({
                next: (image) => {
                    this.uploading.update((count) => count - 1);
                    this.floorPlans.update((rows) => [...rows, { key: this.nextKey++, label: `ชั้น ${rows.length + 1}`, image }]);
                },
                error: (error) => {
                    this.uploading.update((count) => count - 1);
                    this.uploadErrors.update((list) => [...list, `${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`]);
                }
            });
        }
    }

    renameFloor(index: number, label: string) {
        this.floorPlans.update((rows) => rows.map((row, i) => (i === index ? { ...row, label } : row)));
    }

    moveFloor(index: number, offset: number) {
        this.floorPlans.update((rows) => {
            const next = [...rows];
            [next[index], next[index + offset]] = [next[index + offset]!, next[index]!];
            return next;
        });
    }

    removeFloor(index: number) {
        this.floorPlans.update((rows) => rows.filter((_, i) => i !== index));
    }

    setRender(view: RenderView, event: Event) {
        const element = event.target as HTMLInputElement;
        const file = element.files?.[0];
        element.value = '';
        if (!file) return;
        this.uploadErrors.set([]);
        this.renderUploading.update((state) => ({ ...state, [view]: true }));
        this.files.upload(file).subscribe({
            next: (image) => {
                this.renderUploading.update((state) => ({ ...state, [view]: false }));
                this.renders.update((renders) => ({ ...renders, [view]: image }));
            },
            error: (error) => {
                this.renderUploading.update((state) => ({ ...state, [view]: false }));
                this.uploadErrors.update((list) => [...list, `${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`]);
            }
        });
    }

    clearRender(view: RenderView) {
        this.renders.update(({ [view]: _, ...rest }) => rest);
    }

    save() {
        if (!this.name().trim()) {
            this.errors.set({ name: 'กรุณาระบุชื่อแบบบ้าน' });
            return;
        }
        const input: ProjectHouseInput = {
            name: this.name().trim(),
            ...(this.description().trim() ? { description: this.description().trim() } : {}),
            ...this.numbers(),
            floorPlans: this.floorPlans().map((row) => ({ label: row.label.trim(), fileId: row.image.id })),
            renders: Object.fromEntries(Object.entries(this.renders()).map(([view, image]) => [view, image.id]))
        };
        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        this.service.save(this.projectCode(), input).subscribe({
            next: (house) => {
                this.saving.set(false);
                this.saved.emit(house);
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) this.errors.set(problem.errors);
                this.generalError.set(problemMessage(error, 'บันทึกข้อมูลแบบบ้านไม่สำเร็จ'));
            }
        });
    }
}
