import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { Project, ProjectService, getProjectSeverity } from '@/app/pages/service/project.service';

@Component({
    selector: 'app-project-list',
    standalone: true,
    imports: [CommonModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule, ProgressBarModule, TableModule, TagModule],
    template: `
        <div class="card">
            <div class="font-semibold text-xl mb-4">ภาพรวมโครงการ</div>
            <p-table
                #dt1
                [value]="projects"
                dataKey="code"
                [rows]="10"
                [rowHover]="true"
                [showGridlines]="true"
                [paginator]="true"
                [globalFilterFields]="['code', 'customerName', 'phone', 'responsibleName', 'status']"
                [tableStyle]="{ 'min-width': '107rem' }"
                responsiveLayout="scroll"
            >
                <ng-template #caption>
                    <div class="flex justify-between items-center flex-column sm:flex-row gap-2">
                        <button pButton label="ล้างตัวกรอง" class="p-button-outlined" icon="pi pi-filter-slash" (click)="clear(dt1)"></button>
                        <p-iconfield iconPosition="left" class="ml-auto">
                            <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                            <input #filter pInputText type="text" (input)="onGlobalFilter(dt1, $event)" placeholder="ค้นหาโครงการ" />
                        </p-iconfield>
                    </div>
                </ng-template>
                <ng-template #header>
                    <tr>
                        <th pSortableColumn="code" style="min-width: 11rem">รหัสโครงการ <p-sortIcon field="code" /></th>
                        <th pSortableColumn="customerName" style="min-width: 14rem">ชื่อ-นามสกุลลูกค้า <p-sortIcon field="customerName" /></th>
                        <th style="min-width: 11rem">เบอร์โทรติดต่อ</th>
                        <th pSortableColumn="responsibleName" style="min-width: 14rem">ผู้รับผิดชอบโครงการ <p-sortIcon field="responsibleName" /></th>
                        <th pSortableColumn="value" style="min-width: 11rem">มูลค่าโครงการ <p-sortIcon field="value" /></th>
                        <th pSortableColumn="startDate" style="min-width: 11rem">วันที่เริ่มโครงการ <p-sortIcon field="startDate" /></th>
                        <th pSortableColumn="deliveryDate" style="min-width: 11rem">กำหนดการส่งมอบ <p-sortIcon field="deliveryDate" /></th>
                        <th pSortableColumn="progress" style="min-width: 13rem">เปอร์เซ็นความคืบหน้า <p-sortIcon field="progress" /></th>
                        <th pSortableColumn="status" style="min-width: 11rem">สถานะโครงการ <p-sortIcon field="status" /></th>
                    </tr>
                </ng-template>
                <ng-template #body let-project>
                    <tr (click)="openProject(project)" (keydown.enter)="openProject(project)" tabindex="0" role="link" [attr.aria-label]="'จัดการโครงการ ' + project.code" style="cursor: pointer">
                        <td class="font-semibold">{{ project.code }}</td>
                        <td>{{ project.customerName }}</td>
                        <td>{{ project.phone }}</td>
                        <td>{{ project.responsibleName }}</td>
                        <td>{{ project.value | currency: 'THB' : 'symbol' : '1.0-0' }}</td>
                        <td>{{ project.startDate | date: 'dd/MM/yyyy' }}</td>
                        <td>{{ project.deliveryDate | date: 'dd/MM/yyyy' }}</td>
                        <td><p-progressbar [value]="project.progress" [showValue]="true" [style]="{ height: '1.25rem' }" /></td>
                        <td><p-tag [value]="project.status" [severity]="getProjectSeverity(project.status)" /></td>
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td colspan="9" class="text-center">ไม่พบข้อมูลโครงการ</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>
    `
})
export class ProjectList {
    private readonly projectService = inject(ProjectService);
    private readonly router = inject(Router);

    @ViewChild('filter') filter!: ElementRef<HTMLInputElement>;

    readonly projects: Project[] = this.projectService.projects;
    readonly getProjectSeverity = getProjectSeverity;

    onGlobalFilter(table: Table, event: Event) {
        table.filterGlobal((event.target as HTMLInputElement).value, 'contains');
    }

    clear(table: Table) {
        table.clear();
        this.filter.nativeElement.value = '';
    }

    openProject(project: Project) {
        this.router.navigate(['/projects', project.code]);
    }
}
