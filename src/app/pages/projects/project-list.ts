import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '@/app/pages/service/auth.service';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { ProgressBarModule } from 'primeng/progressbar';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { problemMessage } from '@/app/api/api';
import { PROJECT_GROUP_LABEL, PROJECT_STATUS_LABEL, Project, ProjectGroup, ProjectService, getProjectSeverity } from '@/app/pages/service/project.service';
import { apiResource } from '@/app/api/api-resource';

const GROUPS: ProjectGroup[] = ['in-hand', 'pending-contract', 'active', 'completed', 'warranty'];

@Component({
    selector: 'app-project-list',
    standalone: true,
    imports: [CommonModule, ButtonModule, IconFieldModule, InputIconModule, InputTextModule, ProgressBarModule, RouterLink, TableModule, TagModule],
    template: `
        <div class="card">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div class="font-semibold text-xl">ภาพรวมโครงการ</div>
                @if (canCreate()) {
                    <a pButton routerLink="/projects/new" icon="pi pi-plus" label="เปิดโครงการใหม่"></a>
                }
            </div>
            @if (projects.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดรายการโครงการไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="projects.reload()"></button>
                </div>
            }
            <div class="flex flex-wrap gap-2 mb-4" role="group" aria-label="กลุ่มโครงการ">
                <button type="button" class="group-chip" [class.group-chip-active]="!group()" [attr.aria-pressed]="!group()" (click)="setGroup(null)">ทั้งหมด</button>
                @for (item of groups; track item) {
                    <button type="button" class="group-chip" [class.group-chip-active]="group() === item" [attr.aria-pressed]="group() === item" (click)="setGroup(item)">{{ groupLabel[item] }}</button>
                }
            </div>
            <p-table
                #dt1
                [value]="sortedProjects()"
                [loading]="projects.isLoading()"
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
                        <td>{{ project.value === null ? 'รอเซ็นสัญญา' : (project.value | currency: 'THB' : 'symbol' : '1.0-0') }}</td>
                        <td>{{ project.startDate ? (project.startDate | date: 'dd/MM/yyyy') : '-' }}</td>
                        <td>{{ project.deliveryDate ? (project.deliveryDate | date: 'dd/MM/yyyy') : '-' }}</td>
                        <td><p-progressbar [value]="project.progress" [showValue]="true" [style]="{ height: '1.25rem' }" /></td>
                        <td>
                            <p-tag [value]="statusLabel[project.status]" [severity]="getProjectSeverity(project.status)" />
                            @for (coverage of project.warranties ?? []; track coverage.type) {
                                <div class="text-xs mt-1" [class.text-muted-color]="!coverage.active">
                                    {{ coverage.label }}: {{ coverage.active ? 'ประกันถึง ' + (coverage.endDate | date: 'dd/MM/yyyy') : 'หมดประกันแล้ว' }}
                                </div>
                            }
                        </td>
                    </tr>
                </ng-template>
                <ng-template #emptymessage>
                    <tr>
                        <td colspan="9" class="text-center">{{ projects.isLoading() ? 'กำลังโหลด...' : group() ? 'ไม่มีโครงการในกลุ่ม "' + groupLabel[group()!] + '"' : 'ไม่พบข้อมูลโครงการ' }}</td>
                    </tr>
                </ng-template>
            </p-table>
        </div>
    `,
    styles: `
        .group-chip {
            padding: 0.375rem 0.875rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 999px;
            background: transparent;
            color: var(--p-text-color);
            font-size: 0.875rem;
            cursor: pointer;
        }
        .group-chip:hover {
            border-color: var(--p-primary-color);
        }
        .group-chip-active {
            background: var(--p-primary-color);
            border-color: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
    `
})
export class ProjectList {
    private readonly projectService = inject(ProjectService);
    private readonly router = inject(Router);
    private readonly auth = inject(AuthService);
    readonly canCreate = computed(() => this.auth.can('project.create'));

    @ViewChild('filter') filter!: ElementRef<HTMLInputElement>;

    private readonly route = inject(ActivatedRoute);

    readonly groups = GROUPS;
    readonly groupLabel = PROJECT_GROUP_LABEL;
    /** กลุ่มที่เลือกอยู่ใน URL (?group=) ให้ลิงก์จาก Dashboard เปิดมาพร้อมตัวกรอง */
    readonly group = toSignal(this.route.queryParamMap.pipe(map((params) => ((GROUPS as string[]).includes(params.get('group') ?? '') ? (params.get('group') as ProjectGroup) : null))), { initialValue: null });

    readonly projects = apiResource({ params: () => ({ group: this.group() }), stream: ({ params }) => this.projectService.list(params), defaultValue: [] });
    /** โครงการที่เปิดล่าสุดอยู่บนสุด (คลิกหัวคอลัมน์เพื่อเรียงแบบอื่นได้) */
    readonly sortedProjects = computed(() => [...this.projects.value()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.code.localeCompare(a.code)));

    setGroup(group: ProjectGroup | null) {
        this.router.navigate([], { relativeTo: this.route, queryParams: { group }, queryParamsHandling: 'merge', replaceUrl: true });
    }
    readonly statusLabel: Record<string, string> = PROJECT_STATUS_LABEL;
    readonly getProjectSeverity = getProjectSeverity;

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

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
