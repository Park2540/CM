import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { TagModule } from 'primeng/tag';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { AuthService } from '@/app/pages/service/auth.service';
import { EstimateService } from '@/app/pages/service/estimate.service';
import { ProjectModelService } from '@/app/pages/service/project-model.service';
import { ProjectService } from '@/app/pages/service/project.service';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';

type Template = 'standard' | 'blank' | 'copy';

/** ถอดปริมาณและ BOQ: รายการใบประมาณราคาทั้งหมด + สร้างใหม่ */
@Component({
    selector: 'app-estimate-list',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FormsModule, InputTextModule, RouterLink, TagModule, ThaiDatePipe],
    template: `
        <div class="card">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                    <h1 class="text-2xl font-bold m-0">ถอดปริมาณและ BOQ</h1>
                    <p class="text-sm text-muted-color mt-1 mb-0">ถอดปริมาณจากแบบ (ปริมาตร พื้นที่ ความยาว น้ำหนักเหล็ก) แล้วจัดทำบัญชีแสดงปริมาณงานและราคา แยกวัสดุ/ค่าแรง พร้อมสรุปราคาค่าก่อสร้าง</p>
                </div>
                @if (canEdit()) {
                    <div class="flex flex-wrap gap-2">
                        <button pButton type="button" [outlined]="true" icon="pi pi-box" label="ถอดจากโมเดล IFC" (click)="openModel()"></button>
                        <button pButton type="button" icon="pi pi-plus" label="สร้าง BOQ ใหม่" (click)="openCreate()"></button>
                    </div>
                }
            </div>

            <input pInputText type="search" class="w-full md:w-96 mb-4" placeholder="ค้นหาชื่องาน เลขที่ โครงการ หรือเจ้าของ" aria-label="ค้นหา BOQ" [ngModel]="query()" (ngModelChange)="query.set($event)" />

            @if (resource.error()) {
                <div class="rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ errorText() }}</div>
            }

            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                @for (estimate of filtered(); track estimate.id) {
                    <a [routerLink]="['/estimates', estimate.id]" class="estimate-card">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-xs font-semibold text-muted-color">{{ estimate.id }}{{ estimate.projectCode ? ' · ' + estimate.projectCode : '' }}
                                @if (estimate.fromModel) {
                                    <span class="ml-1 px-1.5 py-0.5 rounded bg-emphasis font-normal"><i class="pi pi-box text-[0.6rem] mr-1"></i>จากโมเดล</span>
                                }
                            </span>
                            <p-tag [value]="estimate.status === 'final' ? 'ส่งลูกค้าแล้ว' : 'ร่าง'" [severity]="estimate.status === 'final' ? 'success' : 'secondary'" />
                        </div>
                        <div class="font-semibold text-lg leading-snug">{{ estimate.title }}</div>
                        <div class="text-sm text-muted-color mt-1">{{ estimate.location || 'ยังไม่ระบุสถานที่' }}{{ estimate.ownerName ? ' · ' + estimate.ownerName : '' }}</div>
                        <div class="flex items-end justify-between gap-2 mt-4">
                            <div>
                                <div class="text-xs text-muted-color">รวมเป็นเงินทั้งสิ้น</div>
                                <div class="text-xl font-bold tabular-nums">฿{{ estimate.grandTotal | number: '1.2-2' }}</div>
                            </div>
                            <div class="text-right text-xs text-muted-color">
                                @if (estimate.pricePerSqm) {
                                    <div class="text-sm font-semibold text-color">฿{{ estimate.pricePerSqm | number: '1.0-0' }}/ตร.ม.</div>
                                }
                                {{ estimate.itemCount }} รายการ · แก้ไข {{ estimate.updatedAt | thaiDate }}
                            </div>
                        </div>
                    </a>
                } @empty {
                    <div class="col-span-full text-center text-muted-color py-12">{{ resource.isLoading() ? 'กำลังโหลด...' : 'ยังไม่มี BOQ' }}</div>
                }
            </div>
        </div>

        @if (modelOpen()) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !analyzing() && modelOpen.set(false)" [modal]="true" [draggable]="false" [closable]="!analyzing()" [style]="{ width: 'min(38rem, 96vw)' }" header="ถอด BOQ จากโมเดล IFC">
                <p class="mt-0 text-sm text-muted-color">ระบบอ่านชิ้นงานในโมเดล (คาน เสา พื้น ฐานราก เสาเข็ม เหล็กเสริม เหล็กรูปพรรณ หลังคา) แล้วคำนวณปริมาณ ราคาจากคลังราคา และรายการวัสดุ — ได้ BOQ ฉบับร่างให้ตรวจแก้</p>
                <div class="flex flex-col gap-4">
                    <label class="text-sm font-semibold">โครงการ <span class="text-red-600">*</span>
                        <select class="native-select w-full mt-1 font-normal" [disabled]="analyzing()" (change)="pickModelProject($any($event.target).value)">
                            <option value="">— เลือกโครงการ —</option>
                            @for (project of projects.value(); track project.code) {
                                <option [value]="project.code" [selected]="project.code === modelProject()">{{ project.code }} · {{ project.name }}</option>
                            }
                        </select>
                    </label>
                    @if (modelProject()) {
                        <fieldset class="border-0 p-0 m-0">
                            <legend class="text-sm font-semibold p-0 mb-2">แบบ 3 มิติที่มีไฟล์ IFC</legend>
                            @for (model of ifcModels(); track model.id) {
                                <label class="choice mb-2" [class.choice-active]="modelId() === model.id">
                                    <input type="radio" name="ifc-model" [disabled]="analyzing()" [checked]="modelId() === model.id" (change)="modelId.set(model.id)" />
                                    <span><span class="block font-semibold">v{{ model.version }} · {{ model.title }}</span><span class="block text-xs text-muted-color">{{ model.sourceFile?.name }} · {{ (model.sourceFile?.sizeKb ?? 0) / 1024 | number: '1.0-1' }} MB · {{ model.uploadedAt | thaiDate }}</span></span>
                                </label>
                            } @empty {
                                <p class="text-sm text-muted-color m-0">{{ models.isLoading() ? 'กำลังโหลด...' : 'โครงการนี้ยังไม่มีแบบ 3 มิติที่แนบไฟล์ IFC — ส่งออกจาก Revit เป็น IFC แล้วแนบที่แท็บแบบบ้านของโครงการ' }}</p>
                            }
                        </fieldset>
                        <label class="text-sm font-semibold">กำลังอัดคอนกรีต (เมื่อวัสดุในโมเดลไม่ระบุ)
                            <span class="flex items-center gap-2 mt-1 font-normal"><input pInputText type="number" min="100" max="600" step="10" class="w-28 text-right" [disabled]="analyzing()" [ngModel]="grade()" (ngModelChange)="grade.set(+$event || 210)" /> ksc</span>
                        </label>
                    }
                </div>
                @if (analyzing()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-emphasis" role="status"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังอ่านโมเดลและถอดปริมาณ… ไฟล์ใหญ่อาจใช้เวลาหลายนาที</div>
                }
                @if (modelError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ modelError() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="analyzing()" (click)="modelOpen.set(false)"></button>
                    <button pButton type="button" icon="pi pi-calculator" label="ถอด BOQ" [disabled]="!modelId()" [loading]="analyzing()" (click)="analyze()"></button>
                </ng-template>
            </p-dialog>
        }

        @if (createOpen()) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && createOpen.set(false)" [modal]="true" [draggable]="false" [style]="{ width: 'min(36rem, 96vw)' }" header="สร้าง BOQ ใหม่">
                <div class="flex flex-col gap-4">
                    <label class="text-sm font-semibold">ชื่องาน <span class="text-red-600">*</span>
                        <input pInputText class="w-full mt-1 font-normal" maxlength="200" placeholder="เช่น บ้านพักอาศัย ค.ส.ล. 2 ชั้น" [ngModel]="title()" (ngModelChange)="title.set($event)" [attr.aria-invalid]="!!error() && !title().trim()" />
                    </label>
                    <label class="text-sm font-semibold">ผูกกับโครงการ
                        <select class="native-select w-full mt-1 font-normal" (change)="pickProject($any($event.target).value)">
                            <option value="">— ไม่ผูก (ประมาณราคาก่อนได้งาน) —</option>
                            @for (project of projects.value(); track project.code) {
                                <option [value]="project.code" [selected]="project.code === projectCode()">{{ project.code }} · {{ project.name }}</option>
                            }
                        </select>
                    </label>
                    <fieldset class="border-0 p-0 m-0">
                        <legend class="text-sm font-semibold p-0 mb-2">เริ่มจาก</legend>
                        <div class="flex flex-col gap-2">
                            @for (option of templates; track option.value) {
                                <label class="choice" [class.choice-active]="template() === option.value">
                                    <input type="radio" name="estimate-template" [checked]="template() === option.value" (change)="template.set(option.value)" />
                                    <span><span class="block font-semibold">{{ option.label }}</span><span class="block text-sm text-muted-color">{{ option.description }}</span></span>
                                </label>
                            }
                        </div>
                    </fieldset>
                    @if (template() === 'copy') {
                        <label class="text-sm font-semibold">คัดลอกจาก
                            <select class="native-select w-full mt-1 font-normal" (change)="copyFrom.set($any($event.target).value)">
                                <option value="">— เลือก BOQ —</option>
                                @for (estimate of resource.value(); track estimate.id) {
                                    <option [value]="estimate.id" [selected]="estimate.id === copyFrom()">{{ estimate.id }} · {{ estimate.title }}</option>
                                }
                            </select>
                        </label>
                    }
                </div>
                @if (error()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ error() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="createOpen.set(false)"></button>
                    <button pButton type="button" icon="pi pi-check" label="สร้าง" [loading]="saving()" (click)="create()"></button>
                </ng-template>
            </p-dialog>
        }
    `,
    styles: `
        .estimate-card {
            display: block;
            padding: 1.1rem 1.2rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 12px;
            color: var(--p-text-color);
            text-decoration: none;
            transition: border-color 0.15s, box-shadow 0.15s;
        }
        .estimate-card:hover {
            border-color: var(--p-primary-color);
            box-shadow: 0 4px 14px rgb(0 0 0 / 0.06);
        }
        .native-select {
            padding: 0.5rem 0.6rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
        .choice {
            display: flex;
            gap: 0.75rem;
            align-items: flex-start;
            padding: 0.7rem 0.9rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 8px;
            cursor: pointer;
        }
        .choice-active {
            border-color: var(--p-primary-color);
            background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
        }
    `
})
export class EstimateList {
    private readonly service = inject(EstimateService);
    private readonly projectService = inject(ProjectService);
    private readonly modelService = inject(ProjectModelService);
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    readonly resource = apiResource({ stream: () => this.service.list(), defaultValue: [] });
    readonly projects = apiResource({ params: () => (this.createOpen() || this.modelOpen() ? true : undefined), stream: () => this.projectService.list(), defaultValue: [] });
    readonly canEdit = computed(() => this.auth.can('estimate.manage'));
    readonly query = signal('');
    readonly filtered = computed(() => {
        const query = this.query().trim().toLowerCase();
        return this.resource.value().filter((item) => !query || [item.id, item.title, item.projectCode ?? '', item.ownerName ?? '', item.location ?? ''].some((value) => value.toLowerCase().includes(query)));
    });
    readonly errorText = computed(() => problemMessage(this.resource.error(), 'โหลด BOQ ไม่สำเร็จ'));

