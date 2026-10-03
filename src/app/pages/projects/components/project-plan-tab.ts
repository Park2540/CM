import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { HousePlan, ROOM_KIND_LABEL, RoomKind, countRooms, usableArea } from '@/app/pages/service/house-plan.service';
import { FORMAT_LABEL, ProjectModel, ProjectModelService, SOURCE_APP, isConverting, toModelFile } from '@/app/pages/service/project-model.service';
import { FloorPlan, ROOM_KIND_SWATCH } from './floor-plan';
import { HouseModelViewer } from './house-model-viewer';
import { ModelUploadDialog } from './model-upload-dialog';
import { HouseSettingsDialog } from './house-settings-dialog';
import { ProjectHouse, ProjectHouseService, RENDER_VIEWS, RenderView } from '@/app/pages/service/project-house.service';
import { PhotoPlaceholder } from './project-ui';

/**
 * แบบบ้านของโครงการ: แบบ 3 มิติที่อัปโหลด (SketchUp / Revit ส่งออก) เก็บทุกเวอร์ชัน + แปลนจากคลังแบบบ้าน (ถ้าเลือกไว้)
 * แนบแบบ 3 มิติได้ตั้งแต่เปิดโครงการ เช่น ตอนลูกค้าอนุมัติแบบ และอัปโหลดเวอร์ชันใหม่เมื่อแบบเปลี่ยน
 */
