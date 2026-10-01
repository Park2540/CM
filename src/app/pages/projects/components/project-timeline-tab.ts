import { NgClass } from '@angular/common';
import { Component, Injector, afterNextRender, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { TimelinePhase, TimelineStatus } from '@/app/pages/service/project-timeline.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { STATUS_LABEL, STATUS_PILL_CLASS } from './project-ui';

type PhaseFilter = 'all' | TimelineStatus;

@Component({
    selector: 'app-project-timeline-tab',
    standalone: true,
    imports: [NgClass, ThaiDatePipe],
    template: `
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <h2 class="text-xl font-semibold m-0">ไทม์ไลน์ความคืบหน้า</h2>
            <div class="flex flex-wrap gap-2" role="group" aria-label="กรองตามสถานะ">
                @for (option of filterOptions(); track option.value) {
                    <button
                        type="button"
                        class="px-4 py-2 rounded-full border text-sm cursor-pointer transition-colors"
                        [class]="filter() === option.value ? 'bg-primary text-primary-contrast border-primary font-semibold' : 'bg-surface-0 dark:bg-surface-900 border-surface hover:bg-emphasis'"
                        [attr.aria-pressed]="filter() === option.value"
                        (click)="filter.set(option.value)"
                    >
                        {{ option.label }} {{ option.count }}
                    </button>
                }
            </div>
        </div>

        <ol class="list-none p-0 m-0">
            @for (phase of visiblePhases(); track phase.code; let last = $last) {
                <li class="relative pl-12 pb-5">
                    @if (!last) {
                        <span class="absolute left-[15px] top-10 -bottom-1 border-l-2" [class]="phase.status === 'done' ? 'border-primary' : 'border-dashed border-surface-300 dark:border-surface-600'" aria-hidden="true"></span>
                    }
                    <span class="absolute left-0 top-4 w-8 h-8 rounded-full flex items-center justify-center" [ngClass]="markerClass[phase.status]" aria-hidden="true">
                        @if (phase.status === 'done') {
                            <i class="pi pi-check text-sm"></i>
                        } @else if (phase.status === 'active') {
                            <span class="w-3 h-3 rounded-full bg-orange-500"></span>
                        }
                    </span>

                    <article [id]="'phase-' + phase.code" class="scroll-mt-24 rounded-xl p-5 bg-surface-0 dark:bg-surface-900" [ngClass]="phase.status === 'active' ? 'border-2 border-orange-400 dark:border-orange-500' : 'border border-surface'">
                        <div class="flex flex-wrap justify-between items-start gap-3">
                            <div class="min-w-0">
                                <div class="text-xs text-muted-color">ขั้นตอนที่ {{ phase.step }}</div>
                                <h3 class="text-lg font-semibold m-0 mt-1">{{ phase.name }}</h3>
                            </div>
                            <div class="text-right">
                                <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold" [ngClass]="pillClass[phase.status]">
                                    @if (phase.status === 'active') {
                                        <span class="w-2 h-2 rounded-full bg-orange-500"></span>
                                    }
                                    {{ statusLabel[phase.status] }}
                                </span>
                                <div class="text-xs text-muted-color mt-2">แผน {{ phase.start | thaiDate: 'dayMonth' }} – {{ phase.end | thaiDate }}</div>
                            </div>
                        </div>
                        <p class="text-muted-color mt-3 mb-0">{{ phase.summary }}</p>

                        @if (phase.status === 'active') {
                            <div class="flex items-center gap-4 mt-4">
                                <div
                                    class="flex-1 h-2.5 rounded-full bg-orange-100 dark:bg-orange-500/20 overflow-hidden"
                                    role="progressbar"
                                    [attr.aria-valuenow]="phase.progress"
                                    aria-valuemin="0"
                                    aria-valuemax="100"
                                    [attr.aria-label]="'ความคืบหน้า ' + phase.name"
                                >
                                    <div class="h-full rounded-full bg-orange-500" [style.width.%]="phase.progress"></div>
                                </div>
                                <span class="font-semibold">{{ phase.progress }}%</span>
                            </div>
                        }

                        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-color">
                            @if (phase.holdPoints.total) {
                                <span class="flex items-center gap-2">
                                    <i class="pi" [ngClass]="phase.holdPoints.passed === phase.holdPoints.total ? 'pi-verified text-primary' : 'pi-shield'"></i>
                                    จุดตรวจผ่าน {{ phase.holdPoints.passed }}/{{ phase.holdPoints.total }}
                                </span>
                            }
                            <span class="flex items-center gap-2"><i class="pi pi-list-check"></i>งาน {{ phase.tasks.length }} รายการ</span>
                            <button
                                type="button"
                                class="ml-auto flex items-center gap-1 font-semibold text-color bg-transparent border-0 cursor-pointer p-0 hover:text-primary"
                                [attr.aria-expanded]="expanded().has(phase.code)"
                                [attr.aria-controls]="'tasks-' + phase.code"
                                (click)="toggle(phase.code)"
                            >
                                {{ expanded().has(phase.code) ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด' }}
                                <i class="pi text-xs" [ngClass]="expanded().has(phase.code) ? 'pi-chevron-up' : 'pi-chevron-down'"></i>
                            </button>
                        </div>

                        @if (expanded().has(phase.code)) {
                            <div [id]="'tasks-' + phase.code" class="mt-4 pt-4 border-t border-surface">
                                <h4 class="text-sm font-semibold m-0 mb-3">รายการงานในขั้นตอนนี้</h4>
                                <ul class="list-none p-0 m-0 flex flex-col gap-3">
                                    @for (task of phase.tasks; track task.code) {
                                        <li class="flex items-start gap-3">
                                            <span class="mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center" [ngClass]="taskMarkerClass[task.status]" aria-hidden="true">
                                                @if (task.status === 'done') {
                                                    <i class="pi pi-check" style="font-size: 0.65rem"></i>
                                                } @else if (task.status === 'active') {
                                                    <span class="w-2 h-2 rounded-full bg-orange-500"></span>
                                                }
                                            </span>
                                            <div class="flex-1 min-w-0">
                                                <div class="flex flex-wrap items-center gap-2">
                                                    <span [class.text-muted-color]="task.status === 'pending'">{{ task.name }}</span>
                                                    @if (task.isHoldPoint) {
                                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                                            ><i class="pi pi-shield" style="font-size: 0.7rem"></i>จุดตรวจ</span
                                                        >
                                                    }
                                                    @if (task.isMilestone) {
                                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                                                            ><i class="pi pi-flag" style="font-size: 0.7rem"></i>{{ task.isPaymentMilestone ? 'หมุดหมาย · งวดงาน' : 'หมุดหมาย' }}</span
                                                        >
                                                    }
                                                    @if (task.involvesOwner) {
                                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                                                            ><i class="pi pi-user" style="font-size: 0.7rem"></i>เจ้าของงานร่วม</span
                                                        >
                                                    }
                                                </div>
                                                <div class="text-xs text-muted-color mt-1">{{ task.team }}</div>
                                                @if (task.note) {
                                                    <div class="text-xs text-muted-color mt-1"><i class="pi pi-info-circle mr-1" style="font-size: 0.7rem"></i>{{ task.note }}</div>
                                                }
                                            </div>
                                            <span class="text-sm shrink-0 text-right" [ngClass]="task.status === 'active' ? 'font-semibold text-orange-600 dark:text-orange-400' : 'text-muted-color'">
                                                @switch (task.status) {
                                                    @case ('done') {
                                                        เสร็จแล้ว
                                                    }
                                                    @case ('active') {
                                                        {{ task.progress }}%
                                                    }
                                                    @default {
                                                        เริ่ม {{ task.start | thaiDate: 'dayMonth' }}
                                                    }
                                                }
                                            </span>
                                        </li>
                                    }
                                </ul>
                            </div>
                        }
                    </article>
                </li>
            } @empty {
                <li class="card text-center text-muted-color">ไม่มีขั้นตอนในสถานะนี้</li>
            }
        </ol>
    `
})
export class ProjectTimelineTab {
    private readonly injector = inject(Injector);

    readonly phases = input.required<TimelinePhase[]>();

    readonly statusLabel = STATUS_LABEL;
    readonly pillClass = STATUS_PILL_CLASS;
    readonly markerClass: Record<TimelineStatus, string> = {
        done: 'bg-primary text-primary-contrast',
        active: 'border-2 border-orange-500 bg-surface-0 dark:bg-surface-900',
        pending: 'border-2 border-surface-300 dark:border-surface-600 bg-surface-0 dark:bg-surface-900'
    };
    readonly taskMarkerClass: Record<TimelineStatus, string> = {
        done: 'bg-primary text-primary-contrast',
        active: 'border-2 border-orange-500',
        pending: 'border-2 border-surface-300 dark:border-surface-600'
    };

    readonly filter = signal<PhaseFilter>('all');
    // Phases in progress start expanded; resets whenever the phases change (e.g. another project).
    readonly expanded = linkedSignal(
        () =>
            new Set(
                this.phases()
                    .filter((phase) => phase.status === 'active')
                    .map((phase) => phase.code)
            )
    );
    readonly visiblePhases = computed(() => (this.filter() === 'all' ? this.phases() : this.phases().filter((phase) => phase.status === this.filter())));
    readonly filterOptions = computed(() => {
        const count = (status: TimelineStatus) => this.phases().filter((phase) => phase.status === status).length;
        return [
            { value: 'all' as PhaseFilter, label: 'ทั้งหมด', count: this.phases().length },
            { value: 'active' as PhaseFilter, label: 'กำลังทำ', count: count('active') },
            { value: 'done' as PhaseFilter, label: 'เสร็จแล้ว', count: count('done') },
            { value: 'pending' as PhaseFilter, label: 'รอเริ่ม', count: count('pending') }
        ];
    });

    toggle(code: string) {
        this.expanded.update((current) => {
            const next = new Set(current);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    }

    /** Show and scroll to a phase, expanding its task list. */
    focus(code: string) {
        this.filter.set('all');
        this.expanded.update((current) => new Set(current).add(code));
        afterNextRender(() => document.getElementById(`phase-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), { injector: this.injector });
    }
}
