import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { problemMessage } from '@/app/api/api';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, DocumentCategory, DocumentFileType, ProjectRecordsService } from '@/app/pages/service/project-records.service';
import { ThaiDatePipe } from '../thai-date.pipe';

@Component({
    selector: 'app-project-documents-tab',
    standalone: true,
    imports: [ButtonModule, IconFieldModule, InputIconModule, InputTextModule, NgClass, ThaiDatePipe],
    template: `
        <div class="card">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                <div>
                    <h2 class="text-xl font-semibold m-0">เอกสารโครงการ</h2>
                    <p class="text-muted-color mt-1 mb-0">{{ documents().length }} ไฟล์</p>
                </div>
                <p-iconfield iconPosition="left" class="w-full sm:w-80">
                    <p-inputicon><i class="pi pi-search"></i></p-inputicon>
                    <input pInputText type="search" class="w-full" placeholder="ค้นหาเอกสาร" aria-label="ค้นหาเอกสาร" [value]="query()" (input)="query.set($any($event.target).value)" />
                </p-iconfield>
            </div>

            @if (documentsResource.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดเอกสารไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="documentsResource.reload()"></button>
                </div>
            }

            <div class="flex flex-wrap gap-2 mb-6" role="group" aria-label="กรองตามหมวดเอกสาร">
                @for (option of categoryOptions(); track option.value) {
                    <button
                        type="button"
                        class="px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors"
                        [class]="category() === option.value ? 'bg-primary text-primary-contrast border-primary font-semibold' : 'bg-surface-0 dark:bg-surface-900 border-surface hover:bg-emphasis'"
                        [attr.aria-pressed]="category() === option.value"
                        (click)="category.set(option.value)"
                    >
                        {{ option.label }} <span class="opacity-70">{{ option.count }}</span>
                    </button>
                }
            </div>

            @for (group of groups(); track group.category) {
                <h3 class="text-sm font-semibold text-muted-color mt-6 mb-2 first:mt-0">{{ categoryLabel[group.category] }}</h3>
                <ul class="list-none p-0 m-0 border border-surface rounded-lg">
                    @for (doc of group.documents; track doc.id) {
                        <li class="flex items-center gap-3 p-3 border-b border-surface last:border-b-0">
                            <span class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" [ngClass]="fileStyle[doc.fileType].className" aria-hidden="true">
                                <i class="pi" [ngClass]="fileStyle[doc.fileType].icon"></i>
                            </span>
                            <div class="flex-1 min-w-0">
                                <div class="font-medium truncate" [title]="doc.name">{{ doc.name }}</div>
                                <div class="text-xs text-muted-color mt-1">
                                    {{ doc.date | thaiDate }} · {{ formatSize(doc.sizeKb) }}
                                    @if (doc.uploadedBy) {
                                        <span> · แนบโดย {{ doc.uploadedBy }}</span>
                                    }
                                </div>
                            </div>
                            <a pButton [href]="doc.downloadUrl" target="_blank" rel="noopener" icon="pi pi-download" [rounded]="true" [text]="true" severity="secondary" [attr.aria-label]="'ดาวน์โหลด ' + doc.name"></a>
                        </li>
                    }
                </ul>
            } @empty {
                <div class="text-center text-muted-color py-12">
                    <i class="pi pi-folder-open text-4xl mb-3"></i>
                    @if (documentsResource.isLoading()) {
                        <p class="m-0"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลดเอกสาร...</p>
                    } @else {
                        <p class="m-0">{{ documents().length ? 'ไม่พบเอกสารที่ตรงกับการค้นหา' : 'ยังไม่มีเอกสารในโครงการนี้' }}</p>
                    }
                </div>
            }
        </div>
    `
})
export class ProjectDocumentsTab {
    private readonly records = inject(ProjectRecordsService);

    readonly projectCode = input.required<string>();
    /** เปลี่ยนค่าเพื่อให้โหลดใหม่ (หลังบันทึกหน้างาน) */
    readonly refreshKey = input(0);

    // รายการเอกสารต่อโครงการมีไม่มาก จึงโหลดทั้งหมดครั้งเดียวแล้วกรอง/นับในหน้าจอ
    readonly documentsResource = rxResource({
        params: () => ({ code: this.projectCode(), refresh: this.refreshKey() }),
        stream: ({ params }) => this.records.documents(params.code),
        defaultValue: []
    });
    readonly documents = this.documentsResource.value;
    readonly categoryLabel = DOCUMENT_CATEGORY_LABEL;

    readonly query = signal('');
    readonly category = signal<DocumentCategory | 'all'>('all');

    readonly fileStyle: Record<DocumentFileType, { icon: string; className: string }> = {
        pdf: { icon: 'pi-file-pdf', className: 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300' },
        dwg: { icon: 'pi-objects-column', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' },
        xlsx: { icon: 'pi-file-excel', className: 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-300' },
        docx: { icon: 'pi-file-word', className: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' },
        image: { icon: 'pi-image', className: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' }
    };

    readonly categoryOptions = computed(() => [
        { value: 'all' as const, label: 'ทั้งหมด', count: this.documents().length },
        ...DOCUMENT_CATEGORIES.map((value) => ({ value, label: DOCUMENT_CATEGORY_LABEL[value], count: this.documents().filter((doc) => doc.category === value).length })).filter((option) => option.count > 0)
    ]);

    readonly groups = computed(() => {
        const query = this.query().trim().toLowerCase();
        const matches = this.documents().filter((doc) => (this.category() === 'all' || doc.category === this.category()) && (!query || doc.name.toLowerCase().includes(query)));
        return DOCUMENT_CATEGORIES.map((category) => ({ category, documents: matches.filter((doc) => doc.category === category) })).filter((group) => group.documents.length);
    });

    errorMessage(error: unknown) {
        return problemMessage(error);
    }

    formatSize(sizeKb: number): string {
        return sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
    }
}
