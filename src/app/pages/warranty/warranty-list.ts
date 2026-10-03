import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SkeletonModule } from 'primeng/skeleton';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';
import { Project, ProjectService, WARRANTY_EXPIRING_DAYS, WarrantyCoverage, WarrantyType, coverageState, warrantyPeriod } from '@/app/pages/service/project.service';
import { ThaiDatePipe } from '../projects/thai-date.pipe';

type WarrantyFilter = 'all' | 'covered' | 'architectural' | 'structural-only' | 'expiring' | 'expired';

interface WarrantyRow {
    project: Project;
    coverages: Partial<Record<WarrantyType, WarrantyCoverage>>;
    /** การรับประกันที่ยังมีผลและจะหมดก่อน (ไม่มี = หมดประกันทุกส่วน) */
    next?: WarrantyCoverage;
}

const FILTERS: Array<{ value: WarrantyFilter; label: string }> = [
    { value: 'all', label: 'ทั้งหมด' },
    { value: 'covered', label: 'อยู่ในประกัน' },
    { value: 'architectural', label: 'ประกันงานสถาปัตย์ยังมีผล' },
    { value: 'structural-only', label: 'เหลือเฉพาะงานโครงสร้าง' },
    { value: 'expiring', label: `ใกล้หมด (${WARRANTY_EXPIRING_DAYS} วัน)` },
    { value: 'expired', label: 'หมดประกันแล้ว' }
];

