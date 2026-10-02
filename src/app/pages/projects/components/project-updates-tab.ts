import { NgClass } from '@angular/common';
import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { problemMessage } from '@/app/api/api';
import { ProjectProgressService, SEVERITY_OPTIONS, WEATHER_OPTIONS } from '@/app/pages/service/project-progress.service';
import { DOCUMENT_CATEGORY_LABEL, DOCUMENT_FILE_ICON } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';

const PAGE_SIZE = 10;

/** บันทึกหน้างาน — ประวัติการอัปเดตความคืบหน้าของโครงการ ล่าสุดก่อน */
@Component({
    selector: 'app-project-updates-tab',
    standalone: true,
    imports: [ButtonModule, NgClass, ThaiDatePipe],
    template: `
        <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
            <div>
                <h2 class="text-xl font-semibold m-0">บันทึกหน้างาน</h2>
                <p class="text-muted-color mt-1 mb-0">ประวัติการอัปเดตความคืบหน้าและผลตรวจ {{ updates.value().total }} รายการ</p>
            </div>
            @if (canUpdate()) {
                <button pButton type="button" icon="pi pi-pencil" label="อัปเดตงาน" (click)="requestUpdate.emit()"></button>
            }
        </div>

        @if (updates.error(); as error) {
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดบันทึกไม่สำเร็จ: {{ errorMessage(error) }}</span>
                <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="updates.reload()"></button>
            </div>
        }

        <ol class="list-none p-0 m-0 flex flex-col gap-4">
            @for (update of updates.value().items; track update.id) {
                <li class="card m-0">
                    <div class="flex flex-wrap justify-between items-start gap-3">
                        <div class="flex items-center gap-3">
                            <span
                                class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                                [ngClass]="
                                    update.inspection
                                        ? update.inspection.result === 'passed'
                                            ? 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                                            : 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                                        : 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
                                "
                                aria-hidden="true"
                            >
                                <i class="pi" [ngClass]="update.inspection ? (update.inspection.result === 'passed' ? 'pi-verified' : 'pi-times-circle') : 'pi-pencil'"></i>
                            </span>
                            <div>
                                <div class="font-semibold">
                                    @if (update.inspection) {
                                        ผลตรวจ: {{ update.inspection.result === 'passed' ? 'ผ่าน' : 'ไม่ผ่าน' }}
                                    } @else {
                                        รายงานประจำวันที่ {{ update.reportDate | thaiDate }}
                                    }
                                </div>
                                <div class="text-sm text-muted-color">{{ update.author.name }} ({{ update.author.roleLabel }}) · บันทึกเมื่อ {{ update.createdAt | thaiDate: 'dateTime' }}</div>
                            </div>
                        </div>
                        <span class="text-sm text-muted-color"
                            >ภาพรวมหลังบันทึก <span class="font-semibold text-color">{{ update.overallProgress }}%</span></span
                        >
                    </div>

                    @if (!update.inspection) {
                        <div class="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-muted-color">
                            <span class="flex items-center gap-2"><i [class]="weather[update.weather].icon"></i>{{ weather[update.weather].label }}</span>
                            <span class="flex items-center gap-2"><i class="pi pi-users"></i>แรงงาน {{ update.workers }} คน</span>
                        </div>
                    }

                    @if (update.taskChanges.length) {
                        <ul class="list-none p-0 m-0 mt-4 flex flex-col gap-3">
                            @for (change of update.taskChanges; track change.taskCode) {
                                <li>
                                    <div class="flex justify-between gap-3 text-sm">
                                        <span class="min-w-0"
                                            ><span class="text-muted-color">ขั้นตอนที่ {{ change.phaseStep }} ·</span> {{ change.taskName }}</span
                                        >
                                        <span class="shrink-0 font-semibold tabular-nums">{{ change.from }}% → {{ change.to }}%</span>
                                    </div>
                                    <div class="relative h-2 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mt-1" aria-hidden="true">
                                        <div class="absolute inset-y-0 left-0 rounded-full bg-primary" [style.width.%]="change.from"></div>
                                        @if (change.to > change.from) {
                                            <div class="absolute inset-y-0 bg-green-500 rounded-r-full" [style.left.%]="change.from" [style.width.%]="change.to - change.from"></div>
                                        }
                                    </div>
                                </li>
                            }
                        </ul>
                    }

                    @if (update.note) {
                        <p class="mt-4 mb-0 whitespace-pre-line">{{ update.note }}</p>
                    }

                    @if (update.issues.length) {
                        <div class="flex flex-wrap gap-2 mt-4">
                            @for (issue of update.issues; track $index) {
                                <span class="inline-flex items-center gap-2 px-2 py-1 rounded-md text-sm" [ngClass]="severity[issue.severity].className">
                                    <i class="pi pi-exclamation-triangle" style="font-size: 0.75rem"></i>{{ issue.title }} <span class="text-xs opacity-80">({{ severity[issue.severity].label }})</span>
                                </span>
                            }
                        </div>
                    }

                    @if (update.documents.length) {
                        <ul class="list-none p-0 m-0 mt-4 flex flex-col gap-2" aria-label="เอกสารแนบ">
                            @for (doc of update.documents; track doc.id) {
                                <li>
                                    <a [href]="doc.downloadUrl" target="_blank" rel="noopener" class="flex items-center gap-3 p-2 rounded-lg border border-surface text-color hover:border-primary">
                                        <i class="pi" [ngClass]="fileIcon[doc.fileType]" aria-hidden="true"></i>
                                        <span class="flex-1 min-w-0 truncate">{{ doc.name }}</span>
                                        <span class="text-xs text-muted-color shrink-0">{{ categoryLabel[doc.category] }}</span>
                                        <i class="pi pi-external-link text-xs text-muted-color" aria-hidden="true"></i>
                                    </a>
                                </li>
                            }
                        </ul>
                    }

                    @if (update.photos.length) {
                        <div class="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-4">
                            @for (photo of update.photos; track photo.id) {
                                <a [href]="photo.url" target="_blank" rel="noopener" class="block aspect-square rounded-lg overflow-hidden border border-surface" [attr.aria-label]="'เปิดรูป ' + photo.name">
                                    <img [src]="photo.url" [alt]="photo.name" class="w-full h-full object-cover" loading="lazy" />
                                </a>
                            }
                        </div>
                    }
                </li>
            } @empty {
                <li class="card m-0 text-center text-muted-color py-10">
                    @if (updates.isLoading()) {
                        <i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด...
                    } @else {
                        ยังไม่มีบันทึกหน้างาน
                    }
                </li>
            }
        </ol>

        @if (hasMore()) {
            <div class="flex justify-center mt-4">
                <button pButton type="button" [outlined]="true" icon="pi pi-angle-down" label="แสดงเพิ่ม" [loading]="updates.isLoading()" (click)="pageSize.set(pageSize() + pageStep)"></button>
            </div>
        }
    `
})
export class ProjectUpdatesTab {
    private readonly progressService = inject(ProjectProgressService);

