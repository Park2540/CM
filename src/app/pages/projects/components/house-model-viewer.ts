import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type * as T from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HousePlan, PlanRoom, RoomKind } from '@/app/pages/service/house-plan.service';
import { ModelElement, ModelFile, ModelFormat, VIEWABLE_MODEL_ACCEPT, modelFormatOf } from '@/app/pages/service/project-model.service';

type Three = typeof import('three');
type ModelView = 'exterior' | number;
/** sample = จำลองจากแปลน, model = แบบ 3 มิติของโครงการ/แบบบ้าน, local = ไฟล์จากเครื่อง (ดูอย่างเดียว ไม่บันทึก), none = ไม่มีอะไรแสดง */
type ModelSource = 'sample' | 'model' | 'local' | 'none';
type PartState = 'all' | 'some' | 'none';
type IfcDimension = 'discipline' | 'category' | 'storey' | 'system';
/** กลุ่มชิ้นงานใน .glb ที่แปลงจาก IFC (1 node ต่อ งาน × หมวด × ชั้น × ระบบ) */
interface IfcNode {
    object: T.Object3D;
    discipline: string;
    category: string;
    storey: string;
    system: string;
    elements: number;
}
const emptyFilters = (): Record<IfcDimension, Set<string>> => ({ discipline: new Set(), category: new Set(), storey: new Set(), system: new Set() });
/** ค่าของกลุ่มในมิตินั้น (หมวดใส่งานนำหน้า เพราะชื่อหมวดซ้ำข้ามงานได้) */
const ifcKey = (node: IfcNode, dimension: IfcDimension) => (dimension === 'category' ? `${node.discipline}|${node.category}` : node[dimension]);
/** การวัดระยะ 1 เส้น (พิกัดฉาก หน่วยของไฟล์) */
interface Measurement {
    id: number;
    a: T.Vector3;
    b: T.Vector3;
    distance: number;
    horizontal: number;
    vertical: number;
}
/** ข้อมูลที่แสดงในการ์ดเมื่อคลิกชิ้นงาน */
interface PickedInfo {
    title: string;
    subtitle: string;
    rows: Array<[string, string]>;
    groups: Array<{ name: string; items: Array<[string, string]> }>;
    loading: boolean;
    element?: ModelElement;
}
/** ส่วนประกอบระดับหมวด (เช่น tag "รวมโครงสร้าง") และส่วนย่อย (tag) */
interface PartGroup {
    id: string;
    name: string;
    state: PartState;
    children: Array<{ id: string; name: string; visible: boolean }>;
}

const WALL = 0.15;
const SLAB = 0.15;
const STEP_HEIGHT = 0.18;

const SLAB_COLOR: Record<RoomKind, number> = {
    bedroom: 0xc9dcf5,
    bathroom: 0xbfe9f0,
    living: 0xf3e2b3,
    dining: 0xf1e6a8,
    kitchen: 0xf5d3b0,
    garage: 0xb8bcc2,
    stair: 0xd6d6d6,
    void: 0xffffff,
    other: 0xddd3f3
};

/** รูปแบบที่อ่านเป็นข้อความ (ที่เหลืออ่านเป็น binary) */
const isTextFormat = (format: ModelFormat) => format === 'dae' || format === 'obj';

/**
 * ตัวดูโมเดลบ้าน 3 มิติ (three.js และ loader โหลดเมื่อใช้งานเท่านั้น)
 * - ลำดับที่แสดง: แบบ 3 มิติของโครงการ [model] → ไฟล์ modelUrl ของแบบบ้าน → โมเดลจำลองจากแปลน
 * - รองรับ .glb .gltf .dae .fbx .obj (ไฟล์ที่ SketchUp / Revit ส่งออก)
 * - ผู้ใช้เปิดไฟล์จากเครื่องเพื่อดูได้ (แสดงในเบราว์เซอร์ ไม่อัปโหลด)
 */
