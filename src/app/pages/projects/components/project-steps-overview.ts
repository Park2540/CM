import { Component, input, output } from '@angular/core';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { STATUS_LABEL } from './project-ui';

@Component({
    selector: 'app-project-steps-overview',
    standalone: true,
    template: `
        <section class="card mb-6" aria-labelledby="steps-heading">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-5">
                <h2 id="steps-heading" class="text-lg font-semibold m-0">ภาพรวม {{ phases().length }} ขั้นตอน</h2>
                <div class="flex items-center gap-4 text-sm text-muted-color">
                    <span class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-primary"></span>เสร็จแล้ว</span>
                    <span class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-orange-500"></span>กำลังทำ</span>
                    <span class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-surface-300 dark:bg-surface-600"></span>รอเริ่ม</span>
                </div>
            </div>
            <ol class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-4 list-none p-0 m-0">
                @for (phase of phases(); track phase.code) {
                    <li>
                        <button
                            type="button"
                            class="w-full text-left cursor-pointer bg-transparent border-0 p-0 group"
                            (click)="select.emit(phase)"
                            [attr.aria-label]="'ขั้นตอนที่ ' + phase.step + ' ' + phase.name + ' ' + statusLabel[phase.status] + ' ' + phase.progress + '%'"
                        >
                            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                                <div class="h-full rounded-full" [class]="phase.status === 'done' ? 'bg-primary' : 'bg-orange-500'" [style.width.%]="phase.progress"></div>
                            </div>
                            <div class="text-sm mt-2 truncate group-hover:text-primary" [class.font-semibold]="phase.status === 'active'" [class.text-muted-color]="phase.status === 'pending'">{{ phase.step }}. {{ phase.shortName }}</div>
                        </button>
                    </li>
                }
            </ol>
        </section>
    `
})
export class ProjectStepsOverview {
    readonly phases = input.required<TimelinePhase[]>();
    readonly select = output<TimelinePhase>();

    readonly statusLabel = STATUS_LABEL;
}
