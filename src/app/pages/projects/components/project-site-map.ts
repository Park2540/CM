import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { problemMessage } from '@/app/api/api';
import { Project, ProjectService, SiteLocationInput, directionsUrl, mapDestination, mapEmbedUrl, mapSearchUrl } from '@/app/pages/service/project.service';
import { SiteLocationPicker } from './site-location-picker';
import { ThaiDatePipe } from '../thai-date.pipe';

/** แผนที่หน้างาน + ปุ่มนำทาง Google Maps + ปักหมุดพิกัด (ผู้มีสิทธิ์ project.manage) */
@Component({
    selector: 'app-project-site-map',
    standalone: true,
    imports: [ButtonModule, DialogModule, SiteLocationPicker, ThaiDatePipe],
    template: `
        <section class="card m-0" aria-labelledby="site-map-heading">
            <div class="flex items-center justify-between gap-2 mb-3">
                <h2 id="site-map-heading" class="text-lg font-semibold m-0">แผนที่หน้างาน</h2>
                @if (canManage()) {
                    <button pButton type="button" [text]="true" size="small" icon="pi pi-map-marker" [label]="project().siteCoordinates ? 'แก้ไขหมุด' : 'ปักหมุด'" (click)="openEditor()"></button>
                }
            </div>

            @if (embed(); as src) {
                <div class="rounded-lg overflow-hidden border border-surface bg-emphasis" style="aspect-ratio: 4 / 3">
                    <iframe [src]="src" class="w-full h-full border-0 block" loading="lazy" referrerpolicy="no-referrer-when-downgrade" [title]="'แผนที่หน้างาน ' + project().name"></iframe>
                </div>
                <p class="text-xs text-muted-color mt-2 mb-3">
                    @if (project().siteCoordinates; as point) {
                        <i class="pi pi-map-marker text-primary mr-1"></i>ปักหมุดแล้ว {{ point.lat }}, {{ point.lng }} · {{ point.updatedBy.name }} {{ point.updatedAt | thaiDate }}
                    } @else {
                        <i class="pi pi-info-circle mr-1"></i>ตำแหน่งโดยประมาณจากที่ตั้ง "{{ destination() }}"{{ canManage() ? ' — ปักหมุดเพื่อให้นำทางถึงหน้างานพอดี' : '' }}
                    }
                </p>
                <div class="flex flex-col gap-2">
                    <a pButton [href]="directions()" target="_blank" rel="noopener" icon="pi pi-directions" label="นำทางด้วย Google Maps" class="w-full"></a>
                    <div class="flex gap-2">
                        <a pButton [href]="openUrl()" target="_blank" rel="noopener" [outlined]="true" size="small" icon="pi pi-external-link" label="เปิดแผนที่" class="flex-1"></a>
                        <button pButton type="button" [outlined]="true" size="small" [icon]="copied() ? 'pi pi-check' : 'pi pi-copy'" [label]="copied() ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'" class="flex-1" (click)="copyLink()"></button>
                    </div>
                </div>
            } @else {
                <div class="rounded-lg border border-dashed border-surface p-6 text-center text-sm text-muted-color">
                    <i class="pi pi-map text-2xl block mb-2"></i>
                    ยังไม่มีที่ตั้งหน้างาน{{ canManage() ? ' — กด "ปักหมุด" เพื่อกำหนดตำแหน่ง' : '' }}
                </div>
            }
        </section>

        @if (editorOpen()) {
            <p-dialog [visible]="true" (visibleChange)="!$event && !saving() && editorOpen.set(false)" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(36rem, 96vw)' }" header="ปักหมุดที่ตั้งหน้างาน">
                <app-site-location-picker [(value)]="point" />
                @if (saveError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ saveError() }}</div>
                }
                <ng-template #footer>
                    @if (project().siteCoordinates) {
                        <button pButton type="button" [text]="true" severity="danger" icon="pi pi-trash" label="ลบหมุด" class="mr-auto" [disabled]="saving()" (click)="clear()"></button>
                    }
                    <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" [disabled]="saving()" (click)="editorOpen.set(false)"></button>
                    <button pButton type="button" icon="pi pi-check" label="บันทึกหมุด" [disabled]="!point() || picker()?.invalid()" [loading]="saving()" (click)="save()"></button>
                </ng-template>
            </p-dialog>
        }
    `
})
export class ProjectSiteMap {
    private readonly service = inject(ProjectService);
    private readonly sanitizer = inject(DomSanitizer);

    readonly project = input.required<Project>();
    readonly canManage = input(false);
    /** ข้อมูลโครงการหลังบันทึก/ลบหมุด */
    readonly changed = output<Project>();

    readonly destination = computed(() => mapDestination(this.project()));
    // URL สร้างจากพิกัด/ที่อยู่ที่ encode แล้ว ไปยัง maps.google.com เท่านั้น
    readonly embed = computed(() => {
        const destination = this.destination();
        return destination ? this.sanitizer.bypassSecurityTrustResourceUrl(mapEmbedUrl(destination, this.project().siteCoordinates ? 17 : 13)) : null;
    });
    readonly directions = computed(() => directionsUrl(this.destination() ?? ''));
    readonly openUrl = computed(() => mapSearchUrl(this.destination() ?? ''));
    readonly copied = signal(false);

    copyLink() {
        navigator.clipboard?.writeText(this.directions()).then(() => {
            this.copied.set(true);
            setTimeout(() => this.copied.set(false), 2000);
        });
    }

    // ---------- ปักหมุด ----------
    readonly editorOpen = signal(false);
    readonly point = signal<SiteLocationInput | null>(null);
    readonly picker = viewChild(SiteLocationPicker);
    readonly saving = signal(false);
    readonly saveError = signal('');

    openEditor() {
        const current = this.project().siteCoordinates;
        this.point.set(current ? { lat: current.lat, lng: current.lng } : null);
        this.saveError.set('');
        this.editorOpen.set(true);
    }

    save() {
        const point = this.point();
        if (!point) return;
        this.run(this.service.setSiteLocation(this.project().code, point));
    }

    clear() {
        this.run(this.service.clearSiteLocation(this.project().code));
    }

    private run(request: ReturnType<ProjectService['clearSiteLocation']>) {
        this.saving.set(true);
        this.saveError.set('');
        request.subscribe({
            next: (project) => {
                this.saving.set(false);
                this.editorOpen.set(false);
                this.changed.emit(project);
            },
            error: (error) => {
                this.saving.set(false);
                this.saveError.set(problemMessage(error, 'บันทึกหมุดไม่สำเร็จ'));
            }
        });
    }
}
