import { DecimalPipe } from '@angular/common';
import { Component, Injector, afterNextRender, computed, inject, linkedSignal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProjectService, getProjectSeverity } from '@/app/pages/service/project.service';
import { ProjectTimelineService, TimelinePhase, todayAsDate } from '@/app/pages/service/project-timeline.service';
import { ProjectRecordsService, SitePhoto } from '@/app/pages/service/project-records.service';
import { HousePlanService } from '@/app/pages/service/house-plan.service';
import { CurrentWorkCard, HoldPointsCard, MilestonesCard, OwnerAction, OwnerActionsCard, PaymentSummaryCard, RecentPhotosCard, TeamCard } from './components/project-cards';
import { ProjectDocumentsTab } from './components/project-documents-tab';
import { ProjectPaymentsTab } from './components/project-payments-tab';
import { ProjectPhotosTab } from './components/project-photos-tab';
import { ProjectPlanTab } from './components/project-plan-tab';
import { ProjectStepsOverview } from './components/project-steps-overview';
import { ProjectTimelineTab } from './components/project-timeline-tab';
import { PROJECT_TABS, ProjectTab } from './components/project-ui';
import { ThaiDatePipe } from './thai-date.pipe';

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

@Component({
    selector: 'app-project-management',
    standalone: true,
    imports: [
        ButtonModule,
        CurrentWorkCard,
        DecimalPipe,
        HoldPointsCard,
        MilestonesCard,
        OwnerActionsCard,
        PaymentSummaryCard,
        ProjectDocumentsTab,
        ProjectPaymentsTab,
        ProjectPhotosTab,
        ProjectPlanTab,
        ProjectStepsOverview,
        ProjectTimelineTab,
        RecentPhotosCard,
        RouterLink,
        TagModule,
        TeamCard,
        ThaiDatePipe
    ],
    template: `
        <a routerLink="/projects" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4">
            <i class="pi pi-arrow-left"></i>
            <span>ภาพรวมโครงการ</span>
        </a>

        @if (project(); as project) {
            <div class="flex items-center gap-2 text-sm rounded-lg px-4 py-2 mb-4 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200" role="note">
                <i class="pi pi-info-circle"></i>
                <span>หน้านี้แสดงด้วยข้อมูลตัวอย่าง ยังไม่ได้เชื่อมต่อระบบหลังบ้าน</span>
            </div>

            <!-- ข้อมูลโครงการ -->
            <section class="card flex flex-col lg:flex-row lg:items-center gap-6 mb-0 rounded-b-none">
                <div class="flex-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-3">
                        <span class="px-2 py-1 rounded-md bg-emphasis text-sm font-semibold">{{ project.code }}</span>
                        <p-tag [value]="project.status" [severity]="getProjectSeverity(project.status)" />
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
                            <dd class="m-0 mt-1 font-semibold">฿{{ project.value | number: '1.0-0' }}</dd>
                        </div>
                        <div>
                            <dt class="text-sm text-muted-color">ผู้รับผิดชอบโครงการ</dt>
                            <dd class="m-0 mt-1 font-semibold">{{ project.responsibleName }}</dd>
                        </div>
                    </dl>
                </div>

                <div class="flex items-center gap-5 lg:border-l lg:border-surface lg:pl-8">
                    <div class="relative w-32 h-32 shrink-0" role="img" [attr.aria-label]="'ความคืบหน้ารวม ' + project.progress + ' เปอร์เซ็นต์'">
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
                                [attr.stroke-dashoffset]="ringCircumference * (1 - project.progress / 100)"
                            />
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center">
                            <span class="text-3xl font-bold">{{ project.progress }}%</span>
                            <span class="text-xs text-muted-color">ความคืบหน้ารวม</span>
                        </div>
                    </div>
                    <div>
                        @if (project.progress >= 100) {
                            <div class="text-sm text-muted-color">สถานะ</div>
                            <div class="text-2xl font-bold text-green-600 dark:text-green-400">ส่งมอบแล้ว</div>
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
                        </button>
                    }
                </div>
            </nav>

            @if (timeline(); as timeline) {
                @if (records(); as records) {
                    <div id="project-tabpanel" role="tabpanel" [attr.aria-labelledby]="'tab-' + activeTab()">
                        @switch (activeTab()) {
                            @case ('overview') {
                                <app-project-steps-overview [phases]="timeline.phases" (select)="showPhase($event)" />
                                <div class="grid grid-cols-12 gap-6">
                                    <div class="col-span-12 xl:col-span-8 flex flex-col gap-6">
                                        <app-current-work-card [phases]="timeline.phases" (viewTimeline)="setTab('timeline')" />
                                        <app-payment-summary-card [installments]="records.installments" [contractValue]="project.value" (viewAll)="setTab('payments')" />
                                        <app-recent-photos-card [photos]="records.photos" [limit]="9" (open)="showPhoto($event)" (viewAll)="setTab('photos')" />
                                    </div>
                                    <aside class="col-span-12 xl:col-span-4 flex flex-col gap-6">
                                        <app-owner-actions-card [actions]="ownerActions()" (navigate)="setTab($event)" />
                                        <app-team-card [team]="records.team" />
                                        <app-hold-points-card [phases]="timeline.phases" />
                                        <app-milestones-card [phases]="timeline.phases" />
                                    </aside>
                                </div>
                            }
                            @case ('timeline') {
                                <app-project-steps-overview [phases]="timeline.phases" (select)="showPhase($event)" />
                                <div class="grid grid-cols-12 gap-6">
                                    <section class="col-span-12 xl:col-span-8">
                                        <app-project-timeline-tab [phases]="timeline.phases" />
                                    </section>
                                    <aside class="col-span-12 xl:col-span-4 flex flex-col gap-6">
                                        <app-owner-actions-card [actions]="ownerActions()" (navigate)="setTab($event)" />
                                        <app-recent-photos-card [photos]="records.photos" (open)="showPhoto($event)" (viewAll)="setTab('photos')" />
                                        <app-team-card [team]="records.team" />
                                    </aside>
                                </div>
                            }
                            @case ('plan') {
                                @if (housePlan(); as plan) {
                                    <app-project-plan-tab [plan]="plan" (openDocuments)="setTab('documents')" />
                                } @else {
                                    <div class="card text-center text-muted-color py-12">ยังไม่ได้กำหนดแบบบ้านของโครงการนี้</div>
                                }
                            }
                            @case ('photos') {
                                <app-project-photos-tab [photos]="records.photos" />
                            }
                            @case ('payments') {
                                <app-project-payments-tab [installments]="records.installments" [contractValue]="project.value" />
                            }
                            @case ('documents') {
                                <app-project-documents-tab [documents]="records.documents" />
                            }
                        }
                    </div>
                }
            }
        } @else {
            <div class="card">
                <h1 class="font-semibold text-2xl m-0 mb-4">ไม่พบโครงการ</h1>
                <a pButton routerLink="/projects" icon="pi pi-arrow-left" label="กลับภาพรวมโครงการ" class="p-button-outlined"></a>
            </div>
        }
    `
})
export class ProjectManagement {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly injector = inject(Injector);
    private readonly projectService = inject(ProjectService);
    private readonly timelineService = inject(ProjectTimelineService);
    private readonly recordsService = inject(ProjectRecordsService);
    private readonly housePlanService = inject(HousePlanService);
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

    readonly project = computed(() => this.projectService.getProject(this.code()));
    readonly timeline = computed(() => {
        const project = this.project();
        return project ? this.timelineService.build(project) : null;
    });
    readonly records = computed(() => {
        const project = this.project();
        const timeline = this.timeline();
        return project && timeline ? this.recordsService.build(project, timeline) : null;
    });

    readonly housePlan = computed(() => {
        const project = this.project();
        return project ? this.housePlanService.getPlan(project.housePlanCode) : undefined;
    });

    readonly dueCount = computed(() => this.records()?.installments.filter((item) => item.status === 'due').length ?? 0);
    readonly daysToDelivery = computed(() => {
        const project = this.project();
        if (!project) return 0;
        return Math.round((Date.parse(`${project.deliveryDate}T00:00:00Z`) - todayAsDate().getTime()) / 86_400_000);
    });

    readonly ownerActions = computed((): OwnerAction[] => {
        const payments = (this.records()?.installments ?? [])
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
