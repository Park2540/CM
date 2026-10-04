import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { PersonnelService } from '@/app/pages/service/personnel.service';
import { DesignBrief, ProjectService, SiteLocationInput } from '@/app/pages/service/project.service';
import { apiResource } from '@/app/api/api-resource';
import { SiteLocationPicker } from './components/site-location-picker';

/**
 * เปิดโครงการ (POST /projects) — เก็บเฉพาะข้อมูลเบื้องต้น: ลูกค้า ผู้รับผิดชอบ และแบบบ้านที่ลูกค้าต้องการ
 * มูลค่า วันที่ และแผนงาน บันทึกภายหลังในหน้าโครงการเมื่อเซ็นสัญญา
 */
@Component({
    selector: 'app-project-create',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, FormsModule, InputTextModule, RouterLink, SelectModule, SiteLocationPicker, TextareaModule],
    template: `
        <a routerLink="/projects" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4">
            <i class="pi pi-arrow-left"></i>
            <span>ภาพรวมโครงการ</span>
        </a>

        <div class="mb-6">
            <h1 class="text-2xl font-bold m-0">เปิดโครงการใหม่</h1>
            <p class="text-muted-color mt-1 mb-0">บันทึกข้อมูลลูกค้าและความต้องการคร่าว ๆ สำหรับออกแบบบ้าน เมื่อได้งานหรือเซ็นสัญญาแล้ว จึงบันทึกสัญญาและเริ่มแผนงานในหน้าโครงการ</p>
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

                    <!-- 2. ความต้องการของลูกค้า (โจทย์ออกแบบ) -->
                    <section class="card m-0" aria-labelledby="brief-heading">
                        <h2 id="brief-heading" class="text-lg font-semibold m-0 mb-1">2. ความต้องการของลูกค้า</h2>
                        <p class="text-sm text-muted-color mt-0 mb-4">ความต้องการคร่าว ๆ ใช้เป็นโจทย์ให้ทีมออกแบบ — กรอกเท่าที่ทราบ ไม่บังคับทุกช่อง</p>

                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <fieldset class="border-0 p-0 m-0 col-span-2 md:col-span-4">
                                <legend class="text-sm font-semibold p-0 mb-2">จำนวนชั้น</legend>
                                <div class="flex flex-wrap gap-2">
                                    @for (option of floorOptions; track option) {
                                        <button type="button" class="chip" [class.chip-active]="brief().floors === option" [attr.aria-pressed]="brief().floors === option" (click)="patchBrief({ floors: brief().floors === option ? undefined : option })">{{ option }} ชั้น</button>
                                    }
                                </div>
                            </fieldset>
                            @for (field of countFields; track field.key) {
                                <div>
                                    <label [for]="'brief-' + field.key" class="block text-sm font-semibold mb-2">{{ field.label }}</label>
                                    <input pInputText [id]="'brief-' + field.key" [name]="'brief-' + field.key" type="number" min="0" max="20" step="1" inputmode="numeric" class="w-full" [placeholder]="field.placeholder" [ngModel]="brief()[field.key]" (ngModelChange)="setNumber(field.key, $event)" [attr.aria-invalid]="!!errors()['designBrief.' + field.key]" />
                                </div>
                            }
                            <div>
                                <label for="brief-usable" class="block text-sm font-semibold mb-2">พื้นที่ใช้สอย (ตร.ม.)</label>
                                <input pInputText id="brief-usable" name="briefUsableArea" type="number" min="0" step="any" inputmode="decimal" class="w-full" placeholder="ประมาณ" [ngModel]="brief().usableArea" (ngModelChange)="setNumber('usableArea', $event)" [attr.aria-invalid]="!!errors()['designBrief.usableArea']" />
                            </div>
                            <div>
                                <label for="brief-land" class="block text-sm font-semibold mb-2">ขนาดที่ดิน (ตร.ว.)</label>
                                <input pInputText id="brief-land" name="briefLandArea" type="number" min="0" step="any" inputmode="decimal" class="w-full" [ngModel]="brief().landArea" (ngModelChange)="setNumber('landArea', $event)" [attr.aria-invalid]="!!errors()['designBrief.landArea']" />
                            </div>
                            <div class="col-span-2">
                                <label for="brief-budget" class="block text-sm font-semibold mb-2">งบประมาณที่ตั้งไว้ (บาท)</label>
                                <input pInputText id="brief-budget" name="briefBudget" type="number" min="0" step="10000" inputmode="numeric" class="w-full" placeholder="เช่น 3500000" [ngModel]="brief().budget" (ngModelChange)="setNumber('budget', $event)" [attr.aria-invalid]="!!errors()['designBrief.budget']" />
                                @if (brief().budget) {
                                    <small class="text-muted-color">฿{{ brief().budget | number: '1.0-0' }}</small>
                                }
                            </div>
                            <div class="col-span-2">
                                <label for="brief-style" class="block text-sm font-semibold mb-2">สไตล์บ้าน</label>
                                <input pInputText id="brief-style" name="briefStyle" class="w-full" maxlength="100" list="brief-styles" placeholder="พิมพ์หรือเลือก" [ngModel]="brief().style" (ngModelChange)="patchBrief({ style: $event })" />
                                <datalist id="brief-styles">
                                    @for (style of styleOptions; track style) {
                                        <option [value]="style"></option>
                                    }
                                </datalist>
                            </div>
                        </div>

                        <fieldset class="border-0 p-0 m-0 mt-4">
                            <legend class="text-sm font-semibold p-0 mb-2">ห้อง/พื้นที่พิเศษ</legend>
                            <div class="flex flex-wrap gap-2">
                                @for (room of roomOptions(); track room) {
                                    <button type="button" class="chip" [class.chip-active]="hasRoom(room)" [attr.aria-pressed]="hasRoom(room)" (click)="toggleRoom(room)">
                                        @if (hasRoom(room)) {
                                            <i class="pi pi-check text-xs"></i>
                                        }
                                        {{ room }}
                                    </button>
                                }
                                <input pInputText name="briefCustomRoom" class="w-40" maxlength="50" placeholder="+ เพิ่มเอง แล้วกด Enter" aria-label="เพิ่มห้องพิเศษ" [ngModel]="customRoom()" (ngModelChange)="customRoom.set($event)" (keydown.enter)="$event.preventDefault(); addCustomRoom()" />
                            </div>
                        </fieldset>

                        <label for="requirements" class="block text-sm font-semibold mt-4 mb-2">รายละเอียดเพิ่มเติม</label>
                        <textarea
                            pTextarea
                            id="requirements"
                            name="requirements"
                            rows="3"
                            class="w-full"
                            maxlength="2000"
                            placeholder="เช่น อยากได้ห้องนอนผู้สูงอายุชั้นล่าง ครัวไทยแยกนอกบ้าน หน้าบ้านหันทิศเหนือ"
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

                    <section class="card m-0" aria-labelledby="site-heading">
                        <h2 id="site-heading" class="text-lg font-semibold m-0 mb-1">4. ที่ตั้งหน้างาน (ปักหมุดแผนที่)</h2>
                        <p class="text-sm text-muted-color mt-0 mb-4">กรอกละติจูด/ลองจิจูด ระบบจะปักหมุดให้ ทีมงานกด "นำทาง" ในหน้าโครงการแล้วไปหน้างานด้วย Google Maps ได้ทันที (ไม่บังคับ แก้ไขภายหลังได้)</p>
                        <app-site-location-picker [(value)]="siteCoordinates" />
                        @if (errors()['siteCoordinates.lat'] || errors()['siteCoordinates.lng']) {
                            <small class="block mt-2 text-red-600 dark:text-red-400">{{ errors()['siteCoordinates.lat'] || errors()['siteCoordinates.lng'] }}</small>
                        }
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
                                <dt class="text-muted-color">โจทย์ออกแบบ</dt>
                                <dd class="m-0 text-right">{{ briefSummary() || '-' }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">ผู้รับผิดชอบ</dt>
                                <dd class="m-0 text-right">{{ responsibleName() || '-' }}</dd>
                            </div>
                            <div class="flex justify-between gap-3">
                                <dt class="text-muted-color">หมุดหน้างาน</dt>
                                <dd class="m-0 text-right">
                                    @if (siteCoordinates(); as point) {
                                        <i class="pi pi-map-marker text-primary mr-1"></i>{{ point.lat }}, {{ point.lng }}
                                    } @else {
                                        ยังไม่ปักหมุด
                                    }
                                </dd>
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
    `,
    styles: `
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.4rem 0.85rem;
            border-radius: 999px;
            border: 1px solid var(--p-content-border-color);
            background: transparent;
            color: var(--p-text-color);
            font: inherit;
            font-size: 0.875rem;
            cursor: pointer;
        }
        .chip:hover {
            border-color: var(--p-primary-color);
        }
        .chip-active {
            border-color: var(--p-primary-color);
            background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
            color: var(--p-primary-color);
            font-weight: 600;
        }
    `
})
export class ProjectCreate {
    private readonly router = inject(Router);
    private readonly projectService = inject(ProjectService);
    private readonly auth = inject(AuthService);
    private readonly personnelService = inject(PersonnelService);

