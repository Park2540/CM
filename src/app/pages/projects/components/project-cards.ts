import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TimelinePhase } from '@/app/pages/service/project-timeline.service';
import { Installment, SitePhoto, TeamMember } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { INSTALLMENT_LABEL, INSTALLMENT_PILL_CLASS, ProjectTab, initials } from './project-ui';

export interface OwnerAction {
    key: string;
    title: string;
    detail: string;
    urgent: boolean;
    actionLabel?: string;
    tab?: ProjectTab;
}

@Component({
    selector: 'app-owner-actions-card',
    standalone: true,
    imports: [NgClass, ButtonModule],
    template: `
        <section class="card m-0" aria-labelledby="owner-heading">
            <div class="flex justify-between items-center gap-3 mb-4">
                <h2 id="owner-heading" class="text-lg font-semibold m-0">ถึงคิวคุณ</h2>
                @if (actions().length) {
                    <span class="px-2 py-1 rounded-full text-xs font-semibold bg-orange-500 text-white">{{ actions().length }} รายการ</span>
                }
            </div>
            @for (action of actions(); track action.key) {
                <div class="rounded-lg p-4 mb-3 last:mb-0" [ngClass]="action.urgent ? 'bg-orange-50 border border-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30' : 'border border-surface'">
                    <div class="flex items-start gap-3">
                        <i class="pi pi-exclamation-circle mt-1" [class.text-orange-500]="action.urgent"></i>
                        <div class="flex-1">
                            <div class="font-semibold">{{ action.title }}</div>
                            <div class="text-sm text-muted-color mt-1">{{ action.detail }}</div>
                        </div>
                    </div>
                    @if (action.actionLabel && action.tab) {
                        <button pButton type="button" class="w-full mt-3" [label]="action.actionLabel" (click)="navigate.emit(action.tab)"></button>
                    }
                </div>
            } @empty {
                <p class="text-muted-color m-0">ขณะนี้ยังไม่มีงานที่ต้องให้คุณดำเนินการ</p>
            }
        </section>
    `
})
export class OwnerActionsCard {
    readonly actions = input.required<OwnerAction[]>();
    readonly navigate = output<ProjectTab>();
}