@Component({
    selector: 'app-house-model-viewer',
    standalone: true,
    imports: [DecimalPipe],
    template: `
        <div #container class="viewer relative w-full h-full overflow-hidden rounded-lg">
            <canvas
                #canvas
                class="block w-full h-full outline-none"
                tabindex="0"
                aria-label="โมเดลบ้าน 3 มิติ ลากเพื่อหมุน เลื่อนลูกกลิ้งเพื่อซูม คลิกที่ชิ้นงานเพื่อดูคุณสมบัติ"
                (pointerdown)="onPointerDown($event)"
                (pointerup)="onPointerUp($event)"
                (keydown.escape)="onEscape()"
            ></canvas>

            <div class="absolute top-3 left-3 right-28 flex flex-wrap gap-2">
                @if (source() === 'sample') {
                    @for (option of viewOptions(); track option.value) {
                        <button type="button" class="tool" [class.tool-active]="view() === option.value" [attr.aria-pressed]="view() === option.value" (click)="setView(option.value)">{{ option.label }}</button>
                    }
                    @if (model()) {
                        <button type="button" class="tool" (click)="showDefault()"><i class="pi pi-box mr-1"></i>กลับแบบ 3D ของโครงการ</button>
                    }
                } @else if (source() !== 'none') {
                    <span class="tool max-w-56 truncate" [title]="fileName()"><i class="pi mr-1" [class.pi-box]="source() === 'model'" [class.pi-desktop]="source() === 'local'"></i>{{ fileName() }}</span>
                    <button type="button" class="tool" [class.tool-active]="flipped()" [attr.aria-pressed]="flipped()" title="ใช้เมื่อโมเดลนอนราบ (ไฟล์ที่ใช้แกน Z เป็นแกนตั้ง)" (click)="flipUpAxis()"><i class="pi pi-sync mr-1"></i>สลับแกนตั้ง</button>
                    @if (source() === 'local') {
                        <button type="button" class="tool" (click)="showDefault()"><i class="pi pi-times mr-1"></i>ปิดไฟล์จากเครื่อง</button>
                    } @else if (plan()) {
                        <button type="button" class="tool" (click)="showSample()"><i class="pi pi-th-large mr-1"></i>ดูโมเดลจำลองจากแปลน</button>
                    }
                }
            </div>

            <div class="absolute top-3 right-3 flex gap-2">
                @if ((parts().length > 1 || ifcMode()) && source() !== 'sample') {
                    <button type="button" class="tool" [class.tool-active]="partsOpen()" [attr.aria-pressed]="partsOpen()" aria-controls="model-parts" title="เปิด/ปิดการมองเห็นแต่ละส่วนของโมเดล" (click)="partsOpen.set(!partsOpen())">
                        <i class="pi pi-sitemap mr-1"></i>ส่วนประกอบ
                        @if (hiddenCount()) {
                            <span class="text-xs">(ซ่อน {{ hiddenCount() }})</span>
                        }
                    </button>
                }
                <button type="button" class="tool tool-icon" aria-label="เปิดไฟล์ 3 มิติจากเครื่องเพื่อดู (ไม่บันทึก)" title="เปิดไฟล์ 3D จากเครื่องเพื่อดู (.glb .gltf .dae .fbx .obj) — ไม่บันทึกเข้าระบบ" (click)="fileInput.click()">
                    <i class="pi pi-folder-open"></i>
                </button>
                @if (source() !== 'none') {
                    <button type="button" class="tool" [class.tool-active]="measuring()" [attr.aria-pressed]="measuring()" title="วัดระยะ: คลิก 2 จุดบนโมเดล" (click)="toggleMeasure()"><i class="pi pi-arrows-h mr-1"></i>วัดระยะ</button>
                }
                <button type="button" class="tool tool-icon" aria-label="รีเซ็ตมุมมอง" title="รีเซ็ตมุมมอง" (click)="resetView()"><i class="pi pi-refresh"></i></button>
                <button type="button" class="tool tool-icon" [attr.aria-label]="fullscreen() ? 'ออกจากเต็มจอ' : 'เต็มจอ'" [title]="fullscreen() ? 'ออกจากเต็มจอ' : 'เต็มจอ'" (click)="toggleFullscreen()">
                    <i class="pi" [class.pi-window-maximize]="!fullscreen()" [class.pi-window-minimize]="fullscreen()"></i>
                </button>
            </div>
            <input #fileInput type="file" [accept]="accept" class="hidden" (change)="onFileSelected($event)" />

            @if (source() === 'none' && !loading()) {
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6 pointer-events-none">
                    <i class="pi pi-box text-4xl text-muted-color"></i>
                    <span class="font-semibold">ยังไม่มีแบบ 3 มิติ</span>
                    <span class="text-sm text-muted-color">แบบที่ส่งออกจาก SketchUp หรือ Revit อัปโหลดได้ที่ปุ่ม "อัปโหลดแบบ 3D"</span>
                </div>
            }

            @if (partsOpen() && ifcMode() && source() !== 'sample') {
                <section id="model-parts" class="parts-panel" aria-label="ส่วนประกอบของโมเดล (IFC)">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <span class="font-semibold text-sm">ส่วนประกอบ</span>
                        <button type="button" class="bg-transparent border-0 p-1 cursor-pointer text-muted-color" aria-label="ปิดแผงส่วนประกอบ" (click)="partsOpen.set(false)"><i class="pi pi-times"></i></button>
                    </div>
                    <div class="dim-tabs" role="tablist" aria-label="จัดกลุ่มตาม">
                        @for (dim of dimensions; track dim.value) {
                            <button type="button" role="tab" class="dim-tab" [class.dim-tab-active]="ifcDimension() === dim.value" [attr.aria-selected]="ifcDimension() === dim.value" (click)="ifcDimension.set(dim.value); partQuery.set('')">
                                {{ dim.label }}
                                @if (disabledCount(dim.value)) {
                                    <span class="dim-badge">{{ disabledCount(dim.value) }}</span>
                                }
                            </button>
                        }
                    </div>
                    <input type="search" class="parts-search mt-2" [placeholder]="'ค้นหา' + dimensionLabel()" [attr.aria-label]="'ค้นหา' + dimensionLabel()" [value]="partQuery()" (input)="partQuery.set($any($event.target).value)" />
                    <div class="flex gap-2 my-2 text-xs">
                        <button type="button" class="link-button" (click)="setDimensionAll(true)">แสดงทั้งหมด</button>
                        <button type="button" class="link-button" (click)="setDimensionAll(false)">ซ่อนทั้งหมด</button>
                        @if (totalDisabled()) {
                            <button type="button" class="link-button ml-auto" (click)="resetIfc()">ล้างตัวกรองทุกแท็บ</button>
                        }
                    </div>
                    <ul class="list-none p-0 m-0 overflow-y-auto flex-1 min-h-0">
                        @for (row of ifcRows(); track row.key) {
                            @if (row.header) {
                                <li class="text-xs font-semibold text-muted-color mt-2 mb-1">{{ row.label }}</li>
                            } @else {
                                <li class="part-row" [class.pl-3]="ifcDimension() === 'category'">
                                    <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                        <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="row.enabled" (change)="toggleValue(row.key)" />
                                        <span class="truncate" [title]="row.label">{{ row.label }}</span>
                                    </label>
                                    <span class="text-xs text-muted-color tabular-nums">{{ row.elements | number }}</span>
                                    <button type="button" class="part-solo" title="ดูเฉพาะรายการนี้" [attr.aria-label]="'ดูเฉพาะ ' + row.label" (click)="soloValue(row.key)"><i class="pi pi-eye text-[0.65rem]"></i></button>
                                </li>
                            }
                        } @empty {
                            <li class="text-xs text-muted-color py-2">ไม่พบรายการที่ค้นหา</li>
                        }
                    </ul>
                    <p class="text-xs text-muted-color m-0 mt-2">ตัวเลข = จำนวนชิ้นงาน · แสดงเฉพาะชิ้นงานที่เปิดอยู่ในทุกแท็บ</p>
                </section>
            } @else if (partsOpen() && parts().length > 1 && source() !== 'sample') {
                <section id="model-parts" class="parts-panel" aria-label="ส่วนประกอบของโมเดล">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <span class="font-semibold text-sm">ส่วนประกอบ ({{ partCount() }})</span>
                        <button type="button" class="bg-transparent border-0 p-1 cursor-pointer text-muted-color" aria-label="ปิดแผงส่วนประกอบ" (click)="partsOpen.set(false)"><i class="pi pi-times"></i></button>
                    </div>
                    <input type="search" class="parts-search" placeholder="ค้นหา Tag / ส่วนประกอบ" aria-label="ค้นหาส่วนประกอบ" [value]="partQuery()" (input)="partQuery.set($any($event.target).value)" />
                    <div class="flex gap-2 my-2 text-xs">
                        <button type="button" class="link-button" (click)="setAll(true)">แสดงทั้งหมด</button>
                        <button type="button" class="link-button" (click)="setAll(false)">ซ่อนทั้งหมด</button>
                    </div>
                    <ul class="list-none p-0 m-0 overflow-y-auto flex-1 min-h-0">
                        @for (group of filteredParts(); track group.id) {
                            <li>
                                <div class="part-row font-semibold">
                                    @if (group.children.length) {
                                        <button type="button" class="part-expand" [attr.aria-expanded]="expandedParts().has(group.id)" [attr.aria-label]="(expandedParts().has(group.id) ? 'ย่อ ' : 'ขยาย ') + group.name" (click)="toggleExpand(group.id)">
                                            <i class="pi text-[0.6rem]" [class.pi-chevron-down]="expandedParts().has(group.id) || !!partQuery()" [class.pi-chevron-right]="!expandedParts().has(group.id) && !partQuery()"></i>
                                        </button>
                                    } @else {
                                        <span class="part-expand"></span>
                                    }
                                    <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                        <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="group.state === 'all'" [indeterminate]="group.state === 'some'" (change)="toggleGroup(group.id)" />
                                        <span class="truncate" [title]="group.name">{{ group.name }}</span>
                                    </label>
                                    <button type="button" class="part-solo" title="ดูเฉพาะส่วนนี้" [attr.aria-label]="'ดูเฉพาะ ' + group.name" (click)="solo(group.id)"><i class="pi pi-eye text-[0.65rem]"></i></button>
                                </div>
                                @if (group.children.length && (expandedParts().has(group.id) || partQuery())) {
                                    <ul class="list-none p-0 m-0 pl-5">
                                        @for (part of group.children; track part.id) {
                                            <li class="part-row">
                                                <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                                    <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="part.visible" (change)="togglePart(part.id)" />
                                                    <span class="truncate" [title]="part.name">{{ part.name }}</span>
                                                </label>
                                                <button type="button" class="part-solo" title="ดูเฉพาะส่วนนี้" [attr.aria-label]="'ดูเฉพาะ ' + part.name" (click)="solo(part.id)"><i class="pi pi-eye text-[0.65rem]"></i></button>
                                            </li>
                                        }
                                    </ul>
                                }
                            </li>
                        } @empty {
                            <li class="text-xs text-muted-color py-2">ไม่พบส่วนประกอบที่ค้นหา</li>
                        }
                    </ul>
                </section>
            }

            <!-- ป้ายระยะบนเส้นวัด (ตำแหน่งคำนวณจากกล้องทุกครั้งที่วาดใหม่) -->
            @for (label of measureLabels(); track label.id) {
                @if (label.visible) {
                    <div class="measure-label" [style.left.px]="label.x" [style.top.px]="label.y">{{ label.text }}</div>
                }
            }

            @if (measuring()) {
                <section class="measure-panel" aria-label="เครื่องมือวัดระยะ">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-semibold text-sm"><i class="pi pi-arrows-h mr-1"></i>วัดระยะ</span>
                        <button type="button" class="bg-transparent border-0 p-1 cursor-pointer text-muted-color" aria-label="ปิดเครื่องมือวัดระยะ" (click)="toggleMeasure()"><i class="pi pi-times"></i></button>
                    </div>
                    <p class="text-xs text-muted-color m-0 mt-1" role="status">
                        {{ pendingPoint() ? 'คลิกจุดที่ 2 (Esc = ยกเลิกจุดแรก)' : 'คลิกจุดที่ 1 บนโมเดล — ใกล้มุมจะยึดเข้ามุมให้' }}
                    </p>
                    @if (modelSize(); as size) {
                        <div class="text-xs mt-2">
                            ขนาดโมเดล (กว้าง × ลึก × สูง)
                            <div class="font-semibold">{{ formatLength(size[0]) }} × {{ formatLength(size[1]) }} × {{ formatLength(size[2]) }}</div>
                        </div>
                    }
                    <label class="flex items-center gap-2 text-xs mt-2">
                        หน่วยของไฟล์
                        <select class="unit-select" [value]="unitFactor()" (change)="setUnit(+$any($event.target).value)" title="ไฟล์ที่ระบบแปลงจาก .skp / .ifc และไฟล์ glTF เป็นเมตรอยู่แล้ว ปรับเฉพาะไฟล์ OBJ / FBX ที่ใช้หน่วยอื่น">
                            @for (unit of units; track unit.value) {
                                <option [value]="unit.value" [selected]="unit.value === unitFactor()">{{ unit.label }}</option>
                            }
                        </select>
                    </label>
                    @if (measurementRows().length) {
                        <ol class="list-none p-0 m-0 mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
                            @for (row of measurementRows(); track row.id; let i = $index) {
                                <li class="measure-row">
                                    <span class="measure-index">{{ i + 1 }}</span>
                                    <span class="flex-1 min-w-0">
                                        <span class="block font-semibold">{{ row.distance }}</span>
                                        <span class="block text-[0.7rem] text-muted-color">ราบ {{ row.horizontal }} · ดิ่ง {{ row.vertical }}</span>
                                    </span>
                                    <button type="button" class="part-solo measure-delete" [attr.aria-label]="'ลบการวัดที่ ' + (i + 1)" (click)="removeMeasurement(row.id)"><i class="pi pi-trash text-[0.65rem]"></i></button>
                                </li>
                            }
                        </ol>
                        <button type="button" class="link-button text-xs mt-2" (click)="clearMeasurements()">ล้างการวัดทั้งหมด</button>
                    }
                </section>
            }

            @if (selection(); as selected) {
                <section class="info-card" aria-live="polite" aria-label="ข้อมูลชิ้นงานที่เลือก">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-xs text-muted-color">{{ selected.subtitle }}</div>
                            <div class="font-semibold truncate" [title]="selected.title">{{ selected.title }}</div>
                        </div>
                        <button type="button" class="bg-transparent border-0 p-1 cursor-pointer text-muted-color shrink-0" aria-label="ปิดข้อมูลชิ้นงาน" (click)="clearSelection()"><i class="pi pi-times"></i></button>
                    </div>
                    @if (selected.loading) {
                        <div class="text-xs text-muted-color mt-2"><i class="pi pi-spin pi-spinner mr-1"></i>กำลังโหลดข้อมูลชิ้นงาน...</div>
                    }
                    <dl class="info-list">
                        @for (row of selected.rows; track $index) {
                            <dt>{{ row[0] }}</dt>
                            <dd>{{ row[1] }}</dd>
                        }
                    </dl>
                    @for (group of selected.groups; track group.name) {
                        <details class="mt-2">
                            <summary class="text-xs font-semibold cursor-pointer">{{ group.name }} ({{ group.items.length }})</summary>
                            <dl class="info-list">
                                @for (item of group.items; track $index) {
                                    <dt>{{ item[0] }}</dt>
                                    <dd>{{ item[1] }}</dd>
                                }
                            </dl>
                        </details>
                    }
                    @if (selected.element && ifcMode()) {
                        <div class="flex flex-wrap gap-2 mt-2 text-xs">
                            <button type="button" class="link-button" (click)="soloIn('category', selected.element.discipline + '|' + selected.element.category)">ดูเฉพาะหมวดนี้</button>
                            <button type="button" class="link-button" (click)="soloIn('storey', selected.element.storey)">ดูเฉพาะชั้นนี้</button>
                            @if (selected.element.system) {
                                <button type="button" class="link-button" (click)="soloSystemOf(selected.element)">ดูเฉพาะระบบนี้</button>
                            }
                        </div>
                    }
                </section>
            }

            <div class="absolute bottom-3 left-3 text-xs px-2 py-1 rounded bg-surface-0/85 dark:bg-surface-900/85 text-muted-color pointer-events-none">ลากเพื่อหมุน · ลูกกลิ้งเพื่อซูม · คลิกขวาลากเพื่อเลื่อน · คลิกชิ้นงานเพื่อดูข้อมูล</div>

            @if (loading()) {
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-0/70 dark:bg-surface-900/70">
                    <i class="pi pi-spin pi-spinner text-3xl text-primary"></i>
                    <span class="text-sm">กำลังโหลดโมเดล 3D...</span>
                </div>
            }
            @if (error()) {
                <div class="absolute inset-x-3 bottom-12 flex items-start gap-2 rounded-lg p-3 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <i class="pi pi-exclamation-triangle mt-0.5"></i>
                    <span class="flex-1">{{ error() }}</span>
                    <button type="button" class="bg-transparent border-0 p-0 cursor-pointer text-inherit" aria-label="ปิดข้อความ" (click)="error.set('')"><i class="pi pi-times"></i></button>
                </div>
            }
        </div>
    `,
    styles: `
        :host {
            display: block;
        }
        .viewer {
            background: linear-gradient(180deg, #e8f0f8 0%, #f6f8fa 70%);
        }
        :host-context(.app-dark) .viewer {
            background: linear-gradient(180deg, #1e293b 0%, #0f172a 70%);
        }
        .tool {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.35rem 0.75rem;
            border-radius: 999px;
            border: 1px solid var(--p-content-border-color);
            background: color-mix(in srgb, var(--p-content-background) 92%, transparent);
            color: var(--p-text-color);
            font-size: 0.85rem;
            cursor: pointer;
            box-shadow: 0 1px 2px rgb(15 23 42 / 10%);
        }
        .tool:hover {
            border-color: var(--p-primary-color);
        }
        .tool-active {
            background: var(--p-primary-color);
            border-color: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-weight: 600;
        }
        .tool-icon {
            width: 2.25rem;
            height: 2.25rem;
            justify-content: center;
            padding: 0;
        }
        .parts-panel {
            position: absolute;
            top: 3.5rem;
            right: 0.75rem;
            bottom: 2.75rem;
            width: min(20rem, calc(100% - 1.5rem));
            display: flex;
            flex-direction: column;
            padding: 0.75rem;
            border-radius: var(--p-content-border-radius);
            border: 1px solid var(--p-content-border-color);
            background: color-mix(in srgb, var(--p-content-background) 96%, transparent);
            color: var(--p-text-color);
            box-shadow: 0 4px 16px rgb(15 23 42 / 15%);
            font-size: 0.85rem;
        }
        .parts-search {
            width: 100%;
            padding: 0.35rem 0.6rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: var(--p-content-border-radius);
            background: var(--p-content-background);
            color: var(--p-text-color);
            font: inherit;
        }
        .part-row {
            display: flex;
            align-items: center;
            gap: 0.25rem;
            padding: 0.15rem 0;
        }
        .part-expand,
        .part-solo {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 1.25rem;
            height: 1.25rem;
            flex-shrink: 0;
            border: 0;
            background: transparent;
            color: var(--p-text-muted-color);
            cursor: pointer;
            padding: 0;
        }
        .part-solo {
            opacity: 0;
        }
        .part-row:hover .part-solo,
        .part-solo:focus-visible {
            opacity: 1;
        }
        .measure-label {
            position: absolute;
            transform: translate(-50%, -50%);
            padding: 0.1rem 0.45rem;
            border-radius: 999px;
            background: #e11d48;
            color: #fff;
            font-size: 0.75rem;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 1px 3px rgb(15 23 42 / 30%);
        }
        .measure-panel {
            position: absolute;
            left: 0.75rem;
            top: 3.5rem;
            width: min(15rem, calc(100% - 1.5rem));
            padding: 0.75rem;
            border-radius: var(--p-content-border-radius);
            border: 1px solid var(--p-content-border-color);
            background: color-mix(in srgb, var(--p-content-background) 96%, transparent);
            color: var(--p-text-color);
            box-shadow: 0 4px 16px rgb(15 23 42 / 15%);
            font-size: 0.85rem;
        }
        .unit-select {
            padding: 0.15rem 0.35rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 0.375rem;
            background: var(--p-content-background);
            color: var(--p-text-color);
            font: inherit;
        }
        .measure-row {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            font-size: 0.8rem;
        }
        .measure-index {
            width: 1.15rem;
            height: 1.15rem;
            flex-shrink: 0;
            border-radius: 999px;
            background: #e11d48;
            color: #fff;
            font-size: 0.65rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        .measure-row:hover .measure-delete,
        .measure-delete:focus-visible {
            opacity: 1;
        }
        .info-card {
            position: absolute;
            left: 0.75rem;
            bottom: 2.75rem;
            width: min(20rem, calc(100% - 1.5rem));
            max-height: calc(100% - 6.5rem);
            overflow-y: auto;
            padding: 0.75rem;
            border-radius: var(--p-content-border-radius);
            border: 1px solid var(--p-content-border-color);
            background: color-mix(in srgb, var(--p-content-background) 96%, transparent);
            color: var(--p-text-color);
            box-shadow: 0 4px 16px rgb(15 23 42 / 15%);
            font-size: 0.85rem;
        }
        .info-list {
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 0.15rem 0.6rem;
            margin: 0.5rem 0 0;
            font-size: 0.78rem;
        }
        .info-list dt {
            color: var(--p-text-muted-color);
        }
        .info-list dd {
            margin: 0;
            word-break: break-word;
        }
        .dim-tabs {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 0.25rem;
            padding: 0.2rem;
            border-radius: var(--p-content-border-radius);
            background: var(--p-content-hover-background);
        }
        .dim-tab {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.3rem 0.25rem;
            border: 0;
            border-radius: calc(var(--p-content-border-radius) - 2px);
            background: transparent;
            color: var(--p-text-muted-color);
            font: inherit;
            cursor: pointer;
        }
        .dim-tab-active {
            background: var(--p-content-background);
            color: var(--p-text-color);
            font-weight: 600;
            box-shadow: 0 1px 2px rgb(15 23 42 / 12%);
        }
        .dim-badge {
            min-width: 1.1rem;
            padding: 0 0.25rem;
            border-radius: 999px;
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
            font-size: 0.65rem;
            line-height: 1.1rem;
        }
        .link-button {
            padding: 0;
            border: 0;
            background: transparent;
            color: var(--p-primary-color);
            font: inherit;
            text-decoration: underline;
            cursor: pointer;
        }
    `
})
export class HouseModelViewer {
    /** แบบบ้านจากคลัง (ใช้สร้างโมเดลจำลองจากแปลน) */
    readonly plan = input<HousePlan | undefined>(undefined);
    /** แบบ 3 มิติของโครงการ (มาก่อนแบบบ้านจากคลัง) */
    readonly model = input<ModelFile | null>(null);

