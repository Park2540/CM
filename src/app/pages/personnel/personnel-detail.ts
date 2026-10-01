import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { TagModule } from 'primeng/tag';
import { PersonnelRecord, PersonnelService } from '@/app/pages/service/personnel.service';

@Component({
    selector: 'app-personnel-detail',
    standalone: true,
    imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, ProgressBarModule, RouterLink, TagModule],
    template: `
        @if (personnel; as person) {
            <div class="flex flex-wrap justify-between items-start gap-4 mb-5">
                <div class="flex items-center gap-4">
                    @if (person.photoUrl) {
                        <img [src]="person.photoUrl" [alt]="person.fullName || 'รูปบุคลากร'" class="w-20 h-20 rounded-full object-cover border border-surface" />
                    } @else {
                        <span class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary text-primary-contrast font-semibold text-2xl">{{ getInitials(person.fullName) }}</span>
                    }
                    <div>
                        <div class="text-color-secondary mb-1">ข้อมูลบุคลากร / {{ isNew ? 'เพิ่มบุคลากร' : person.employeeCode }}</div>
                        <h1 class="font-semibold text-2xl m-0">{{ person.fullName || 'บุคลากรใหม่' }}</h1>
                        <div class="text-color-secondary mt-1">{{ person.position || 'ยังไม่ระบุตำแหน่ง' }}</div>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <a pButton routerLink="/master/personnel" icon="pi pi-arrow-left" label="กลับรายชื่อ" class="p-button-outlined"></a>
                    @if (isEditing) {
                        <button pButton type="button" label="ยกเลิก" icon="pi pi-times" class="p-button-outlined" (click)="cancelEdit()"></button>
                        <button pButton type="button" label="บันทึกข้อมูล" icon="pi pi-save" (click)="save(person)"></button>
                    } @else {
                        <button pButton type="button" label="แก้ไขข้อมูล" icon="pi pi-pencil" (click)="beginEdit()"></button>
                    }
                </div>
            </div>

            @if (saveMessage) {
                <div class="border border-green-300 bg-green-50 text-green-900 rounded p-3 mb-4" role="status">{{ saveMessage }}</div>
            }
            @if (saveError) {
                <div class="border border-red-300 bg-red-50 text-red-900 rounded p-3 mb-4" role="alert">{{ saveError }}</div>
            }

            @if (expiryAlerts.length) {
                <div class="border border-orange-300 bg-orange-50 text-orange-950 rounded p-4 mb-5" role="status">
                    <div class="font-semibold mb-2"><i class="pi pi-exclamation-triangle mr-2"></i>ใบอนุญาตหรือเอกสารหมดอายุ/ใกล้หมดอายุ</div>
                    @for (alert of expiryAlerts; track alert.license + alert.expiresAt) {
                        <div>{{ alert.license }} หมดอายุวันที่ {{ alert.expiresAt | date: 'dd/MM/yyyy' }}</div>
                    }
                </div>
            }

            <nav class="flex flex-wrap gap-2 border-b border-surface mb-2 pb-3" aria-label="หมวดข้อมูลบุคลากร">
                <a href="#general" class="text-primary">ทั่วไป</a>
                <a href="#contact" class="text-primary">ติดต่อ</a>
                <a href="#work" class="text-primary">การทำงาน</a>
                <a href="#qualifications" class="text-primary">คุณวุฒิ/ใบอนุญาต</a>
                <a href="#compensation" class="text-primary">ค่าตอบแทน</a>
                <a href="#bank" class="text-primary">บัญชีธนาคาร</a>
                <a href="#documents" class="text-primary">เอกสารแนบ</a>
                <a href="#history" class="text-primary">ประวัติในระบบ</a>
                <a href="#safety" class="text-primary">ความปลอดภัย</a>
            </nav>

            <section id="general" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">1. ข้อมูลทั่วไป</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <label class="flex flex-col gap-2">
                        <span>รูปบุคลากร</span>
                        @if (isEditing) {
                            <input type="file" accept="image/*" (change)="onPhotoSelected($event, person)" />
                        }
                        @if (person.photoUrl) {
                            <img [src]="person.photoUrl" alt="ตัวอย่างรูปบุคลากร" class="w-24 h-24 rounded object-cover" />
                        } @else {
                            <span class="text-color-secondary">ยังไม่ได้เพิ่มรูป</span>
                        }
                    </label>
                    <label class="flex flex-col gap-2"><span>รหัสบุคลากร</span><input pInputText [(ngModel)]="person.employeeCode" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ชื่อ-นามสกุล</span><input pInputText [(ngModel)]="person.fullName" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>เลขบัตรประชาชน</span><input pInputText [(ngModel)]="person.nationalId" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>เลขใบประกอบวิชาชีพ</span><input pInputText [(ngModel)]="person.professionalLicenseNumber" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ตำแหน่งงาน</span><input pInputText [(ngModel)]="person.position" [readonly]="!isEditing" /></label>
                </div>
            </section>

            <section id="contact" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">2. ข้อมูลติดต่อ</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <label class="flex flex-col gap-2"><span>เบอร์โทร</span><input pInputText type="tel" [(ngModel)]="person.phone" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>LINE</span><input pInputText [(ngModel)]="person.lineId" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>อีเมล</span><input pInputText type="email" [(ngModel)]="person.email" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ที่อยู่ตามทะเบียนบ้าน</span><textarea pInputText rows="3" [(ngModel)]="person.registeredAddress" [readonly]="!isEditing"></textarea></label>
                    <label class="flex flex-col gap-2"><span>ที่อยู่ปัจจุบัน</span><textarea pInputText rows="3" [(ngModel)]="person.currentAddress" [readonly]="!isEditing"></textarea></label>
                </div>
                <h3 class="font-semibold mt-5 mb-3">ผู้ติดต่อฉุกเฉิน</h3>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label class="flex flex-col gap-2"><span>ชื่อ</span><input pInputText [(ngModel)]="person.emergencyContactName" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ความสัมพันธ์</span><input pInputText [(ngModel)]="person.emergencyContactRelation" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>เบอร์โทร</span><input pInputText type="tel" [(ngModel)]="person.emergencyContactPhone" [readonly]="!isEditing" /></label>
                </div>
            </section>

            <section id="work" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">3. ข้อมูลการทำงาน</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <label class="flex flex-col gap-2"><span>ตำแหน่ง</span><input pInputText [(ngModel)]="person.position" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ประเภทการจ้าง</span><input pInputText [(ngModel)]="person.employmentType" [readonly]="!isEditing" placeholder="ประจำ / รายเดือน / รายวัน" /></label>
                    <label class="flex flex-col gap-2"><span>วันเริ่มงาน</span><input pInputText type="date" [(ngModel)]="person.hireDate" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>วันสิ้นสุด</span><input pInputText type="date" [(ngModel)]="person.endDate" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>สังกัดหรือฝ่าย</span><input pInputText [(ngModel)]="person.department" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>หัวหน้างาน</span><input pInputText [(ngModel)]="person.supervisor" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ความเชี่ยวชาญ</span><textarea pInputText rows="2" [(ngModel)]="person.expertise" [readonly]="!isEditing" placeholder="เช่น งานโครงสร้าง, งานไฟฟ้า"></textarea></label>
                    <label class="flex flex-col gap-2"><span>พื้นที่ที่ทำงานได้</span><input pInputText [(ngModel)]="person.workAreas" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ช่วงเวลาว่างสำหรับรับงานเพิ่ม</span><input pInputText [(ngModel)]="person.availability" [readonly]="!isEditing" /></label>
                </div>
            </section>

            <section id="qualifications" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">4. คุณวุฒิ ใบอนุญาต และใบรับรอง</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    <label class="flex flex-col gap-2"><span>วุฒิการศึกษา</span><input pInputText [(ngModel)]="person.education" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>สถาบัน</span><input pInputText [(ngModel)]="person.institution" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ประเภทใบอนุญาต</span><input pInputText [(ngModel)]="person.professionalLicenseType" [readonly]="!isEditing" placeholder="วิศวกร / สถาปนิก" /></label>
                    <label class="flex flex-col gap-2"><span>เลขที่ใบอนุญาต</span><input pInputText [(ngModel)]="person.professionalLicenseNumber" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ระดับใบอนุญาต</span><input pInputText [(ngModel)]="person.professionalLicenseLevel" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>วันหมดอายุใบอนุญาต</span><input pInputText type="date" [(ngModel)]="person.professionalLicenseExpiresAt" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ใบรับรองอื่น ๆ</span><textarea pInputText rows="2" [(ngModel)]="person.otherCertificates" [readonly]="!isEditing" placeholder="ความปลอดภัย, ทำงานที่สูง, งานเชื่อม"></textarea></label>
                    <label class="flex flex-col gap-2"><span>ใบอนุญาตทำงานหมดอายุ</span><input pInputText type="date" [(ngModel)]="person.workPermitExpiresAt" [readonly]="!isEditing" /></label>
                    <label class="flex flex-col gap-2"><span>ประกันสังคม (พนักงานประจำ)</span><input pInputText [(ngModel)]="person.socialSecurityNumber" [readonly]="!isEditing" /></label>
                </div>
                <div class="mt-4">
                    <p-tag [value]="professionalLicenseStatus(person)" [severity]="professionalLicenseSeverity(person)" />
                    <p class="text-color-secondary mt-2 mb-0">ใช้ตรวจสอบคุณสมบัติก่อนมอบหมายงานที่ต้องใช้ใบอนุญาต</p>
                </div>
            </section>

            <section id="compensation" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">5. ค่าตอบแทน</h2>
                @if (canViewSensitiveData) {
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <label class="flex flex-col gap-2"><span>รูปแบบค่าตอบแทน</span><input pInputText [(ngModel)]="person.compensationType" [readonly]="!isEditing" placeholder="เงินเดือน / รายเดือน / รายวัน / เหมางาน" /></label>
                        <label class="flex flex-col gap-2"><span>อัตราค่าจ้าง</span><input pInputText type="number" [(ngModel)]="person.compensationRate" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>ประวัติการปรับอัตราและวันที่มีผล</span><textarea pInputText rows="2" [(ngModel)]="person.compensationHistory" [readonly]="!isEditing"></textarea></label>
                        <label class="flex flex-col gap-2"><span>เงื่อนไขภาษีหัก ณ ที่จ่าย</span><textarea pInputText rows="2" [(ngModel)]="person.withholdingTaxTerms" [readonly]="!isEditing"></textarea></label>
                    </div>
                } @else {
                    <div class="flex items-start gap-3 border border-surface rounded p-4" role="status">
                        <i class="pi pi-lock mt-1"></i>
                        <div>
                            <div class="font-semibold">จำกัดสิทธิ์การเข้าถึง</div>
                            <div class="text-color-secondary mt-1">ข้อมูลค่าตอบแทนแสดงเฉพาะผู้ได้รับอนุญาต</div>
                        </div>
                    </div>
                }
            </section>

            <section id="bank" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">6. บัญชีธนาคาร</h2>
                @if (canViewSensitiveData) {
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        <label class="flex flex-col gap-2"><span>ธนาคาร</span><input pInputText [(ngModel)]="person.bankName" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>เลขที่บัญชี</span><input pInputText [(ngModel)]="person.bankAccountNumber" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>ชื่อบัญชี</span><input pInputText [(ngModel)]="person.bankAccountName" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>เลขประจำตัวผู้เสียภาษี</span><input pInputText [(ngModel)]="person.taxpayerId" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>เอกสารหักภาษี ณ ที่จ่าย</span><input pInputText [(ngModel)]="person.withholdingCertificate" [readonly]="!isEditing" /></label>
                    </div>
                } @else {
                    <div class="flex items-start gap-3 border border-surface rounded p-4" role="status">
                        <i class="pi pi-lock mt-1"></i>
                        <div>
                            <div class="font-semibold">จำกัดสิทธิ์การเข้าถึง</div>
                            <div class="text-color-secondary mt-1">ข้อมูลบัญชีธนาคารแสดงเฉพาะผู้ได้รับอนุญาต</div>
                        </div>
                    </div>
                }
            </section>

            <section id="documents" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">7. เอกสารแนบ</h2>
                @if (isEditing) {
                    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 items-end mb-4">
                        <label class="flex flex-col gap-2"><span>ประเภทเอกสาร</span><input pInputText [(ngModel)]="newDocumentType" placeholder="เช่น สำเนาบัตรประชาชน" /></label>
                        <label class="flex flex-col gap-2"><span>วันหมดอายุ (ถ้ามี)</span><input pInputText type="date" [(ngModel)]="newDocumentExpiresAt" /></label>
                        <label class="flex flex-col gap-2"><span>เลือกไฟล์</span><input type="file" accept=".pdf,image/*" (change)="addDocument($event, person)" /></label>
                    </div>
                }
                @if (person.documents.length) {
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="border-b border-surface">
                                    <th class="p-3">ประเภทเอกสาร</th>
                                    <th class="p-3">ไฟล์</th>
                                    <th class="p-3">วันหมดอายุ</th>
                                    <th class="p-3">ผู้อัปโหลด</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (document of person.documents; track $index) {
                                    <tr class="border-b border-surface">
                                        <td class="p-3">{{ document.type }}</td>
                                        <td class="p-3">
                                            @if (document.dataUrl) {
                                                <a [href]="document.dataUrl" [download]="document.fileName">{{ document.fileName }}</a>
                                            } @else {
                                                {{ document.fileName }}
                                            }
                                        </td>
                                        <td class="p-3">{{ document.expiresAt ? (document.expiresAt | date: 'dd/MM/yyyy') : '-' }}</td>
                                        <td class="p-3">{{ document.uploadedBy }}</td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                } @else {
                    <p class="text-color-secondary">ยังไม่มีเอกสารแนบ</p>
                }
            </section>

            <section id="history" class="border-b border-surface py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">8. ประวัติในระบบ</h2>
                <p class="text-color-secondary">ระบบสร้างข้อมูลส่วนนี้โดยอัตโนมัติ ไม่ต้องกรอก</p>
                <h3 class="font-semibold mt-4">โครงการและงานที่เคยได้รับมอบหมาย</h3>
                @if (person.projectHistory.length) {
                    <div class="overflow-x-auto">
                        <table class="w-full text-left border-collapse">
                            <thead>
                                <tr class="border-b border-surface">
                                    <th class="p-3">โครงการ</th>
                                    <th class="p-3">บทบาท</th>
                                    <th class="p-3">ช่วงเวลา</th>
                                    <th class="p-3">งานที่มอบหมาย</th>
                                    <th class="p-3">รายงานประจำวัน</th>
                                    @if (canViewSensitiveData) {
                                        <th class="p-3">ค่าจ้างที่จ่าย</th>
                                    }
                                </tr>
                            </thead>
                            <tbody>
                                @for (history of person.projectHistory; track history.projectCode + history.period) {
                                    <tr class="border-b border-surface">
                                        <td class="p-3">{{ history.projectCode }}</td>
                                        <td class="p-3">{{ history.role }}</td>
                                        <td class="p-3">{{ history.period }}</td>
                                        <td class="p-3">{{ history.assignment }}</td>
                                        <td class="p-3">{{ history.dailyReport }}</td>
                                        @if (canViewSensitiveData) {
                                            <td class="p-3">{{ history.paidAmount | currency: 'THB' : 'symbol' : '1.0-0' }}</td>
                                        }
                                    </tr>
                                }
                            </tbody>
                        </table>
                    </div>
                } @else {
                    <p class="text-color-secondary">ยังไม่มีประวัติโครงการ</p>
                }
                <h3 class="font-semibold mt-5">ประวัติการแก้ไขข้อมูล</h3>
                <ul class="list-disc pl-5">
                    @for (entry of person.auditHistory; track $index) {
                        <li class="mb-1">{{ entry }}</li>
                    }
                    @if (!person.auditHistory.length) {
                        <li class="text-color-secondary">ยังไม่มีประวัติ</li>
                    }
                </ul>
            </section>

            <section id="safety" class="py-5">
                <h2 class="font-semibold text-xl mt-0 mb-4">9. ความปลอดภัยและการประเมิน</h2>
                <h3 class="font-semibold">ประวัติการอบรม</h3>
                @if (person.trainings.length) {
                    <ul class="list-disc pl-5">
                        @for (training of person.trainings; track training.name) {
                            <li class="mb-1">{{ training.name }} · วันที่ {{ training.completedAt | date: 'dd/MM/yyyy' }} · หมดอายุ {{ training.expiresAt | date: 'dd/MM/yyyy' }}</li>
                        }
                    </ul>
                } @else {
                    <p class="text-color-secondary">ยังไม่มีประวัติอบรม</p>
                }
                <div class="mt-4"><span class="font-semibold">อุปกรณ์ป้องกันที่ออกให้: </span>{{ person.issuedEquipment || '-' }}</div>
                @if (canViewSensitiveData) {
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <label class="flex flex-col gap-2"><span>คะแนนประเมินผลงาน</span><input pInputText [(ngModel)]="person.performanceRating" [readonly]="!isEditing" /></label>
                        <label class="flex flex-col gap-2"><span>หมายเหตุผู้บริหาร</span><textarea pInputText rows="2" [(ngModel)]="person.performanceNotes" [readonly]="!isEditing"></textarea></label>
                    </div>
                } @else {
                    <p class="text-color-secondary mt-4"><i class="pi pi-lock mr-2"></i>ข้อมูลประเมินผลงานจำกัดสิทธิ์สำหรับผู้บริหาร</p>
                }
            </section>
        } @else {
            <div class="border border-surface rounded p-6">
                <h1 class="font-semibold text-2xl mt-0">ไม่พบข้อมูลบุคลากร</h1>
                <a pButton routerLink="/master/personnel" label="กลับรายชื่อบุคลากร" icon="pi pi-arrow-left" class="p-button-outlined"></a>
            </div>
        }
    `
})
export class PersonnelDetail {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly personnelService = inject(PersonnelService);