    readonly canCreate = computed(() => this.auth.can('project.create'));
    readonly regions = apiResource({ stream: () => this.projectService.regions(), defaultValue: [] });
    readonly personnel = apiResource({ stream: () => this.personnelService.list(), defaultValue: [] });

    readonly customerName = signal('');
    readonly phone = signal('');
    readonly customerEmail = signal('');
    readonly customerLineId = signal('');
    readonly customerAddress = signal('');
    readonly brief = signal<DesignBrief>({});
    readonly customRoom = signal('');
    readonly floorOptions = [1, 2, 3];
    readonly countFields: Array<{ key: 'bedrooms' | 'bathrooms' | 'parking'; label: string; placeholder: string }> = [
        { key: 'bedrooms', label: 'ห้องนอน', placeholder: 'เช่น 3' },
        { key: 'bathrooms', label: 'ห้องน้ำ', placeholder: 'เช่น 2' },
        { key: 'parking', label: 'ที่จอดรถ (คัน)', placeholder: 'เช่น 2' }
    ];
    readonly styleOptions = ['โมเดิร์น', 'มินิมอล', 'นอร์ดิก', 'ลอฟท์', 'ไทยร่วมสมัย', 'ล้านนาประยุกต์', 'โคโลเนียล'];
    private readonly baseRooms = ['ห้องพระ', 'ห้องทำงาน', 'ห้องนอนผู้สูงอายุชั้นล่าง', 'ห้องแม่บ้าน', 'ห้องเก็บของ', 'ครัวไทย', 'ห้องซักรีด', 'ระเบียง/ชานบ้าน'];
    readonly roomOptions = computed(() => [...new Set([...this.baseRooms, ...(this.brief().rooms ?? [])])]);
    /** สรุปสั้น ๆ (ระบบใช้ตั้งชื่อแบบบ้านแบบเดียวกัน) */
    readonly briefSummary = computed(() => {
        const brief = this.brief();
        return [brief.floors ? `${brief.floors} ชั้น` : '', brief.bedrooms ? `${brief.bedrooms} ห้องนอน` : '', brief.bathrooms ? `${brief.bathrooms} ห้องน้ำ` : '', brief.style ?? ''].filter(Boolean).join(' · ');
    });
    readonly requirements = signal('');
    readonly name = signal('');
    readonly regionCode = signal<string | null>(null);
    readonly responsibleName = signal<string | null>(null);
    readonly siteCoordinates = signal<SiteLocationInput | null>(null);
    private readonly sitePicker = viewChild.required(SiteLocationPicker);

