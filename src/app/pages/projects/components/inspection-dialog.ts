import { NgClass } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TextareaModule } from 'primeng/textarea';
import { problemMessage } from '@/app/api/api';
import { TimelineTask } from '@/app/pages/service/project-timeline.service';
import { ProgressUpdate, ProjectProgressService, UploadedFile } from '@/app/pages/service/project-progress.service';
import { AttachedDocument, DocumentAttacher } from './document-attacher';
import { PhotoUploader } from './photo-uploader';

/** บันทึกผลตรวจจุด Hold Point (POST /projects/{code}/tasks/{taskCode}/inspection) */
@Component({
    selector: 'app-inspection-dialog',
    standalone: true,
    imports: [ButtonModule, DialogModule, DocumentAttacher, FormsModule, NgClass, PhotoUploader, TextareaModule],
    template: `
        <p-dialog [visible]="true" (visibleChange)="!$event && closed.emit()" [modal]="true" [draggable]="false" [style]="{ width: 'min(36rem, 95vw)' }" header="บันทึกผลตรวจ (Hold Point)">
            <div class="text-sm text-muted-color">{{ task().code }} · {{ task().team }}</div>
            <div class="font-semibold mt-1 mb-4">{{ task().name }}</div>
            @if (task().note) {
                <p class="text-sm rounded-lg px-3 py-2 bg-surface-100 dark:bg-surface-800 mt-0 mb-4"><i class="pi pi-info-circle mr-1"></i>{{ task().note }}</p>
            }

            <fieldset class="border-0 p-0 m-0 mb-4">
                <legend class="text-sm font-semibold mb-2">ผลการตรวจ</legend>
                <div class="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        class="flex flex-col items-center gap-1 p-4 rounded-lg border-2 cursor-pointer bg-transparent"
                        [ngClass]="result() === 'passed' ? 'border-green-500 bg-green-50 dark:bg-green-500/10' : 'border-surface'"
                        [attr.aria-pressed]="result() === 'passed'"
                        (click)="result.set('passed')"
                    >
                        <i class="pi pi-check-circle text-2xl text-green-600 dark:text-green-400"></i>
                        <span class="font-semibold">ผ่าน</span>
                        <span class="text-xs text-muted-color">เริ่มงานถัดไปได้</span>
                    </button>
                    <button
                        type="button"
                        class="flex flex-col items-center gap-1 p-4 rounded-lg border-2 cursor-pointer bg-transparent"
                        [ngClass]="result() === 'failed' ? 'border-red-500 bg-red-50 dark:bg-red-500/10' : 'border-surface'"
                        [attr.aria-pressed]="result() === 'failed'"
                        (click)="result.set('failed')"
                    >
                        <i class="pi pi-times-circle text-2xl text-red-600 dark:text-red-400"></i>
                        <span class="font-semibold">ไม่ผ่าน</span>
                        <span class="text-xs text-muted-color">ต้องแก้ไขแล้วตรวจใหม่</span>
                    </button>
                </div>
            </fieldset>

            <label for="inspection-note" class="block text-sm font-semibold mb-2">บันทึกผลตรวจ {{ result() === 'failed' ? '(ระบุสิ่งที่ต้องแก้ไข)' : '(ถ้ามี)' }}</label>
            <textarea pTextarea id="inspection-note" rows="3" class="w-full" [ngModel]="note()" (ngModelChange)="note.set($event); error.set('')" [attr.aria-invalid]="!!error()"></textarea>

            <div class="text-sm font-semibold mt-4 mb-2">รูปประกอบการตรวจ</div>
            <app-photo-uploader [(photos)]="photos" [(uploading)]="uploading" />

            <div class="text-sm font-semibold mt-4 mb-2">รายงานผลตรวจ / ผลทดสอบ</div>
            <app-document-attacher [(documents)]="documents" [(uploading)]="documentsUploading" defaultCategory="inspection" />

            @if (error()) {
                <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ error() }}</div>
            }

            <ng-template #footer>
                <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="closed.emit()"></button>
                <button pButton type="button" icon="pi pi-check" label="บันทึกผลตรวจ" [loading]="saving()" [disabled]="!result() || uploading() > 0 || documentsUploading() > 0" (click)="submit()"></button>
            </ng-template>
        </p-dialog>
    `
})
export class InspectionDialog {
    private readonly progressService = inject(ProjectProgressService);

    readonly projectCode = input.required<string>();
    readonly task = input.required<TimelineTask>();
    readonly saved = output<ProgressUpdate>();
    readonly closed = output<void>();

    readonly result = signal<'passed' | 'failed' | null>(null);
    readonly note = signal('');
    readonly photos = signal<UploadedFile[]>([]);
    readonly uploading = signal(0);
    readonly documents = signal<AttachedDocument[]>([]);
    readonly documentsUploading = signal(0);
    readonly saving = signal(false);
    readonly error = signal('');

    submit() {
        const result = this.result();
        const note = this.note().trim();
        if (!result) return;
        if (result === 'failed' && !note) {
            this.error.set('กรุณาระบุสิ่งที่ต้องแก้ไข');
            return;
        }
        this.saving.set(true);
        this.progressService
            .recordInspection(this.projectCode(), this.task().code, {
                result,
                note: note || undefined,
                photoIds: this.photos().map((photo) => photo.id),
                documents: this.documents().map((doc) => ({ fileId: doc.file.id, category: doc.category ?? 'inspection', name: doc.name.trim() || undefined }))
            })
            .subscribe({
                next: (update) => {
                    this.saving.set(false);
                    this.saved.emit(update);
                },
                error: (error) => {
                    this.saving.set(false);
                    this.error.set(problemMessage(error, 'บันทึกไม่สำเร็จ'));
                }
            });
    }
}
