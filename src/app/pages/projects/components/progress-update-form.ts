import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { TimelinePhase, TimelineTask } from '@/app/pages/service/project-timeline.service';
import { IssueSeverity, ProgressUpdate, ProjectProgressService, SEVERITY_OPTIONS, UploadedFile, WEATHER_OPTIONS, Weather } from '@/app/pages/service/project-progress.service';
import { AttachedDocument, DocumentAttacher } from './document-attacher';
import { PhotoUploader } from './photo-uploader';

interface TaskRow {
    taskCode: string;
    progress: number;
}

const todayLocal = () => new Intl.DateTimeFormat('en-CA').format(new Date());

/** ฟอร์มบันทึกความคืบหน้าประจำวัน (POST /projects/{code}/updates) */
@Component({
    selector: 'app-progress-update-form',
    standalone: true,
    imports: [ButtonModule, DocumentAttacher, DrawerModule, FormsModule, InputNumberModule, InputTextModule, NgClass, PhotoUploader, SelectModule, TextareaModule],
    template: `
        <p-drawer [visible]="true" (visibleChange)="!$event && closed.emit()" position="right" [style]="{ width: 'min(44rem, 100vw)' }" header="อัปเดตความคืบหน้างาน" [modal]="true">
            <form class="flex flex-col gap-6" (ngSubmit)="submit()" novalidate>
                <!-- ข้อมูลวันทำงาน -->
                <section class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label for="report-date" class="block text-sm font-semibold mb-2">วันที่ทำงาน</label>
                        <input
                            pInputText
                            id="report-date"
                            type="date"
                            class="w-full"
                            [min]="projectStartDate()"
                            [max]="today"
                            [ngModel]="reportDate()"
                            (ngModelChange)="reportDate.set($event)"
                            name="reportDate"
                            [attr.aria-invalid]="!!errors()['reportDate']"
                        />
                        @if (errors()['reportDate']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['reportDate'] }}</small>
                        }
                    </div>
                    <div>
                        <label for="workers" class="block text-sm font-semibold mb-2">จำนวนแรงงาน (คน)</label>
                        <p-inputnumber
                            inputId="workers"
                            [ngModel]="workers()"
                            (ngModelChange)="workers.set($event)"
                            name="workers"
                            [min]="0"
                            [max]="500"
                            [showButtons]="true"
                            styleClass="w-full"
                            [inputStyle]="{ width: '100%' }"
                            [invalid]="!!errors()['workers']"
                        />
                        @if (errors()['workers']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['workers'] }}</small>
                        }
                    </div>
                    <fieldset class="sm:col-span-2 border-0 p-0 m-0">
                        <legend class="text-sm font-semibold mb-2">สภาพอากาศ</legend>
                        <div class="flex flex-wrap gap-2">
                            @for (option of weatherOptions; track option.value) {
                                <button
                                    type="button"
                                    class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer"
                                    [ngClass]="weather() === option.value ? 'bg-primary text-primary-contrast border-primary font-semibold' : 'bg-surface-0 dark:bg-surface-900 border-surface hover:bg-emphasis'"
                                    [attr.aria-pressed]="weather() === option.value"
                                    (click)="weather.set(option.value)"
                                >
                                    <i [class]="option.icon"></i>{{ option.label }}
                                </button>
                            }
                        </div>
                    </fieldset>
                </section>

                <!-- งานที่คืบหน้า -->
                <section>
                    <h3 class="text-base font-semibold m-0 mb-1">งานที่คืบหน้า</h3>
                    <p class="text-sm text-muted-color mt-0 mb-3">เลือกงานแล้วปรับ % ที่ทำได้ถึงวันนี้ · จุดตรวจ (Hold Point) ให้ใช้ปุ่ม "บันทึกผลตรวจ" ในไทม์ไลน์</p>
                    <p-select
                        [options]="taskOptions()"
                        [group]="true"
                        [filter]="true"
                        filterBy="label"
                        placeholder="+ เพิ่มงานที่คืบหน้า"
                        [ngModel]="null"
                        (ngModelChange)="addRow($event)"
                        name="taskPicker"
                        ariaLabel="เลือกงานที่คืบหน้า"
                        class="w-full"
                        emptyMessage="ไม่มีงานที่อัปเดตได้"
                    >
                        <ng-template #group let-group>
                            <span class="font-semibold">{{ group.label }}</span>
                        </ng-template>
                    </p-select>

                    <ul class="list-none p-0 m-0 mt-3 flex flex-col gap-3">
                        @for (row of rows(); track row.taskCode) {
                            @let task = taskOf(row.taskCode);
                            <li class="rounded-lg border p-4" [ngClass]="errors()['taskChanges.' + row.taskCode] ? 'border-red-400' : 'border-surface'">
                                <div class="flex justify-between items-start gap-3">
                                    <div class="min-w-0">
                                        <div class="font-semibold">{{ task.task.name }}</div>
                                        <div class="text-xs text-muted-color mt-1">ขั้นตอนที่ {{ task.phase.step }} · {{ task.task.team }} · ปัจจุบัน {{ task.task.progress }}%</div>
                                    </div>
                                    <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" [attr.aria-label]="'นำออก ' + task.task.name" (click)="removeRow(row.taskCode)"></button>
                                </div>
                                <div class="flex items-center gap-3 mt-3">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="5"
                                        class="flex-1 accent-[var(--p-primary-color)]"
                                        [value]="row.progress"
                                        (input)="setProgress(row.taskCode, $any($event.target).valueAsNumber)"
                                        [attr.aria-label]="'ความคืบหน้า ' + task.task.name"
                                    />
                                    <p-inputnumber
                                        [ngModel]="row.progress"
                                        (ngModelChange)="setProgress(row.taskCode, $event ?? 0)"
                                        [name]="'progress-' + row.taskCode"
                                        [min]="0"
                                        [max]="100"
                                        suffix="%"
                                        [inputStyle]="{ width: '5rem' }"
                                        [ariaLabel]="'ระบุ % ' + task.task.name"
                                    />
                                </div>
                                <div class="flex flex-wrap items-center gap-2 mt-2">
                                    @for (quick of [25, 50, 75, 100]; track quick) {
                                        <button type="button" class="px-2 py-1 rounded-md border border-surface text-xs cursor-pointer bg-transparent hover:bg-emphasis" (click)="setProgress(row.taskCode, quick)">
                                            {{ quick === 100 ? 'เสร็จ 100%' : quick + '%' }}
                                        </button>
                                    }
                                    <span
                                        class="ml-auto text-sm font-semibold"
                                        [ngClass]="row.progress > task.task.progress ? 'text-green-600 dark:text-green-400' : row.progress < task.task.progress ? 'text-orange-600 dark:text-orange-400' : 'text-muted-color'"
                                    >
                                        {{ row.progress > task.task.progress ? '+' : '' }}{{ row.progress - task.task.progress }}%
                                    </span>
                                </div>
                                @if (row.progress < task.task.progress) {
                                    <small class="block text-orange-600 dark:text-orange-400 mt-2"><i class="pi pi-exclamation-triangle mr-1"></i>ลดความคืบหน้าลง กรุณาระบุเหตุผลในหมายเหตุ</small>
                                }
                                @if (errors()['taskChanges.' + row.taskCode]) {
                                    <small class="block text-red-600 dark:text-red-400 mt-2">{{ errors()['taskChanges.' + row.taskCode] }}</small>
                                }
                            </li>
                        }
                    </ul>
                </section>

                <!-- หมายเหตุ -->
                <section>
                    <label for="update-note" class="block text-base font-semibold mb-2">สรุปงานวันนี้ / หมายเหตุ</label>
                    <textarea
                        pTextarea
                        id="update-note"
                        rows="3"
                        class="w-full"
                        placeholder="เช่น ทีมเทคอนกรีตคานชั้น 2 เสร็จ เตรียมถอดแบบสัปดาห์หน้า"
                        [ngModel]="note()"
                        (ngModelChange)="note.set($event)"
                        name="note"
                        [attr.aria-invalid]="!!errors()['note']"
                    ></textarea>
                    @if (errors()['note']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['note'] }}</small>
                    }
                </section>

                <!-- ปัญหา -->
                <section>
                    <div class="flex justify-between items-center mb-2">
                        <h3 class="text-base font-semibold m-0">ปัญหา / อุปสรรค</h3>
                        <button pButton type="button" icon="pi pi-plus" label="เพิ่มปัญหา" [text]="true" size="small" (click)="addIssue()"></button>
                    </div>
                    @for (issue of issues(); track $index; let i = $index) {
                        <div class="flex flex-wrap sm:flex-nowrap gap-2 mb-2">
                            <input
                                pInputText
                                class="flex-1 min-w-0"
                                placeholder="เช่น วัสดุเข้าหน้างานล่าช้า"
                                [ngModel]="issue.title"
                                (ngModelChange)="updateIssue(i, { title: $event })"
                                [name]="'issue-' + i"
                                [attr.aria-label]="'ปัญหาที่ ' + (i + 1)"
                            />
                            <p-select
                                [options]="severityOptions"
                                optionLabel="label"
                                optionValue="value"
                                [ngModel]="issue.severity"
                                (ngModelChange)="updateIssue(i, { severity: $event })"
                                [name]="'severity-' + i"
                                class="w-36"
                                [ariaLabel]="'ความรุนแรงปัญหาที่ ' + (i + 1)"
                            />
                            <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" [attr.aria-label]="'ลบปัญหาที่ ' + (i + 1)" (click)="removeIssue(i)"></button>
                        </div>
                    } @empty {
                        <p class="text-sm text-muted-color m-0">ไม่มีปัญหา</p>
                    }
                    @if (errors()['issues']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['issues'] }}</small>
                    }
                </section>

                <!-- รูป -->
                <section>
                    <h3 class="text-base font-semibold m-0 mb-2">รูปหน้างาน</h3>
                    <app-photo-uploader [(photos)]="photos" [(uploading)]="uploading" />
                    @if (errors()['photoIds']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['photoIds'] }}</small>
                    }
                </section>

                <!-- เอกสาร -->
                <section>
                    <h3 class="text-base font-semibold m-0 mb-1">เอกสารแนบ</h3>
                    <p class="text-sm text-muted-color mt-0 mb-3">เช่น ใบส่งของ ผลทดสอบคอนกรีต แบบแก้ไข ใบอนุญาต · เอกสารจะไปอยู่ในแท็บเอกสารของโครงการตามหมวดที่เลือก</p>
                    <app-document-attacher [(documents)]="documents" [(uploading)]="documentsUploading" [showErrors]="!!errors()['documents']" />
                    @if (errors()['documents']) {
                        <small class="text-red-600 dark:text-red-400">{{ errors()['documents'] }}</small>
                    }
                </section>

                @if (generalError()) {
                    <div class="rounded-lg px-4 py-3 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert"><i class="pi pi-exclamation-triangle mr-2"></i>{{ generalError() }}</div>
                }

                <div class="flex justify-end gap-2 sticky bottom-0 bg-surface-0 dark:bg-surface-900 py-3 border-t border-surface">
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closed.emit()"></button>
                    <button pButton type="submit" icon="pi pi-check" [label]="uploading() || documentsUploading() ? 'รออัปโหลดไฟล์...' : 'บันทึกความคืบหน้า'" [loading]="saving()" [disabled]="uploading() > 0 || documentsUploading() > 0"></button>
                </div>
            </form>
        </p-drawer>
    `
})
export class ProgressUpdateForm implements OnInit {
    private readonly progressService = inject(ProjectProgressService);