    private readonly cdr = inject(ChangeDetectorRef);

    readonly canViewSensitiveData = false;
    isNew = false;
    personnel: PersonnelRecord | null = null;
    isEditing = false;
    saveMessage = '';
    saveError = '';
    newDocumentType = '';
    newDocumentExpiresAt = '';
    private originalRecord: PersonnelRecord | null = null;

    constructor() {
        // Component is reused when only :id changes (e.g. detail -> "new"), so react to param updates.
        this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => this.load(params.get('id') ?? ''));
    }

    private load(id: string) {
        // After saving a new record we navigate to its id; keep the current state and save message.
        if (id !== 'new' && this.personnel?.id === id) return;

        this.isNew = id === 'new';
        this.personnel = this.isNew ? this.personnelService.createBlank() : (this.personnelService.getById(id) ?? null);
        this.isEditing = this.isNew;
        this.saveMessage = '';
        this.saveError = '';
        this.newDocumentType = '';
        this.newDocumentExpiresAt = '';
        this.originalRecord = null;
        this.cdr.markForCheck();
    }

    get expiryAlerts() {
        return this.personnel ? this.personnelService.getExpiringLicenses().filter((item) => item.record.id === this.personnel?.id) : [];
    }

    beginEdit() {
        if (!this.personnel) return;
        this.originalRecord = structuredClone(this.personnel);
        this.personnel = structuredClone(this.personnel);
        this.isEditing = true;
        this.saveMessage = '';
        this.saveError = '';
    }

    cancelEdit() {
        if (this.isNew) {
            this.router.navigate(['/master/personnel']);
            return;
        }
        if (this.originalRecord) this.personnel = structuredClone(this.originalRecord);
        this.isEditing = false;
        this.saveError = '';
    }

    save(personnel: PersonnelRecord) {
        if (!personnel.employeeCode.trim() || !personnel.fullName.trim()) {
            this.saveError = 'กรุณาระบุรหัสบุคลากรและชื่อ-นามสกุล';
            return;
        }

        this.personnel = this.personnelService.save(personnel);
        this.isEditing = false;
        this.isNew = false;
        this.originalRecord = structuredClone(this.personnel);
        this.saveMessage = 'บันทึกข้อมูลบุคลากรแล้ว';
        this.saveError = '';
        this.router.navigate(['/master/personnel', this.personnel.id], { replaceUrl: true });
    }

    onPhotoSelected(event: Event, personnel: PersonnelRecord) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            personnel.photoUrl = String(reader.result ?? '');
            // FileReader callbacks run outside Angular's template events, so refresh the view explicitly (app is zoneless).
            this.cdr.markForCheck();
        };
        reader.readAsDataURL(file);
    }

    addDocument(event: Event, personnel: PersonnelRecord) {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file || !this.newDocumentType.trim()) {
            this.saveError = 'กรุณาระบุประเภทเอกสารก่อนเลือกไฟล์';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            personnel.documents.push({
                type: this.newDocumentType.trim(),
                fileName: file.name,
                expiresAt: this.newDocumentExpiresAt,
                uploadedBy: 'ผู้ใช้งานปัจจุบัน',
                dataUrl: String(reader.result ?? '')
            });
            this.newDocumentType = '';
            this.newDocumentExpiresAt = '';
            this.saveError = '';
            this.cdr.markForCheck();
        };
        reader.readAsDataURL(file);
    }

    getInitials(fullName: string): string {
        return (
            fullName
                .split(' ')
                .slice(0, 2)
                .map((part) => part[0] ?? '')
                .join('') || '?'
        );
    }

    professionalLicenseValid(personnel: PersonnelRecord): boolean {
        if (!personnel.professionalLicenseType && !personnel.professionalLicenseNumber) return true;
        return this.personnelService.isProfessionalLicenseValid(personnel);
    }

    professionalLicenseStatus(personnel: PersonnelRecord): string {
        if (!personnel.professionalLicenseType && !personnel.professionalLicenseNumber) return 'ไม่จำเป็นต้องใช้ใบอนุญาต';
        if (!personnel.professionalLicenseNumber || !personnel.professionalLicenseExpiresAt) return 'ข้อมูลใบอนุญาตไม่ครบ';
        return this.professionalLicenseValid(personnel) ? 'ใบอนุญาตยังใช้ได้' : 'ใบอนุญาตหมดอายุ';
    }

    professionalLicenseSeverity(personnel: PersonnelRecord) {
        if (!personnel.professionalLicenseType && !personnel.professionalLicenseNumber) return 'info';
        if (!personnel.professionalLicenseNumber || !personnel.professionalLicenseExpiresAt) return 'warn';
        return this.professionalLicenseValid(personnel) ? 'success' : 'danger';
    }
}
