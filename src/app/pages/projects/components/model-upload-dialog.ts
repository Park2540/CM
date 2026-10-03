import { DecimalPipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import {
    FORMAT_LABEL,
    MAX_MODEL_MB,
    ModelFile,
    ModelSourceApp,
    ProjectModel,
    ProjectModelService,
    SOURCE_APP,
    SOURCE_MODEL_EXTENSIONS,
    UpAxis,
    ALL_MODEL_ACCEPT,
    modelFormatOf
} from '@/app/pages/service/project-model.service';
import { HouseModelViewer } from './house-model-viewer';

type Slot = 'file' | 'source';

/** อัปโหลดแบบบ้าน 3 มิติเวอร์ชันใหม่: ไฟล์สำหรับแสดงผล (บังคับ) + ไฟล์ต้นฉบับ .skp / .rvt / .ifc (ไม่บังคับ) */
@Component({
    selector: 'app-model-upload-dialog',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, HouseModelViewer, InputTextModule, NgClass, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && close()" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(46rem, 95vw)' }" header="อัปโหลดแบบบ้าน 3 มิติ">
            <fieldset class="border-0 p-0 m-0 mb-4">
                <legend class="text-sm font-semibold mb-2 p-0">ออกแบบด้วยโปรแกรม</legend>
                <div class="grid grid-cols-3 gap-2">
                    @for (app of apps; track app.value) {
                        <button
                            type="button"
                            class="p-3 rounded-lg border-2 cursor-pointer bg-transparent text-color text-sm"
                            [ngClass]="sourceApp() === app.value ? 'border-primary font-semibold' : 'border-surface'"
                            [attr.aria-pressed]="sourceApp() === app.value"
                            (click)="sourceApp.set(app.value)"
                        >
                            {{ app.label }}
                        </button>
                    }
                </div>
            </fieldset>

            <div class="rounded-lg px-4 py-3 mb-4 text-sm bg-blue-50 text-blue-900 dark:bg-blue-500/15 dark:text-blue-100">
                <div class="font-semibold mb-1"><i class="pi pi-info-circle mr-1"></i>ส่งออกไฟล์สำหรับแสดงผลจาก {{ appInfo().label }}</div>
                <ul class="m-0 pl-5">
                    @for (hint of appInfo().exportHint; track $index) {
                        <li>{{ hint }}</li>
                    }
                </ul>
                @if (appInfo().sourceExtension) {
                    <div class="mt-1">ไฟล์ {{ appInfo().sourceExtension }} แนบได้เลย (เก็บไว้ให้ทีมดาวน์โหลดไปแก้ไข) แต่จะแสดงเป็นโมเดล 3D ได้เมื่อแนบไฟล์ที่ส่งออกตามวิธีข้างบนด้วย</div>
                }
            </div>

            <label
                class="flex flex-col items-center justify-center gap-1 p-5 mb-4 rounded-lg border-2 border-dashed cursor-pointer text-sm text-center hover:border-primary hover:text-primary focus-within:outline-2 focus-within:outline-primary"
                [ngClass]="errors()['fileId'] ? 'border-red-400 text-red-600 dark:text-red-400' : 'border-surface text-muted-color'"
            >
                <i class="pi pi-upload text-xl"></i>
                <span class="font-semibold text-color">เลือกไฟล์แบบ 3 มิติ (เลือกพร้อมกันได้หลายไฟล์)</span>
                <span>.skp .rvt .ifc .glb .gltf .dae .fbx .obj · ไม่เกิน {{ maxMb }} MB ต่อไฟล์ · ระบบแยกไฟล์ต้นฉบับกับไฟล์แสดงผลให้เอง</span>
                <input type="file" multiple class="sr-only" [accept]="allAccept" (change)="onSelect($event)" />
            </label>
            @for (message of pickErrors(); track $index) {
                <small class="block -mt-2 mb-3 text-red-600 dark:text-red-400" role="alert">{{ message }}</small>
            }

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                @for (slot of slots; track slot) {
                    <div>
                        <div class="text-sm font-semibold mb-2">
                            @if (slot === 'file') {
                                ไฟล์สำหรับแสดงผล 3D
                                <span class="block text-xs font-normal text-muted-color">.glb .gltf .dae .fbx .obj</span>
                            } @else {
                                ไฟล์ต้นฉบับ
                                <span class="block text-xs font-normal text-muted-color">.skp (SketchUp) .rvt (Revit) หรือ .ifc</span>
                            }
                        </div>
                        @if (uploaded()[slot]; as file) {
                            <div class="flex items-center gap-2 p-2 rounded-lg border border-surface">
                                <i class="pi pi-box ml-1 text-primary" aria-hidden="true"></i>
                                <span class="flex-1 min-w-0">
                                    <span class="block truncate text-sm">{{ file.name }}</span>
                                    <span class="block text-xs text-muted-color">{{ file.sizeKb / 1024 | number: '1.0-1' }} MB{{ slot === 'file' ? ' · ' + formatLabel() : '' }}</span>
                                </span>
                                <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" [attr.aria-label]="'นำออก ' + file.name" [disabled]="saving()" (click)="clear(slot)"></button>
                            </div>
                        } @else if (progress()[slot] !== null) {
                            <div class="p-3 rounded-lg border border-dashed border-surface text-sm">
                                <div class="flex justify-between mb-1"><span class="truncate">{{ pendingName()[slot] }}</span><span>{{ progress()[slot] }}%</span></div>
                                <div class="h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden"><div class="h-full bg-primary" [style.width.%]="progress()[slot]"></div></div>
                                <button type="button" class="mt-2 p-0 border-0 bg-transparent text-xs text-muted-color underline cursor-pointer" (click)="cancelUpload(slot)">ยกเลิกการอัปโหลด</button>
                            </div>
                        } @else {
                            <div class="p-3 rounded-lg border border-dashed border-surface text-sm text-muted-color">ยังไม่มี</div>
                        }
                        @if (errors()[slot === 'file' ? 'fileId' : 'sourceFileId']; as message) {
                            <small class="block mt-1 text-red-600 dark:text-red-400">{{ message }}</small>
                        }
                    </div>
                }
            </div>

            @if (uploaded().source && !uploaded().file && progress().file === null) {
                <div class="rounded-lg px-4 py-3 mt-4 text-sm bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100" role="status">
                    @if (sourceExtension() === '.ifc') {
                        <i class="pi pi-sync mr-1"></i>บันทึกได้เลย — ระบบจะ<strong>แปลงไฟล์ IFC เป็น 3D ให้อัตโนมัติ</strong>หลังบันทึก และแยกเปิด/ปิดได้ตามงาน หมวด ชั้น และระบบ (รวมเหล็กเสริมและงานระบบ)
                    } @else if (sourceExtension() === '.skp') {
                        <i class="pi pi-sync mr-1"></i>บันทึกได้เลย — ระบบจะ<strong>แปลงไฟล์ .skp เป็น 3D ให้อัตโนมัติ</strong>หลังบันทึก (ไฟล์ใหญ่อาจใช้เวลาหลายนาที)
                        <div class="mt-1">
                            ไฟล์ต้องบันทึกจาก SketchUp รุ่นเดียวกับที่ติดตั้งบนเซิร์ฟเวอร์หรือเก่ากว่า ถ้าแปลงไม่สำเร็จ ให้ส่งออกเป็น <strong>GLTF Exporter (*.glb)</strong> แล้วกด "เลือกไฟล์" เพิ่ม
                        </div>
                    } @else if (sourceExtension() === '.rvt') {
                        <i class="pi pi-exclamation-circle mr-1"></i>บันทึกได้ แต่ไฟล์ .rvt ยังแปลงเป็น 3D ไม่ได้ — ใน Revit ให้ <strong>File › Export › IFC</strong> แล้วกด "เลือกไฟล์" เพิ่มไฟล์ .ifc (แยกเปิด/ปิดเหล็กเสริมและงานระบบได้)
                    } @else {
                        <i class="pi pi-exclamation-circle mr-1"></i>บันทึกได้ แต่เวอร์ชันนี้จะยังไม่แสดงเป็นโมเดล 3D เพราะเบราว์เซอร์เปิดไฟล์ {{ appInfo().sourceExtension || 'ต้นฉบับ' }} ไม่ได้
                        <div class="mt-1">ให้แสดง 3D: ส่งออกตามวิธีข้างบน แล้วกด "เลือกไฟล์" เพื่อเพิ่มไฟล์ที่ส่งออก — ไฟล์ต้นฉบับที่เลือกไว้ยังอยู่</div>
                    }
                </div>
            }

            @if (preview(); as model) {
                <div class="mt-4">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <span class="text-sm font-semibold">ตัวอย่างก่อนบันทึก</span>
                        @if (model.format === 'obj') {
                            <span class="flex items-center gap-3 text-sm" role="radiogroup" aria-label="แกนตั้งของไฟล์">
                                แกนตั้ง:
                                @for (axis of axes; track axis) {
                                    <label class="flex items-center gap-1 cursor-pointer"><input type="radio" name="upAxis" class="accent-[var(--p-primary-color)]" [checked]="upAxis() === axis" (change)="upAxis.set(axis)" />{{ axis.toUpperCase() }}</label>
                                }
                            </span>
                        }
                    </div>
                    <div class="h-64"><app-house-model-viewer class="h-full" [model]="model" /></div>
                    <small class="block mt-1 text-muted-color">ถ้าโมเดลนอนราบ กด "สลับแกนตั้ง" ในตัวอย่าง{{ model.format === 'obj' ? ' แล้วเลือกแกนตั้ง Z เพื่อบันทึกค่านี้' : '' }}</small>
                </div>
            }

            <div class="grid grid-cols-1 gap-4 mt-4">
                <div>
                    <label for="model-title" class="block text-sm font-semibold mb-2">ชื่อเวอร์ชัน</label>
                    <input pInputText id="model-title" class="w-full" maxlength="120" [placeholder]="'แบบ 3D ฉบับที่ ' + nextVersion()" [ngModel]="title()" (ngModelChange)="title.set($event)" />
                </div>
                <div>
                    <label for="model-note" class="block text-sm font-semibold mb-2">หมายเหตุ</label>
                    <textarea pTextarea id="model-note" rows="2" maxlength="500" class="w-full" placeholder="เช่น ปรับตามที่ลูกค้าขอเพิ่มห้องนอนชั้น 2" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
                </div>
            </div>

            @if (generalError()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
            }

            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="close()"></button>
                <button pButton type="button" icon="pi pi-check" label="บันทึกเป็นเวอร์ชันใหม่" [loading]="saving()" [disabled]="(!uploaded().file && !uploaded().source) || uploading()" (click)="save()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class ModelUploadDialog {
    private readonly files = inject(FileUploadService);
    private readonly models = inject(ProjectModelService);

    readonly projectCode = input.required<string>();
    readonly nextVersion = input(1);
    readonly saved = output<ProjectModel>();
    readonly closed = output<void>();

    readonly slots: Slot[] = ['file', 'source'];
    readonly axes: UpAxis[] = ['y', 'z'];
    readonly apps = (Object.keys(SOURCE_APP) as ModelSourceApp[]).map((value) => ({ value, label: SOURCE_APP[value].label }));
    readonly allAccept = ALL_MODEL_ACCEPT;
    readonly maxMb = MAX_MODEL_MB;

    readonly sourceApp = signal<ModelSourceApp>('sketchup');
    readonly uploaded = signal<Record<Slot, UploadedFile | null>>({ file: null, source: null });
    readonly progress = signal<Record<Slot, number | null>>({ file: null, source: null });
    readonly pendingName = signal<Record<Slot, string>>({ file: '', source: '' });
    readonly upAxis = signal<UpAxis>('y');
    readonly title = signal('');
    readonly note = signal('');
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    /** ไฟล์ที่เลือกแล้วใช้ไม่ได้ (นามสกุลไม่รองรับ ขนาดเกิน) */
    readonly pickErrors = signal<string[]>([]);
    readonly generalError = signal('');
    private readonly subscriptions: Partial<Record<Slot, Subscription>> = {};

    readonly appInfo = computed(() => SOURCE_APP[this.sourceApp()]);
    /** นามสกุลของไฟล์ต้นฉบับ (.skp / .ifc หลังบ้านแปลงเป็น 3 มิติให้, .rvt ยังแปลงไม่ได้) */
    readonly sourceExtension = computed(() => {
        const name = this.uploaded().source?.name.toLowerCase() ?? '';
        return name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
    });
    readonly uploading = computed(() => this.progress().file !== null || this.progress().source !== null);
    readonly formatLabel = computed(() => {
        const format = this.uploaded().file ? modelFormatOf(this.uploaded().file!.name) : null;
        return format ? FORMAT_LABEL[format] : '';
    });
    readonly preview = computed((): ModelFile | null => {
        const file = this.uploaded().file;
        const format = file ? modelFormatOf(file.name) : null;
        return file && format ? { url: file.url, name: file.name, format, upAxis: format === 'obj' ? this.upAxis() : 'y' } : null;
    });

    /** เลือกได้หลายไฟล์ในครั้งเดียว แยกช่องตามนามสกุล (.skp/.rvt/.ifc = ต้นฉบับ ที่เหลือ = ไฟล์แสดงผล) ช่องละ 1 ไฟล์ ไฟล์ใหม่แทนที่ไฟล์เดิม */
    onSelect(event: Event) {
        const element = event.target as HTMLInputElement;
        const selected = Array.from(element.files ?? []);
        element.value = '';
        const messages: string[] = [];
        const taken = new Set<Slot>();
        for (const file of selected) {
            const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
            const slot: Slot | null = SOURCE_MODEL_EXTENSIONS.includes(extension) ? 'source' : modelFormatOf(file.name) ? 'file' : null;
            if (!slot) messages.push(extension === 'skb' ? `${file.name}: เป็นไฟล์สำรองอัตโนมัติของ SketchUp ให้เลือกไฟล์ .skp แทน` : `${file.name}: ไม่รองรับไฟล์ .${extension}`);
            else if (file.size > MAX_MODEL_MB * 1024 * 1024) messages.push(`${file.name}: ใหญ่เกิน ${MAX_MODEL_MB} MB`);
            else if (taken.has(slot)) messages.push(`${file.name}: เลือก${slot === 'file' ? 'ไฟล์แสดงผล' : 'ไฟล์ต้นฉบับ'}ได้ครั้งละ 1 ไฟล์`);
            else {
                taken.add(slot);
                this.start(slot, file, extension);
            }
        }
        this.pickErrors.set(messages);
    }

    private start(slot: Slot, file: File, extension: string) {
        const key = slot === 'file' ? 'fileId' : 'sourceFileId';
        this.subscriptions[slot]?.unsubscribe();
        this.uploaded.update((value) => ({ ...value, [slot]: null }));
        this.errors.update(({ [key]: _, fileId: __, ...rest }) => rest);

        // เดาโปรแกรมจากไฟล์ต้นฉบับ
        if (extension === 'skp') this.sourceApp.set('sketchup');
        if (extension === 'rvt') this.sourceApp.set('revit');

        this.pendingName.update((names) => ({ ...names, [slot]: file.name }));
        this.progress.update((value) => ({ ...value, [slot]: 0 }));
        this.subscriptions[slot] = this.files.uploadWithProgress(file).subscribe({
            next: ({ progress, file: done }) => {
                if (done) {
                    this.uploaded.update((value) => ({ ...value, [slot]: done }));
                    this.progress.update((value) => ({ ...value, [slot]: null }));
                } else {
                    this.progress.update((value) => ({ ...value, [slot]: progress }));
                }
            },
            error: (error) => {
                this.progress.update((value) => ({ ...value, [slot]: null }));
                this.errors.update((errors) => ({ ...errors, [key]: problemMessage(error, 'อัปโหลดไม่สำเร็จ') }));
            }
        });
    }

    cancelUpload(slot: Slot) {
        this.subscriptions[slot]?.unsubscribe();
        this.progress.update((value) => ({ ...value, [slot]: null }));
    }

    clear(slot: Slot) {
        this.uploaded.update((value) => ({ ...value, [slot]: null }));
    }

    close() {
        this.slots.forEach((slot) => this.subscriptions[slot]?.unsubscribe());
        this.closed.emit();
    }

    save() {
        const { file, source } = this.uploaded();
        if (!file && !source) return;
        this.saving.set(true);
        this.generalError.set('');
        this.models
            .create(this.projectCode(), {
                fileId: file?.id,
                sourceFileId: source?.id,
                sourceApp: this.sourceApp(),
                title: this.title().trim() || undefined,
                note: this.note().trim() || undefined,
                upAxis: this.preview()?.upAxis ?? 'y'
            })
            .subscribe({
                next: (model) => {
                    this.saving.set(false);
                    this.saved.emit(model);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'บันทึกแบบ 3 มิติไม่สำเร็จ'));
                }
            });
    }
}
