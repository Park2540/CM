import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { rxResource } from '@angular/core/rxjs-interop';
import { problemMessage } from '@/app/api/api';
import { PersonnelRecord, PersonnelService } from '@/app/pages/service/personnel.service';

@Component({
    selector: 'app-personnel-list',
    standalone: true,
    imports: [CommonModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule, TableModule],
    template: `
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div>
                <h1 class="font-semibold text-2xl m-0">ข้อมูลบุคลากรรวม</h1>
                <p class="text-color-secondary mt-2 mb-0">{{ records.value().length }} รายการ</p>
            </div>
            <button pButton type="button" label="เพิ่มบุคลากร" icon="pi pi-user-plus" (click)="createPersonnel()"></button>
        </div>

        @if (expiringLicenses.value().length) {
            <div class="flex items-start gap-3 border border-orange-300 bg-orange-50 text-orange-900 rounded p-4 mb-4" role="status">
                <i class="pi pi-exclamation-triangle mt-1"></i>
                <div>
                    <div class="font-semibold">มีใบอนุญาตหมดอายุหรือใกล้หมดอายุภายใน 90 วัน</div>
                    <div class="mt-1">{{ expiringLicenses.value().length }} รายการ กรุณาตรวจสอบและต่ออายุก่อนมอบหมายงาน</div>
                </div>
            </div>
        }

        @if (records.error(); as error) {
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลบุคลากรไม่สำเร็จ: {{ errorMessage(error) }}</span>
                <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="records.reload()"></button>
            </div>
        }

        <div class="card">
            <p-table
                #dt
                [value]="records.value()"
                [loading]="records.isLoading()"
                dataKey="id"
                [rows]="10"
                [paginator]="true"
                [rowHover]="true"
                [showGridlines]="true"
                [globalFilterFields]="['employeeCode', 'fullName', 'nationalId', 'professionalLicenseNumber', 'position', 'phone', 'currentAddress']"
                [tableStyle]="{ 'min-width': '145rem' }"
                responsiveLayout="scroll"
            >
                <ng-template #caption>
                    <div class="flex justify-end">
                        <p-iconfield iconPosition="left" class="w-full sm:w-80">
                            <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                            <input pInputText type="text" placeholder="ค้นหาข้อมูลบุคลากร" (input)="filterRecords(dt, $event)" />
                        </p-iconfield>
                    </div>
                </ng-template>
                <ng-template #header>
                    <tr>
                        <th pSortableColumn="employeeCode" style="min-width: 10rem">รหัสบุคลากร <p-sortIcon field="employeeCode" /></th>
                        <th style="min-width: 7rem">รูปภาพ</th>
                        <th pSortableColumn="fullName" style="min-width: 14rem">ชื่อ-นามสกุล <p-sortIcon field="fullName" /></th>
                        <th style="min-width: 12rem">เลขบัตรประชาชน</th>
                        <th style="min-width: 14rem">เลขใบประกอบวิชาชีพ</th>
                        <th pSortableColumn="position" style="min-width: 12rem">ตำแหน่ง <p-sortIcon field="position" /></th>
                        <th pSortableColumn="hireDate" style="min-width: 10rem">วันที่เข้างาน <p-sortIcon field="hireDate" /></th>
                        <th pSortableColumn="birthDate" style="min-width: 10rem">วันเดือนปีเกิด <p-sortIcon field="birthDate" /></th>
                        <th style="min-width: 6rem">อายุ</th>
                        <th style="min-width: 11rem">เบอร์โทร</th>
                        <th style="min-width: 20rem">ที่อยู่</th>
                    </tr>
                </ng-template>
                <ng-template #body let-personnel>
                    <tr (click)="openPersonnel(personnel)" (keydown.enter)="openPersonnel(personnel)" tabindex="0" role="link" [attr.aria-label]="'เปิดข้อมูลบุคลากร ' + personnel.fullName" style="cursor: pointer">
                        <td class="font-semibold">{{ personnel.employeeCode }}</td>
                        <td class="text-center">
                            @if (personnel.photoUrl) {
                                <img [src]="personnel.photoUrl" [alt]="personnel.fullName" class="w-10 h-10 rounded-full object-cover mx-auto" />
                            } @else {
                                <span class="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-contrast font-semibold">{{ getInitials(personnel.fullName) }}</span>
                            }
                        </td>
                        <td>{{ personnel.fullName }}</td>
                        <td>{{ personnel.nationalId }}</td>
                        <td>{{ personnel.professionalLicenseNumber || '-' }}</td>
                        <td>{{ personnel.position }}</td>
                        <td>{{ personnel.hireDate | date: 'dd/MM/yyyy' }}</td>
                        <td>{{ personnel.birthDate | date: 'dd/MM/yyyy' }}</td>
                        <td>{{ getAge(personnel.birthDate) }}</td>
                        <td>{{ personnel.phone }}</td>
                        <td>{{ personnel.currentAddress }}</td>
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td colspan="11" class="text-center">ไม่พบข้อมูลบุคลากร</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>
    `
})
export class PersonnelList {
    private readonly personnelService = inject(PersonnelService);
    private readonly router = inject(Router);

    readonly records = rxResource({ stream: () => this.personnelService.list(), defaultValue: [] });
    readonly expiringLicenses = rxResource({ stream: () => this.personnelService.licenseAlerts(90), defaultValue: [] });

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    filterRecords(table: Table, event: Event) {
        table.filterGlobal((event.target as HTMLInputElement).value, 'contains');
    }

    getAge(birthDate: string): number | string {
        if (!birthDate) return '-';

        const birth = new Date(`${birthDate}T00:00:00`);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const hasHadBirthday = today.getMonth() > birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());

        if (!hasHadBirthday) age--;
        return age;
    }

    getInitials(fullName: string): string {
        return fullName
            .split(' ')
            .slice(0, 2)
            .map((part) => part[0] ?? '')
            .join('');
    }

    openPersonnel(personnel: PersonnelRecord) {
        this.router.navigate(['/master/personnel', personnel.id]);
    }

    createPersonnel() {
        this.router.navigate(['/master/personnel/new']);
    }
}