    readonly accept = VIEWABLE_MODEL_ACCEPT;
    readonly loading = signal(true);
    readonly error = signal('');
    readonly source = signal<ModelSource>('none');
    readonly flipped = signal(false);
    readonly fileName = signal('');
    readonly view = signal<ModelView>('exterior');
    readonly fullscreen = signal(false);
    readonly viewOptions = signal<Array<{ value: ModelView; label: string }>>([]);

    // ---------- ส่วนประกอบ (เปิด/ปิดการมองเห็น) ----------
    readonly parts = signal<PartGroup[]>([]);
    readonly partsOpen = signal(false);
    readonly partQuery = signal('');
    readonly expandedParts = signal(new Set<string>());
    /** object ของแต่ละส่วน (id → Object3D) */
    private partObjects = new Map<string, T.Object3D>();
    readonly partCount = computed(() => this.parts().reduce((sum, group) => sum + Math.max(1, group.children.length), 0));
    readonly hiddenCount = computed(() => (this.ifcMode() ? this.totalDisabled() : this.parts().reduce((sum, group) => sum + (group.children.length ? group.children.filter((part) => !part.visible).length : group.state === 'none' ? 1 : 0), 0)));
    readonly filteredParts = computed(() => {
        const q = this.partQuery().trim().toLowerCase();
        if (!q) return this.parts();
        return this.parts()
            .map((group) => (group.name.toLowerCase().includes(q) ? group : { ...group, children: group.children.filter((part) => part.name.toLowerCase().includes(q)) }))
            .filter((group) => group.name.toLowerCase().includes(q) || group.children.length);
    });