    readonly projectCode = input.required<string>();
    readonly projectStartDate = input.required<string>();
    readonly phases = input.required<TimelinePhase[]>();
    /** เปิดฟอร์มพร้อมงานนี้ (จากปุ่ม "อัปเดต" ในไทม์ไลน์) */
    readonly initialTaskCode = input<string | null>(null);
    readonly saved = output<ProgressUpdate>();
    readonly closed = output<void>();

    readonly today = todayLocal();
    readonly weatherOptions = WEATHER_OPTIONS;
    readonly severityOptions = SEVERITY_OPTIONS;

    readonly reportDate = signal(this.today);
    readonly weather = signal<Weather>('sunny');
    readonly workers = signal<number | null>(null);
    readonly rows = signal<TaskRow[]>([]);
    readonly note = signal('');
    readonly issues = signal<Array<{ title: string; severity: IssueSeverity }>>([]);
    readonly photos = signal<UploadedFile[]>([]);
    readonly uploading = signal(0);
    readonly documents = signal<AttachedDocument[]>([]);
    readonly documentsUploading = signal(0);
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    private readonly taskIndex = computed(() => new Map(this.phases().flatMap((phase) => phase.tasks.map((task) => [task.code, { phase, task }] as const))));

    /** งานที่อัปเดต % ได้: ยังไม่เสร็จ ไม่ใช่หมุดหมายหรือจุดตรวจ และยังไม่ถูกเลือก */
    readonly taskOptions = computed(() => {
        const chosen = new Set(this.rows().map((row) => row.taskCode));
        return this.phases()
            .filter((phase) => phase.status !== 'done')
            .map((phase) => ({
                label: `ขั้นตอนที่ ${phase.step} · ${phase.shortName}`,
                items: phase.tasks.filter((task) => task.status !== 'done' && !task.isMilestone && !task.isHoldPoint && !chosen.has(task.code)).map((task) => ({ label: `${task.name} (${task.progress}%)`, value: task.code }))
            }))
            .filter((group) => group.items.length);
    });

