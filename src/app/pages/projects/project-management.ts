import { DecimalPipe, NgClass } from '@angular/common';
import { Component, Injector, afterNextRender, computed, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { ProgressUpdate, ProjectProgressService } from '@/app/pages/service/project-progress.service';
import { PROJECT_STATUS_LABEL, Project, ProjectService, getProjectSeverity, isContracted } from '@/app/pages/service/project.service';
import { HttpErrorResponse } from '@angular/common/http';
import { TimelinePhase, TimelineTask, todayAsDate } from '@/app/pages/service/project-timeline.service';
import { ContractForm } from './components/contract-form';
import { InspectionDialog } from './components/inspection-dialog';
import { ProgressUpdateForm } from './components/progress-update-form';
import { ProjectUpdatesTab } from './components/project-updates-tab';
import { ProjectRecordsService, SitePhoto } from '@/app/pages/service/project-records.service';
import { HousePlanService } from '@/app/pages/service/house-plan.service';
import { CurrentWorkCard, HoldPointsCard, MilestonesCard, OwnerAction, OwnerActionsCard, PaymentSummaryCard, RecentPhotosCard, TeamCard } from './components/project-cards';
import { ProjectDocumentsTab } from './components/project-documents-tab';
import { ProjectTeamTab } from './components/project-team-tab';
import { PaymentChange, ProjectPaymentsTab } from './components/project-payments-tab';
import { ProjectPhotosTab } from './components/project-photos-tab';
import { ProjectPlanTab } from './components/project-plan-tab';
import { ProjectStepsOverview } from './components/project-steps-overview';
import { ProjectTimelineTab } from './components/project-timeline-tab';
import { ProjectChangeOrdersTab } from './components/project-change-orders-tab';
import { ProjectProcurementTab } from './components/project-procurement-tab';
import { ChangeOrderService } from '@/app/pages/service/change-order.service';
import { ProjectModel } from '@/app/pages/service/project-model.service';
import { PROJECT_TABS, ProjectTab } from './components/project-ui';
import { ThaiDatePipe } from './thai-date.pipe';
import { apiResource } from '@/app/api/api-resource';

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

@Component({
    selector: 'app-project-management',
    standalone: true,
    imports: [
        ContractForm,
        ButtonModule,
        CurrentWorkCard,
        DecimalPipe,
        NgClass,
        HoldPointsCard,
        InspectionDialog,
        MilestonesCard,
        ProgressUpdateForm,
        ProjectUpdatesTab,
        ToastModule,
        OwnerActionsCard,
        PaymentSummaryCard,
        ProjectDocumentsTab,
        ProjectPaymentsTab,
        ProjectPhotosTab,
        ProjectPlanTab,
        ProjectChangeOrdersTab,
        ProjectProcurementTab,
        ProjectStepsOverview,
        ProjectTimelineTab,
        RecentPhotosCard,
        RouterLink,
        TagModule,
        ProjectTeamTab,
        TeamCard,
        ThaiDatePipe
    ],
    providers: [MessageService],
    template: `
        <p-toast />
        <a routerLink="/projects" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4">
            <i class="pi pi-arrow-left"></i>
            <span>ภาพรวมโครงการ</span>
        </a>

        @if (planned(); as project) {
            <!-- ข้อมูลโครงการ -->
            <section class="card flex flex-col lg:flex-row lg:items-center gap-6 mb-0 rounded-b-none">
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-3">
                        <span class="px-2 py-1 rounded-md bg-emphasis text-sm font-semibold">{{ project.code }}</span>
                        <p-tag [value]="statusLabel[project.status]" [severity]="getProjectSeverity(project.status)" />
                        <div class="ml-auto flex flex-wrap gap-2">
                            @if (canManage()) {
                                <a pButton [routerLink]="['/projects', project.code, 'setup']" icon="pi pi-sliders-h" label="ตั้งค่างานก่อสร้าง" [outlined]="true"></a>
                            }
                            @if (canUpdate() && timeline()) {
                                <button pButton type="button" icon="pi pi-pencil" label="อัปเดตงาน" (click)="openUpdateForm()"></button>
                            }
                        </div>
                    </div>
                    <h1 class="text-2xl font-bold m-0">{{ project.name }}</h1>
                    <div class="flex items-center gap-2 text-muted-color mt-2">
                        <i class="pi pi-map-marker"></i>
                        <span>{{ project.location }}</span>
                    </div>
                    <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 mb-0">
                        <div>
                            <dt class="text-sm text-muted-color">วันเริ่มงาน</dt>
                            <dd class="m-0 mt-1 font-semibold">{{ project.startDate | thaiDate }}</dd>
                        </div>
                        <div>
                            <dt class="text-sm text-muted-color">กำหนดส่งมอบ</dt>
                            <dd class="m-0 mt-1 font-semibold">{{ project.deliveryDate | thaiDate }}</dd>
                        </div>
                        <div>
                            <dt class="text-sm text-muted-color">มูลค่าสัญญา</dt>
                            <dd class="m-0 mt-1 font-semibold">฿{{ project.revisedValue ?? project.value | number: '1.0-0' }}</dd>
                            @if (project.changeOrderTotal) {
                                <dd class="m-0 text-xs text-muted-color">สัญญาเดิม ฿{{ project.value | number: '1.0-0' }} · งานเพิ่ม-ลด {{ project.changeOrderTotal > 0 ? '+' : '−' }}฿{{ abs(project.changeOrderTotal) | number: '1.0-0' }}</dd>
                            }
                        </div>
                        <div>
                            <dt class="text-sm text-muted-color">ผู้รับผิดชอบโครงการ</dt>
                            <dd class="m-0 mt-1 font-semibold">{{ project.responsibleName }}</dd>
                        </div>
                    </dl>
                </div>

                <div class="flex items-center gap-5 lg:border-l lg:border-surface lg:pl-8">
                    <div class="relative w-32 h-32 shrink-0" role="img" [attr.aria-label]="'ความคืบหน้ารวม ' + progress() + ' เปอร์เซ็นต์'">
                        <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
                            <circle cx="60" cy="60" [attr.r]="ringRadius" fill="none" stroke-width="10" style="stroke: var(--p-content-border-color)" />
                            <circle
                                cx="60"
                                cy="60"
                                [attr.r]="ringRadius"
                                fill="none"
                                stroke-width="10"
                                stroke-linecap="round"
                                style="stroke: var(--p-primary-color)"
                                [attr.stroke-dasharray]="ringCircumference"
                                [attr.stroke-dashoffset]="ringCircumference * (1 - progress() / 100)"
                            />
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center">
                            <span class="text-3xl font-bold">{{ progress() }}%</span>
                            <span class="text-xs text-muted-color">ความคืบหน้ารวม</span>
                        </div>
                    </div>
                    <div>
                        @if (progress() >= 100) {
                            <div class="text-sm text-muted-color">สถานะ</div>
                            <div class="text-2xl font-bold text-green-600 dark:text-green-400">ส่งมอบแล้ว</div>
                            @if (project.warranties?.length) {
                                <ul class="list-none p-0 m-0 mt-2 flex flex-col gap-1 text-sm" aria-label="การรับประกัน">
                                    @for (coverage of project.warranties; track coverage.type) {
                                        <li [class.text-muted-color]="!coverage.active">
                                            <i class="pi pi-shield text-xs mr-1" aria-hidden="true"></i>{{ coverage.label }}
                                            @if (coverage.active) {
                                                ถึง {{ coverage.endDate | thaiDate }}
                                            } @else {
                                                หมดประกันแล้ว
                                            }
                                        </li>
                                    }
                                </ul>
                                <a routerLink="/warranty" class="text-xs text-primary">ดูโครงการที่รับประกัน</a>
                            }
                        } @else if (daysToDelivery() >= 0) {
                            <div class="text-sm text-muted-color">เหลือเวลาถึงกำหนดส่งมอบ</div>
                            <div class="text-3xl font-bold">{{ daysToDelivery() }} วัน</div>
                        } @else {
                            <div class="text-sm text-muted-color">เลยกำหนดส่งมอบ</div>
                            <div class="text-3xl font-bold text-red-600 dark:text-red-400">{{ -daysToDelivery() }} วัน</div>
                        }
                        <div class="text-sm text-muted-color mt-1">ส่งมอบ {{ project.deliveryDate | thaiDate }}</div>
                    </div>
                </div>
            </section>

            <!-- แท็บ -->
            <nav class="card py-0 rounded-t-none border-t border-surface mb-6 overflow-x-auto">
                <div class="flex gap-1 min-w-max" role="tablist" aria-label="ข้อมูลโครงการ" (keydown)="onTabKeydown($event)">
                    @for (tab of tabs; track tab.value) {
                        <button
                            type="button"
                            role="tab"
                            [id]="'tab-' + tab.value"
                            [attr.aria-selected]="activeTab() === tab.value"
                            aria-controls="project-tabpanel"
                            [attr.tabindex]="activeTab() === tab.value ? 0 : -1"
                            class="flex items-center gap-2 px-4 py-4 bg-transparent border-0 border-b-2 cursor-pointer whitespace-nowrap transition-colors"
                            [class]="activeTab() === tab.value ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted-color hover:text-color'"
                            (click)="setTab(tab.value)"
                        >
                            <i [class]="tab.icon"></i>
                            {{ tab.label }}
                            @if (tab.value === 'payments' && dueCount()) {
                                <span class="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center" [attr.aria-label]="dueCount() + ' งวดรอชำระ'">{{ dueCount() }}</span>
                            }
                            @if (tab.value === 'changes' && pendingChangeCount()) {
                                <span class="w-5 h-5 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center" [attr.aria-label]="pendingChangeCount() + ' รายการรออนุมัติ'">{{ pendingChangeCount() }}</span>
                            }
                        </button>
                    }
                </div>
            </nav>

            @if (timeline(); as timeline) {
                <div id="project-tabpanel" role="tabpanel" [attr.aria-labelledby]="'tab-' + activeTab()">
                    @switch (activeTab()) {
                        @case ('overview') {
                            <app-project-steps-overview [phases]="timeline.phases" (select)="showPhase($event)" />
                            <div class="grid grid-cols-12 gap-6">
                                <div class="col-span-12 xl:col-span-8 flex flex-col gap-6">
                                    <app-current-work-card [phases]="timeline.phases" (viewTimeline)="setTab('timeline')" />
                                    <app-payment-summary-card [installments]="installments()" [contractValue]="project.revisedValue ?? project.value" (viewAll)="setTab('payments')" />
                                    <app-recent-photos-card [photos]="recentPhotos().items" [total]="recentPhotos().total" [limit]="9" (open)="showPhoto($event)" (viewAll)="setTab('photos')" />
                                </div>
                                <aside class="col-span-12 xl:col-span-4 flex flex-col gap-6">
                                    <app-owner-actions-card [actions]="ownerActions()" (navigate)="setTab($event)" />
                                    <app-team-card [team]="team()" />
                                    <app-hold-points-card [phases]="timeline.phases" />
                                    <app-milestones-card [phases]="timeline.phases" />
                                </aside>
                            </div>
                        }
                        @case ('timeline') {
                            <app-project-steps-overview [phases]="timeline.phases" (select)="showPhase($event)" />
                            <div class="grid grid-cols-12 gap-6">
                                <section class="col-span-12 xl:col-span-8">
                                    <app-project-timeline-tab [phases]="timeline.phases" [canUpdate]="canUpdate()" (updateTask)="openUpdateForm($event)" (inspectTask)="inspecting.set($event)" />
                                </section>
                                <aside class="col-span-12 xl:col-span-4 flex flex-col gap-6">
                                    <app-owner-actions-card [actions]="ownerActions()" (navigate)="setTab($event)" />
                                    <app-recent-photos-card [photos]="recentPhotos().items" [total]="recentPhotos().total" (open)="showPhoto($event)" (viewAll)="setTab('photos')" />
                                    <app-team-card [team]="team()" />
                                </aside>
                            </div>
                        }
                        @case ('updates') {
                            <app-project-updates-tab [projectCode]="project.code" [canUpdate]="canUpdate()" [refreshKey]="refreshKey()" (requestUpdate)="openUpdateForm()" />
                        }
                        @case ('plan') {
                            @if (housePlanResource.isLoading()) {
                                <div class="card text-center text-muted-color py-12"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดแบบบ้าน...</div>
                            } @else {
                                <app-project-plan-tab [projectCode]="project.code" [plan]="housePlan()" [canManage]="canManage()" (openDocuments)="setTab('documents')" (modelsChanged)="onModelsChanged($event)" (houseChanged)="onHouseChanged()" />
                            }
                        }
                        @case ('photos') {
                            <app-project-photos-tab [projectCode]="project.code" [refreshKey]="refreshKey()" />
                        }
                        @case ('team') {
                            <app-project-team-tab [projectCode]="project.code" [phases]="timeline.phases" [canManage]="canManage()" (changed)="onTeamChanged()" />
                        }
                        @case ('payments') {
                            <app-project-payments-tab [projectCode]="project.code" [installments]="installments()" [contractValue]="project.revisedValue ?? project.value" [canRecord]="canRecordPayment()" (changed)="onPaymentChanged($event)" />
                        }
                        @case ('changes') {
                            <app-project-change-orders-tab
                                [projectCode]="project.code"
                                [orders]="changeOrders()"
                                [contractValue]="project.value"
                                [phases]="timeline.phases"
                                [canManage]="canManage()"
                                [canApprove]="canApproveChanges()"
                                (changed)="onChangeOrdersChanged()"
                            />
                        }
                        @case ('procurement') {
                            <app-project-procurement-tab [projectCode]="project.code" [phases]="timeline.phases" (notify)="messages.add({ severity: 'success', summary: $event })" />
                        }
                        @case ('documents') {
                            <app-project-documents-tab [projectCode]="project.code" [refreshKey]="refreshKey()" />
                        }
                    }
                </div>

                @if (updateFormOpen()) {
                    <app-progress-update-form [projectCode]="project.code" [projectStartDate]="project.startDate" [phases]="timeline.phases" [initialTaskCode]="updateTaskCode()" (saved)="onSaved($event)" (closed)="updateFormOpen.set(false)" />
                }
                @if (inspecting(); as task) {
                    <app-inspection-dialog [projectCode]="project.code" [task]="task" (saved)="onSaved($event)" (closed)="inspecting.set(null)" />
                }
            } @else if (timelineResource.error(); as error) {
                <div class="card flex flex-wrap items-center justify-between gap-3" role="alert">
                    <span class="text-red-700 dark:text-red-300"><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลโครงการไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" icon="pi pi-refresh" label="ลองใหม่" (click)="timelineResource.reload()"></button>
                </div>
            } @else {
                <div class="card text-center text-muted-color py-12"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดไทม์ไลน์โครงการ...</div>
            }
        } @else if (project(); as project) {
            <!-- โครงการที่ยังไม่เริ่มก่อสร้าง: รอบันทึกสัญญา หรือรอตั้งค่างานก่อสร้าง -->
            <section class="card mb-6">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2 mb-3">
                            <span class="px-2 py-1 rounded-md bg-emphasis text-sm font-semibold">{{ project.code }}</span>
                            <p-tag [value]="statusLabel[project.status]" [severity]="getProjectSeverity(project.status)" />
                        </div>
                        <h1 class="text-2xl font-bold m-0">{{ project.name }}</h1>
                        <div class="text-muted-color mt-2">เปิดโครงการเมื่อ {{ project.createdAt | thaiDate: 'dateTime' }} · ผู้รับผิดชอบ {{ project.responsibleName }}</div>
                    </div>
                    @if (canManage()) {
                        @if (contracted()) {
                            <a pButton [routerLink]="['/projects', project.code, 'setup']" icon="pi pi-sliders-h" label="ตั้งค่างานก่อสร้าง"></a>
                        } @else {
                            <button pButton type="button" icon="pi pi-file-check" label="บันทึกสัญญา" (click)="contractFormOpen.set(true)"></button>
                        }
                    }
                </div>

                <ol class="list-none p-0 m-0 mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3" aria-label="ขั้นตอนโครงการ">
                    @for (step of lifecycleSteps(); track step.label) {
                        <li
                            class="flex items-center gap-3 rounded-lg p-3"
                            [ngClass]="step.state === 'done' ? 'bg-primary-50 dark:bg-primary-500/10' : step.state === 'current' ? 'border-2 border-orange-400 dark:border-orange-500' : 'border border-surface'"
                            [attr.aria-current]="step.state === 'current' ? 'step' : null"
                        >
                            @switch (step.state) {
                                @case ('done') {
                                    <span class="w-8 h-8 rounded-full bg-primary text-primary-contrast flex items-center justify-center shrink-0" aria-hidden="true"><i class="pi pi-check text-sm"></i></span>
                                }
                                @case ('current') {
                                    <span class="w-8 h-8 rounded-full border-2 border-orange-500 flex items-center justify-center shrink-0" aria-hidden="true"><span class="w-3 h-3 rounded-full bg-orange-500"></span></span>
                                }
                                @default {
                                    <span class="w-8 h-8 rounded-full border-2 border-surface-300 dark:border-surface-600 shrink-0" aria-hidden="true"></span>
                                }
                            }
                            <div>
                                <div class="font-semibold" [class.text-muted-color]="step.state === 'todo'">{{ step.label }}</div>
                                <div class="text-xs text-muted-color">{{ step.detail }}</div>
                            </div>
                        </li>
                    }
                </ol>

                @if (contracted(); as contract) {
                    <div class="mt-5 pt-5 border-t border-surface">
                        <dl class="grid grid-cols-2 md:grid-cols-4 gap-4 m-0">
                            <div>
                                <dt class="text-sm text-muted-color">มูลค่าสัญญา</dt>
                                <dd class="m-0 mt-1 font-semibold">฿{{ contract.value | number: '1.0-0' }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm text-muted-color">วันเริ่มงาน</dt>
                                <dd class="m-0 mt-1 font-semibold">{{ contract.startDate | thaiDate }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm text-muted-color">กำหนดส่งมอบ</dt>
                                <dd class="m-0 mt-1 font-semibold">{{ contract.deliveryDate | thaiDate }}</dd>
                            </div>
                            <div>
                                <dt class="text-sm text-muted-color">ที่ตั้งหน้างาน</dt>
                                <dd class="m-0 mt-1 font-semibold">{{ contract.location }}</dd>
                            </div>
                        </dl>
                        <p class="text-sm text-muted-color mt-4 mb-0"><i class="pi pi-info-circle mr-1"></i>ขั้นต่อไป: ตั้งค่าว่าบ้านหลังนี้มีงานอะไรบ้าง (จำนวนชั้น ประเภทฐานราก ระบบพิเศษ) ระบบจะสร้างไทม์ไลน์และงวดงานให้อัตโนมัติ</p>
                    </div>
                }
            </section>

            <div class="grid grid-cols-12 gap-6 mb-6">
                <section class="card m-0 col-span-12 lg:col-span-5" aria-labelledby="customer-info-heading">
                    <h2 id="customer-info-heading" class="text-lg font-semibold m-0 mb-4">ข้อมูลลูกค้า</h2>
                    <dl class="m-0 flex flex-col gap-3 text-sm">
                        <div class="flex gap-3">
                            <dt class="w-24 shrink-0 text-muted-color">ชื่อ</dt>
                            <dd class="m-0 font-semibold">{{ project.customerName }}</dd>
                        </div>
                        <div class="flex gap-3">
                            <dt class="w-24 shrink-0 text-muted-color">เบอร์โทร</dt>
                            <dd class="m-0">
                                <a [href]="'tel:' + project.phone" class="text-primary">{{ project.phone }}</a>
                            </dd>
                        </div>
                        <div class="flex gap-3">
                            <dt class="w-24 shrink-0 text-muted-color">อีเมล</dt>
                            <dd class="m-0">{{ project.customerEmail || '-' }}</dd>
                        </div>
                        <div class="flex gap-3">
                            <dt class="w-24 shrink-0 text-muted-color">LINE</dt>
                            <dd class="m-0">{{ project.customerLineId || '-' }}</dd>
                        </div>
                        <div class="flex gap-3">
                            <dt class="w-24 shrink-0 text-muted-color">ที่อยู่</dt>
                            <dd class="m-0">{{ project.customerAddress || '-' }}</dd>
                        </div>
                    </dl>
                </section>
                <section class="card m-0 col-span-12 lg:col-span-7" aria-labelledby="requested-plan-heading">
                    <h2 id="requested-plan-heading" class="text-lg font-semibold m-0 mb-4">แบบบ้านที่ลูกค้าต้องการ</h2>
                    <div class="flex items-start gap-3">
                        <i class="pi pi-home text-xl text-primary mt-1"></i>
                        <div>
                            <div class="font-semibold">{{ project.housePlanName }}</div>
                            <div class="text-sm text-muted-color mt-1">{{ project.housePlanCode ? 'แบบจากคลังแบบบ้าน ดูแปลนและโมเดล 3D ด้านล่าง' : 'แบบที่กำหนดเอง ยังไม่มีแปลนในระบบ' }}</div>
                        </div>
                    </div>
                    <h3 class="text-sm font-semibold mt-5 mb-2">ความต้องการเพิ่มเติม</h3>
                    <p class="m-0 whitespace-pre-line" [class.text-muted-color]="!project.requirements">{{ project.requirements || 'ยังไม่ได้ระบุ' }}</p>
                </section>
            </div>

            <!-- แนบแบบ 3 มิติได้ตั้งแต่ยังไม่เซ็นสัญญา (เช่น แบบที่เสนอลูกค้า) -->
            @if (!housePlanResource.isLoading()) {
                <app-project-plan-tab [projectCode]="project.code" [plan]="housePlan()" [canManage]="canManage()" [showDocumentsLink]="false" (modelsChanged)="onModelsChanged($event)" (houseChanged)="onHouseChanged()" />
            }

            @if (contractFormOpen()) {
                <app-contract-form [project]="project" (saved)="onContracted($event)" (closed)="contractFormOpen.set(false)" />
            }
        } @else if (projectNotFound()) {
            <div class="card">
                <h1 class="font-semibold text-2xl m-0 mb-4">ไม่พบโครงการ</h1>
                <a pButton routerLink="/projects" icon="pi pi-arrow-left" label="กลับภาพรวมโครงการ" class="p-button-outlined"></a>
            </div>
        } @else if (projectResource.error(); as error) {
            <div class="card flex flex-wrap items-center justify-between gap-3" role="alert">
                <span class="text-red-700 dark:text-red-300"><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลโครงการไม่สำเร็จ: {{ errorMessage(error) }}</span>
                <button pButton type="button" [outlined]="true" icon="pi pi-refresh" label="ลองใหม่" (click)="projectResource.reload()"></button>
            </div>
        } @else {
            <div class="card text-center text-muted-color py-12"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดข้อมูลโครงการ...</div>
        }
    `
})
export class ProjectManagement {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly injector = inject(Injector);
    private readonly projectService = inject(ProjectService);
    private readonly progressService = inject(ProjectProgressService);
    private readonly auth = inject(AuthService);
    protected readonly messages = inject(MessageService);
    private readonly recordsService = inject(ProjectRecordsService);
    private readonly housePlanService = inject(HousePlanService);
    private readonly changeOrderService = inject(ChangeOrderService);
    private readonly thaiDate = new ThaiDatePipe();

    readonly getProjectSeverity = getProjectSeverity;
    readonly ringRadius = RING_RADIUS;
    readonly ringCircumference = RING_CIRCUMFERENCE;
    readonly tabs = PROJECT_TABS;

    private readonly timelineTab = viewChild(ProjectTimelineTab);
    private readonly photosTab = viewChild(ProjectPhotosTab);

    private readonly code = toSignal(this.route.paramMap.pipe(map((params) => params.get('code') ?? '')), { initialValue: '' });
    private readonly tabFromUrl = toSignal(this.route.queryParamMap.pipe(map((params) => params.get('tab'))), { initialValue: null });
    // Local state follows the URL but updates immediately on click, so child tabs exist on the next render.
    readonly activeTab = linkedSignal<ProjectTab>(() => {
        const tab = this.tabFromUrl();
        return this.tabs.some((item) => item.value === tab) ? (tab as ProjectTab) : 'overview';
    });

    readonly projectResource = apiResource({
        params: () => this.code() || undefined,
        stream: ({ params: code }) => this.projectService.get(code)
    });
    readonly project = computed(() => this.projectResource.value());
    /** โครงการที่บันทึกสัญญาแล้ว (มีแผนงาน งวดงาน ภาพ เอกสาร) — null ถ้ายังรอเซ็นสัญญา */
    readonly contracted = computed(() => {
        const project = this.project();
        return isContracted(project) ? project : null;
    });
    /** โครงการที่ตั้งค่างานก่อสร้างแล้ว (มีไทม์ไลน์ งวดงาน ภาพ เอกสาร) */
    readonly planned = computed(() => {
        const project = this.contracted();
        return project?.setupConfiguredAt ? project : null;
    });
    /** ขั้นตอนก่อนเริ่มก่อสร้าง: เปิดโครงการ → บันทึกสัญญา → ตั้งค่างานก่อสร้าง → เริ่มก่อสร้าง */
    readonly lifecycleSteps = computed(() => {
        const current = this.contracted() ? 2 : 1;
        const steps = [
            { label: 'เปิดโครงการ', detail: 'ข้อมูลลูกค้าและแบบบ้าน' },
            { label: 'บันทึกสัญญา', detail: 'มูลค่า วันที่ ที่ตั้งหน้างาน' },
            { label: 'ตั้งค่างานก่อสร้าง', detail: 'ฐานราก จำนวนชั้น ระบบพิเศษ' },
            { label: 'เริ่มก่อสร้าง', detail: 'ไทม์ไลน์ งวดงาน อัปเดตงาน' }
        ];
        return steps.map((step, index) => ({ ...step, state: index < current ? 'done' : index === current ? 'current' : 'todo' }));
    });
    readonly canManage = computed(() => this.auth.can('project.manage'));
    readonly contractFormOpen = signal(false);
    readonly projectNotFound = computed(() => {
        const error = this.projectResource.error();
        return error instanceof HttpErrorResponse && error.status === 404;
    });
    readonly statusLabel = PROJECT_STATUS_LABEL;
    /** ไทม์ไลน์จาก API — หลังบ้านคำนวณ % ใหม่ทุกครั้งที่มีการอัปเดตงาน */
    readonly timelineResource = apiResource({
        params: () => (this.planned() ? this.code() : undefined),
        stream: ({ params: code }) => this.progressService.getTimeline(code)
    });
    readonly timeline = computed(() => this.timelineResource.value() ?? null);
    readonly progress = computed(() => this.timeline()?.progress ?? this.project()?.progress ?? 0);

    /** บทบาทที่บันทึกความคืบหน้าได้ (หลังบ้านตรวจสิทธิ์ซ้ำอีกชั้น) */
    readonly canUpdate = computed(() => this.auth.can('progress.update'));
    readonly updateFormOpen = signal(false);
    readonly updateTaskCode = signal<string | null>(null);
    readonly inspecting = signal<TimelineTask | null>(null);
    /** เพิ่มค่าเมื่อมีบันทึกใหม่ ให้แท็บบันทึกหน้างานโหลดใหม่ */
    readonly refreshKey = signal(0);
    // ข้อมูลประกอบของโครงการ โหลดใหม่เมื่อมีการอัปเดตงาน (refreshKey) เพราะสถานะงวดและภาพเปลี่ยนตาม
    private readonly projectParams = computed(() => (this.planned() ? { code: this.code(), refresh: this.refreshKey() } : undefined));
    private readonly installmentsResource = apiResource({ params: this.projectParams, stream: ({ params }) => this.recordsService.installments(params.code), defaultValue: [] });
    readonly teamResource = apiResource({ params: this.projectParams, stream: ({ params }) => this.recordsService.team(params.code), defaultValue: [] });
    private readonly recentPhotosResource = apiResource({
        params: this.projectParams,
        stream: ({ params }) => this.recordsService.photos(params.code, { pageSize: 9 }),
        defaultValue: { items: [], total: 0, phases: [] }
    });
    readonly installments = this.installmentsResource.value;
    /** งานเพิ่ม-ลด (โหลดใหม่ตาม refreshKey เหมือนข้อมูลประกอบอื่น) */
    private readonly changeOrdersResource = apiResource({ params: this.projectParams, stream: ({ params }) => this.changeOrderService.list(params.code), defaultValue: [] });
    readonly changeOrders = this.changeOrdersResource.value;
    readonly pendingChangeCount = computed(() => this.changeOrders().filter((order) => order.status === 'pending').length);
    /** งานเพิ่ม-ลดต้องให้ผู้อนุมัติทุกยอดตัดสิน (หลังบ้านตรวจซ้ำ) */
    readonly canApproveChanges = computed(() => this.auth.can('approval.any'));
    readonly canRecordPayment = computed(() => this.auth.can('payment.record'));
    readonly abs = Math.abs;
    readonly team = this.teamResource.value;
    readonly recentPhotos = this.recentPhotosResource.value;

    readonly housePlanResource = apiResource({
        params: () => this.project()?.housePlanCode,
        stream: ({ params: code }) => this.housePlanService.get(code)
    });
    readonly housePlan = computed(() => (this.housePlanResource.error() ? undefined : this.housePlanResource.value()));

    readonly dueCount = computed(() => this.installments().filter((item) => item.status === 'due').length);
    readonly daysToDelivery = computed(() => {
        const project = this.project();
        if (!project) return 0;
        return Math.round((Date.parse(`${project.deliveryDate}T00:00:00Z`) - todayAsDate().getTime()) / 86_400_000);
    });

    readonly ownerActions = computed((): OwnerAction[] => {
        const payments = this.installments()
            .filter((item) => item.status === 'due')
            .map((item) => ({
                key: `payment-${item.no}`,
                title: `ชำระเงินงวดที่ ${item.no}`,
                detail: `${item.title} · ฿${item.amount.toLocaleString('th-TH')} · ครบกำหนด ${this.thaiDate.transform(item.dueDate)}`,
                urgent: true,
                actionLabel: 'ดูรายละเอียดงวด',
                tab: 'payments' as ProjectTab
            }));
        const tasks = (this.timeline()?.phases ?? [])
            .flatMap((phase) => phase.tasks.map((task) => ({ phase, task })))
            .filter(({ task }) => task.involvesOwner && task.status !== 'done')
            .sort((a, b) => a.task.start.getTime() - b.task.start.getTime())
            .slice(0, 3)
            .map(({ phase, task }) => ({
                key: `task-${task.code}`,
                title: task.name,
                detail: `ขั้นตอนที่ ${phase.step} · แผน ${this.thaiDate.transform(task.start)}`,
                urgent: !payments.length && task.status === 'active'
            }));
        return [...payments, ...tasks];
    });

    onContracted(project: Project) {
        this.contractFormOpen.set(false);
        this.projectResource.set(project);
        // ขั้นต่อไป: ตั้งค่างานก่อสร้างเพื่อสร้างไทม์ไลน์
        this.router.navigate(['/projects', project.code, 'setup']);
    }

    /** งานเพิ่ม-ลดเปลี่ยน: มูลค่าสัญญา กำหนดส่งมอบ ไทม์ไลน์ และงวดเงินอาจเปลี่ยนตาม */
    onChangeOrdersChanged() {
        this.projectResource.reload();
        this.timelineResource.reload();
        this.refreshKey.update((key) => key + 1);
    }

    /** บันทึก/ยกเลิกรับชำระ: โหลดงวดเงินและเอกสาร (หลักฐานอยู่ในหมวดใบแจ้งหนี้/ใบเสร็จ) ใหม่ */
    onPaymentChanged({ kind, installment }: PaymentChange) {
        this.refreshKey.update((key) => key + 1);
        this.messages.add(
            kind === 'recorded'
                ? { severity: 'success', summary: `บันทึกรับชำระงวดที่ ${installment.no} แล้ว`, detail: `฿${(installment.payment?.amount ?? 0).toLocaleString('th-TH')} · หลักฐานอยู่ในแท็บเอกสาร` }
                : { severity: 'info', summary: `ยกเลิกการรับชำระงวดที่ ${installment.no} แล้ว` }
        );
    }

    onHouseChanged() {
        this.messages.add({ severity: 'success', summary: 'บันทึกข้อมูลแบบบ้านแล้ว' });
    }

    onModelsChanged({ kind, model }: { kind: 'uploaded' | 'deleted'; model: ProjectModel }) {
        this.messages.add(
            kind === 'uploaded'
                ? { severity: 'success', summary: `บันทึกแบบ 3 มิติ ฉบับที่ ${model.version} แล้ว`, detail: model.title }
                : { severity: 'info', summary: `ลบแบบ 3 มิติ ฉบับที่ ${model.version} แล้ว` }
        );
    }

    /** ทีมงานเปลี่ยน: โหลดรายชื่อติดต่อและผู้รับผิดชอบหลักของโครงการใหม่ */
    onTeamChanged() {
        this.teamResource.reload();
        this.projectResource.reload();
    }

    openUpdateForm(taskCode: string | null = null) {
        this.updateTaskCode.set(taskCode);
        this.updateFormOpen.set(true);
    }

    onSaved(update: ProgressUpdate) {
        this.updateFormOpen.set(false);
        this.inspecting.set(null);
        this.timelineResource.reload();
        this.projectResource.reload();
        this.refreshKey.update((key) => key + 1);
        const summary = update.inspection ? `บันทึกผลตรวจ: ${update.inspection.result === 'passed' ? 'ผ่าน' : 'ไม่ผ่าน'}` : 'บันทึกความคืบหน้าแล้ว';
        this.messages.add({ severity: update.inspection?.result === 'failed' ? 'warn' : 'success', summary, detail: `ภาพรวมโครงการ ${update.overallProgress}%` });
    }

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    setTab(tab: ProjectTab) {
        this.activeTab.set(tab);
        this.router.navigate([], { relativeTo: this.route, queryParams: { tab: tab === 'overview' ? null : tab }, queryParamsHandling: 'merge', replaceUrl: true });
    }

    showPhase(phase: TimelinePhase) {
        this.setTab('timeline');
        afterNextRender(() => this.timelineTab()?.focus(phase.code), { injector: this.injector });
    }

    showPhoto(photo: SitePhoto) {
        this.setTab('photos');
        afterNextRender(() => this.photosTab()?.open(photo), { injector: this.injector });
    }

    onTabKeydown(event: KeyboardEvent) {
        const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!offset) return;
        event.preventDefault();
        const index = this.tabs.findIndex((tab) => tab.value === this.activeTab());
        const next = this.tabs[(index + offset + this.tabs.length) % this.tabs.length].value;
        this.setTab(next);
        afterNextRender(() => document.getElementById(`tab-${next}`)?.focus(), { injector: this.injector });
    }
}
