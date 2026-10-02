import { Component, HostListener, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { problemMessage } from '@/app/api/api';
import { ProjectRecordsService, SitePhoto } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';

const PAGE_SIZE = 36;

/** ภาพถ่ายหน้างาน (GET /projects/{code}/photos) — กรองตามขั้นตอนและแบ่งหน้าที่ API */
@Component({
    selector: 'app-project-photos-tab',
    standalone: true,
    imports: [ButtonModule, DialogModule, ThaiDatePipe],
    template: `
        <div class="card">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                    <h2 class="text-xl font-semibold m-0">ภาพถ่ายหน้างาน</h2>
                    <p class="text-muted-color mt-1 mb-0">{{ photos.value().total }} ภาพ อัปเดตโดยทีมงานหน้างาน</p>
                </div>
            </div>

            @if (photos.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดภาพไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="photos.reload()"></button>
                </div>
            }

            @if (phaseOptions().length > 1) {
                <div class="flex flex-wrap gap-2 mb-6" role="group" aria-label="กรองตามขั้นตอน">
                    @for (option of phaseOptions(); track option.code) {
                        <button
                            type="button"
                            class="px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors"
                            [class]="phaseFilter() === option.code ? 'bg-primary text-primary-contrast border-primary font-semibold' : 'bg-surface-0 dark:bg-surface-900 border-surface hover:bg-emphasis'"
                            [attr.aria-pressed]="phaseFilter() === option.code"
                            (click)="phaseFilter.set(option.code)"
                        >
                            {{ option.label }} <span class="opacity-70">{{ option.count }}</span>
                        </button>
                    }
                </div>
            }

            @for (group of groups(); track group.key) {
                <h3 class="text-sm font-semibold text-muted-color mt-6 mb-3 first:mt-0">{{ group.date | thaiDate }}</h3>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    @for (photo of group.photos; track photo.id) {
                        <figure class="m-0">
                            <button
                                type="button"
                                class="block w-full aspect-[4/3] p-0 border-0 bg-emphasis cursor-pointer rounded-lg overflow-hidden focus-visible:outline-2 focus-visible:outline-primary"
                                [attr.aria-label]="'เปิดภาพ ' + photo.caption"
                                (click)="open(photo)"
                            >
                                <img [src]="photo.thumbnailUrl" [alt]="photo.caption" class="w-full h-full object-cover" loading="lazy" />
                            </button>
                            <figcaption class="text-xs mt-2 line-clamp-2">{{ photo.caption }}</figcaption>
                            <div class="text-xs text-muted-color mt-1">ขั้นตอนที่ {{ photo.phaseStep }} · {{ photo.phaseShortName }}</div>
                        </figure>
                    }
                </div>
            } @empty {
                <div class="text-center text-muted-color py-12">
                    @if (photos.isLoading()) {
                        <i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดภาพ...
                    } @else {
                        <i class="pi pi-images text-4xl mb-3"></i>
                        <p class="m-0">ยังไม่มีภาพจากหน้างาน ภาพจะแสดงเมื่อเริ่มงานก่อสร้าง</p>
                    }
                </div>
            }

            @if (items().length < photos.value().total) {
                <div class="flex justify-center mt-6">
                    <button
                        pButton
                        type="button"
                        [outlined]="true"
                        icon="pi pi-angle-down"
                        [loading]="photos.isLoading()"
                        [label]="'แสดงเพิ่ม (เหลืออีก ' + (photos.value().total - items().length) + ' ภาพ)'"
                        (click)="pageSize.set(pageSize() + pageStep)"
                    ></button>
                </div>
            }
        </div>

        <p-dialog [visible]="!!selected()" (visibleChange)="!$event && selected.set(null)" [modal]="true" [dismissableMask]="true" [draggable]="false" [style]="{ width: 'min(60rem, 95vw)' }" [header]="selected()?.caption ?? ''">
            @if (selected(); as photo) {
                <img [src]="photo.url" [alt]="photo.caption" class="block w-full max-h-[70vh] object-contain rounded-lg bg-emphasis" />
                <div class="flex flex-wrap justify-between items-center gap-3 mt-4">
                    <div>
                        <div class="font-semibold">{{ photo.date | thaiDate }}</div>
                        <div class="text-sm text-muted-color">ขั้นตอนที่ {{ photo.phaseStep }} · {{ photo.phaseShortName }}</div>
                    </div>
                    @if (selectedIndex() >= 0) {
                        <div class="flex items-center gap-2">
                            <button pButton type="button" icon="pi pi-chevron-left" [rounded]="true" [outlined]="true" aria-label="ภาพก่อนหน้า" [disabled]="selectedIndex() === 0" (click)="step(-1)"></button>
                            <span class="text-sm text-muted-color">{{ selectedIndex() + 1 }} / {{ photos.value().total }}</span>
                            <button pButton type="button" icon="pi pi-chevron-right" [rounded]="true" [outlined]="true" aria-label="ภาพถัดไป" [disabled]="selectedIndex() === items().length - 1" (click)="step(1)"></button>
                        </div>
                    }
                </div>
            }
        </p-dialog>
    `
})
export class ProjectPhotosTab {
    private readonly records = inject(ProjectRecordsService);

    readonly projectCode = input.required<string>();
    /** เปลี่ยนค่าเพื่อให้โหลดใหม่ (หลังบันทึกหน้างาน) */
    readonly refreshKey = input(0);

    readonly pageStep = PAGE_SIZE;
    readonly phaseFilter = linkedSignal<string, string>({ source: this.projectCode, computation: () => 'all' });
    // "Load more" grows the page; switching filter or project resets it.
    readonly pageSize = linkedSignal({ source: () => [this.projectCode(), this.phaseFilter()], computation: () => PAGE_SIZE });
    readonly selected = signal<SitePhoto | null>(null);

    readonly photos = rxResource({
        params: () => ({ code: this.projectCode(), phaseCode: this.phaseFilter() === 'all' ? null : this.phaseFilter(), pageSize: this.pageSize(), refresh: this.refreshKey() }),
        stream: ({ params }) => this.records.photos(params.code, { phaseCode: params.phaseCode, pageSize: params.pageSize }),
        defaultValue: { items: [], total: 0, phases: [] }
    });
    readonly items = computed(() => this.photos.value().items);
    readonly phaseOptions = computed(() => {
        const phases = this.photos.value().phases;
        const total = phases.reduce((sum, phase) => sum + phase.count, 0);
        return [{ code: 'all', label: 'ทั้งหมด', count: total }, ...phases.map((phase) => ({ code: phase.phaseCode, label: `${phase.phaseStep}. ${phase.phaseShortName}`, count: phase.count }))];
    });
    readonly groups = computed(() => {
        const groups: Array<{ key: string; date: Date; photos: SitePhoto[] }> = [];
        for (const photo of this.items()) {
            const key = photo.date.toISOString().slice(0, 10);
            const last = groups[groups.length - 1];
            if (last?.key === key) last.photos.push(photo);
            else groups.push({ key, date: photo.date, photos: [photo] });
        }
        return groups;
    });
    readonly selectedIndex = computed(() => {
        const selected = this.selected();
        return selected ? this.items().findIndex((photo) => photo.id === selected.id) : -1;
    });

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    /** เปิดภาพ (เรียกจากหน้าภาพรวมได้ แม้ภาพนั้นยังไม่อยู่ในหน้าที่โหลด) */
    open(photo: SitePhoto) {
        this.selected.set(photo);
    }

    step(offset: number) {
        const next = this.items()[this.selectedIndex() + offset];
        if (next) this.selected.set(next);
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent) {
        if (!this.selected()) return;
        if (event.key === 'ArrowLeft') this.step(-1);
        if (event.key === 'ArrowRight') this.step(1);
    }
}