    ngOnInit() {
        const initial = this.initialTaskCode();
        if (initial) this.addRow(initial);
    }

    taskOf(code: string): { phase: TimelinePhase; task: TimelineTask } {
        return this.taskIndex().get(code)!;
    }

    addRow(code: string | null) {
        const found = code ? this.taskIndex().get(code) : undefined;
        if (!found || this.rows().some((row) => row.taskCode === code)) return;
        // Start at the next 5% step so the row is a real change by default.
        const next = Math.min(100, Math.floor(found.task.progress / 5) * 5 + 5);
        this.rows.update((rows) => [...rows, { taskCode: found.task.code, progress: next }]);
    }

    removeRow(code: string) {
        this.rows.update((rows) => rows.filter((row) => row.taskCode !== code));
    }

    setProgress(code: string, value: number) {
        const progress = Math.min(100, Math.max(0, Math.round(value || 0)));
        this.rows.update((rows) => rows.map((row) => (row.taskCode === code ? { ...row, progress } : row)));
    }

    addIssue() {
        this.issues.update((issues) => [...issues, { title: '', severity: 'medium' }]);
    }

    updateIssue(index: number, patch: Partial<{ title: string; severity: IssueSeverity }>) {
        this.issues.update((issues) => issues.map((issue, i) => (i === index ? { ...issue, ...patch } : issue)));
    }