    readonly projectCode = input.required<string>();
    readonly canUpdate = input(false);
    /** เปลี่ยนค่าเพื่อให้โหลดใหม่ (หลังบันทึก) */
    readonly refreshKey = input(0);
    readonly requestUpdate = output<void>();

    readonly pageStep = PAGE_SIZE;
    readonly weather = Object.fromEntries(WEATHER_OPTIONS.map((option) => [option.value, option]));
    readonly severity = Object.fromEntries(SEVERITY_OPTIONS.map((option) => [option.value, option]));
    readonly categoryLabel = DOCUMENT_CATEGORY_LABEL;
    readonly fileIcon = DOCUMENT_FILE_ICON;

    // "Load more" grows the page; switching project resets it.
    readonly pageSize = linkedSignal({ source: this.projectCode, computation: () => PAGE_SIZE });
    readonly updates = rxResource({
        params: () => ({ code: this.projectCode(), pageSize: this.pageSize(), refresh: this.refreshKey() }),
        stream: ({ params }) => this.progressService.listUpdates(params.code, 1, params.pageSize),
        defaultValue: { items: [], total: 0, page: 1, pageSize: PAGE_SIZE }
    });
    readonly hasMore = computed(() => this.updates.value().items.length < this.updates.value().total);

    errorMessage(error: unknown) {
        return problemMessage(error);
    }
}