@Component({
    selector: 'app-current-work-card',
    standalone: true,
    imports: [ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="current-heading">
            <div class="flex justify-between items-center gap-3 mb-4">
                <h2 id="current-heading" class="text-lg font-semibold m-0">กำลังดำเนินการตอนนี้</h2>
                <button type="button" class="flex items-center gap-1 text-sm font-semibold bg-transparent border-0 p-0 cursor-pointer text-color hover:text-primary" (click)="viewTimeline.emit()">
                    ดูไทม์ไลน์ทั้งหมด <i class="pi pi-chevron-right text-xs"></i>
                </button>
            </div>
            @for (phase of activePhases(); track phase.code) {
                <div class="mb-4">
                    <div class="flex justify-between items-baseline gap-3 mb-2">
                        <span class="font-semibold">ขั้นตอนที่ {{ phase.step }} · {{ phase.name }}</span>
                        <span class="font-semibold text-orange-600 dark:text-orange-400">{{ phase.progress }}%</span>
                    </div>
                    <div class="h-2 rounded-full bg-orange-100 dark:bg-orange-500/20 overflow-hidden">
                        <div class="h-full rounded-full bg-orange-500" [style.width.%]="phase.progress"></div>
                    </div>
                </div>
            } @empty {
                <p class="text-muted-color mt-0">{{ allDone() ? 'งานทุกขั้นตอนเสร็จเรียบร้อยแล้ว' : 'ยังไม่เริ่มงาน' }}</p>
            }
            @if (nextTasks().length) {
                <h3 class="text-sm font-semibold mt-5 mb-3">งานถัดไป</h3>
                <ul class="list-none p-0 m-0 flex flex-col gap-3">
                    @for (task of nextTasks(); track task.code) {
                        <li class="flex items-start gap-3">
                            <span class="mt-1 w-4 h-4 shrink-0 rounded-full border-2 border-surface-300 dark:border-surface-600" aria-hidden="true"></span>
                            <div class="flex-1">
                                <div>{{ task.name }}</div>
                                <div class="text-xs text-muted-color mt-1">{{ task.team }}</div>
                            </div>
                            <span class="text-sm text-muted-color shrink-0">{{ task.start | thaiDate: 'dayMonth' }}</span>
                        </li>
                    }
                </ul>
            }
        </section>
    `
})
export class CurrentWorkCard {
    readonly phases = input.required<TimelinePhase[]>();
    readonly viewTimeline = output<void>();

    readonly activePhases = computed(() => this.phases().filter((phase) => phase.status === 'active'));
    readonly allDone = computed(() => this.phases().every((phase) => phase.status === 'done'));
    readonly nextTasks = computed(() =>
        this.phases()
            .flatMap((phase) => phase.tasks)
            .filter((task) => task.status === 'pending' && !task.isMilestone)
            .sort((a, b) => a.start.getTime() - b.start.getTime())
            .slice(0, 4)
    );
}

@Component({
    selector: 'app-recent-photos-card',
    standalone: true,
    imports: [ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="photos-heading">
            <h2 id="photos-heading" class="text-lg font-semibold m-0 mb-4">ภาพล่าสุดจากหน้างาน</h2>
            @if (recent().length) {
                <div class="grid grid-cols-3 gap-2">
                    @for (photo of recent(); track photo.id) {
                        <button type="button" class="aspect-square p-0 border-0 bg-transparent cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-primary" [attr.aria-label]="'เปิดภาพ ' + photo.caption" (click)="open.emit(photo)">
                            <span class="relative block w-full h-full rounded-lg overflow-hidden bg-emphasis"
                                ><img [src]="photo.thumbnailUrl" [alt]="photo.caption" class="w-full h-full object-cover" loading="lazy" /><span
                                    class="absolute left-1.5 bottom-1.5 text-xs px-1.5 py-0.5 rounded bg-surface-0/85 dark:bg-surface-900/85 text-color"
                                    >{{ photo.date | thaiDate: 'dayMonth' }}</span
                                ></span
                            >
                        </button>
                    }
                </div>
                <button type="button" class="flex items-center gap-1 mt-4 text-sm font-semibold bg-transparent border-0 p-0 cursor-pointer text-color hover:text-primary" (click)="viewAll.emit()">
                    ดูภาพทั้งหมด ({{ total() ?? photos().length }}) <i class="pi pi-chevron-right text-xs"></i>
                </button>
            } @else {
                <p class="text-muted-color m-0">ยังไม่มีภาพจากหน้างาน</p>
            }
        </section>
    `
})
export class RecentPhotosCard {
    readonly photos = input.required<SitePhoto[]>();
    readonly limit = input(6);
    /** จำนวนภาพทั้งหมดของโครงการ (รายการที่ส่งมาอาจเป็นแค่หน้าแรก) */
    readonly total = input<number | null>(null);
    readonly open = output<SitePhoto>();
    readonly viewAll = output<void>();

    readonly recent = computed(() => this.photos().slice(0, this.limit()));
}

@Component({
    selector: 'app-team-card',
    standalone: true,
    imports: [ButtonModule],
    template: `
        <section class="card m-0" aria-labelledby="team-heading">
            <h2 id="team-heading" class="text-lg font-semibold m-0 mb-4">ติดต่อทีมงาน</h2>
            <ul class="list-none p-0 m-0 flex flex-col gap-4">
                @for (member of team(); track member.role) {
                    <li class="flex items-center gap-3">
                        <span class="w-10 h-10 shrink-0 rounded-full bg-emphasis flex items-center justify-center font-semibold">{{ initials(member.name) }}</span>
                        <div class="flex-1 min-w-0">
                            <div class="font-semibold truncate">{{ member.name }}</div>
                            <div class="text-sm text-muted-color">{{ member.role }}</div>
                        </div>
                        <a pButton [href]="'tel:' + member.phone" icon="pi pi-phone" [rounded]="true" [outlined]="true" severity="secondary" [attr.aria-label]="'โทรหา ' + member.name + ' ' + member.phone"></a>
                    </li>
                }
            </ul>
        </section>
    `
})
export class TeamCard {
    readonly team = input.required<TeamMember[]>();
    readonly initials = initials;
}

@Component({
    selector: 'app-hold-points-card',
    standalone: true,
    imports: [ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="hold-heading">
            <h2 id="hold-heading" class="text-lg font-semibold m-0 mb-1">จุดตรวจคุณภาพ</h2>
            <p class="text-sm text-muted-color mt-0 mb-4">งานถัดไปจะเริ่มได้เมื่อวิศวกร/ผู้ควบคุมงานตรวจผ่านแล้ว</p>
            <div class="flex items-baseline justify-between mb-2">
                <span class="text-sm">ผ่านแล้ว</span>
                <span class="font-semibold">{{ summary().passed }} / {{ summary().total }} จุด</span>
            </div>
            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mb-4">
                <div class="h-full rounded-full bg-primary" [style.width.%]="summary().total ? (summary().passed / summary().total) * 100 : 0"></div>
            </div>
            @if (summary().next; as next) {
                <div class="flex items-start gap-3 border border-surface rounded-lg p-3">
                    <i class="pi pi-shield mt-1 text-primary"></i>
                    <div>
                        <div class="text-xs text-muted-color">จุดตรวจถัดไป</div>
                        <div class="font-semibold">{{ next.name }}</div>
                        <div class="text-sm text-muted-color mt-1">แผน {{ next.start | thaiDate }}</div>
                    </div>
                </div>
            } @else {
                <p class="text-muted-color m-0">ผ่านการตรวจครบทุกจุดแล้ว</p>
            }
        </section>
    `
})
export class HoldPointsCard {
    readonly phases = input.required<TimelinePhase[]>();

    readonly summary = computed(() => {
        const holdPoints = this.phases()
            .flatMap((phase) => phase.tasks)
            .filter((task) => task.isHoldPoint)
            .sort((a, b) => a.start.getTime() - b.start.getTime());
        return {
            passed: holdPoints.filter((task) => task.status === 'done').length,
            total: holdPoints.length,
            next: holdPoints.find((task) => task.status !== 'done')
        };
    });
}

@Component({
    selector: 'app-milestones-card',
    standalone: true,
    imports: [ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="milestone-heading">
            <h2 id="milestone-heading" class="text-lg font-semibold m-0 mb-2">หมุดหมายถัดไป</h2>
            @for (task of upcoming(); track task.code) {
                <div class="flex items-start gap-3 py-3 border-b border-surface last:border-b-0">
                    <i class="pi pi-flag mt-1 text-purple-500"></i>
                    <div>
                        <div class="font-semibold">{{ task.name }}</div>
                        <div class="text-sm text-muted-color mt-1">
                            แผน {{ task.start | thaiDate }}
                            @if (task.isPaymentMilestone) {
                                · ใช้ประกอบงวดงาน
                            }
                        </div>
                    </div>
                </div>
            } @empty {
                <p class="text-muted-color m-0">ผ่านทุกหมุดหมายแล้ว</p>
            }
        </section>
    `
})
export class MilestonesCard {
    readonly phases = input.required<TimelinePhase[]>();

    readonly upcoming = computed(() =>
        this.phases()
            .flatMap((phase) => phase.tasks)
            .filter((task) => task.isMilestone && task.status !== 'done')
            .sort((a, b) => a.start.getTime() - b.start.getTime())
            .slice(0, 3)
    );
}

@Component({
    selector: 'app-payment-summary-card',
    standalone: true,
    imports: [DecimalPipe, NgClass, ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="payment-summary-heading">
            <div class="flex justify-between items-center gap-3 mb-4">
                <h2 id="payment-summary-heading" class="text-lg font-semibold m-0">สรุปการชำระเงิน</h2>
                <button type="button" class="flex items-center gap-1 text-sm font-semibold bg-transparent border-0 p-0 cursor-pointer text-color hover:text-primary" (click)="viewAll.emit()">
                    ดูงวดงานทั้งหมด <i class="pi pi-chevron-right text-xs"></i>
                </button>
            </div>
            <div class="flex items-baseline justify-between gap-3 mb-2">
                <span class="text-sm text-muted-color">ชำระแล้ว</span>
                <span
                    ><span class="font-semibold">฿{{ paidAmount() | number: '1.0-0' }}</span> <span class="text-sm text-muted-color">จาก ฿{{ contractValue() | number: '1.0-0' }}</span></span
                >
            </div>
            <div class="h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                <div class="h-full rounded-full bg-green-500" [style.width.%]="contractValue() ? (paidAmount() / contractValue()) * 100 : 0"></div>
            </div>
            @if (next(); as next) {
                <div class="flex items-start justify-between gap-3 mt-4 border border-surface rounded-lg p-3">
                    <div>
                        <div class="text-xs text-muted-color">งวดถัดไป · งวดที่ {{ next.no }}</div>
                        <div class="font-semibold">{{ next.title }}</div>
                        <div class="text-sm text-muted-color mt-1">฿{{ next.amount | number: '1.0-0' }} · {{ next.status === 'due' ? 'ครบกำหนด' : 'กำหนดการ' }} {{ next.dueDate | thaiDate }}</div>
                    </div>
                    <span class="px-2 py-1 rounded-full text-xs font-semibold shrink-0" [ngClass]="pillClass[next.status]">{{ label[next.status] }}</span>
                </div>
            }
        </section>
    `
})
export class PaymentSummaryCard {
    readonly installments = input.required<Installment[]>();
    readonly contractValue = input.required<number>();
    readonly viewAll = output<void>();

    readonly label = INSTALLMENT_LABEL;
    readonly pillClass = INSTALLMENT_PILL_CLASS;
    readonly paidAmount = computed(() =>
        this.installments()
            .filter((item) => item.status === 'paid')
            .reduce((sum, item) => sum + item.amount, 0)
    );
    readonly next = computed(() => this.installments().find((item) => item.status !== 'paid'));
}
