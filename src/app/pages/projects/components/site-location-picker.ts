import { Component, OnInit, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SiteLocationInput, mapEmbedUrl, mapSearchUrl, parseCoordinates } from '@/app/pages/service/project.service';

let nextId = 0;

/** ขอบเขตประเทศไทยโดยประมาณ — ใช้เตือนเมื่อพิมพ์สลับละติจูด/ลองจิจูด */
const inThailand = (point: SiteLocationInput) => point.lat >= 5 && point.lat <= 21 && point.lng >= 97 && point.lng <= 106;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * เลือกพิกัดหน้างาน: กรอกละติจูด/ลองจิจูด · วางลิงก์ Google Maps · ใช้ตำแหน่งปัจจุบัน
 * แสดงแผนที่ตัวอย่างให้ตรวจหมุด — ค่า [(value)] เป็น null จนกว่าพิกัดจะถูกต้องครบ
 */
@Component({
    selector: 'app-site-location-picker',
    standalone: true,
    imports: [ButtonModule, FormsModule, InputTextModule],
    template: `
        <div class="grid grid-cols-2 gap-3">
            <div>
                <label [for]="id + '-lat'" class="block text-sm font-semibold mb-1">ละติจูด (Latitude)</label>
                <input pInputText [id]="id + '-lat'" inputmode="decimal" autocomplete="off" class="w-full" placeholder="เช่น 19.910512" [disabled]="disabled()" [ngModel]="lat()" [ngModelOptions]="{ standalone: true }" (ngModelChange)="setLat($event)" [attr.aria-invalid]="!!latError()" />
                @if (latError()) {
                    <small class="text-red-600 dark:text-red-400">{{ latError() }}</small>
                }
            </div>
            <div>
                <label [for]="id + '-lng'" class="block text-sm font-semibold mb-1">ลองจิจูด (Longitude)</label>
                <input pInputText [id]="id + '-lng'" inputmode="decimal" autocomplete="off" class="w-full" placeholder="เช่น 99.840612" [disabled]="disabled()" [ngModel]="lng()" [ngModelOptions]="{ standalone: true }" (ngModelChange)="setLng($event)" [attr.aria-invalid]="!!lngError()" />
                @if (lngError()) {
                    <small class="text-red-600 dark:text-red-400">{{ lngError() }}</small>
                }
            </div>
        </div>
        @if (!latError() && !lngError() && invalid()) {
            <small class="block mt-1 text-red-600 dark:text-red-400">กรอกให้ครบทั้งละติจูดและลองจิจูด หรือเว้นว่างทั้งสองช่อง</small>
        }

        @if (!disabled()) {
            <label [for]="id + '-link'" class="block text-sm font-semibold mt-3 mb-1">หรือวางลิงก์ Google Maps / พิกัดที่คัดลอกมา</label>
            <div class="flex flex-wrap gap-2">
                <input pInputText [id]="id + '-link'" class="flex-1 min-w-48" placeholder="https://www.google.com/maps/... หรือ 19.9105, 99.8406" [ngModel]="link()" [ngModelOptions]="{ standalone: true }" (ngModelChange)="pasteLink($event)" [attr.aria-invalid]="!!linkError()" [attr.aria-describedby]="id + '-link-help'" />
                <button pButton type="button" [outlined]="true" icon="pi pi-compass" label="ตำแหน่งปัจจุบัน" [loading]="locating()" (click)="useCurrentPosition()"></button>
            </div>
            <small [id]="id + '-link-help'" class="block mt-1" [class]="linkError() || geoError() ? 'text-red-600 dark:text-red-400' : 'text-muted-color'">
                {{ linkError() || geoError() || 'ระบบเติมละติจูด/ลองจิจูดให้อัตโนมัติ — ใน Google Maps กดค้างที่หน้างานแล้วคัดลอกตัวเลขพิกัดมาวางได้เลย' }}
            </small>
        }

        @if (value(); as point) {
            @if (!thailand()) {
                <p class="text-sm mt-3 mb-0 rounded-lg px-3 py-2 bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100" role="status">
                    <i class="pi pi-exclamation-triangle mr-1"></i>พิกัดนี้อยู่นอกประเทศไทย — ตรวจว่ากรอกละติจูดกับลองจิจูดสลับกันหรือไม่
                    @if (!disabled()) {
                        <button type="button" class="ml-1 bg-transparent border-0 p-0 underline cursor-pointer text-inherit" (click)="swap()">สลับให้</button>
                    }
                </p>
            }
            <div class="rounded-lg overflow-hidden border border-surface mt-3 bg-emphasis" [style.aspect-ratio]="ratio()">
                <iframe [src]="preview()" class="w-full h-full border-0 block" loading="lazy" [title]="'หมุดหน้างาน ' + point.lat + ', ' + point.lng"></iframe>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-1 text-xs text-muted-color">
                <span><i class="pi pi-map-marker text-primary mr-1"></i>หมุดอยู่ที่ {{ point.lat }}, {{ point.lng }} — ตรวจว่าตรงหน้างาน</span>
                <a [href]="openUrl()" target="_blank" rel="noopener" class="text-primary">เปิดใน Google Maps <i class="pi pi-external-link text-[0.6rem]"></i></a>
            </div>
        } @else if (!lat() && !lng()) {
            <p class="text-xs text-muted-color mt-3 mb-0"><i class="pi pi-info-circle mr-1"></i>ไม่ปักหมุดก็ได้ — แผนที่จะค้นหาจากที่ตั้งหน้างาน (ตำแหน่งโดยประมาณ)</p>
        }
    `
})
export class SiteLocationPicker implements OnInit {
    private readonly sanitizer = inject(DomSanitizer);

