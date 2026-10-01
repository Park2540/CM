import { Component, HostListener, computed, input, linkedSignal, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SitePhoto } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';
import { PhotoPlaceholder } from './project-ui';

const PAGE_SIZE = 36;

@Component({
    selector: 'app-project-photos-tab',
    standalone: true,
    imports: [ButtonModule, DialogModule, PhotoPlaceholder, ThaiDatePipe],
    template: `
        <div class="card">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                    <h2 class="text-xl font-semibold m-0">ภาพถ่ายหน้างาน</h2>
                    <p class="text-muted-color mt-1 mb-0">{{ filtered().length }} ภาพ อัปเดตโดยทีมงานหน้างาน</p>
                </div>
            </div>

            @if (photos().length) {
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

                @for (group of groups(); track group.key) {
                    <h3 class="text-sm font-semibold text-muted-color mt-6 mb-3 first:mt-0">{{ group.date | thaiDate }}</h3>
                    <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                        @for (photo of group.photos; track photo.id) {
                            <figure class="m-0">
                                <button
                                    type="button"
                                    class="block w-full aspect-[4/3] p-0 border-0 bg-transparent cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-primary"
                                    [attr.aria-label]="'เปิดภาพ ' + photo.caption"
                                    (click)="open(photo)"
                                >
                                    <app-photo-placeholder class="h-full" />
                                </button>
                                <figcaption class="text-xs mt-2 line-clamp-2">{{ photo.caption }}</figcaption>
                                <div class="text-xs text-muted-color mt-1">ขั้นตอนที่ {{ photo.phaseStep }} · {{ photo.phaseShortName }}</div>
                            </figure>
                        }
                    </div>
                }

                @if (visibleCount() < filtered().length) {
                    <div class="flex justify-center mt-6">
                        <button pButton type="button" [outlined]="true" icon="pi pi-angle-down" [label]="'แสดงเพิ่ม (เหลืออีก ' + (filtered().length - visibleCount()) + ' ภาพ)'" (click)="visibleCount.set(visibleCount() + pageSize)"></button>
                    </div>
                }
            } @else {
                <div class="text-center text-muted-color py-12">
                    <i class="pi pi-images text-4xl mb-3"></i>
                    <p class="m-0">ยังไม่มีภาพจากหน้างาน ภาพจะแสดงเมื่อเริ่มงานก่อสร้าง</p>
                </div>
            }
        </div>

        <p-dialog [visible]="!!selected()" (visibleChange)="!$event && selectedIndex.set(null)" [modal]="true" [dismissableMask]="true" [draggable]="false" [style]="{ width: 'min(60rem, 95vw)' }" [header]="selected()?.caption ?? ''">
            @if (selected(); as photo) {
                <div class="aspect-video">
                    <app-photo-placeholder class="h-full" [large]="true" />
                </div>
                <div class="flex flex-wrap justify-between items-center gap-3 mt-4">
                    <div>
                        <div class="font-semibold">{{ photo.date | thaiDate }}</div>
                        <div class="text-sm text-muted-color">ขั้นตอนที่ {{ photo.phaseStep }} · {{ photo.phaseShortName }}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button pButton type="button" icon="pi pi-chevron-left" [rounded]="true" [outlined]="true" aria-label="ภาพก่อนหน้า" [disabled]="selectedIndex() === 0" (click)="step(-1)"></button>
                        <span class="text-sm text-muted-color">{{ (selectedIndex() ?? 0) + 1 }} / {{ filtered().length }}</span>
                        <button pButton type="button" icon="pi pi-chevron-right" [rounded]="true" [outlined]="true" aria-label="ภาพถัดไป" [disabled]="selectedIndex() === filtered().length - 1" (click)="step(1)"></button>
                    </div>
                </div>
            }
        </p-dialog>
    `
})
export class ProjectPhotosTab {
    readonly photos = input.required<SitePhoto[]>();

    readonly pageSize = PAGE_SIZE;
    readonly phaseFilter = signal<string>('all');
    readonly selectedIndex = signal<number | null>(null);

    readonly phaseOptions = computed(() => {
        const options = new Map<string, { code: string; label: string; count: number; step: number }>();
        for (const photo of this.photos()) {
            const option = options.get(photo.phaseCode) ?? { code: photo.phaseCode, label: `${photo.phaseStep}. ${photo.phaseShortName}`, count: 0, step: photo.phaseStep };
            option.count++;
            options.set(photo.phaseCode, option);
        }
        return [{ code: 'all', label: 'ทั้งหมด', count: this.photos().length, step: 0 }, ...[...options.values()].sort((a, b) => a.step - b.step)];
    });
    readonly filtered = computed(() => (this.phaseFilter() === 'all' ? this.photos() : this.photos().filter((photo) => photo.phaseCode === this.phaseFilter())));
    // Reset paging whenever the filter (or project) changes.
    readonly visibleCount = linkedSignal(() => {
        this.filtered();
        return PAGE_SIZE;
    });
    readonly groups = computed(() => {
        const groups: Array<{ key: string; date: Date; photos: SitePhoto[] }> = [];
        for (const photo of this.filtered().slice(0, this.visibleCount())) {
            const key = photo.date.toISOString().slice(0, 10);
            const last = groups[groups.length - 1];
            if (last?.key === key) last.photos.push(photo);
            else groups.push({ key, date: photo.date, photos: [photo] });
        }
        return groups;
    });
    readonly selected = computed(() => {
        const index = this.selectedIndex();
        return index === null ? null : (this.filtered()[index] ?? null);
    });

    open(photo: SitePhoto) {
        let index = this.filtered().indexOf(photo);
        if (index === -1) {
            this.phaseFilter.set('all');
            index = this.photos().indexOf(photo);
        }
        this.selectedIndex.set(index === -1 ? null : index);
    }

    step(offset: number) {
        const index = this.selectedIndex();
        if (index === null) return;
        this.selectedIndex.set(Math.min(this.filtered().length - 1, Math.max(0, index + offset)));
    }

    @HostListener('document:keydown', ['$event'])
    onKeydown(event: KeyboardEvent) {
        if (this.selectedIndex() === null) return;
        if (event.key === 'ArrowLeft') this.step(-1);
        if (event.key === 'ArrowRight') this.step(1);
    }
}