    private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

    private three?: Three;
    private renderer?: T.WebGLRenderer;
    private scene?: T.Scene;
    private camera?: T.PerspectiveCamera;
    private controls?: OrbitControls;
    private ground?: T.Mesh;
    private model3d?: T.Object3D;
    private floorGroups: T.Group[] = [];
    private roof?: T.Object3D;
    private frame = 0;
    private resizeObserver?: ResizeObserver;
    private destroyed = false;
    /** กันผลการโหลดครั้งเก่ามาทับครั้งใหม่ (เช่น สลับเวอร์ชันเร็ว ๆ) */
    private loadToken = 0;

    // ---------- คลิกเลือกชิ้นงาน ----------
    readonly selection = signal<PickedInfo | null>(null);
    private pointerStart: { x: number; y: number } | null = null;
    private highlight?: T.Mesh;
    /** ข้อมูลชิ้นงานของไฟล์ที่เปิดอยู่ (โหลดครั้งแรกที่คลิก) */
    private elementsLoad?: Promise<ModelElement[]>;
    private elementsUrl?: string;

    onPointerDown(event: PointerEvent) {
        this.pointerStart = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    }

    /** คลิก (ไม่ได้ลากหมุน) = เลือกชิ้นงาน หรือวางจุดวัดระยะ */
    onPointerUp(event: PointerEvent) {
        const start = this.pointerStart;
        this.pointerStart = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
        if (this.measuring()) this.addMeasurePoint(event);
        else void this.pick(event);
    }

    onEscape() {
        if (this.pendingPoint()) this.cancelPendingPoint();
        else this.clearSelection();
    }

    // ---------- วัดระยะ ----------
    readonly measuring = signal(false);
    readonly pendingPoint = signal(false);
    readonly measurements = signal<Measurement[]>([]);
    readonly measureLabels = signal<Array<{ id: number; x: number; y: number; text: string; visible: boolean }>>([]);
    /** ขนาดกรอบโมเดล (กว้าง × ลึก × สูง) ในหน่วยของไฟล์ */
    readonly modelSize = signal<[number, number, number] | null>(null);
    /** หน่วยของไฟล์ → เมตร (ไฟล์ที่แปลงจาก .skp / .ifc และ glTF เป็นเมตร) */
    readonly unitFactor = signal(1);
    readonly units = [
        { value: 1, label: 'เมตร' },
        { value: 0.01, label: 'เซนติเมตร' },
        { value: 0.001, label: 'มิลลิเมตร' },
        { value: 0.0254, label: 'นิ้ว' },
        { value: 0.3048, label: 'ฟุต' }
    ];
    readonly measurementRows = computed(() =>
        this.measurements().map((m) => ({ id: m.id, distance: this.formatLength(m.distance), horizontal: this.formatLength(m.horizontal), vertical: this.formatLength(m.vertical) }))
    );
    private measureGroup?: T.Group;
    private pendingStart?: T.Vector3;
    private pendingMarker?: T.Mesh;
    private markerRadius = 0.05;
    private nextMeasureId = 1;
    private measureObjects = new Map<number, T.Object3D[]>();

    /** ระยะในหน่วยของไฟล์ → ข้อความเป็นเมตร (สั้นกว่า 1 ม. แสดงเป็น ซม. / มม.) */
    formatLength(value: number) {
        const meters = value * this.unitFactor();
        if (meters >= 1) return `${meters.toFixed(2)} ม.`;
        if (meters >= 0.01) return `${(meters * 100).toFixed(1)} ซม.`;
        return `${Math.round(meters * 1000)} มม.`;
    }

    toggleMeasure() {
        const on = !this.measuring();
        this.measuring.set(on);
        this.cancelPendingPoint();
        if (on) this.clearSelection();
    }

    setUnit(factor: number) {
        this.unitFactor.set(factor);
        this.updateMeasureLabels();
    }

    removeMeasurement(id: number) {
        for (const object of this.measureObjects.get(id) ?? []) {
            this.measureGroup?.remove(object);
            disposeObject(object);
        }
        this.measureObjects.delete(id);
        this.measurements.update((list) => list.filter((m) => m.id !== id));
        this.updateMeasureLabels();
        this.requestRender();
    }

    clearMeasurements() {
        for (const id of [...this.measureObjects.keys()]) this.removeMeasurement(id);
        this.cancelPendingPoint();
    }

    private cancelPendingPoint() {
        if (this.pendingMarker) {
            this.measureGroup?.remove(this.pendingMarker);
            disposeObject(this.pendingMarker);
        }
        this.pendingMarker = undefined;
        this.pendingStart = undefined;
        this.pendingPoint.set(false);
        this.requestRender();
    }

    private addMeasurePoint(event: PointerEvent) {
        const hit = this.raycast(event);
        if (!hit || !this.measureGroup) return;
        const point = this.snapToVertex(hit, event);
        if (!this.pendingStart) {
            this.pendingStart = point;
            this.pendingMarker = this.measureMarker(point);
            this.measureGroup.add(this.pendingMarker);
            this.pendingPoint.set(true);
            this.requestRender();
            return;
        }
        const three = this.three!;
        const start = this.pendingStart;
        const id = this.nextMeasureId++;
        const line = new three.Line(new three.BufferGeometry().setFromPoints([start, point]), new three.LineBasicMaterial({ color: 0xe11d48, depthTest: false, transparent: true }));
        line.renderOrder = 20;
        const end = this.measureMarker(point);
        this.measureGroup.add(line, end);
        this.measureObjects.set(id, [this.pendingMarker!, line, end]);
        this.pendingMarker = undefined;
        this.pendingStart = undefined;
        this.pendingPoint.set(false);
        // แกนตั้งของฉากคือ Y
        const delta = point.clone().sub(start);
        this.measurements.update((list) => [...list, { id, a: start, b: point, distance: delta.length(), horizontal: Math.hypot(delta.x, delta.z), vertical: Math.abs(delta.y) }]);
        this.updateMeasureLabels();
        this.requestRender();
    }