    readonly codePreview = computed(() => {
        const region = this.regionCode();
        return region ? `${region}${String(new Date().getFullYear() + 543).slice(-2)}xxxx` : 'ออกให้เมื่อบันทึก';
    });

    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    patchBrief(change: Partial<DesignBrief>) {
        this.brief.update((brief) => ({ ...brief, ...change }));
    }

    setNumber(key: 'bedrooms' | 'bathrooms' | 'parking' | 'usableArea' | 'landArea' | 'budget', value: number | string | null) {
        const number = value === '' || value === null ? undefined : Number(value);
        this.patchBrief({ [key]: number !== undefined && Number.isFinite(number) ? number : undefined });
    }

    hasRoom(room: string) {
        return (this.brief().rooms ?? []).includes(room);
    }

    toggleRoom(room: string) {
        const rooms = this.brief().rooms ?? [];
        this.patchBrief({ rooms: rooms.includes(room) ? rooms.filter((item) => item !== room) : [...rooms, room] });
    }

    addCustomRoom() {
        const room = this.customRoom().trim();
        if (room && !this.hasRoom(room)) this.toggleRoom(room);
        this.customRoom.set('');
    }

    submit() {
        const errors: Record<string, string> = {};
        if (!this.customerName().trim()) errors['customerName'] = 'กรุณาระบุชื่อลูกค้า';
        if (!this.phone().trim()) errors['phone'] = 'กรุณาระบุเบอร์โทร';
        if (!this.name().trim()) errors['name'] = 'กรุณาตั้งชื่อโครงการ';
        if (!this.regionCode()) errors['regionCode'] = 'กรุณาเลือกจังหวัด';
        if (!this.responsibleName()) errors['responsibleName'] = 'กรุณาเลือกผู้รับผิดชอบโครงการ';
        if (this.sitePicker().invalid()) errors['siteCoordinates.lat'] = 'พิกัดหน้างานไม่ถูกต้อง — แก้ไขหรือเว้นว่างทั้งสองช่อง';
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
                designBrief: Object.fromEntries(Object.entries(this.brief()).filter(([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && !value.length))) as DesignBrief,
                requirements: optional(this.requirements()),
                ...(this.siteCoordinates() ? { siteCoordinates: this.siteCoordinates()! } : {})
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
