import { Component, computed, inject, input, model, signal } from '@angular/core';
import { problemMessage } from '@/app/api/api';
import { FileUploadService, UploadedFile } from '@/app/pages/service/file-upload.service';

const MAX_FILES = 10;

/** เลือกรูปแล้วอัปโหลดทันที (POST /uploads) ผลลัพธ์อยู่ใน [(photos)] */
@Component({
    selector: 'app-photo-uploader',
    standalone: true,
    template: `
        <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
            @for (photo of photos(); track photo.id) {
                <div class="relative aspect-square rounded-lg overflow-hidden border border-surface">
                    <img [src]="photo.url" [alt]="photo.name" class="w-full h-full object-cover" />
                    <button type="button" class="absolute top-1 right-1 w-6 h-6 rounded-full border-0 bg-surface-900/70 text-white flex items-center justify-center cursor-pointer" [attr.aria-label]="'ลบรูป ' + photo.name" (click)="remove(photo)">
                        <i class="pi pi-times" style="font-size: 0.65rem"></i>
                    </button>
                </div>
            }
            @for (i of pendingSlots(); track $index) {
                <div class="aspect-square rounded-lg border border-dashed border-surface flex items-center justify-center" aria-label="กำลังอัปโหลด">
                    <i class="pi pi-spin pi-spinner text-muted-color"></i>
                </div>
            }
            @if (photos().length + uploading() < maxFiles) {
                <label
                    class="aspect-square rounded-lg border border-dashed border-surface flex flex-col items-center justify-center gap-1 cursor-pointer text-muted-color hover:border-primary hover:text-primary text-xs text-center focus-within:outline-2 focus-within:outline-primary"
                >
                    <i class="pi pi-camera text-lg"></i>
                    {{ label() }}
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" (change)="onSelect($event)" />
                </label>
            }
        </div>
        @for (error of errors(); track $index) {
            <small class="block text-red-600 dark:text-red-400 mt-1" role="alert">{{ error }}</small>
        }
    `
})
export class PhotoUploader {
    private readonly files = inject(FileUploadService);

    readonly photos = model<UploadedFile[]>([]);
    /** จำนวนไฟล์ที่กำลังอัปโหลด ให้หน้าฟอร์มรอก่อนบันทึก */
    readonly uploading = model(0);
    readonly label = input('เพิ่มรูป');

    readonly maxFiles = MAX_FILES;
    readonly errors = signal<string[]>([]);
    readonly pendingSlots = computed(() => Array.from({ length: this.uploading() }));

    onSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        input.value = '';
        this.errors.set([]);

        const room = MAX_FILES - this.photos().length - this.uploading();
        if (files.length > room) this.errors.update((errors) => [...errors, `เพิ่มได้อีก ${room} รูป (สูงสุด ${MAX_FILES} รูปต่อบันทึก)`]);

        for (const file of files.slice(0, Math.max(0, room))) {
            this.uploading.update((count) => count + 1);
            this.files.upload(file).subscribe({
                next: (uploaded) => {
                    this.uploading.update((count) => count - 1);
                    this.photos.update((photos) => [...photos, uploaded]);
                },
                error: (error) => {
                    this.uploading.update((count) => count - 1);
                    this.errors.update((errors) => [...errors, `${file.name}: ${problemMessage(error, 'อัปโหลดไม่สำเร็จ')}`]);
                }
            });
        }
    }

    remove(photo: UploadedFile) {
        this.photos.update((photos) => photos.filter((item) => item.id !== photo.id));
    }
}