    private measureMarker(point: T.Vector3): T.Mesh {
        const three = this.three!;
        const marker = new three.Mesh(new three.SphereGeometry(this.markerRadius, 16, 12), new three.MeshBasicMaterial({ color: 0xe11d48, depthTest: false, transparent: true }));
        marker.position.copy(point);
        marker.renderOrder = 21;
        return marker;
    }

    /** ยึดเข้ามุมของสามเหลี่ยมที่คลิกถ้าอยู่ใกล้ (ไม่เกิน 12 พิกเซลบนจอ) ให้วัดจากมุมชิ้นงานได้แม่น */
    private snapToVertex(hit: T.Intersection, event: PointerEvent): T.Vector3 {
        const three = this.three!;
        const mesh = hit.object as T.Mesh;
        const position = mesh.geometry.getAttribute('position');
        if (!hit.face || !position) return hit.point.clone();
        const rect = this.canvas().nativeElement.getBoundingClientRect();
        let best: T.Vector3 | null = null;
        let bestDistance = 12;
        for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
            const vertex = new three.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
            const screen = vertex.clone().project(this.camera!);
            const distance = Math.hypot(((screen.x + 1) / 2) * rect.width - (event.clientX - rect.left), ((1 - screen.y) / 2) * rect.height - (event.clientY - rect.top));
            if (distance < bestDistance) {
                bestDistance = distance;
                best = vertex;
            }
        }
        return best ?? hit.point.clone();
    }

    /** ตำแหน่งป้ายระยะบนจอ (จุดกึ่งกลางเส้นวัด) */
    private updateMeasureLabels() {
        const camera = this.camera;
        const element = this.container().nativeElement;
        if (!camera || !this.three) return;
        const width = element.clientWidth;
        const height = element.clientHeight;
        this.measureLabels.set(
            this.measurements().map((m) => {
                const mid = m.a.clone().add(m.b).multiplyScalar(0.5).project(camera);
                return { id: m.id, x: ((mid.x + 1) / 2) * width, y: ((1 - mid.y) / 2) * height, text: this.formatLength(m.distance), visible: mid.z < 1 && Math.abs(mid.x) <= 1.1 && Math.abs(mid.y) <= 1.1 };
            })
        );
    }

    /** จุดแรกที่ลำแสงจากตำแหน่งเมาส์ชนโมเดล (เฉพาะส่วนที่มองเห็นอยู่) */
    private raycast(event: PointerEvent): T.Intersection | undefined {
        const three = this.three;
        if (!three || !this.model3d || !this.camera) return undefined;
        const rect = this.canvas().nativeElement.getBoundingClientRect();
        const pointer = new three.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        const raycaster = new three.Raycaster();
        raycaster.setFromCamera(pointer, this.camera);
        const meshes: T.Object3D[] = [];
        this.model3d.traverseVisible((child) => {
            if ((child as T.Mesh).isMesh) meshes.push(child);
        });
        return raycaster.intersectObjects(meshes, false).find((item) => item.face);
    }

    clearSelection() {
        this.selection.set(null);
        this.removeHighlight();
        this.requestRender();
    }

    /** ดูเฉพาะค่าเดียวในมิติที่กำหนด (จากการ์ดข้อมูลชิ้นงาน) */
    soloIn(dimension: IfcDimension, key: string) {
        this.ifcDimension.set(dimension);
        this.soloValue(key);
        this.partsOpen.set(true);
    }

    /** ระบบในตัวกรองเป็นชื่อแบบรวมเลขวงจร (ตัดเลขท้าย) */
    soloSystemOf(element: ModelElement) {
        this.soloIn('system', element.system.replace(/\s+\d+$/, ''));
    }

    private async pick(event: PointerEvent) {
        if (!this.three || !this.model3d || this.source() === 'sample') return;
        // เฉพาะ mesh ที่มองเห็นอยู่ (ส่วนที่ปิดในแผงส่วนประกอบคลิกไม่โดน)
        const hit = this.raycast(event);
        this.removeHighlight();
        if (!hit) {
            this.selection.set(null);
            this.requestRender();
            return;
        }
        const mesh = hit.object as T.Mesh;
        const attribute = mesh.geometry.getAttribute('_element') as T.BufferAttribute | undefined;
        if (!attribute) {
            // ไฟล์ที่ไม่มีข้อมูลรายชิ้น: บอกส่วนประกอบที่คลิก (tag / ชื่อ object)
            let node: T.Object3D | null = mesh;
            while (node && !node.userData['name'] && !node.name) node = node.parent;
            const name = String(node?.userData['name'] ?? node?.name ?? 'ไม่มีชื่อ');
            const parentName = node?.parent?.userData['name'];
            this.highlightMesh(mesh, null, 0);
            this.selection.set({ title: name, subtitle: parentName ? `ส่วนประกอบ · ${parentName}` : 'ส่วนประกอบ', rows: [], groups: [], loading: false });
            return;
        }
        const index = Math.round(attribute.getX(hit.face!.a));
        this.highlightMesh(mesh, attribute, index);
        this.selection.set({ title: 'ชิ้นงาน', subtitle: '', rows: [], groups: [], loading: true });
        try {
            const element = (await this.loadElements())[index];
            if (!element) throw new Error('missing');
            const groups = new Map<string, Array<[string, string]>>();
            for (const [group, name, value] of element.properties) groups.set(group, [...(groups.get(group) ?? []), [name, value]]);
            this.selection.set({
                title: element.name || element.category,
                subtitle: `${element.discipline} · ${element.category}`,
                element,
                loading: false,
                rows: [
                    ['ประเภท', element.type || '-'],
                    ['ชั้น', element.storey],
                    ...(element.system ? ([['ระบบ', element.system]] as Array<[string, string]>) : []),
                    ['IFC', element.ifcClass],
                    ['GUID', element.guid]
                ],
                groups: [...groups].map(([name, items]) => ({ name, items }))
            });
        } catch {
            this.selection.set({ title: 'ชิ้นงาน', subtitle: '', rows: [['ข้อมูล', 'โหลดข้อมูลชิ้นงานไม่สำเร็จ']], groups: [], loading: false });
        }
    }

    private loadElements(): Promise<ModelElement[]> {
        const url = this.model()?.elementsUrl;
        if (!url) return Promise.resolve([]);
        if (!this.elementsLoad || this.elementsUrl !== url) {
            this.elementsUrl = url;
            this.elementsLoad = fetch(url)
                .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
                .then((data: { elements: ModelElement[] }) => data.elements);
            this.elementsLoad.catch(() => (this.elementsLoad = undefined));
        }
        return this.elementsLoad;
    }

    /** ไฮไลต์สามเหลี่ยมของชิ้นงานที่เลือก (attribute = null: ทั้ง mesh) */
    private highlightMesh(mesh: T.Mesh, attribute: T.BufferAttribute | null, element: number) {
        const three = this.three!;
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position');
        const index = geometry.index;
        const triangleCount = (index ? index.count : position.count) / 3;
        const vertex = (i: number) => (index ? index.getX(i) : i);
        const points: number[] = [];
        const p = new three.Vector3();
        mesh.updateWorldMatrix(true, false);
        for (let t = 0; t < triangleCount; t++) {
            const a = vertex(t * 3);
            if (attribute && Math.round(attribute.getX(a)) !== element) continue;
            for (let k = 0; k < 3; k++) {
                p.fromBufferAttribute(position, vertex(t * 3 + k)).applyMatrix4(mesh.matrixWorld);
                points.push(p.x, p.y, p.z);
            }
        }
        const highlightGeometry = new three.BufferGeometry();
        highlightGeometry.setAttribute('position', new three.Float32BufferAttribute(points, 3));
        this.highlight = new three.Mesh(
            highlightGeometry,
            new three.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.65, side: three.DoubleSide, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
        );
        this.highlight.renderOrder = 10;
        this.scene!.add(this.highlight);
        this.requestRender();
    }

    private removeHighlight() {
        if (!this.highlight) return;
        this.scene?.remove(this.highlight);
        disposeObject(this.highlight);
        this.highlight = undefined;
    }
    private readonly onFullscreenChange = () => {
        this.fullscreen.set(document.fullscreenElement === this.container().nativeElement);
    };

    constructor() {
        afterNextRender(() => this.init());
        inject(DestroyRef).onDestroy(() => this.dispose());
        // Rebuild when another plan or model is passed in (e.g. a new model version).
        effect(() => {
            this.plan();
            this.model();
            untracked(() => {
                if (this.scene) void this.showDefault();
            });
        });
    }

    private async init() {
        try {
            const [three, { OrbitControls }] = await Promise.all([import('three'), import('three/examples/jsm/controls/OrbitControls.js')]);
            if (this.destroyed) return;
            this.three = three;

            const canvas = this.canvas().nativeElement;
            this.renderer = new three.WebGLRenderer({ canvas, antialias: true, alpha: true });
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = three.PCFSoftShadowMap;

            this.scene = new three.Scene();
            this.camera = new three.PerspectiveCamera(40, 1, 0.1, 1000);

            this.scene.add(new three.HemisphereLight(0xffffff, 0xb0b8c0, 1.6));
            const sun = new three.DirectionalLight(0xffffff, 2.2);
            sun.position.set(18, 28, 14);
            sun.castShadow = true;
            sun.shadow.mapSize.set(2048, 2048);
            Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 });
            sun.shadow.camera.updateProjectionMatrix();
            this.scene.add(sun);

            this.ground = new three.Mesh(new three.CircleGeometry(40, 64), new three.MeshStandardMaterial({ color: 0xd9e4cf, roughness: 1 }));
            this.ground.rotation.x = -Math.PI / 2;
            this.ground.receiveShadow = true;
            this.scene.add(this.ground);
            // เส้นและหมุดวัดระยะ (ไม่ถูกลบตอนเปลี่ยนโมเดล ใช้ clearMeasurements แทน)
            this.measureGroup = new three.Group();
            this.scene.add(this.measureGroup);

            this.controls = new OrbitControls(this.camera, canvas);
            this.controls.enableDamping = true;
            this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
            this.controls.listenToKeyEvents(canvas);
            this.controls.addEventListener('change', () => this.requestRender());

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container().nativeElement);
            document.addEventListener('fullscreenchange', this.onFullscreenChange);
            this.resize();

            await this.showDefault();
        } catch {
            this.error.set('ไม่สามารถแสดงผล 3 มิติได้ เบราว์เซอร์อาจไม่รองรับ WebGL');
            this.loading.set(false);
        }
    }

    /** แบบ 3 มิติของโครงการ → ไฟล์โมเดลของแบบบ้าน → โมเดลจำลองจากแปลน → ว่าง */
    async showDefault() {
        if (!this.three) return;
        const token = ++this.loadToken;
        this.error.set('');
        const plan = this.plan();
        const file: ModelFile | null = this.model() ?? (plan?.modelUrl ? { url: plan.modelUrl, name: plan.name, format: modelFormatOf(plan.modelUrl) ?? 'glb', upAxis: 'y' } : null);
        if (!file) {
            this.showSample();
            return;
        }
        this.loading.set(true);
        try {
            const object = await this.loadModel(file.format, await this.fetchModel(file.url, file.format));
            if (this.destroyed || token !== this.loadToken) return;
            this.setModel(object, 'model', file.name, file.upAxis === 'z');
        } catch {
            if (token !== this.loadToken) return;
            this.error.set(`โหลดแบบ 3 มิติ "${file.name}" ไม่สำเร็จ${plan ? ' แสดงโมเดลจำลองจากแปลนแทน' : ''} — ตรวจสอบว่าส่งออกไฟล์ถูกต้อง (.gltf ต้องเป็นไฟล์เดียว)`);
            this.showSample();
        } finally {
            if (token === this.loadToken) this.loading.set(false);
        }
    }

    showSample() {
        if (!this.three) return;
        const plan = this.plan();
        if (!plan) {
            this.clearModel();
            this.source.set('none');
            this.loading.set(false);
            this.requestRender();
            return;
        }
        this.viewOptions.set([{ value: 'exterior', label: 'ภายนอก' }, ...plan.floors.map((floor, index) => ({ value: index as ModelView, label: floor.label }))]);
        this.view.set('exterior');
        this.setModel(this.buildHouse(plan), 'sample', '');
        this.loading.set(false);
    }

    async onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = '';
        if (!file || !this.three) return;
        const format = modelFormatOf(file.name);
        if (!format) {
            this.error.set(`เปิด "${file.name}" ในเบราว์เซอร์ไม่ได้ — ไฟล์ .skp / .rvt ต้องส่งออกเป็น .glb .dae .fbx หรือ .obj ก่อน`);
            return;
        }

        const token = ++this.loadToken;
        this.loading.set(true);
        this.error.set('');
        try {
            const data = isTextFormat(format) ? await file.text() : await file.arrayBuffer();
            const object = await this.loadModel(format, data);
            if (token === this.loadToken) this.setModel(object, 'local', file.name);
        } catch {
            this.error.set(format === 'gltf' ? 'เปิดไฟล์ไม่สำเร็จ ไฟล์ .gltf ที่แยกไฟล์ภาพ/ข้อมูลไว้ต่างหากยังไม่รองรับ กรุณาส่งออกเป็น .glb' : `เปิดไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .${format} ที่ถูกต้อง`);
        } finally {
            if (token === this.loadToken) this.loading.set(false);
        }
    }

    /** หมุนโมเดลที่ใช้แกน Z เป็นแกนตั้ง (เช่น OBJ ที่ไม่ได้สลับแกนตอนส่งออก) ให้ตั้งขึ้น */
    flipUpAxis() {
        if (!this.model3d || this.source() === 'sample') return;
        this.flipped.update((value) => !value);
        this.model3d.rotation.x = this.flipped() ? -Math.PI / 2 : 0;
        this.frameModel(this.model3d);
    }

    // ---------- ส่วนประกอบของไฟล์ IFC: กรองตาม งาน / หมวด / ชั้น / ระบบ ----------
    readonly dimensions: Array<{ value: IfcDimension; label: string }> = [
        { value: 'discipline', label: 'งาน' },
        { value: 'category', label: 'หมวด' },
        { value: 'storey', label: 'ชั้น' },
        { value: 'system', label: 'ระบบ' }
    ];
    readonly ifcMode = signal(false);
    readonly ifcDimension = signal<IfcDimension>('discipline');
    /** ค่าที่ปิดอยู่ของแต่ละมิติ (หมวดใช้ key "งาน|หมวด") */
    readonly ifcDisabled = signal<Record<IfcDimension, Set<string>>>(emptyFilters());
    private ifcNodes: IfcNode[] = [];
    private ifcStoreys: string[] = [];
    readonly dimensionLabel = computed(() => this.dimensions.find((dim) => dim.value === this.ifcDimension())!.label);
    readonly totalDisabled = computed(() => Object.values(this.ifcDisabled()).reduce((sum, set) => sum + set.size, 0));

    disabledCount(dimension: IfcDimension) {
        return this.ifcDisabled()[dimension].size;
    }

    /** แถวของแท็บที่เลือก: ค่า + จำนวนชิ้นงาน (หมวดจัดกลุ่มใต้หัวข้องาน, ชั้นเรียงตามระดับ) */
    readonly ifcRows = computed((): Array<{ key: string; label: string; elements: number; enabled: boolean; header?: boolean }> => {
        const dimension = this.ifcDimension();
        const disabled = this.ifcDisabled()[dimension];
        const q = this.partQuery().trim().toLowerCase();
        const counts = new Map<string, number>();
        for (const node of this.ifcNodes) counts.set(ifcKey(node, dimension), (counts.get(ifcKey(node, dimension)) ?? 0) + node.elements);
        let keys = [...counts.keys()];
        if (dimension === 'storey') keys.sort((a, b) => (this.ifcStoreys.indexOf(a) + 1 || 999) - (this.ifcStoreys.indexOf(b) + 1 || 999));
        else keys.sort((a, b) => a.localeCompare(b, 'th'));
        if (q) keys = keys.filter((key) => key.toLowerCase().includes(q));
        const row = (key: string) => ({ key, label: dimension === 'category' ? key.split('|')[1]! : key, elements: counts.get(key)!, enabled: !disabled.has(key) });
        if (dimension !== 'category') return keys.map(row);
        // หมวด: หัวข้อตามงาน
        const rows: Array<{ key: string; label: string; elements: number; enabled: boolean; header?: boolean }> = [];
        let current = '';
        for (const key of keys) {
            const discipline = key.split('|')[0]!;
            if (discipline !== current) rows.push({ key: `#${discipline}`, label: discipline, elements: 0, enabled: true, header: true });
            current = discipline;
            rows.push(row(key));
        }
        return rows;
    });

    toggleValue(key: string) {
        const dimension = this.ifcDimension();
        this.ifcDisabled.update((filters) => {
            const next = new Set(filters[dimension]);
            if (!next.delete(key)) next.add(key);
            return { ...filters, [dimension]: next };
        });
        this.applyIfcFilters();
    }

    /** ดูเฉพาะค่านี้ในแท็บปัจจุบัน (แท็บอื่นคงเดิม) */
    soloValue(key: string) {
        const dimension = this.ifcDimension();
        const all = new Set(this.ifcNodes.map((node) => ifcKey(node, dimension)));
        all.delete(key);
        this.ifcDisabled.update((filters) => ({ ...filters, [dimension]: all }));
        this.applyIfcFilters();
    }

    setDimensionAll(visible: boolean) {
        const dimension = this.ifcDimension();
        this.ifcDisabled.update((filters) => ({ ...filters, [dimension]: visible ? new Set() : new Set(this.ifcNodes.map((node) => ifcKey(node, dimension))) }));
        this.applyIfcFilters();
    }

    resetIfc() {
        this.ifcDisabled.set(emptyFilters());
        this.applyIfcFilters();
    }

    private applyIfcFilters() {
        const filters = this.ifcDisabled();
        for (const node of this.ifcNodes) node.object.visible = this.dimensions.every(({ value }) => !filters[value].has(ifcKey(node, value)));
        this.requestRender();
    }

    /**
     * ส่วนประกอบของโมเดล 2 ระดับ: ข้ามชั้นที่มีลูกเดียวลงไป แล้วใช้ลูกเป็นหมวด และลูกของหมวดเป็นส่วนย่อย
     * ไฟล์ที่แปลงจาก .skp: หมวด = tag ชั้นนอก ส่วนย่อย = tag (ชื่อจริงและค่าเปิด/ปิดตั้งต้นอยู่ใน userData)
     */
    private buildParts(object: T.Object3D) {
        this.partObjects = new Map();
        let root = object;
        while (root.children.length === 1 && !root.userData['kind'] && !root.userData['source']) root = root.children[0]!;
        // ไฟล์ที่แปลงจาก IFC: กรองหลายมิติแทนรายการ 2 ระดับ
        this.ifcMode.set(root.userData['source'] === 'ifc');
        this.ifcNodes = [];
        this.ifcDisabled.set(emptyFilters());
        if (this.ifcMode()) {
            this.ifcStoreys = (root.userData['storeys'] as string[] | undefined) ?? [];
            this.ifcNodes = root.children.map((child) => ({
                object: child,
                discipline: String(child.userData['discipline'] ?? 'อื่น ๆ'),
                category: String(child.userData['category'] ?? child.name),
                storey: String(child.userData['storey'] ?? ''),
                system: String(child.userData['system'] ?? ''),
                elements: Number(child.userData['elements'] ?? 1)
            }));
            this.parts.set([]);
            this.ifcDimension.set('discipline');
            this.partQuery.set('');
            return;
        }
        const nameOf = (node: T.Object3D, fallback: string) => String(node.userData['name'] ?? (node.name || fallback));
        const groups: PartGroup[] = root.children.map((category, i) => {
            const id = `g${i}`;
            this.partObjects.set(id, category);
            // ส่วนย่อย: ลูกที่มีชื่อ (ไฟล์ทั่วไปอาจมีลูกเป็น mesh ไม่มีชื่อ ไม่ต้องแสดง)
            const named = category.children.filter((child) => child.userData['name'] || child.name);
            const hiddenCategory = category.userData['visible'] === false;
            const children = named.length > 1 || category.userData['kind'] ? named.map((child, j) => {
                const childId = `${id}.${j}`;
                this.partObjects.set(childId, child);
                // ปิดทั้งหมวด = ปิดทุกส่วนย่อย (หมวดเปิดไว้เสมอ ใช้ส่วนย่อยคุมการมองเห็น)
                child.visible = !hiddenCategory && child.userData['visible'] !== false;
                return { id: childId, name: nameOf(child, `ส่วนที่ ${j + 1}`), visible: child.visible };
            }) : [];
            if (children.length) category.visible = true;
            else category.visible = !hiddenCategory;
            return { id, name: nameOf(category, `ส่วนที่ ${i + 1}`), children, state: 'all' as PartState };
        });
        this.parts.set(groups.map((group) => this.withState(group)));
        this.expandedParts.set(new Set());
        this.partQuery.set('');
    }

    private withState(group: PartGroup): PartGroup {
        const visible = group.children.length ? group.children.filter((part) => part.visible).length : this.partObjects.get(group.id)!.visible ? 1 : 0;
        const total = Math.max(1, group.children.length);
        return { ...group, state: visible === total ? 'all' : visible ? 'some' : 'none' };
    }

    /** ตั้งค่าการมองเห็นจาก object จริงแล้วอัปเดตรายการ */
    private syncParts() {
        this.parts.update((groups) => groups.map((group) => this.withState({ ...group, children: group.children.map((part) => ({ ...part, visible: this.partObjects.get(part.id)!.visible })) })));
        this.requestRender();
    }

    togglePart(id: string) {
        const object = this.partObjects.get(id);
        if (!object) return;
        object.visible = !object.visible;
        this.syncParts();
    }

    toggleGroup(id: string) {
        const group = this.parts().find((item) => item.id === id);
        if (!group) return;
        const show = group.state !== 'all';
        if (group.children.length) group.children.forEach((part) => (this.partObjects.get(part.id)!.visible = show));
        else this.partObjects.get(id)!.visible = show;
        this.syncParts();
    }

    setAll(visible: boolean) {
        for (const group of this.parts()) {
            if (group.children.length) group.children.forEach((part) => (this.partObjects.get(part.id)!.visible = visible));
            else this.partObjects.get(group.id)!.visible = visible;
        }
        this.syncParts();
    }

    /** แสดงเฉพาะส่วนที่เลือก (หมวดหรือส่วนย่อย) */
    solo(id: string) {
        this.setAll(false);
        const group = this.parts().find((item) => item.id === id);
        if (group?.children.length) group.children.forEach((part) => (this.partObjects.get(part.id)!.visible = true));
        else {
            this.partObjects.get(id)!.visible = true;
            const parent = this.parts().find((item) => item.children.some((part) => part.id === id));
            if (parent && !parent.children.length) this.partObjects.get(parent.id)!.visible = true;
        }
        this.syncParts();
    }

    toggleExpand(id: string) {
        this.expandedParts.update((set) => {
            const next = new Set(set);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    }

    setView(view: ModelView) {
        this.view.set(view);
        this.floorGroups.forEach((group, index) => (group.visible = view === 'exterior' || index <= view));
        if (this.roof) this.roof.visible = view === 'exterior';
        this.requestRender();
    }

    resetView() {
        this.controls?.reset();
    }

    toggleFullscreen() {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void this.container().nativeElement.requestFullscreen?.();
    }

    private async fetchModel(url: string, format: ModelFormat): Promise<string | ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return isTextFormat(format) ? response.text() : response.arrayBuffer();
    }

    /** แปลงข้อมูลไฟล์เป็นโมเดล three.js ตามรูปแบบไฟล์ (โหลด loader เฉพาะที่ใช้) */
    private async loadModel(format: ModelFormat, data: string | ArrayBuffer): Promise<T.Object3D> {
        switch (format) {
            case 'glb':
            case 'gltf': {
                const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
                return (await new GLTFLoader().parseAsync(data, '')).scene;
            }
            case 'dae': {
                // SketchUp ส่งออกเป็น Z_UP — ColladaLoader หมุนให้ตามข้อมูลแกนในไฟล์
                const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
                const collada = new ColladaLoader().parse(data as string, '');
                if (!collada) throw new Error('invalid collada');
                return collada.scene;
            }
            case 'fbx': {
                const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
                return new FBXLoader().parse(data as ArrayBuffer, '');
            }
            case 'obj': {
                const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
                const object = new OBJLoader().parse(data as string);
                // ไม่ได้แนบไฟล์วัสดุ (.mtl) ใช้สีผนังแทนสีเริ่มต้นของ loader
                const material = new this.three!.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9, side: this.three!.DoubleSide });
                object.traverse((child) => {
                    if ((child as T.Mesh).isMesh) (child as T.Mesh).material = material;
                });
                return object;
            }
        }
    }

    private setModel(object: T.Object3D, source: Exclude<ModelSource, 'none'>, name: string, zUp = false) {
        this.clearModel();
        if (source !== 'sample') {
            this.floorGroups = [];
            this.roof = undefined;
            // โมเดลรายละเอียดสูง (เช่น แปลงจาก .skp หลายล้านสามเหลี่ยม) ไม่ทำเงา ให้หมุนดูได้ลื่น
            let triangles = 0;
            object.traverse((child) => {
                const mesh = child as T.Mesh;
                if (mesh.isMesh) triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes['position']?.count ?? 0) / 3;
            });
            const shadows = triangles < 1_000_000;
            object.traverse((child) => {
                if ((child as T.Mesh).isMesh) child.castShadow = child.receiveShadow = shadows;
            });
            if (zUp) object.rotation.x = -Math.PI / 2;
        }
        this.model3d = object;
        this.scene!.add(object);
        this.source.set(source);
        this.fileName.set(name);
        this.flipped.set(zUp);
        // คำนวณกรอบมุมกล้องจากทุกส่วน (รวมส่วนที่ซ่อนตั้งต้น) ก่อนตั้งค่าการมองเห็น
        this.frameModel(object);
        if (source === 'sample') {
            this.parts.set([]);
            this.partsOpen.set(false);
        } else {
            this.buildParts(object);
            this.requestRender();
        }
    }

    /** วางโมเดลบนพื้นแล้วมองจากมุมหน้าขวา — ใช้ได้กับทุกหน่วย (เช่น FBX จาก Revit ที่เป็นเซนติเมตร) */
    private frameModel(object: T.Object3D) {
        const three = this.three!;
        object.updateMatrixWorld(true);
        const box = new three.Box3().setFromObject(object);
        const sphere = box.getBoundingSphere(new three.Sphere());
        const size = box.getSize(new three.Vector3());
        // กว้าง (X) × ลึก (Z) × สูง (Y — แกนตั้งของฉาก)
        this.modelSize.set([size.x, size.z, size.y]);
        // ขนาดหมุดวัดตามขนาดโมเดล (เห็นชัดทั้งบ้านหลังเล็กและอาคารใหญ่)
        this.markerRadius = Math.max(sphere.radius * 0.006, 1e-4);
        const camera = this.camera!;
        const distance = (sphere.radius / Math.sin(three.MathUtils.degToRad(camera.fov / 2))) * 1.05;
        this.ground!.position.y = box.min.y;
        this.ground!.scale.setScalar(Math.max(1, sphere.radius / 15));
        camera.near = distance / 100;
        camera.far = distance * 100;
        camera.position.copy(sphere.center).addScaledVector(new three.Vector3(0.9, 0.75, 1.3).normalize(), distance);
        camera.updateProjectionMatrix();
        this.controls!.target.copy(sphere.center);
        this.controls!.update();
        this.controls!.saveState();
        this.requestRender();
    }

    private buildHouse(plan: HousePlan): T.Group {
        const three = this.three!;
        const house = new three.Group();
        const halfW = plan.width / 2;
        const halfD = plan.depth / 2;
        const height = plan.floorHeight;

        const wallMaterial = new three.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 });
        const glassMaterial = new three.MeshPhysicalMaterial({ color: 0x9ec5e8, transparent: true, opacity: 0.35, roughness: 0.1 });
        const slabMaterials = new Map<RoomKind, T.MeshStandardMaterial>();
        const slabMaterial = (kind: RoomKind) => {
            if (!slabMaterials.has(kind)) slabMaterials.set(kind, new three.MeshStandardMaterial({ color: SLAB_COLOR[kind], roughness: 0.8 }));
            return slabMaterials.get(kind)!;
        };
        const box = (w: number, h: number, d: number, material: T.Material, x: number, y: number, z: number) => {
            const mesh = new three.Mesh(new three.BoxGeometry(w, h, d), material);
            mesh.position.set(x, y, z);
            mesh.castShadow = mesh.receiveShadow = true;
            return mesh;
        };

        this.floorGroups = plan.floors.map((floor, index) => {
            const group = new three.Group();
            const baseY = index * height;
            const wallHeight = height - SLAB;
            const wallY = baseY + SLAB + wallHeight / 2;
            const builtEdges = new Set<string>();

            for (const room of floor.rooms) {
                if (room.kind !== 'void') {
                    group.add(box(room.w, SLAB, room.h, slabMaterial(room.kind), room.x + room.w / 2 - halfW, baseY + SLAB / 2, room.y + room.h / 2 - halfD));
                }
                if (room.kind === 'stair' && index < plan.floors.length - 1) group.add(this.buildStair(room, baseY, height, halfW, halfD, slabMaterial('stair')));

                for (const [x1, y1, x2, y2] of roomEdges(room)) {
                    const key = [x1, y1, x2, y2].map((value) => value.toFixed(2)).join(',');
                    const horizontal = y1 === y2;
                    const exterior = horizontal ? y1 === 0 || y1 === plan.depth : x1 === 0 || x1 === plan.width;
                    const isFront = horizontal && y1 === plan.depth;
                    if (builtEdges.has(key)) continue;
                    if (room.kind === 'void' && !exterior) continue; // open to the floor below
                    if (room.kind === 'garage' && isFront) continue; // garage door opening

                    const material = isFront && (room.kind === 'living' || room.kind === 'void') ? glassMaterial : wallMaterial;
                    const length = horizontal ? x2 - x1 : y2 - y1;
                    group.add(horizontal ? box(length + WALL, wallHeight, WALL, material, (x1 + x2) / 2 - halfW, wallY, y1 - halfD) : box(WALL, wallHeight, length + WALL, material, x1 - halfW, wallY, (y1 + y2) / 2 - halfD));
                    builtEdges.add(key);
                }
            }
            house.add(group);
            return group;
        });

        // Gable roof with the ridge running left-right.
        const overhang = 0.6;
        const rise = plan.depth * 0.28;
        const profile = new three.Shape([new three.Vector2(-halfD - overhang, 0), new three.Vector2(halfD + overhang, 0), new three.Vector2(0, rise)]);
        const roof = new three.Mesh(new three.ExtrudeGeometry(profile, { depth: plan.width + overhang * 2, bevelEnabled: false }), new three.MeshStandardMaterial({ color: 0x3f4650, roughness: 0.7 }));
        roof.rotation.y = Math.PI / 2;
        roof.position.set(-halfW - overhang, plan.floors.length * height, 0);
        roof.castShadow = true;
        house.add(roof);
        this.roof = roof;

        return house;
    }

    private buildStair(room: PlanRoom, baseY: number, height: number, halfW: number, halfD: number, material: T.Material): T.Group {
        const three = this.three!;
        const stair = new three.Group();
        const alongWidth = room.w >= room.h;
        const run = alongWidth ? room.w : room.h;
        const steps = Math.ceil(height / STEP_HEIGHT);
        const tread = run / steps;
        for (let i = 0; i < steps; i++) {
            const stepTop = (i + 1) * STEP_HEIGHT;
            const offset = i * tread + tread / 2;
            const geometry = alongWidth ? new three.BoxGeometry(tread, stepTop, room.h * 0.5) : new three.BoxGeometry(room.w * 0.5, stepTop, tread);
            const mesh = new three.Mesh(geometry, material);
            mesh.position.set(alongWidth ? room.x + offset - halfW : room.x + room.w * 0.25 - halfW, baseY + SLAB + stepTop / 2, alongWidth ? room.y + room.h * 0.25 - halfD : room.y + offset - halfD);
            mesh.castShadow = mesh.receiveShadow = true;
            stair.add(mesh);
        }
        return stair;
    }

    private requestRender() {
        if (this.frame || !this.renderer) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            // update() returns true while damping is still moving the camera.
            const moving = this.controls?.update() ?? false;
            this.renderer?.render(this.scene!, this.camera!);
            if (this.measurements().length) this.updateMeasureLabels();
            if (moving) this.requestRender();
        });
    }

    private resize() {
        const element = this.container().nativeElement;
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (!this.renderer || !this.camera || !width || !height) return;
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.requestRender();
    }

    private clearModel() {
        this.selection.set(null);
        this.removeHighlight();
        this.clearMeasurements();
        if (!this.model3d) return;
        this.scene?.remove(this.model3d);
        disposeObject(this.model3d);
        this.model3d = undefined;
    }

    private dispose() {
        this.destroyed = true;
        cancelAnimationFrame(this.frame);
        this.resizeObserver?.disconnect();
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        this.controls?.dispose();
        this.clearModel();
        if (this.ground) disposeObject(this.ground);
        this.renderer?.dispose();
    }
}

function roomEdges(room: PlanRoom): Array<[number, number, number, number]> {
    const { x, y, w, h } = room;
    return [
        [x, y, x + w, y],
        [x, y + h, x + w, y + h],
        [x, y, x, y + h],
        [x + w, y, x + w, y + h]
    ];
}

function disposeObject(object: T.Object3D) {
    object.traverse((child) => {
        const mesh = child as T.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            for (const value of Object.values(material)) {
                if (value && typeof value === 'object' && 'isTexture' in value) (value as T.Texture).dispose();
            }
            material.dispose();
        }
    });
}
