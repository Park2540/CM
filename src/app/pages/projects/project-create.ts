import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { HousePlan, HousePlanService, countRooms, usableArea } from '@/app/pages/service/house-plan.service';
import { PersonnelService } from '@/app/pages/service/personnel.service';
import { ProjectService } from '@/app/pages/service/project.service';
import { apiResource } from '@/app/api/api-resource';

/**
 * เปิดโครงการ (POST /projects) — เก็บเฉพาะข้อมูลเบื้องต้น: ลูกค้า ผู้รับผิดชอบ และแบบบ้านที่ลูกค้าต้องการ
 * มูลค่า วันที่ และแผนงาน บันทึกภายหลังในหน้าโครงการเมื่อเซ็นสัญญา
 */
@Component({
    selector: 'app-project-create',
    standalone: true,
    imports: [ButtonModule, FormsModule, InputTextModule, NgClass, RouterLink, SelectModule, TextareaModule],
    template: `
        <a routerLink="/projects" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4">
            <i class="pi pi-arrow-left"></i>
            <span>ภาพรวมโครงการ</span>
        </a>

        <div class="mb-6">
            <h1 class="text-2xl font-bold m-0">เปิดโครงการใหม่</h1>
            <p class="text-muted-color mt-1 mb-0">บันทึกข้อมูลเบื้องต้นของลูกค้าและแบบบ้านที่ต้องการ เมื่อได้งานหรือเซ็นสัญญาแล้ว จึงบันทึกสัญญาและเริ่มแผนงานในหน้าโครงการ</p>
        </div>

        @if (!canCreate()) {
            <div class="card flex items-start gap-3" role="alert">
                <i class="pi pi-lock mt-1"></i>
                <div>
                    <div class="font-semibold">ไม่มีสิทธิ์เปิดโครงการ</div>
                    <div class="text-muted-color mt-1">ติดต่อเจ้าของบริษัทหรือผู้ดูแลระบบเพื่อขอสิทธิ์</div>
                </div>
            </div>
        } @else {
            <form class="grid grid-cols-12 gap-6" (ngSubmit)="submit()" novalidate>
                <div class="col-span-12 xl:col-span-8 flex flex-col gap-6">
                    <!-- 1. ลูกค้า -->
                    <section class="card m-0" aria-labelledby="customer-heading">
                        <h2 id="customer-heading" class="text-lg font-semibold m-0 mb-4">1. ข้อมูลลูกค้า</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label for="customer-name" class="block text-sm font-semibold mb-2">ชื่อ-นามสกุล <span class="text-red-600" aria-hidden="true">*</span></label>
                                <input pInputText id="customer-name" name="customerName" class="w-full" autocomplete="off" [ngModel]="customerName()" (ngModelChange)="customerName.set($event)" [attr.aria-invalid]="!!errors()['customerName']" />
                                @if (errors()['customerName']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['customerName'] }}</small>
                                }
                            </div>
                            <div>
                                <label for="phone" class="block text-sm font-semibold mb-2">เบอร์โทร <span class="text-red-600" aria-hidden="true">*</span></label>
                                <input pInputText id="phone" name="phone" type="tel" class="w-full" placeholder="08x-xxx-xxxx" [ngModel]="phone()" (ngModelChange)="phone.set($event)" [attr.aria-invalid]="!!errors()['phone']" />
                                @if (errors()['phone']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['phone'] }}</small>
                                }
                            </div>
                            <div>
                                <label for="customer-email" class="block text-sm font-semibold mb-2">อีเมล</label>
                                <input pInputText id="customer-email" name="customerEmail" type="email" class="w-full" [ngModel]="customerEmail()" (ngModelChange)="customerEmail.set($event)" [attr.aria-invalid]="!!errors()['customerEmail']" />
                                @if (errors()['customerEmail']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['customerEmail'] }}</small>
                                }
                            </div>
                            <div>
                                <label for="customer-line" class="block text-sm font-semibold mb-2">LINE ID</label>
                                <input pInputText id="customer-line" name="customerLineId" class="w-full" [ngModel]="customerLineId()" (ngModelChange)="customerLineId.set($event)" />
                            </div>
                            <div class="md:col-span-2">
                                <label for="customer-address" class="block text-sm font-semibold mb-2">ที่อยู่ติดต่อ</label>
                                <textarea pTextarea id="customer-address" name="customerAddress" rows="2" class="w-full" [ngModel]="customerAddress()" (ngModelChange)="customerAddress.set($event)"></textarea>
                            </div>
                        </div>
                    </section>

                    <!-- 2. แบบบ้าน -->
                    <section class="card m-0" aria-labelledby="plan-heading">
                        <h2 id="plan-heading" class="text-lg font-semibold m-0 mb-1">2. แบบบ้านที่ลูกค้าต้องการ</h2>
                        <p class="text-sm text-muted-color mt-0 mb-4">พิมพ์ชื่อแบบเองได้ หรือเลือกจากคลังแบบบ้าน (แบบในคลังจะดูแปลนและโมเดล 3D ได้ในหน้าโครงการ)</p>

                        @if (plans.value().length) {
                            <div class="flex flex-wrap gap-2 mb-4" role="group" aria-label="เลือกจากคลังแบบบ้าน">
                                @for (plan of plans.value(); track plan.code) {
                                    <button
                                        type="button"
                                        class="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer bg-transparent"
                                        [ngClass]="matchedPlan()?.code === plan.code ? 'border-primary bg-primary-50 dark:bg-primary-500/10 font-semibold' : 'border-surface hover:border-primary'"
                                        [attr.aria-pressed]="matchedPlan()?.code === plan.code"
                                        (click)="housePlanName.set(plan.name)"
                                    >
                                        <i class="pi pi-home"></i>{{ plan.name }} <span class="text-muted-color font-normal">{{ area(plan) }} ตร.ม.</span>
                                    </button>
                                }
                            </div>
                        }

                        <label for="house-plan" class="block text-sm font-semibold mb-2">ชื่อแบบบ้าน <span class="text-red-600" aria-hidden="true">*</span></label>
                        <input
                            pInputText
                            id="house-plan"
                            name="housePlanName"
                            class="w-full"
                            placeholder="เช่น บ้านชั้นเดียว 3 ห้องนอน (ออกแบบเฉพาะ)"
                            [ngModel]="housePlanName()"
                            (ngModelChange)="housePlanName.set($event)"
                            [attr.aria-invalid]="!!errors()['housePlanName']"
                        />
                        @if (errors()['housePlanName']) {
                            <small class="text-red-600 dark:text-red-400">{{ errors()['housePlanName'] }}</small>
                        }
                        @if (matchedPlan(); as plan) {
                            <p class="text-sm mt-2 mb-0">
                                <i class="pi pi-check-circle text-primary mr-1"></i>แบบในคลัง: {{ area(plan) }} ตร.ม. · {{ plan.floors.length }} ชั้น · {{ rooms(plan, 'bedroom') }} ห้องนอน · {{ rooms(plan, 'bathroom') }} ห้องน้ำ
                            </p>
                        } @else if (housePlanName().trim()) {
                            <p class="text-sm text-muted-color mt-2 mb-0"><i class="pi pi-pencil mr-1"></i>แบบที่กำหนดเอง (ยังไม่มีแปลนในระบบ)</p>
                        }

                        <label for="requirements" class="block text-sm font-semibold mt-4 mb-2">ความต้องการเพิ่มเติมของลูกค้า</label>
                        <textarea
                            pTextarea
                            id="requirements"
                            name="requirements"
                            rows="3"
                            class="w-full"
                            placeholder="เช่น จำนวนห้อง ห้องพระ ที่จอดรถ งบประมาณที่ตั้งไว้"
                            [ngModel]="requirements()"
                            (ngModelChange)="requirements.set($event)"
                        ></textarea>
                    </section>

                    <!-- 3. โครงการ -->
                    <section class="card m-0" aria-labelledby="project-heading">
                        <h2 id="project-heading" class="text-lg font-semibold m-0 mb-4">3. ข้อมูลโครงการ</h2>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="md:col-span-2">
                                <label for="project-name" class="block text-sm font-semibold mb-2">ชื่อโครงการ <span class="text-red-600" aria-hidden="true">*</span></label>
                                <input pInputText id="project-name" name="name" class="w-full" [ngModel]="name()" (ngModelChange)="name.set($event)" [attr.aria-invalid]="!!errors()['name']" />
                                @if (errors()['name']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['name'] }}</small>
                                }
                            </div>
                            <div>
                                <label for="region" class="block text-sm font-semibold mb-2">จังหวัดที่ตั้งโครงการ <span class="text-red-600" aria-hidden="true">*</span></label>
                                <p-select
                                    inputId="region"
                                    name="regionCode"
                                    [options]="regions.value()"
                                    optionLabel="province"
                                    optionValue="code"
                                    [filter]="true"
                                    filterBy="province"
                                    placeholder="เลือกจังหวัด"
                                    class="w-full"
                                    [ngModel]="regionCode()"
                                    (ngModelChange)="regionCode.set($event)"
                                    [invalid]="!!errors()['regionCode']"
                                />
                                <small id="region-hint" class="block text-muted-color">ใช้ออกรหัสโครงการ</small>
                                @if (errors()['regionCode']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['regionCode'] }}</small>
                                }
                            </div>
                            <div>
                                <label for="responsible" class="block text-sm font-semibold mb-2">ผู้รับผิดชอบโครงการ <span class="text-red-600" aria-hidden="true">*</span></label>
                                <p-select
                                    inputId="responsible"
                                    name="responsibleName"
                                    [options]="personnel.value()"
                                    optionLabel="fullName"
                                    optionValue="fullName"
                                    [filter]="true"
                                    filterBy="fullName,position"
                                    placeholder="เลือกจากทะเบียนบุคลากร"
                                    class="w-full"
                                    [ngModel]="responsibleName()"
                                    (ngModelChange)="responsibleName.set($event)"
                                    [invalid]="!!errors()['responsibleName']"
                                >
                                    <ng-template #item let-person>
                                        <div>
                                            <div>{{ person.fullName }}</div>
                                            <div class="text-xs text-muted-color">{{ person.position || 'ยังไม่ระบุตำแหน่ง' }}</div>
                                        </div>
                                    </ng-template>
                                </p-select>
                                @if (errors()['responsibleName']) {
                                    <small class="text-red-600 dark:text-red-400">{{ errors()['responsibleName'] }}</small>
                                }
                            </div>
                        </div>
                    </section>

                    @if (generalError()) {
                        <div class="rounded-lg px-4 py-3 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert"><i class="pi pi-exclamation-triangle mr-2"></i>{{ generalError() }}</div>
                    }
                </div>

                <!-- สรุป -->
                <aside class="col-span-12 xl:col-span-4">
                    <div class="card m-0 xl:sticky xl:top-24">
                        <h2 class="text-lg font-semibold m-0 mb-4">สรุป</h2>
                        <dl class="m-0 flex flex-col gap-3 text-sm">
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">รหัสโครงการ</dt>
                                <dd class="m-0 font-semibold text-right">{{ codePreview() }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">ลูกค้า</dt>
                                <dd class="m-0 text-right">{{ customerName() || '-' }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">แบบบ้าน</dt>
                                <dd class="m-0 text-right">{{ housePlanName() || '-' }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">ผู้รับผิดชอบ</dt>
                                <dd class="m-0 text-right">{{ responsibleName() || '-' }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">สถานะเริ่มต้น</dt>
                                <dd class="m-0 text-right">รอเซ็นสัญญา</dd>
                            </div>
                        </dl>

                        <div class="rounded-lg p-3 mt-5 text-sm bg-surface-100 dark:bg-surface-800">
                            <div class="font-semibold mb-2">ขั้นตอนถัดไปในหน้าโครงการ</div>
                            <ol class="m-0 pl-5 flex flex-col gap-1">
                                <li>เมื่อได้งาน บันทึกสัญญา: มูลค่า วันเริ่ม กำหนดส่งมอบ ที่ตั้งหน้างาน</li>
                                <li>ระบบสร้างแผนงานและงวดงานให้อัตโนมัติ</li>
                                <li>ทีมงานอัปเดตงาน รูป และเอกสารได้</li>
                            </ol>
                        </div>

                        <div class="flex flex-col gap-2 mt-5">
                            <button pButton type="submit" icon="pi pi-check" label="เปิดโครงการ" [loading]="saving()"></button>
                            <a pButton routerLink="/projects" label="ยกเลิก" [text]="true" severity="secondary"></a>
                        </div>
                    </div>
                </aside>
            </form>
        }
    `
})
export class ProjectCreate {
    private readonly router = inject(Router);
    private readonly projectService = inject(ProjectService);
    private readonly auth = inject(AuthService);
    private readonly housePlanService = inject(HousePlanService);
    private readonly personnelService = inject(PersonnelService);

