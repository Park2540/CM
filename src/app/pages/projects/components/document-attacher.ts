import { NgClass } from '@angular/common';
import { Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL, DocumentCategory } from '@/app/pages/service/project-records.service';

export interface AttachedDocument {
    file: UploadedFile;
    category: DocumentCategory | null;
    name: string;
}

const MAX_FILES = 10;
const ACCEPT = '.pdf,.xlsx,.xls,.docx,.doc,.dwg,image/jpeg,image/png,image/webp';

/** แนบเอกสาร: อัปโหลดทันที (POST /uploads) แล้วให้เลือกหมวดและตั้งชื่อ ผลลัพธ์อยู่ใน [(documents)] */
@Component({
    selector: 'app-document-attacher',
    standalone: true,
    imports: [ButtonModule, FormsModule, InputTextModule, NgClass, SelectModule],
    template: `
        <ul class="list-none p-0 m-0 flex flex-col gap-2">
            @for (doc of documents(); track doc.file.id; let i = $index) {
                <li class="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2 rounded-lg border" [ngClass]="showErrors() && !doc.category ? 'border-red-400' : 'border-surface'">
                    <i class="pi shrink-0 ml-1" [ngClass]="iconFor(doc.file)" aria-hidden="true"></i>
                    <input pInputText class="flex-1 min-w-0" [ngModel]="doc.name" (ngModelChange)="update(i, { name: $event })" [name]="'doc-name-' + doc.file.id" [placeholder]="doc.file.name" [attr.aria-label]="'ชื่อเอกสาร ' + doc.file.name" />
                    <p-select
                        [options]="categoryOptions"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="เลือกหมวด"
                        [ngModel]="doc.category"
                        (ngModelChange)="update(i, { category: $event })"
                        [name]="'doc-category-' + doc.file.id"
                        class="w-48"
                        [invalid]="showErrors() && !doc.category"
                        [ariaLabel]="'หมวดเอกสาร ' + doc.file.name"
                    />
                    <button pButton type="button" icon="pi pi-trash" [text]="true" [rounded]="true" severity="secondary" [attr.aria-label]="'นำออก ' + doc.file.name" (click)="remove(i)"></button>
                </li>
            }
            @for (i of pendingSlots(); track $index) {
                <li class="flex items-center gap-2 p-3 rounded-lg border border-dashed border-surface text-sm text-muted-color"><i class="pi pi-spin pi-spinner"></i>กำลังอัปโหลด...</li>
            }
        </ul>
        @if (documents().length + uploading() < maxFiles) {
            <label
                class="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg border border-dashed border-surface cursor-pointer text-sm text-muted-color hover:border-primary hover:text-primary focus-within:outline-2 focus-within:outline-primary"
            >
                <i class="pi pi-paperclip"></i>
                แนบเอกสาร (PDF, Excel, Word, DWG, รูป)
                <input type="file" [accept]="accept" multiple class="sr-only" (change)="onSelect($event)" />
            </label>
        }
        @for (error of errors(); track $index) {
            <small class="block text-red-600 dark:text-red-400 mt-1" role="alert">{{ error }}</small>
        }
    `
})
export class DocumentAttacher {
    private readonly files = inject(FileUploadService);

    readonly documents = model<AttachedDocument[]>([]);
    /** จำนวนไฟล์ที่กำลังอัปโหลด ให้หน้าฟอร์มรอก่อนบันทึก */
    readonly uploading = model(0);
    /** หมวดที่ตั้งให้ไฟล์ใหม่ (null = ให้ผู้ใช้เลือกเอง) */
    readonly defaultCategory = input<DocumentCategory | null>(null);
    /** ไฮไลต์เอกสารที่ยังไม่ได้เลือกหมวด (หลังกดบันทึก) */
    readonly showErrors = input(false);

    readonly accept = ACCEPT;
    readonly maxFiles = MAX_FILES;
    readonly categoryOptions = DOCUMENT_CATEGORIES.map((value) => ({ value, label: DOCUMENT_CATEGORY_LABEL[value] }));
    readonly errors = signal<string[]>([]);
    readonly pendingSlots = () => Array.from({ length: this.uploading() });

    iconFor(file: UploadedFile): string {
        if (file.contentType.startsWith('image/')) return 'pi-image text-violet-500';
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (extension === 'xlsx' || extension === 'xls') return 'pi-file-excel text-green-600';
        if (extension === 'docx' || extension === 'doc') return 'pi-file-word text-blue-600';
        if (extension === 'dwg') return 'pi-objects-column text-blue-600';
        return 'pi-file-pdf text-red-600';
    }

    onSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const selected = Array.from(input.files ?? []);
        input.value = '';
        this.errors.set([]);

        const room = MAX_FILES - this.documents().length - this.uploading();
        if (selected.length > room) this.errors.update((errors) => [...errors, `แนบได้อีก ${room} ไฟล์ (สูงสุด ${MAX_FILES} ไฟล์ต่อบันทึก)`]);

        for (const file of selected.slice(0, Math.max(0, room))) {
            this.uploading.update((count) => count + 1);
            this.files.upload(file).subscribe({
                next: (uploaded) => {
                    this.uploading.update((count) => count - 1);
                    this.documents.update((docs) => [...docs, { file: uploaded, category: this.defaultCategory(), name: uploaded.name.replace(/\.[^.]+$/, '') }]);
                },
                error: (error) => {
                    this.uploading.update((count) => count - 1);
                    this.errors.update((errors) => [...errors, `${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`]);
                }
            });
        }
    }

    update(index: number, patch: Partial<AttachedDocument>) {
        this.documents.update((docs) => docs.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)));
    }

    remove(index: number) {
        this.documents.update((docs) => docs.filter((_, i) => i !== index));
    }
}