/** โครงการที่ส่งมอบแล้วและการรับประกันแยกส่วน (งานสถาปัตยกรรม / งานโครงสร้าง) — ข้อมูลจาก GET /projects?group=completed */
@Component({
    selector: 'app-warranty-list',
    standalone: true,
    imports: [ButtonModule, DecimalPipe, IconFieldModule, InputIconModule, InputTextModule, NgClass, RouterLink, SkeletonModule, ThaiDatePipe],
    template: `
        <div class="card">
            <h1 class="text-xl font-semibold m-0">โครงการที่รับประกัน</h1>
            <p class="text-muted-color mt-1 mb-5">โครงการที่ส่งมอบแล้วเข้าสู่ระยะรับประกันอัตโนมัติ นับจากวันส่งมอบ แยกเป็น 2 ส่วนตามเงื่อนไขของบริษัท</p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                @for (term of terms(); track term.type) {
                    <div class="rounded-lg border border-surface p-4 flex items-start gap-3">
                        <span class="w-10 h-10 rounded-full flex items-center justify-center shrink-0" [ngClass]="term.type === 'structural' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'">
                            <i class="pi" [ngClass]="term.type === 'structural' ? 'pi-building' : 'pi-palette'" aria-hidden="true"></i>
                        </span>
                        <div class="min-w-0">
                            <div class="font-semibold">
                                {{ term.label }} <span class="ml-1 px-2 py-0.5 rounded-full text-xs bg-emphasis">รับประกัน {{ period(term.months) }}</span>
                            </div>
                            <p class="text-sm text-muted-color mt-1 mb-0">{{ term.scope }}</p>
                        </div>
                    </div>
                } @empty {
                    <p-skeleton height="5rem" />
                    <p-skeleton height="5rem" />
                }
            </div>

            <dl class="grid grid-cols-2 xl:grid-cols-4 gap-4 m-0 mb-6">
                @for (stat of stats(); track stat.label) {
                    <div class="rounded-lg p-4 bg-emphasis">
                        <dt class="text-sm text-muted-color">{{ stat.label }}</dt>
                        <dd class="m-0 mt-1 text-2xl font-bold" [ngClass]="stat.className">{{ stat.value }}</dd>
                        <dd class="m-0 text-xs text-muted-color">{{ stat.hint }}</dd>
                    </div>
                }
            </dl>

            @if (projectsResource.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-4 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลไม่สำเร็จ: {{ errorMessage(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="projectsResource.reload()"></button>
                </div>
            }

            <div class="flex flex-wrap items-center gap-2 mb-4">
                <div class="flex flex-wrap gap-2" role="group" aria-label="สถานะการรับประกัน">
                    @for (item of filters; track item.value) {
                        <button type="button" class="filter-chip" [class.filter-chip-active]="filter() === item.value" [attr.aria-pressed]="filter() === item.value" (click)="filter.set(item.value)">
                            {{ item.label }} <span class="text-xs opacity-70">{{ countOf(item.value) }}</span>
                        </button>
                    }
                </div>
                <p-iconfield iconPosition="left" class="ml-auto w-full sm:w-auto">
                    <p-inputicon class="pi pi-search" />
                    <input pInputText type="search" class="w-full" placeholder="ค้นหารหัส ชื่อโครงการ ลูกค้า" [value]="search()" (input)="search.set($any($event.target).value)" aria-label="ค้นหาโครงการ" />
                </p-iconfield>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse" style="min-width: 56rem">
                    <thead>
                        <tr class="border-b border-surface text-sm text-muted-color">
                            <th scope="col" class="py-3 pr-3 font-semibold">โครงการ</th>
                            <th scope="col" class="py-3 pr-3 font-semibold">ส่งมอบ</th>
                            @for (term of terms(); track term.type) {
                                <th scope="col" class="py-3 pr-3 font-semibold w-64">{{ term.label }} ({{ period(term.months) }})</th>
                            }
                            <th scope="col" class="py-3 font-semibold"><span class="sr-only">เปิดโครงการ</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        @if (projectsResource.isLoading() && !rows().length) {
                            <tr>
                                <td colspan="5" class="py-8 text-center text-muted-color"><i class="pi pi-spin pi-spinner mr-2"></i>กำลังโหลด...</td>
                            </tr>
                        }
                        @for (row of visibleRows(); track row.project.code) {
                            <tr class="border-b border-surface last:border-b-0 align-top">
                                <td class="py-4 pr-3">
                                    <a [routerLink]="['/projects', row.project.code]" class="font-semibold text-primary">{{ row.project.code }}</a>
                                    <div class="text-sm">{{ row.project.name }}</div>
                                    <div class="text-xs text-muted-color">{{ row.project.customerName }} · {{ row.project.phone }}</div>
                                </td>
                                <td class="py-4 pr-3 text-sm whitespace-nowrap">{{ row.project.handedOverAt | thaiDate }}</td>
                                @for (term of terms(); track term.type) {
                                    <td class="py-4 pr-3">
                                        @if (row.coverages[term.type]; as coverage) {
                                            <div class="text-sm">ถึง {{ coverage.endDate | thaiDate }}</div>
                                            <span class="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold" [ngClass]="pillClass[state(coverage)]">
                                                @switch (state(coverage)) {
                                                    @case ('expired') {
                                                        หมดประกันแล้ว
                                                    }
                                                    @case ('expiring') {
                                                        <i class="pi pi-exclamation-circle text-[0.65rem] mr-1" aria-hidden="true"></i>ใกล้หมด เหลือ {{ coverage.daysLeft | number }} วัน
                                                    }
                                                    @default {
                                                        เหลือ {{ coverage.daysLeft | number }} วัน
                                                    }
                                                }
                                            </span>
                                            <div class="h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mt-2 max-w-48" role="img" [attr.aria-label]="'ผ่านไปแล้ว ' + elapsed(coverage) + '% ของระยะประกัน'">
                                                <div class="h-full rounded-full" [ngClass]="barClass[state(coverage)]" [style.width.%]="elapsed(coverage)"></div>
                                            </div>
                                        } @else {
                                            <span class="text-muted-color">-</span>
                                        }
                                    </td>
                                }
                                <td class="py-4 text-right">
                                    <a pButton [routerLink]="['/projects', row.project.code]" [queryParams]="{ tab: 'documents' }" [text]="true" size="small" icon="pi pi-folder-open" label="เอกสารส่งมอบ"></a>
                                </td>
                            </tr>
                        } @empty {
                            @if (!projectsResource.isLoading()) {
                                <tr>
                                    <td colspan="5" class="py-8 text-center text-muted-color">{{ rows().length ? 'ไม่พบโครงการตามตัวกรอง' : 'ยังไม่มีโครงการที่ส่งมอบ' }}</td>
                                </tr>
                            }
                        }
                    </tbody>
                </table>
            </div>
            <p class="text-xs text-muted-color mt-4 mb-0"><i class="pi pi-info-circle mr-1"></i>เรียงตามการรับประกันที่ใกล้หมดก่อน · "ใกล้หมด" = เหลือไม่เกิน {{ expiringDays }} วัน · โครงการจะออกจากกลุ่ม "อยู่ในประกัน" เมื่อประกันงานโครงสร้างหมด</p>
        </div>
    `,
    styles: `
        .filter-chip {
            padding: 0.375rem 0.875rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 999px;
            background: transparent;
            color: var(--p-text-color);
            font: inherit;
            font-size: 0.875rem;
            cursor: pointer;
        }
        .filter-chip:hover {
            border-color: var(--p-primary-color);
        }
        .filter-chip-active {
            border-color: var(--p-primary-color);
            background: var(--p-primary-color);
            color: var(--p-primary-contrast-color);
        }
    `
})
export class WarrantyList {
    private readonly projectService = inject(ProjectService);