    readonly canCreate = computed(() => this.auth.can('project.create'));
    readonly plans = apiResource({ stream: () => this.housePlanService.list(), defaultValue: [] });
    readonly regions = apiResource({ stream: () => this.projectService.regions(), defaultValue: [] });
    readonly personnel = apiResource({ stream: () => this.personnelService.list(), defaultValue: [] });

    readonly customerName = signal('');
    readonly phone = signal('');
    readonly customerEmail = signal('');
    readonly customerLineId = signal('');
    readonly customerAddress = signal('');
    readonly housePlanName = signal('');
    readonly requirements = signal('');
    readonly name = signal('');
    readonly regionCode = signal<string | null>(null);
    readonly responsibleName = signal<string | null>(null);

    /** แบบในคลังที่ชื่อตรงกับที่พิมพ์ (ส่ง housePlanCode ไปด้วย เพื่อให้ดูแปลนได้) */
    readonly matchedPlan = computed(() => {
        const name = this.housePlanName().trim().toLowerCase();
        return this.plans.value().find((plan) => plan.name.toLowerCase() === name);
    });
    readonly codePreview = computed(() => {
        const region = this.regionCode();
        return region ? `${region}${String(new Date().getFullYear() + 543).slice(-2)}xxxx` : 'ออกให้เมื่อบันทึก';
    });

    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    area(plan: HousePlan) {
        return usableArea(plan);
    }

