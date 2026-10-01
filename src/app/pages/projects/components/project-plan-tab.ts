import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { HousePlan, ROOM_KIND_LABEL, RoomKind, countRooms, usableArea } from '@/app/pages/service/house-plan.service';
import { FloorPlan, ROOM_KIND_SWATCH } from './floor-plan';
import { HouseModelViewer } from './house-model-viewer';
import { PhotoPlaceholder } from './project-ui';

@Component({
    selector: 'app-project-plan-tab',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, DialogModule, FloorPlan, HouseModelViewer, PhotoPlaceholder],
    template: `
        <div class="card">
            <h2 class="text-xl font-semibold m-0 mb-5">แบบแปลนบ้าน</h2>

            <div class="grid grid-cols-12 gap-6 lg:gap-8">
                <!-- สื่อแสดงผล -->
                <div class="col-span-12 lg:col-span-7">
                    <div class="inline-flex rounded-full border border-surface p-1 mb-3" role="group" aria-label="รูปแบบการแสดงผล">
                        <button type="button" class="seg" [class.seg-active]="media() === 'model'" [attr.aria-pressed]="media() === 'model'" (click)="media.set('model')"><i class="pi pi-box"></i>โมเดล 3D</button>
                        <button type="button" class="seg" [class.seg-active]="media() === 'render'" [attr.aria-pressed]="media() === 'render'" (click)="media.set('render')"><i class="pi pi-image"></i>ภาพทัศนียภาพ</button>
                    </div>
                    <div class="h-[24rem] lg:h-[30rem]">
                        @if (media() === 'model') {
                            <app-house-model-viewer class="h-full" [plan]="plan()" />
                        } @else {
                            <div class="relative h-full">
                                <app-photo-placeholder class="h-full" [large]="true" />
                                <div class="absolute inset-x-0 bottom-4 text-center text-sm text-muted-color">ภาพทัศนียภาพจากผู้ออกแบบจะแสดงที่นี่</div>
                            </div>
                        }
                    </div>
                </div>

                <!-- รายละเอียดแบบบ้าน -->
                <div class="col-span-12 lg:col-span-5">
                    <h3 class="text-2xl font-bold m-0">{{ plan().name }}</h3>
                    <div class="font-semibold mt-2">พื้นที่ใช้สอย {{ area() | number }} ตร.ม.</div>
                    <div class="text-sm text-muted-color mt-1">ขนาดตัวบ้าน {{ plan().width }} × {{ plan().depth }} ม. · {{ plan().floors.length }} ชั้น</div>

                    <ul class="grid grid-cols-2 gap-x-4 gap-y-3 list-none p-0 my-5">
                        <li class="flex items-center gap-3">
                            <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18h18M3 18v2m18-2v2M6 10V6h5v4m2 0V6h5v4" /></svg>
                            {{ bedrooms() }} ห้องนอน
                        </li>
                        <li class="flex items-center gap-3">
                            <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Zm2 0V5a2 2 0 0 1 4 0M8 19l-1 2m10-2 1 2" /></svg>
                            {{ bathrooms() }} ห้องน้ำ
                        </li>
                        <li class="flex items-center gap-3">
                            <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm-2 0h20M9 6c0-1 1-1 1-2m4 2c0-1 1-1 1-2" /></svg>
                            {{ kitchens() }} ห้องครัว
                        </li>
                        <li class="flex items-center gap-3">
                            <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
                            </svg>
                            ที่จอดรถ {{ plan().parking }} คัน
                        </li>
                    </ul>
                    <p class="text-muted-color mt-0 mb-6">{{ plan().description }}</p>

                    <div class="grid grid-cols-2 gap-4">
                        @for (floor of plan().floors; track floor.label; let i = $index) {
                            <div>
                                <div class="font-semibold mb-2">{{ floor.label }}</div>
                                <button
                                    type="button"
                                    class="w-full p-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900 cursor-pointer hover:border-primary transition-colors"
                                    [attr.aria-label]="'ขยายแปลน' + floor.label"
                                    (click)="openFloor(i)"
                                >
                                    <app-floor-plan [floor]="floor" [width]="plan().width" [depth]="plan().depth" />
                                </button>
                            </div>
                        }
                    </div>

                    <div class="flex flex-wrap gap-x-4 gap-y-2 mt-4 text-xs text-muted-color">
                        @for (kind of legendKinds(); track kind) {
                            <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm border border-surface" [class]="swatch[kind]"></span>{{ kindLabel[kind] }}</span>
                        }
                        <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm border border-dashed border-surface-400"></span>{{ kindLabel.void }}</span>
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap justify-between items-center gap-3 mt-6 pt-4 border-t border-surface">
                <span class="text-sm text-muted-color"><i class="pi pi-info-circle mr-1"></i>แปลนแสดงสัดส่วนโดยประมาณเพื่อประกอบการติดตามงาน ขนาดจริงให้อ้างอิงแบบก่อสร้าง</span>
                <button pButton type="button" [outlined]="true" icon="pi pi-folder-open" label="ดูแบบก่อสร้างฉบับเต็ม" (click)="openDocuments.emit()"></button>
            </div>
        </div>

        <p-dialog
            [visible]="selectedFloor() !== null"
            (visibleChange)="!$event && selectedFloor.set(null)"
            [modal]="true"
            [dismissableMask]="true"
            [draggable]="false"
            [style]="{ width: 'min(64rem, 95vw)' }"
            [header]="plan().name + ' · ' + (floor()?.label ?? '')"
        >
            @if (floor(); as floor) {
                <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
                    <div class="md:col-span-3">
                        <app-floor-plan [floor]="floor" [width]="plan().width" [depth]="plan().depth" [detailed]="true" />
                    </div>
                    <div class="md:col-span-2">
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="border-b border-surface text-muted-color text-left">
                                    <th class="py-2 font-semibold">ห้อง</th>
                                    <th class="py-2 font-semibold text-right">ขนาด (ม.)</th>
                                    <th class="py-2 font-semibold text-right">ตร.ม.</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (room of floorRooms(); track $index) {
                                    <tr class="border-b border-surface">
                                        <td class="py-2">{{ room.name }}</td>
                                        <td class="py-2 text-right">{{ room.w }} × {{ room.h }}</td>
                                        <td class="py-2 text-right">{{ room.w * room.h | number: '1.0-1' }}</td>
                                    </tr>
                                }
                            </tbody>
                            <tfoot>
                                <tr class="font-semibold">
                                    <td class="py-2" colspan="2">รวมพื้นที่ชั้นนี้</td>
                                    <td class="py-2 text-right">{{ floorArea() | number: '1.0-1' }}</td>
                                </tr>
                            </tfoot>
                        </table>
                        <div class="flex justify-between gap-2 mt-4">
                            <button pButton type="button" [outlined]="true" icon="pi pi-chevron-left" label="ชั้นก่อนหน้า" [disabled]="selectedFloor() === 0" (click)="openFloor((selectedFloor() ?? 0) - 1)"></button>
                            <button
                                pButton
                                type="button"
                                [outlined]="true"
                                icon="pi pi-chevron-right"
                                iconPos="right"
                                label="ชั้นถัดไป"
                                [disabled]="selectedFloor() === plan().floors.length - 1"
                                (click)="openFloor((selectedFloor() ?? 0) + 1)"
                            ></button>
                        </div>
                    </div>
                </div>
            }
        </p-dialog>
    `,
    styles: `
        .seg {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.4rem 0.9rem;
            border-radius: 999px;
            border: 0;
            background: transparent;
            color: var(--p-text-muted-color);
            font-size: 0.875rem;
            cursor: pointer;
        }
        .seg-active {
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
        .feature-icon {
            width: 1.5rem;
            height: 1.5rem;
            flex-shrink: 0;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.6;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
    `
})
export class ProjectPlanTab {
    readonly plan = input.required<HousePlan>();
    readonly openDocuments = output<void>();

