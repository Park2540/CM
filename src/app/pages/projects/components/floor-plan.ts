import { DecimalPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { PlanFloor, PlanRoom, RoomKind } from '@/app/pages/service/house-plan.service';

const PAD = 0.8;

/** แปลนพื้น 2 มิติจากข้อมูลห้อง (หน่วยเมตร) — ด้านหน้าบ้านอยู่ด้านล่างของภาพ */
@Component({
    selector: 'app-floor-plan',
    standalone: true,
    template: `
        <svg [attr.viewBox]="viewBox()" class="w-full h-auto block" role="img" [attr.aria-label]="'แปลน' + floor().label + ' ' + roomSummary()">
            @for (room of floor().rooms; track $index) {
                <g>
                    <rect [attr.x]="room.x" [attr.y]="room.y" [attr.width]="room.w" [attr.height]="room.h" [class]="'room room-' + room.kind" />
                    @if (room.kind === 'stair') {
                        @for (tread of treads(room); track $index) {
                            <line [attr.x1]="tread.x1" [attr.y1]="tread.y1" [attr.x2]="tread.x2" [attr.y2]="tread.y2" class="tread" />
                        }
                    }
                    @if (showLabels() && room.kind !== 'stair') {
                        <text [attr.x]="room.x + room.w / 2" [attr.y]="room.y + room.h / 2" [attr.font-size]="labelSize(room)" text-anchor="middle" dominant-baseline="middle" class="label">
                            <tspan [attr.x]="room.x + room.w / 2" [attr.dy]="detailed() ? '-0.4em' : 0">{{ room.name }}</tspan>
                            @if (detailed() && room.kind !== 'void') {
                                <tspan [attr.x]="room.x + room.w / 2" dy="1.3em" class="area">{{ room.w * room.h | number: '1.0-1' }} ตร.ม.</tspan>
                            }
                        </text>
                    }
                </g>
            }
            <rect x="0" y="0" [attr.width]="width()" [attr.height]="depth()" class="outline" />
            <text [attr.x]="width() / 2" [attr.y]="depth() + PAD * 0.7" text-anchor="middle" font-size="0.4" class="front">ด้านหน้าบ้าน</text>
        </svg>
    `,
    imports: [DecimalPipe],
    styles: `
        .room {
            stroke: var(--p-text-color);
            stroke-width: 0.08;
        }
        .outline {
            fill: none;
            stroke: var(--p-text-color);
            stroke-width: 0.2;
        }
        .tread {
            stroke: var(--p-text-muted-color);
            stroke-width: 0.04;
        }
        .label {
            fill: var(--p-text-color);
            font-weight: 600;
        }
        .area,
        .front {
            fill: var(--p-text-muted-color);
            font-weight: 400;
        }
        .room-bedroom {
            fill: #dbeafe;
        }
        .room-bathroom {
            fill: #cffafe;
        }
        .room-living {
            fill: #fef3c7;
        }
        .room-dining {
            fill: #fef9c3;
        }
        .room-kitchen {
            fill: #ffedd5;
        }
        .room-other {
            fill: #ede9fe;
        }
        .room-garage {
            fill: var(--p-surface-200);
        }
        .room-stair {
            fill: var(--p-surface-100);
        }
        .room-void {
            fill: transparent;
            stroke-dasharray: 0.25 0.15;
        }
        :host-context(.app-dark) .room-bedroom {
            fill: rgb(59 130 246 / 22%);
        }
        :host-context(.app-dark) .room-bathroom {
            fill: rgb(6 182 212 / 22%);
        }
        :host-context(.app-dark) .room-living {
            fill: rgb(245 158 11 / 22%);
        }
        :host-context(.app-dark) .room-dining {
            fill: rgb(234 179 8 / 18%);
        }
        :host-context(.app-dark) .room-kitchen {
            fill: rgb(249 115 22 / 22%);
        }
        :host-context(.app-dark) .room-other {
            fill: rgb(139 92 246 / 22%);
        }
        :host-context(.app-dark) .room-garage {
            fill: var(--p-surface-700);
        }
        :host-context(.app-dark) .room-stair {
            fill: var(--p-surface-800);
        }
    `
})
export class FloorPlan {
    readonly floor = input.required<PlanFloor>();
    readonly width = input.required<number>();
    readonly depth = input.required<number>();
    readonly showLabels = input(true);
    /** แสดงพื้นที่ใต้ชื่อห้อง (ใช้ในมุมมองขยาย) */
    readonly detailed = input(false);

    readonly PAD = PAD;
    readonly viewBox = computed(() => `${-PAD} ${-PAD} ${this.width() + PAD * 2} ${this.depth() + PAD * 2}`);
    readonly roomSummary = computed(() =>
        this.floor()
            .rooms.filter((room) => room.kind !== 'stair' && room.kind !== 'void')
            .map((room) => room.name)
            .join(', ')
    );

    labelSize(room: PlanRoom): number {
        // Thai glyphs are roughly 0.55em wide; shrink long names to fit the room width.
        const fit = (room.w * 0.85) / (room.name.length * 0.55);
        return Math.max(0.22, Math.min(this.detailed() ? 0.5 : 0.6, fit, room.h * 0.3));
    }

    treads(room: PlanRoom) {
        const alongWidth = room.w >= room.h;
        const length = alongWidth ? room.w : room.h;
        const count = Math.floor(length / 0.28);
        return Array.from({ length: count }, (_, i) => {
            const offset = (i + 1) * (length / (count + 1));
            return alongWidth ? { x1: room.x + offset, y1: room.y, x2: room.x + offset, y2: room.y + room.h } : { x1: room.x, y1: room.y + offset, x2: room.x + room.w, y2: room.y + offset };
        });
    }
}

export const ROOM_KIND_SWATCH: Record<Exclude<RoomKind, 'void' | 'stair'>, string> = {
    bedroom: 'bg-blue-100 dark:bg-blue-500/25',
    bathroom: 'bg-cyan-100 dark:bg-cyan-500/25',
    living: 'bg-amber-100 dark:bg-amber-500/25',
    dining: 'bg-yellow-100 dark:bg-yellow-500/20',
    kitchen: 'bg-orange-100 dark:bg-orange-500/25',
    garage: 'bg-surface-200 dark:bg-surface-700',
    other: 'bg-violet-100 dark:bg-violet-500/25'
};