    rooms(plan: HousePlan, kind: 'bedroom' | 'bathroom') {
        return countRooms(plan, kind);
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.customerName().trim()) errors['customerName'] = 'กรุณาระบุชื่อลูกค้า';
        if (!this.phone().trim()) errors['phone'] = 'กรุณาระบุเบอร์โทร';
        if (!this.housePlanName().trim()) errors['housePlanName'] = 'กรุณาระบุแบบบ้านที่ลูกค้าต้องการ';
        if (!this.name().trim()) errors['name'] = 'กรุณาตั้งชื่อโครงการ';
        if (!this.regionCode()) errors['regionCode'] = 'กรุณาเลือกจังหวัด';
        if (!this.responsibleName()) errors['responsibleName'] = 'กรุณาเลือกผู้รับผิดชอบโครงการ';
        this.errors.set(errors);
        this.generalError.set(Object.keys(errors).length ? 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' : '');
        if (Object.keys(errors).length) return;

        const optional = (value: string) => value.trim() || undefined;
        this.saving.set(true);
        this.projectService
            .create({
                name: this.name().trim(),
                regionCode: this.regionCode()!,
                customerName: this.customerName().trim(),
                phone: this.phone().trim(),
                customerEmail: optional(this.customerEmail()),
                customerLineId: optional(this.customerLineId()),
                customerAddress: optional(this.customerAddress()),
                responsibleName: this.responsibleName()!,
                housePlanName: this.housePlanName().trim(),
                housePlanCode: this.matchedPlan()?.code,
                requirements: optional(this.requirements())
            })
            .subscribe({
                next: (project) => this.router.navigate(['/projects', project.code]),
                error: (error) => {
                    this.saving.set(false);
                    const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                    if (problem?.errors) this.errors.set(problem.errors);
                    this.generalError.set(problemMessage(error, 'เปิดโครงการไม่สำเร็จ'));
                }
            });
    }
}