    readonly filters = FILTERS;
    readonly expiringDays = WARRANTY_EXPIRING_DAYS;
    readonly period = warrantyPeriod;
    readonly state = coverageState;
    readonly pillClass: Record<ReturnType<typeof coverageState>, string> = {
        active: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
        expiring: 'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
        expired: 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-300'
    };
    readonly barClass: Record<ReturnType<typeof coverageState>, string> = { active: 'bg-green-500', expiring: 'bg-orange-500', expired: 'bg-surface-400' };

    readonly projectsResource = apiResource({ stream: () => this.projectService.list({ group: 'completed' }), defaultValue: [] });
    private readonly portfolioResource = apiResource({ stream: () => this.projectService.portfolio() });
    readonly terms = computed(() => (this.portfolioResource.hasValue() ? this.portfolioResource.value().warrantyTerms : []));

    readonly filter = signal<WarrantyFilter>('covered');
    readonly search = signal('');

    readonly rows = computed((): WarrantyRow[] =>
        this.projectsResource
            .value()
            .map((project) => {
                const list = project.warranties ?? [];
                const next = list.filter((coverage) => coverage.active).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
                return { project, coverages: Object.fromEntries(list.map((coverage) => [coverage.type, coverage])), next };
            })
            // ใกล้หมดก่อน โครงการที่หมดประกันทุกส่วนอยู่ท้ายสุด (ส่งมอบล่าสุดก่อน)
            .sort((a, b) => (a.next && b.next ? a.next.endDate.localeCompare(b.next.endDate) : a.next ? -1 : b.next ? 1 : (b.project.handedOverAt ?? '').localeCompare(a.project.handedOverAt ?? '')))
    );

    private matches(row: WarrantyRow, filter: WarrantyFilter): boolean {
        const architectural = row.coverages.architectural?.active ?? false;
        switch (filter) {
            case 'all':
                return true;
            case 'covered':
                return !!row.next;
            case 'architectural':
                return architectural;
            case 'structural-only':
                return !architectural && !!row.coverages.structural?.active;
            case 'expiring':
                return !!row.next && row.next.daysLeft <= WARRANTY_EXPIRING_DAYS;
            case 'expired':
                return !row.next;
        }
    }

    readonly visibleRows = computed(() => {
        const q = this.search().trim().toLowerCase();
        return this.rows().filter((row) => this.matches(row, this.filter()) && (!q || [row.project.code, row.project.name, row.project.customerName].some((text) => text.toLowerCase().includes(q))));
    });

    countOf(filter: WarrantyFilter) {
        return this.rows().filter((row) => this.matches(row, filter)).length;
    }

    readonly stats = computed(() => {
        const expiring = this.countOf('expiring');
        return [
            { label: 'อยู่ในประกัน', value: this.countOf('covered'), hint: `จากที่ส่งมอบแล้ว ${this.rows().length} โครงการ`, className: '' },
            { label: 'ประกันงานสถาปัตย์ยังมีผล', value: this.countOf('architectural'), hint: `ภายใน ${this.termPeriod('architectural')} หลังส่งมอบ`, className: '' },
            { label: 'ใกล้หมดประกัน', value: expiring, hint: `เหลือไม่เกิน ${WARRANTY_EXPIRING_DAYS} วัน`, className: expiring ? 'text-orange-600 dark:text-orange-400' : '' },
            { label: 'หมดประกันแล้ว', value: this.countOf('expired'), hint: 'ครบทั้งงานสถาปัตย์และโครงสร้าง', className: '' }
        ];
    });

    termPeriod(type: WarrantyType) {
        const term = this.terms().find((item) => item.type === type);
        return term ? warrantyPeriod(term.months) : '-';
    }

    /** ระยะประกันที่ผ่านไปแล้ว (%) */
    elapsed(coverage: WarrantyCoverage) {
        const start = Date.parse(coverage.startDate);
        const end = Date.parse(coverage.endDate);
        const now = end - coverage.daysLeft * 86_400_000;
        return Math.round(Math.min(1, Math.max(0, (now - start) / (end - start))) * 100);
    }

    errorMessage(error: unknown) {
        return problemMessage(error);
    }
}