    readonly templates: Array<{ value: Template; label: string; description: string }> = [
        { value: 'standard', label: 'หมวดงานมาตรฐาน', description: 'งานเตรียมการ โครงสร้าง หลังคา สถาปัตย์ ไฟฟ้า ประปา พร้อมกลุ่มงานย่อย (ยังไม่มีรายการ)' },
        { value: 'copy', label: 'คัดลอกจาก BOQ เดิม', description: 'ได้รายการ ปริมาณ และราคาทั้งหมด แล้วปรับเฉพาะส่วนที่ต่าง' },
        { value: 'blank', label: 'ว่าง', description: 'เพิ่มหมวดงานเอง' }
    ];
    readonly createOpen = signal(false);
    readonly title = signal('');
    readonly projectCode = signal('');
    readonly template = signal<Template>('standard');
    readonly copyFrom = signal('');
    readonly saving = signal(false);
    readonly error = signal('');

    // ---------- ถอดจากโมเดล IFC ----------
    readonly modelOpen = signal(false);
    readonly modelProject = signal('');
    readonly modelId = signal('');
    readonly grade = signal(210);
    readonly analyzing = signal(false);
    readonly modelError = signal('');
    readonly models = apiResource({ params: () => this.modelProject() || undefined, stream: ({ params: code }) => this.modelService.list(code), defaultValue: [] });
    readonly ifcModels = computed(() => this.models.value().filter((model) => /\.ifc$/i.test(model.sourceFile?.name ?? '')));