    /** พิกัดที่เลือก (null = ยังไม่ปักหมุด หรือกรอกไม่ครบ/ไม่ถูกต้อง) */
    readonly value = model<SiteLocationInput | null>(null);
    readonly disabled = input(false);
    /** สัดส่วนแผนที่ตัวอย่าง */
    readonly ratio = input('16 / 9');

    readonly id = `site-location-${nextId++}`;
    readonly lat = signal('');
    readonly lng = signal('');
    readonly link = signal('');
    readonly linkError = signal('');
    readonly geoError = signal('');
    readonly locating = signal(false);

    /** กรอกช่องเดียว หรือมีช่องที่ไม่ถูกต้อง — ฟอร์มที่ใช้ควรไม่ให้บันทึก */
    readonly invalid = computed(() => !!this.latError() || !!this.lngError() || !this.lat().trim() !== !this.lng().trim());
    readonly latError = computed(() => this.fieldError(this.lat(), 90, 'ละติจูด'));
    readonly lngError = computed(() => this.fieldError(this.lng(), 180, 'ลองจิจูด'));
    readonly thailand = computed(() => {
        const point = this.value();
        return !point || inThailand(point);
    });
    // URL ไปยัง maps.google.com เท่านั้น สร้างจากตัวเลขพิกัด
    readonly preview = computed(() => {
        const point = this.value();
        return point ? this.sanitizer.bypassSecurityTrustResourceUrl(mapEmbedUrl(`${point.lat},${point.lng}`, 17)) : null;
    });
    readonly openUrl = computed(() => {
        const point = this.value();
        return point ? mapSearchUrl(`${point.lat},${point.lng}`) : '';
    });

    ngOnInit() {
        const point = this.value();
        if (point) this.fill(point);
    }

    setLat(text: string) {
        // วางพิกัดทั้งคู่ลงช่องเดียว ("19.91, 99.84") → แยกให้
        const pair = parseCoordinates(text);
        if (pair && /[,\s]/.test(text.trim())) return this.fill(pair);
        this.lat.set(text);
        this.sync();
    }

    setLng(text: string) {
        this.lng.set(text);
        this.sync();
    }

    pasteLink(text: string) {
        this.link.set(text);
        this.geoError.set('');
        if (!text.trim()) return this.linkError.set('');
        const point = parseCoordinates(text);
        if (!point) {
            this.linkError.set(/goo\.gl|maps\.app/.test(text) ? 'ลิงก์ย่อ (maps.app.goo.gl) อ่านพิกัดไม่ได้ — กดค้างที่หน้างานใน Google Maps แล้วคัดลอกตัวเลขพิกัดมาวาง' : 'ไม่พบพิกัดในข้อความนี้');
            return;
        }
        this.linkError.set('');
        this.link.set('');
        this.fill(point);
    }

    swap() {
        const point = this.value();
        if (point) this.fill({ lat: point.lng, lng: point.lat });
    }

    useCurrentPosition() {
        this.geoError.set('');
        this.linkError.set('');
        if (!navigator.geolocation) return this.geoError.set('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง');
        this.locating.set(true);
        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.locating.set(false);
                this.fill({ lat: position.coords.latitude, lng: position.coords.longitude });
            },
            (error) => {
                this.locating.set(false);
                this.geoError.set(error.code === error.PERMISSION_DENIED ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เบราว์เซอร์แล้วลองใหม่' : 'ระบุตำแหน่งไม่สำเร็จ ลองใหม่อีกครั้ง');
            },
            { enableHighAccuracy: true, timeout: 15000 }
        );
    }

    /** ล้างหมุด */
    clear() {
        this.lat.set('');
        this.lng.set('');
        this.value.set(null);
    }

    private fill(point: SiteLocationInput) {
        this.lat.set(String(round6(point.lat)));
        this.lng.set(String(round6(point.lng)));
        this.sync();
    }

    private sync() {
        const lat = this.lat().trim();
        const lng = this.lng().trim();
        const valid = lat && lng && !this.latError() && !this.lngError();
        this.value.set(valid ? { lat: round6(Number(lat)), lng: round6(Number(lng)) } : null);
    }

    private fieldError(text: string, limit: number, label: string) {
        const value = text.trim();
        if (!value) return '';
        if (!/^-?\d+(\.\d+)?$/.test(value)) return `${label}ต้องเป็นตัวเลข เช่น ${limit === 90 ? '19.910512' : '99.840612'}`;
        return Math.abs(Number(value)) > limit ? `${label}ต้องอยู่ระหว่าง -${limit} ถึง ${limit}` : '';
    }
}