    readonly media = signal<'model' | 'render'>('model');
    readonly selectedFloor = signal<number | null>(null);

    readonly kindLabel = ROOM_KIND_LABEL;
    readonly swatch = ROOM_KIND_SWATCH;

    readonly area = computed(() => usableArea(this.plan()));
    readonly bedrooms = computed(() => countRooms(this.plan(), 'bedroom'));
    readonly bathrooms = computed(() => countRooms(this.plan(), 'bathroom'));
    readonly kitchens = computed(() => countRooms(this.plan(), 'kitchen'));
    readonly legendKinds = computed(() => {
        const kinds = new Set(this.plan().floors.flatMap((floor) => floor.rooms.map((room) => room.kind)));
        return (Object.keys(ROOM_KIND_SWATCH) as Array<keyof typeof ROOM_KIND_SWATCH>).filter((kind) => kinds.has(kind as RoomKind));
    });

    readonly floor = computed(() => {
        const index = this.selectedFloor();
        return index === null ? null : this.plan().floors[index];
    });
    readonly floorRooms = computed(() => (this.floor()?.rooms ?? []).filter((room) => room.kind !== 'void'));
    readonly floorArea = computed(() => this.floorRooms().reduce((sum, room) => sum + room.w * room.h, 0));

    openFloor(index: number) {
        this.selectedFloor.set(index);
    }
}