    removeIssue(index: number) {
        this.issues.update((issues) => issues.filter((_, i) => i !== index));
    }

    submit() {
        const errors: Record<string, string> = {};
        const changes = this.rows().filter((row) => row.progress !== this.taskOf(row.taskCode).task.progress);
        const note = this.note().trim();
        if (!this.reportDate()) errors['reportDate'] = 'กรุณาระบุวันที่';
        if (this.workers() === null) errors['workers'] = 'กรุณาระบุจำนวนแรงงาน (ใส่ 0 ถ้าไม่มี)';
        if (!changes.length && !note && !this.documents().length) errors['note'] = this.rows().length ? 'ยังไม่ได้เปลี่ยน % ของงานที่เลือก — เขียนหมายเหตุหรือแนบเอกสารแทนได้' : 'เพิ่มงานที่คืบหน้า เขียนหมายเหตุ หรือแนบเอกสาร อย่างน้อย 1 อย่าง';
        if (this.documents().some((doc) => !doc.category)) errors['documents'] = 'กรุณาเลือกหมวดของเอกสารทุกไฟล์';
        this.errors.set(errors);
        this.generalError.set('');
        if (Object.keys(errors).length) return;

        this.saving.set(true);
        this.progressService
            .createUpdate(this.projectCode(), {
                reportDate: this.reportDate(),
                weather: this.weather(),
                workers: this.workers()!,
                note: note || undefined,
                taskChanges: changes,
                issues: this.issues().filter((issue) => issue.title.trim()),
                photoIds: this.photos().map((photo) => photo.id),
                documents: this.documents().map((doc) => ({ fileId: doc.file.id, category: doc.category!, name: doc.name.trim() || undefined }))
            })
            .subscribe({
                next: (update) => {
                    this.saving.set(false);
                    this.saved.emit(update);
                },
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
                }
            });
    }
}