    openModel() {
        this.modelProject.set('');
        this.modelId.set('');
        this.modelError.set('');
        this.modelOpen.set(true);
    }

    pickModelProject(code: string) {
        this.modelProject.set(code);
        this.modelId.set('');
    }

    analyze() {
        this.analyzing.set(true);
        this.modelError.set('');
        this.service.createFromModel({ projectCode: this.modelProject(), modelId: this.modelId(), concreteGrade: this.grade() }).subscribe({
            next: (estimate) => this.router.navigate(['/estimates', estimate.id], { queryParams: { tab: 'model' } }),
            error: (error) => {
                this.analyzing.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                this.modelError.set(problem?.detail ?? problemMessage(error, 'ถอด BOQ ไม่สำเร็จ'));
            }
        });
    }

    openCreate() {
        this.title.set('');
        this.projectCode.set('');
        this.template.set('standard');
        this.copyFrom.set('');
        this.error.set('');
        this.createOpen.set(true);
    }

    pickProject(code: string) {
        this.projectCode.set(code);
        const project = this.projects.value().find((item) => item.code === code);
        if (project && !this.title().trim()) this.title.set(project.name);
    }

    create() {
        if (!this.title().trim()) return this.error.set('กรุณาระบุชื่องาน');
        if (this.template() === 'copy' && !this.copyFrom()) return this.error.set('กรุณาเลือก BOQ ที่จะคัดลอก');
        this.saving.set(true);
        this.error.set('');
        this.service
            .create({
                title: this.title().trim(),
                ...(this.projectCode() ? { projectCode: this.projectCode() } : {}),
                ...(this.template() === 'copy' ? { copyFrom: this.copyFrom() } : { template: this.template() as 'standard' | 'blank' })
            })
            .subscribe({
                next: (estimate) => this.router.navigate(['/estimates', estimate.id]),
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    this.error.set(problem?.detail ?? problemMessage(error, 'สร้างไม่สำเร็จ'));
                }
            });
    }
}
