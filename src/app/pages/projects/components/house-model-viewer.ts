import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type * as T from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { HousePlan, PlanRoom, RoomKind } from '@/app/pages/service/house-plan.service';

type Three = typeof import('three');
type ModelView = 'exterior' | number;

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

/**
 * ตัวดูโมเดลบ้าน 3 มิติ (three.js โหลดเมื่อเปิดใช้งานเท่านั้น)
 * - ค่าเริ่มต้น: ใช้ไฟล์ modelUrl ของแบบบ้าน ถ้าไม่มีจะสร้างโมเดลจำลองจากข้อมูลแปลน
 * - ผู้ใช้เปิดไฟล์ .glb / .gltf จากเครื่องเพื่อดูได้ (แสดงในเบราว์เซอร์ ไม่อัปโหลด)
 */
@Component({
    selector: 'app-house-model-viewer',
    standalone: true,
    template: `
        <div #container class="viewer relative w-full h-full overflow-hidden rounded-lg">
            <canvas #canvas class="block w-full h-full outline-none" tabindex="0" aria-label="โมเดลบ้าน 3 มิติ ลากเพื่อหมุน เลื่อนลูกกลิ้งเพื่อซูม"></canvas>

            <div class="absolute top-3 left-3 right-28 flex flex-wrap gap-2">
                @if (source() === 'sample') {
                    @for (option of viewOptions(); track option.value) {
                        <button type="button" class="tool" [class.tool-active]="view() === option.value" [attr.aria-pressed]="view() === option.value" (click)="setView(option.value)">{{ option.label }}</button>
                    }
                } @else {
                    <span class="tool max-w-56 truncate" [title]="fileName()"><i class="pi pi-box mr-1"></i>{{ fileName() }}</span>
                    <button type="button" class="tool" (click)="showSample()"><i class="pi pi-replay mr-1"></i>กลับโมเดลจากแปลน</button>
                }
            </div>

            <div class="absolute top-3 right-3 flex gap-2">
                <button type="button" class="tool tool-icon" aria-label="เปิดไฟล์โมเดล 3D จากเครื่อง (.glb, .gltf)" title="เปิดไฟล์ 3D (.glb, .gltf)" (click)="fileInput.click()"><i class="pi pi-upload"></i></button>
                <button type="button" class="tool tool-icon" aria-label="รีเซ็ตมุมมอง" title="รีเซ็ตมุมมอง" (click)="resetView()"><i class="pi pi-refresh"></i></button>
                <button type="button" class="tool tool-icon" [attr.aria-label]="fullscreen() ? 'ออกจากเต็มจอ' : 'เต็มจอ'" [title]="fullscreen() ? 'ออกจากเต็มจอ' : 'เต็มจอ'" (click)="toggleFullscreen()">
                    <i class="pi" [class.pi-window-maximize]="!fullscreen()" [class.pi-window-minimize]="fullscreen()"></i>
                </button>
            </div>
            <input #fileInput type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" class="hidden" (change)="onFileSelected($event)" />

            <div class="absolute bottom-3 left-3 text-xs px-2 py-1 rounded bg-surface-0/85 dark:bg-surface-900/85 text-muted-color pointer-events-none">ลากเพื่อหมุน · ลูกกลิ้งเพื่อซูม · คลิกขวาลากเพื่อเลื่อน</div>

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
    `
})
export class HouseModelViewer {
    readonly plan = input.required<HousePlan>();

    readonly loading = signal(true);
    readonly error = signal('');
    readonly source = signal<'sample' | 'file'>('sample');
    readonly fileName = signal('');
    readonly view = signal<ModelView>('exterior');
    readonly fullscreen = signal(false);
    readonly viewOptions = signal<Array<{ value: ModelView; label: string }>>([]);

    private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

    private three?: Three;
    private renderer?: T.WebGLRenderer;
    private scene?: T.Scene;
    private camera?: T.PerspectiveCamera;
    private controls?: OrbitControls;
    private ground?: T.Mesh;
    private model?: T.Object3D;
    private floorGroups: T.Group[] = [];
    private roof?: T.Object3D;
    private frame = 0;
    private resizeObserver?: ResizeObserver;
    private destroyed = false;
    private readonly onFullscreenChange = () => {
        this.fullscreen.set(document.fullscreenElement === this.container().nativeElement);
    };

    constructor() {
        afterNextRender(() => this.init());
        inject(DestroyRef).onDestroy(() => this.dispose());
        // Rebuild when another plan is passed in (e.g. navigating to a different project).
        effect(() => {
            const plan = this.plan();
            untracked(() => {
                if (this.scene) this.showDefault(plan);
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

            this.controls = new OrbitControls(this.camera, canvas);
            this.controls.enableDamping = true;
            this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
            this.controls.listenToKeyEvents(canvas);
            this.controls.addEventListener('change', () => this.requestRender());

            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.container().nativeElement);
            document.addEventListener('fullscreenchange', this.onFullscreenChange);
            this.resize();

            await this.showDefault(this.plan());
        } catch {
            this.error.set('ไม่สามารถแสดงผล 3 มิติได้ เบราว์เซอร์อาจไม่รองรับ WebGL');
            this.loading.set(false);
        }
    }

    /** ใช้ไฟล์โมเดลของแบบบ้านถ้ามี ไม่มีก็สร้างจากแปลน */
    private async showDefault(plan: HousePlan) {
        if (!plan.modelUrl) {
            this.showSample();
            return;
        }
        this.loading.set(true);
        try {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
            const gltf = await new GLTFLoader().loadAsync(plan.modelUrl);
            this.setModel(gltf.scene, 'file', plan.name);
        } catch {
            this.error.set('โหลดไฟล์โมเดลของแบบบ้านไม่สำเร็จ แสดงโมเดลจำลองจากแปลนแทน');
            this.showSample();
        } finally {
            this.loading.set(false);
        }
    }

    showSample() {
        if (!this.three) return;
        const plan = this.plan();
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

        this.loading.set(true);
        this.error.set('');
        try {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
            const buffer = await file.arrayBuffer();
            const gltf = await new GLTFLoader().parseAsync(buffer, '');
            this.setModel(gltf.scene, 'file', file.name);
        } catch {
            this.error.set(file.name.toLowerCase().endsWith('.gltf') ? 'เปิดไฟล์ไม่สำเร็จ ไฟล์ .gltf ที่แยกไฟล์ภาพ/ข้อมูลไว้ต่างหากยังไม่รองรับ กรุณาส่งออกเป็น .glb' : 'เปิดไฟล์ไม่สำเร็จ กรุณาตรวจสอบว่าเป็นไฟล์ .glb หรือ .gltf ที่ถูกต้อง');
        } finally {
            this.loading.set(false);
        }
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

    private setModel(object: T.Object3D, source: 'sample' | 'file', name: string) {
        const three = this.three!;
        this.clearModel();
        if (source === 'file') {
            this.floorGroups = [];
            this.roof = undefined;
            object.traverse((child) => {
                if ((child as T.Mesh).isMesh) child.castShadow = child.receiveShadow = true;
            });
        }
        this.model = object;
        this.scene!.add(object);
        this.source.set(source);
        this.fileName.set(name);

        // Frame the model: sit it on the ground and look at it from the front-right corner.
        const box = new three.Box3().setFromObject(object);
        const sphere = box.getBoundingSphere(new three.Sphere());
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
        if (!this.model) return;
        this.scene?.remove(this.model);
        disposeObject(this.model);
        this.model = undefined;
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