@Component({
    selector: 'app-project-plan-tab',
    standalone: true,
    imports: [ButtonModule, DatePipe, DecimalPipe, DialogModule, FloorPlan, HouseModelViewer, HouseSettingsDialog, ModelUploadDialog, PhotoPlaceholder],
    template: `
        <div class="card">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
                <h2 class="text-xl font-semibold m-0">แบบแปลนบ้าน</h2>
                @if (canManage()) {
                    <div class="flex flex-wrap gap-2">
                        <button pButton type="button" icon="pi pi-sliders-h" label="ตั้งค่าแบบบ้าน" [outlined]="true" [disabled]="!houseResource.hasValue()" (click)="settingsOpen.set(true)"></button>
                        <button pButton type="button" icon="pi pi-upload" label="อัปโหลดแบบ 3D" (click)="uploadOpen.set(true)"></button>
                    </div>
                }
            </div>

            <div class="grid grid-cols-12 gap-6 lg:gap-8">
                <!-- สื่อแสดงผล -->
                <div class="col-span-12" [class.lg:col-span-7]="hasDetails()">
                    <div class="flex flex-wrap items-center gap-3 mb-3">
                        <div class="inline-flex rounded-full border border-surface p-1" role="group" aria-label="รูปแบบการแสดงผล">
                            <button type="button" class="seg" [class.seg-active]="media() === 'model'" [attr.aria-pressed]="media() === 'model'" (click)="media.set('model')"><i class="pi pi-box"></i>โมเดล 3D</button>
                            <button type="button" class="seg" [class.seg-active]="media() === 'render'" [attr.aria-pressed]="media() === 'render'" (click)="media.set('render')"><i class="pi pi-image"></i>ภาพทัศนียภาพ</button>
                        </div>
                        @if (media() === 'render') {
                            <div class="inline-flex flex-wrap gap-1" role="group" aria-label="มุมของภาพทัศนียภาพ">
                                @for (view of renderViews; track view.value) {
                                    <button type="button" class="view-chip" [class.view-chip-active]="renderView() === view.value" [attr.aria-pressed]="renderView() === view.value" (click)="renderView.set(view.value)">
                                        {{ view.label }}
                                        @if (!house()?.renders?.[view.value]) {
                                            <span class="sr-only">(ยังไม่มีภาพ)</span>
                                        }
                                    </button>
                                }
                            </div>
                        } @else if (models().length > 1) {
                            <label class="flex items-center gap-2 text-sm">
                                <span class="text-muted-color">เวอร์ชัน</span>
                                <select class="native-select" [value]="selectedId()" (change)="selectedId.set($any($event.target).value)">
                                    @for (model of models(); track model.id; let first = $first) {
                                        <option [value]="model.id" [selected]="model.id === selectedId()">ฉบับที่ {{ model.version }} · {{ model.title }}{{ first ? ' (ล่าสุด)' : '' }}</option>
                                    }
                                </select>
                            </label>
                        }
                    </div>
                    <div class="h-[24rem] lg:h-[30rem]">
                        @if (media() === 'model') {
                            <app-house-model-viewer class="h-full" [plan]="plan()" [model]="selectedFile()" />
                        } @else if (renderImage(); as image) {
                            <a [href]="image.url" target="_blank" rel="noopener" class="block h-full rounded-lg overflow-hidden bg-surface-100 dark:bg-surface-800" [attr.aria-label]="'เปิดภาพทัศนียภาพ' + renderLabel() + 'ขนาดเต็ม'">
                                <img [src]="image.url" [alt]="'ภาพทัศนียภาพ' + renderLabel()" class="w-full h-full object-contain" />
                            </a>
                        } @else {
                            <div class="relative h-full">
                                <app-photo-placeholder class="h-full" [large]="true" />
                                <div class="absolute inset-x-0 bottom-4 text-center text-sm text-muted-color">
                                    ยังไม่มีภาพทัศนียภาพ{{ renderLabel() }}{{ canManage() ? ' — เพิ่มได้ที่ "ตั้งค่าแบบบ้าน"' : '' }}
                                </div>
                            </div>
                        }
                    </div>

                    @if (selected(); as model) {
                        <div class="mt-3 rounded-lg border border-surface p-3 text-sm">
                            <div class="flex flex-wrap items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <div class="font-semibold">
                                        ฉบับที่ {{ model.version }} · {{ model.title }}
                                        @if (model.id === models()[0]?.id) {
                                            <span class="ml-1 px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300">แบบที่ใช้อยู่</span>
                                        }
                                    </div>
                                    <div class="text-xs text-muted-color mt-1">{{ appLabel(model) }}{{ model.format ? ' · ' + formatLabel[model.format] : '' }} · อัปโหลดโดย {{ model.uploadedBy.name }} เมื่อ {{ model.uploadedAt | date: 'd/M/yyyy HH:mm' }}</div>
                                    @switch (model.conversion?.status) {
                                        @case ('queued') {
                                            <div class="text-xs mt-1 text-blue-700 dark:text-blue-300" role="status"><i class="pi pi-spin pi-spinner mr-1"></i>รอคิวแปลงไฟล์ต้นฉบับเป็น 3D...</div>
                                        }
                                        @case ('converting') {
                                            <div class="text-xs mt-1 text-blue-700 dark:text-blue-300" role="status"><i class="pi pi-spin pi-spinner mr-1"></i>กำลังแปลงไฟล์ต้นฉบับเป็น 3D — ไฟล์ใหญ่อาจใช้เวลาหลายนาที หน้านี้จะแสดงโมเดลเองเมื่อเสร็จ</div>
                                        }
                                        @case ('done') {
                                            <div class="text-xs mt-1 text-muted-color"><i class="pi pi-check-circle mr-1 text-green-600 dark:text-green-400"></i>แปลงจากไฟล์ต้นฉบับอัตโนมัติ{{ model.conversion?.triangles ? ' · ' + (model.conversion!.triangles! | number) + ' สามเหลี่ยม' : '' }}</div>
                                        }
                                        @case ('failed') {
                                            <div class="text-xs mt-1 text-red-700 dark:text-red-300" role="alert"><i class="pi pi-exclamation-triangle mr-1"></i>{{ model.conversion?.message }}</div>
                                        }
                                        @case ('unavailable') {
                                            <div class="text-xs mt-1 text-orange-700 dark:text-orange-300"><i class="pi pi-exclamation-circle mr-1"></i>{{ model.conversion?.message }}</div>
                                        }
                                        @default {
                                            @if (!model.file) {
                                                <div class="text-xs mt-1 text-orange-700 dark:text-orange-300">
                                                    <i class="pi pi-exclamation-circle mr-1"></i>เวอร์ชันนี้มีเฉพาะไฟล์ต้นฉบับ จึงยังแสดงเป็น 3D ไม่ได้ — ส่งออกเป็น .glb / .dae / .fbx แล้วอัปโหลดเวอร์ชันใหม่
                                                </div>
                                            }
                                        }
                                    }
                                    @if (convertError()) {
                                        <div class="text-xs mt-1 text-red-700 dark:text-red-300" role="alert"><i class="pi pi-exclamation-triangle mr-1"></i>{{ convertError() }}</div>
                                    }
                                    @if (largeModel(model)) {
                                        <div class="text-xs mt-1 text-muted-color"><i class="pi pi-info-circle mr-1"></i>โมเดลรายละเอียดสูง ไฟล์ใหญ่ อาจใช้เวลาโหลดสักครู่</div>
                                    }
                                    @if (model.note) {
                                        <div class="text-xs mt-1">{{ model.note }}</div>
                                    }
                                </div>
                                <div class="flex flex-wrap gap-1">
                                    @if (model.file && model.format) {
                                        <a pButton [href]="model.file.url" [attr.download]="model.file.name" [text]="true" size="small" icon="pi pi-download" [label]="formatLabel[model.format]"></a>
                                    }
                                    @if (model.sourceFile; as source) {
                                        <a pButton [href]="source.url" [attr.download]="source.name" [text]="true" size="small" icon="pi pi-download" [label]="'ต้นฉบับ ' + appLabel(model)" [title]="source.name"></a>
                                    }
                                    @if (canManage() && (model.conversion?.status === 'failed' || model.conversion?.status === 'unavailable')) {
                                        <button pButton type="button" [text]="true" size="small" icon="pi pi-sync" label="แปลงใหม่" [loading]="converting() === model.id" (click)="convert(model)"></button>
                                    }
                                    @if (canManage()) {
                                        <button pButton type="button" [text]="true" size="small" severity="danger" icon="pi pi-trash" aria-label="ลบเวอร์ชันนี้" title="ลบเวอร์ชันนี้" (click)="deleting.set(model)"></button>
                                    }
                                </div>
                            </div>
                        </div>
                    } @else if (modelsResource.error(); as error) {
                        <div class="mt-3 text-sm text-red-700 dark:text-red-300" role="alert"><i class="pi pi-exclamation-triangle mr-1"></i>โหลดรายการแบบ 3 มิติไม่สำเร็จ: {{ errorMessage(error) }}</div>
                    } @else if (!modelsResource.isLoading()) {
                        <p class="mt-3 mb-0 text-sm text-muted-color">
                            <i class="pi pi-info-circle mr-1"></i>
                            @if (plan()) {
                                ยังไม่ได้อัปโหลดแบบ 3 มิติของโครงการ กำลังแสดงโมเดลจำลองจากแปลนแบบบ้าน
                            } @else {
                                ยังไม่ได้อัปโหลดแบบ 3 มิติ และยังไม่ได้เลือกแบบจากคลังแบบบ้าน
                            }
                            @if (canManage()) {
                                — อัปโหลดแบบที่ส่งออกจาก SketchUp หรือ Revit ได้ที่ปุ่ม "อัปโหลดแบบ 3D"
                            }
                        </p>
                    }
                </div>

                <!-- รายละเอียดแบบบ้านที่ผู้ตั้งค่ากรอก (มาก่อนแบบบ้านจากคลัง) -->
                @if (house()?.configured ? house() : null; as house) {
                    <div class="col-span-12 lg:col-span-5">
                        <h3 class="text-2xl font-bold m-0">{{ house.name }}</h3>
                        @if (house.usableArea) {
                            <div class="font-semibold mt-2">พื้นที่ใช้สอย {{ house.usableArea | number: '1.0-1' }} ตร.ม.</div>
                        }
                        @if (sizeText(house); as size) {
                            <div class="text-sm text-muted-color mt-1">{{ size }}</div>
                        }

                        @if (features(house).length) {
                            <ul class="grid grid-cols-2 gap-x-4 gap-y-3 list-none p-0 my-5">
                                @for (feature of features(house); track feature.key) {
                                    <li class="flex items-center gap-3">
                                        @switch (feature.key) {
                                            @case ('bedrooms') {
                                                <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18h18M3 18v2m18-2v2M6 10V6h5v4m2 0V6h5v4" /></svg>
                                            }
                                            @case ('bathrooms') {
                                                <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Zm2 0V5a2 2 0 0 1 4 0M8 19l-1 2m10-2 1 2" /></svg>
                                            }
                                            @case ('kitchens') {
                                                <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true"><path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Zm-2 0h20M9 6c0-1 1-1 1-2m4 2c0-1 1-1 1-2" /></svg>
                                            }
                                            @default {
                                                <svg viewBox="0 0 24 24" class="feature-icon" aria-hidden="true">
                                                    <circle cx="12" cy="12" r="9" />
                                                    <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
                                                </svg>
                                            }
                                        }
                                        {{ feature.text }}
                                    </li>
                                }
                            </ul>
                        } @else {
                            <div class="my-4"></div>
                        }
                        @if (house.description) {
                            <p class="text-muted-color mt-0 mb-6 whitespace-pre-line">{{ house.description }}</p>
                        }

                        @if (house.floorPlans.length) {
                            <div class="grid grid-cols-2 gap-4">
                                @for (floor of house.floorPlans; track $index; let i = $index) {
                                    <div>
                                        <div class="font-semibold mb-2">{{ floor.label }}</div>
                                        <button
                                            type="button"
                                            class="w-full p-1 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900 cursor-pointer hover:border-primary transition-colors"
                                            [attr.aria-label]="'ขยายแปลน' + floor.label"
                                            (click)="openFloorImage(i)"
                                        >
                                            <img [src]="floor.image.url" [alt]="'แปลน' + floor.label" class="w-full h-40 object-contain block" loading="lazy" />
                                        </button>
                                    </div>
                                }
                            </div>
                        } @else {
                            <p class="text-sm text-muted-color m-0"><i class="pi pi-image mr-1"></i>ยังไม่มีภาพแปลนรายชั้น{{ canManage() ? ' — เพิ่มได้ที่ "ตั้งค่าแบบบ้าน"' : '' }}</p>
                        }
                        @if (house.updatedBy) {
                            <p class="text-xs text-muted-color mt-4 mb-0">ตั้งค่าโดย {{ house.updatedBy.name }} เมื่อ {{ house.updatedAt | date: 'd/M/yyyy HH:mm' }}</p>
                        }
                    </div>
                } @else if (plan(); as plan) {
                    <div class="col-span-12 lg:col-span-5">
                        <h3 class="text-2xl font-bold m-0">{{ plan.name }}</h3>
                        <div class="font-semibold mt-2">พื้นที่ใช้สอย {{ area() | number }} ตร.ม.</div>
                        <div class="text-sm text-muted-color mt-1">ขนาดตัวบ้าน {{ plan.width }} × {{ plan.depth }} ม. · {{ plan.floors.length }} ชั้น</div>

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
                                ที่จอดรถ {{ plan.parking }} คัน
                            </li>
                        </ul>
                        <p class="text-muted-color mt-0 mb-6">{{ plan.description }}</p>

                        <div class="grid grid-cols-2 gap-4">
                            @for (floor of plan.floors; track floor.label; let i = $index) {
                                <div>
                                    <div class="font-semibold mb-2">{{ floor.label }}</div>
                                    <button
                                        type="button"
                                        class="w-full p-2 rounded-lg border border-surface bg-surface-0 dark:bg-surface-900 cursor-pointer hover:border-primary transition-colors"
                                        [attr.aria-label]="'ขยายแปลน' + floor.label"
                                        (click)="openFloor(i)"
                                    >
                                        <app-floor-plan [floor]="floor" [width]="plan.width" [depth]="plan.depth" />
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
                }
            </div>

            <div class="flex flex-wrap justify-between items-center gap-3 mt-6 pt-4 border-t border-surface">
                <span class="text-sm text-muted-color"><i class="pi pi-info-circle mr-1"></i>แปลนและโมเดลใช้ประกอบการติดตามงาน ขนาดจริงให้อ้างอิงแบบก่อสร้าง</span>
                @if (showDocumentsLink()) {
                    <button pButton type="button" [outlined]="true" icon="pi pi-folder-open" label="ดูแบบก่อสร้างฉบับเต็ม" (click)="openDocuments.emit()"></button>
                }
            </div>
        </div>

        @if (settingsOpen() && house(); as current) {
            <app-house-settings-dialog [projectCode]="projectCode()" [house]="current" (saved)="onHouseSaved($event)" (closed)="settingsOpen.set(false)" />
        }

        @if (floorImageIndex() !== null && house()?.floorPlans?.[floorImageIndex()!]; as floor) {
            <p-dialog [visible]="true" (visibleChange)="!$event && floorImageIndex.set(null)" [modal]="true" [dismissableMask]="true" [draggable]="false" [style]="{ width: 'min(72rem, 96vw)' }" [header]="(house()?.name ?? '') + ' · ' + floor.label">
                <img [src]="floor.image.url" [alt]="'แปลน' + floor.label" class="w-full max-h-[75vh] object-contain block" />
                <ng-template #footer>
                    <a pButton [href]="floor.image.url" target="_blank" rel="noopener" [text]="true" icon="pi pi-external-link" label="เปิดภาพขนาดเต็ม"></a>
                    <button pButton type="button" [outlined]="true" icon="pi pi-chevron-left" label="ชั้นก่อนหน้า" [disabled]="floorImageIndex() === 0" (click)="openFloorImage(floorImageIndex()! - 1)"></button>
                    <button pButton type="button" [outlined]="true" icon="pi pi-chevron-right" iconPos="right" label="ชั้นถัดไป" [disabled]="floorImageIndex() === (house()?.floorPlans?.length ?? 1) - 1" (click)="openFloorImage(floorImageIndex()! + 1)"></button>
                </ng-template>
            </p-dialog>
        }

        @if (uploadOpen()) {
            <app-model-upload-dialog [projectCode]="projectCode()" [nextVersion]="(models()[0]?.version ?? 0) + 1" (saved)="onUploaded($event)" (closed)="uploadOpen.set(false)" />
        }

        @if (deleting(); as model) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !deleteBusy() && deleting.set(null)" [modal]="true" [draggable]="false" [closable]="!deleteBusy()" [style]="{ width: 'min(30rem, 95vw)' }" header="ลบแบบ 3 มิติ">
                <p class="mt-0">ลบ "ฉบับที่ {{ model.version }} · {{ model.title }}" ออกจากโครงการ?{{ model.id === models()[0]?.id && models().length > 1 ? ' เวอร์ชันก่อนหน้าจะกลายเป็นแบบที่ใช้อยู่' : '' }} ระบบบันทึกการลบไว้ใน Audit Log</p>
                @if (deleteError()) {
                    <small class="block text-red-600 dark:text-red-400" role="alert">{{ deleteError() }}</small>
                }
                <ng-template #footer>
                    <button pButton type="button" label="ไม่ลบ" [text]="true" severity="secondary" [disabled]="deleteBusy()" (click)="deleting.set(null)"></button>
                    <button pButton type="button" severity="danger" icon="pi pi-trash" label="ลบ" [loading]="deleteBusy()" (click)="confirmDelete(model)"></button>
                </ng-template>
            </p-dialog>
        }

        @if (plan(); as plan) {
            <p-dialog
                [visible]="selectedFloor() !== null"
                (visibleChange)="!$event && selectedFloor.set(null)"
                [modal]="true"
                [dismissableMask]="true"
                [draggable]="false"
                [style]="{ width: 'min(64rem, 95vw)' }"
                [header]="plan.name + ' · ' + (floor()?.label ?? '')"
            >
                @if (floor(); as floor) {
                    <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
                        <div class="md:col-span-3">
                            <app-floor-plan [floor]="floor" [width]="plan.width" [depth]="plan.depth" [detailed]="true" />
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
                                    [disabled]="selectedFloor() === plan.floors.length - 1"
                                    (click)="openFloor((selectedFloor() ?? 0) + 1)"
                                ></button>
                            </div>
                        </div>
                    </div>
                }
            </p-dialog>
        }
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
        .view-chip {
            padding: 0.3rem 0.75rem;
            border-radius: 999px;
            border: 1px solid var(--p-content-border-color);
            background: transparent;
            color: var(--p-text-color);
            font-size: 0.85rem;
            cursor: pointer;
        }
        .view-chip:hover {
            border-color: var(--p-primary-color);
        }
        .view-chip-active {
            background: var(--p-primary-color);
            border-color: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
        .seg-active {
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
        .native-select {
            padding: 0.35rem 0.6rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: var(--p-content-border-radius);
            background: var(--p-content-background);
            color: var(--p-text-color);
            font: inherit;
            max-width: 20rem;
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
    private readonly modelService = inject(ProjectModelService);
    private readonly houseService = inject(ProjectHouseService);

    readonly projectCode = input.required<string>();
    /** แบบบ้านจากคลัง (ไม่มี = แบบที่กำหนดเอง ใช้แบบ 3 มิติที่อัปโหลดอย่างเดียว) */
    readonly plan = input<HousePlan | undefined>(undefined);
    /** สิทธิ์ project.manage: อัปโหลด/ลบแบบ 3 มิติ (หลังบ้านตรวจซ้ำ) */
    readonly canManage = input(false);
    readonly openDocuments = output<void>();
    /** ซ่อนลิงก์แท็บเอกสาร (โครงการที่ยังไม่บันทึกสัญญายังไม่มีแท็บเอกสาร) */
    readonly showDocumentsLink = input(true);
    /** อัปโหลด/ลบแบบ 3 มิติแล้ว */
    readonly modelsChanged = output<{ kind: 'uploaded' | 'deleted'; model: ProjectModel }>();
    /** บันทึกข้อมูลแบบบ้านแล้ว */
    readonly houseChanged = output<ProjectHouse>();

    readonly media = signal<'model' | 'render'>('model');

    // ---------- ข้อมูลแบบบ้านที่ผู้ตั้งค่ากรอก ----------
    readonly houseResource = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.houseService.get(code) });
    readonly house = computed(() => (this.houseResource.hasValue() ? this.houseResource.value() : undefined));
    readonly settingsOpen = signal(false);
    readonly renderViews = RENDER_VIEWS;
    readonly renderView = signal<RenderView>('front');
    readonly renderImage = computed(() => this.house()?.renders?.[this.renderView()] ?? null);
    readonly renderLabel = computed(() => RENDER_VIEWS.find((view) => view.value === this.renderView())!.label);
    readonly floorImageIndex = signal<number | null>(null);
    /** มีรายละเอียดแบบบ้านแสดงคอลัมน์ขวา (ตั้งค่าเองแล้ว หรือมีแบบจากคลัง) */
    readonly hasDetails = computed(() => !!this.house()?.configured || !!this.plan());

    sizeText(house: ProjectHouse) {
        const parts = [house.width && house.depth ? `ขนาดตัวบ้าน ${house.width} × ${house.depth} ม.` : '', house.floors ? `${house.floors} ชั้น` : ''].filter(Boolean);
        return parts.join(' · ');
    }

    /** เฉพาะข้อมูลที่ผู้ตั้งค่ากรอก */
    features(house: ProjectHouse) {
        return [
            { key: 'bedrooms', value: house.bedrooms, text: `${house.bedrooms} ห้องนอน` },
            { key: 'bathrooms', value: house.bathrooms, text: `${house.bathrooms} ห้องน้ำ` },
            { key: 'kitchens', value: house.kitchens, text: `${house.kitchens} ห้องครัว` },
            { key: 'parking', value: house.parking, text: `ที่จอดรถ ${house.parking} คัน` }
        ].filter((feature) => feature.value !== undefined);
    }

    openFloorImage(index: number) {
        this.floorImageIndex.set(index);
    }

    onHouseSaved(house: ProjectHouse) {
        this.settingsOpen.set(false);
        this.houseResource.set(house);
        this.houseChanged.emit(house);
    }
    readonly selectedFloor = signal<number | null>(null);
    readonly uploadOpen = signal(false);
    readonly deleting = signal<ProjectModel | null>(null);
    readonly deleteBusy = signal(false);
    readonly deleteError = signal('');

    readonly kindLabel = ROOM_KIND_LABEL;
    readonly swatch = ROOM_KIND_SWATCH;
    readonly formatLabel = FORMAT_LABEL;

    readonly modelsResource = apiResource({ params: () => this.projectCode(), stream: ({ params: code }) => this.modelService.list(code), defaultValue: [] });
    /** ล่าสุดก่อน */
    readonly models = this.modelsResource.value;
    /** เวอร์ชันที่ดูอยู่ (เริ่มที่ล่าสุด และกลับไปล่าสุดเมื่อรายการเปลี่ยน) */
    readonly selectedId = linkedSignal(() => this.models()[0]?.id ?? '');
    readonly selected = computed(() => this.models().find((model) => model.id === this.selectedId()) ?? null);
    readonly selectedFile = computed(() => {
        const model = this.selected();
        return model ? toModelFile(model) : null;
    });

    readonly area = computed(() => (this.plan() ? usableArea(this.plan()!) : 0));
    readonly bedrooms = computed(() => (this.plan() ? countRooms(this.plan()!, 'bedroom') : 0));
    readonly bathrooms = computed(() => (this.plan() ? countRooms(this.plan()!, 'bathroom') : 0));
    readonly kitchens = computed(() => (this.plan() ? countRooms(this.plan()!, 'kitchen') : 0));
    readonly legendKinds = computed(() => {
        const kinds = new Set((this.plan()?.floors ?? []).flatMap((floor) => floor.rooms.map((room) => room.kind)));
        return (Object.keys(ROOM_KIND_SWATCH) as Array<keyof typeof ROOM_KIND_SWATCH>).filter((kind) => kinds.has(kind as RoomKind));
    });

    readonly floor = computed(() => {
        const index = this.selectedFloor();
        return index === null ? null : (this.plan()?.floors[index] ?? null);
    });
    readonly floorRooms = computed(() => (this.floor()?.rooms ?? []).filter((room) => room.kind !== 'void'));
    readonly floorArea = computed(() => this.floorRooms().reduce((sum, room) => sum + room.w * room.h, 0));

    /** รหัสเวอร์ชันที่กำลังสั่งแปลงใหม่ */
    readonly converting = signal('');
    readonly convertError = signal('');

    constructor() {
        // ระหว่างแปลงไฟล์ต้นฉบับที่หลังบ้าน โหลดรายการใหม่ทุก 5 วินาทีจนเสร็จ (เวอร์ชันได้ไฟล์ .glb แล้วตัวดูโหลดเอง)
        effect((onCleanup) => {
            if (!this.models().some(isConverting)) return;
            const timer = setInterval(() => this.modelsResource.reload(), 5000);
            onCleanup(() => clearInterval(timer));
        });
    }

    openFloor(index: number) {
        this.selectedFloor.set(index);
    }

    largeModel(model: ProjectModel) {
        return (model.file?.sizeKb ?? 0) > 50 * 1024;
    }

    convert(model: ProjectModel) {
        this.converting.set(model.id);
        this.convertError.set('');
        this.modelService.convert(this.projectCode(), model.id).subscribe({
            next: () => {
                this.converting.set('');
                this.modelsResource.reload();
            },
            error: (error) => {
                this.converting.set('');
                this.convertError.set(problemMessage(error, 'สั่งแปลงไม่สำเร็จ'));
            }
        });
    }

    appLabel(model: ProjectModel) {
        return SOURCE_APP[model.sourceApp].label;
    }

    onUploaded(model: ProjectModel) {
        this.uploadOpen.set(false);
        this.media.set('model');
        this.modelsResource.reload();
        this.modelsChanged.emit({ kind: 'uploaded', model });
    }

    confirmDelete(model: ProjectModel) {
        this.deleteBusy.set(true);
        this.deleteError.set('');
        this.modelService.remove(this.projectCode(), model.id).subscribe({
            next: () => {
                this.deleteBusy.set(false);
                this.deleting.set(null);
                this.modelsResource.reload();
                this.modelsChanged.emit({ kind: 'deleted', model });
            },
            error: (error) => {
                this.deleteBusy.set(false);
                this.deleteError.set(problemMessage(error, 'ลบไม่สำเร็จ'));
            }
        });
    }

    errorMessage(error: unknown) {
        return problemMessage(error);
    }
}
