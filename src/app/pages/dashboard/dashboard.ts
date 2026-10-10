import { DecimalPipe, NgClass } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { LayoutService } from '@/app/layout/service/layout.service';
import { AuthService } from '@/app/pages/service/auth.service';
import { ApprovalService, APPROVAL_TYPE_LABEL } from '@/app/pages/service/approval.service';
import { AuditLogService } from '@/app/pages/service/audit-log.service';
import { CompanyFinanceService, ProjectHealth } from '@/app/pages/service/company-finance.service';
import { todayAsDate } from '@/app/pages/service/project-timeline.service';
import { PROJECT_STATUS_LABEL, ProjectGroup, ProjectService, ProjectStatus, WARRANTY_EXPIRING_DAYS, WarrantyType, getProjectSeverity, warrantyPeriod } from '@/app/pages/service/project.service';
import { TagModule } from 'primeng/tag';
import { ThaiDatePipe } from '@/app/pages/projects/thai-date.pipe';
import { problemMessage } from '@/app/api/api';
import { apiResource } from '@/app/api/api-resource';

/** สีชุดข้อมูลกราฟ (ผ่านการตรวจ CVD ทั้งโหมดสว่างและมืด) */
const CHART_COLORS = {
    light: { cashIn: '#2a78d6', cashOut: '#eb6834', text: '#52514e', muted: '#898781', grid: '#e1e0d9' },
    dark: { cashIn: '#3987e5', cashOut: '#d95926', text: '#c3c2b7', muted: '#898781', grid: '#2c2c2a' }
};

export const HEALTH_DISPLAY: Record<ProjectHealth, { label: string; icon: string; color: string }> = {
    normal: { label: 'ปกติ', icon: 'pi-check-circle', color: '#0ca30c' },
    behind: { label: 'ล่าช้ากว่าแผน', icon: 'pi-clock', color: '#fab219' },
    'over-budget': { label: 'ต้นทุนเกินงบ', icon: 'pi-exclamation-triangle', color: '#ec835a' },
    loss: { label: 'คาดว่าขาดทุน', icon: 'pi-times-circle', color: '#d03b3b' }
};

export function formatBaht(value: number, compact = false): string {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (compact && abs >= 1_000_000) return `${sign}฿${(abs / 1_000_000).toFixed(2)} ล้าน`;
    return `${sign}฿${Math.round(abs).toLocaleString('th-TH')}`;
}

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [ButtonModule, ChartModule, DecimalPipe, NgClass, RouterLink, TagModule, ThaiDatePipe],
    template: `
        <div class="flex flex-wrap justify-between items-end gap-3 mb-6">
            <div>
                <h1 class="text-2xl font-bold m-0">ภาพรวมบริษัท</h1>
                <p class="text-muted-color mt-1 mb-0">ข้อมูล ณ {{ today | thaiDate }} · {{ canViewFinance() ? 'ทุกโครงการ' : 'ตัวเลขการเงินแสดงเฉพาะผู้มีสิทธิ์การเงินระดับบริษัท' }}</p>
            </div>
            <span class="flex items-center gap-2 text-sm rounded-lg px-3 py-2 bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200" role="note"> <i class="pi pi-info-circle"></i>ตัวเลขเป็นข้อมูลตัวอย่าง ยังไม่ได้เชื่อมต่อระบบบัญชี </span>
        </div>

        @if (financeError()) {
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 mb-6 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดข้อมูลการเงินไม่สำเร็จ: {{ financeError() }}</span>
                <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="summaryResource.reload(); cashFlowResource.reload()"></button>
            </div>
        }

        <!-- ตัวเลขหลัก -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            @for (tile of kpis(); track tile.label) {
                <a [routerLink]="tile.link ?? null" class="card m-0 block no-underline text-color" [ngClass]="tile.link ? 'cursor-pointer hover:border-primary' : ''">
                    <div class="flex items-center gap-2 text-sm text-muted-color"><i class="pi" [ngClass]="tile.icon"></i>{{ tile.label }}</div>
                    <div class="text-2xl font-bold mt-2">{{ tile.value }}</div>
                    <div class="text-sm text-muted-color mt-1">{{ tile.hint }}</div>
                </a>
            }
        </div>

        <!-- สถานะโครงการ -->
        <section class="card mb-6" aria-labelledby="portfolio-heading">
            <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                <h2 id="portfolio-heading" class="text-lg font-semibold m-0">สถานะโครงการ</h2>
                <a routerLink="/projects" class="flex items-center gap-1 text-sm font-semibold text-color hover:text-primary"> ทั้งหมด {{ portfolio()?.counts?.total ?? '–' }} โครงการ <i class="pi pi-chevron-right text-xs"></i> </a>
            </div>

            @if (portfolioResource.error(); as error) {
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">
                    <span><i class="pi pi-exclamation-triangle mr-2"></i>โหลดสถานะโครงการไม่สำเร็จ: {{ errorText(error) }}</span>
                    <button pButton type="button" [outlined]="true" severity="danger" size="small" icon="pi pi-refresh" label="ลองใหม่" (click)="portfolioResource.reload()"></button>
                </div>
            } @else {
                <div class="grid grid-cols-12 gap-6">
                    <div class="col-span-12 xl:col-span-8">
                        <ul class="list-none p-0 m-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                            @for (tile of portfolioTiles(); track tile.group) {
                                <li>
                                    <a
                                        routerLink="/projects"
                                        [queryParams]="{ group: tile.group }"
                                        class="h-full flex flex-col rounded-lg border p-4 no-underline text-color transition-colors hover:border-primary"
                                        [ngClass]="tile.group === 'in-hand' ? 'border-primary bg-primary-50 dark:bg-primary-500/10' : 'border-surface'"
                                        [attr.aria-label]="tile.label + ' ' + tile.count + ' โครงการ — ดูรายการ'"
                                    >
                                        <span class="flex items-center gap-2 text-sm text-muted-color"><i class="pi" [ngClass]="tile.icon" aria-hidden="true"></i>{{ tile.label }}</span>
                                        <span class="text-3xl font-bold mt-2 tabular-nums">{{ tile.count }}</span>
                                        <span class="text-xs text-muted-color mt-1">{{ tile.hint }}</span>
                                    </a>
                                </li>
                            }
                        </ul>

                        @if (portfolio(); as data) {
                            <div class="flex flex-wrap items-center gap-2 mt-4 text-sm">
                                <span class="text-muted-color">กำลังดำเนินการแยกตามสถานะ:</span>
                                @for (status of activeStatuses; track status) {
                                    <a routerLink="/projects" [queryParams]="{ group: 'active' }" class="no-underline" [attr.aria-label]="statusLabel[status] + ' ' + data.activeByStatus[status] + ' โครงการ'">
                                        <p-tag [severity]="getProjectSeverity(status)" [value]="statusLabel[status] + ' ' + data.activeByStatus[status]" />
                                    </a>
                                }
                            </div>
                        }
                    </div>

                    <!-- ประกันใกล้หมด -->
                    <div class="col-span-12 xl:col-span-4 xl:border-l xl:border-surface xl:pl-6">
                        <div class="flex items-center justify-between gap-2 mb-1">
                            <h3 class="text-base font-semibold m-0">โครงการในระยะประกัน</h3>
                            <a routerLink="/warranty" class="text-sm text-primary">ดูทั้งหมด</a>
                        </div>
                        <p class="text-xs text-muted-color mt-0 mb-3">{{ warrantyTermsText() }} หลังส่งมอบ · ใกล้หมดก่อนอยู่บนสุด</p>
                        <ul class="list-none p-0 m-0">
                            @for (item of warranties(); track item.code) {
                                <li class="border-b border-surface last:border-b-0">
                                    <a [routerLink]="['/projects', item.code]" class="flex items-start justify-between gap-3 py-2 no-underline text-color hover:text-primary">
                                        <span class="min-w-0">
                                            <span class="block font-semibold">{{ item.code }}</span>
                                            <span class="block text-xs text-muted-color truncate">{{ item.customerName }} · ส่งมอบ {{ item.handedOverAt | thaiDate }}</span>
                                        </span>
                                        <span class="text-right shrink-0">
                                            <span class="block text-xs text-muted-color">{{ termLabel(item.expiringType) }} ถึง {{ item.warrantyUntil | thaiDate }}</span>
                                            <span class="block text-sm font-semibold" [ngClass]="item.daysLeft <= expiringDays ? 'text-orange-600 dark:text-orange-400' : ''">
                                                @if (item.daysLeft <= expiringDays) {
                                                    <i class="pi pi-exclamation-circle text-xs mr-1" aria-hidden="true"></i>
                                                }
                                                เหลือ {{ item.daysLeft }} วัน
                                            </span>
                                        </span>
                                    </a>
                                </li>
                            } @empty {
                                <li class="text-sm text-muted-color py-4 text-center">{{ portfolioResource.isLoading() ? 'กำลังโหลด...' : 'ไม่มีโครงการในระยะประกัน' }}</li>
                            }
                        </ul>
                    </div>
                </div>
            }
        </section>

        <div class="grid grid-cols-12 gap-6 mb-6">
            <!-- กระแสเงินสด -->
            @if (canViewFinance()) {
                <section class="card m-0 col-span-12 xl:col-span-8" aria-labelledby="cashflow-heading">
                    <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                        <div>
                            <h2 id="cashflow-heading" class="text-lg font-semibold m-0">เงินรับ-เงินจ่าย รายเดือน</h2>
                            <p class="text-sm text-muted-color mt-1 mb-0">6 เดือนล่าสุด · รับ {{ cashTotals().cashIn | number: '1.0-0' }} บาท · จ่าย {{ cashTotals().cashOut | number: '1.0-0' }} บาท</p>
                        </div>
                        <button
                            pButton
                            type="button"
                            [text]="true"
                            size="small"
                            [icon]="showCashTable() ? 'pi pi-chart-bar' : 'pi pi-table'"
                            [label]="showCashTable() ? 'ดูเป็นกราฟ' : 'ดูเป็นตาราง'"
                            (click)="showCashTable.set(!showCashTable())"
                        ></button>
                    </div>
                    @if (showCashTable()) {
                        <table class="w-full text-sm border-collapse">
                            <thead>
                                <tr class="border-b border-surface text-muted-color text-left">
                                    <th class="py-2 font-semibold">เดือน</th>
                                    <th class="py-2 font-semibold text-right">เงินรับ (บาท)</th>
                                    <th class="py-2 font-semibold text-right">เงินจ่าย (บาท)</th>
                                    <th class="py-2 font-semibold text-right">สุทธิ (บาท)</th>
                                </tr>
                            </thead>
                            <tbody>
                                @for (month of cashFlow(); track month.key) {
                                    <tr class="border-b border-surface last:border-b-0">
                                        <td class="py-2">{{ month.label }}</td>
                                        <td class="py-2 text-right tabular-nums">{{ month.cashIn | number: '1.0-0' }}</td>
                                        <td class="py-2 text-right tabular-nums">{{ month.cashOut | number: '1.0-0' }}</td>
                                        <td class="py-2 text-right tabular-nums">{{ month.cashIn - month.cashOut | number: '1.0-0' }}</td>
                                    </tr>
                                }
                            </tbody>
                        </table>
                    } @else {
                        <div class="h-80">
                            <p-chart type="bar" [data]="chartData()" [options]="chartOptions()" height="100%" [ariaLabel]="'กราฟเงินรับและเงินจ่ายรายเดือน 6 เดือนล่าสุด'" />
                        </div>
                    }
                </section>
            }

            <!-- รออนุมัติ -->
            <section class="card m-0 col-span-12 flex flex-col" [ngClass]="canViewFinance() ? 'xl:col-span-4' : ''" aria-labelledby="approval-heading">
                <div class="flex justify-between items-center gap-3 mb-4">
                    <h2 id="approval-heading" class="text-lg font-semibold m-0">รออนุมัติ</h2>
                    <span class="px-2 py-1 rounded-full text-xs font-semibold bg-orange-500 text-white">{{ pendingCount() }} รายการ</span>
                </div>
                <ul class="list-none p-0 m-0 flex-1">
                    @for (item of topPending(); track item.id) {
                        <li class="py-3 border-b border-surface last:border-b-0">
                            <div class="flex justify-between gap-3">
                                <span class="font-semibold truncate">{{ item.title }}</span>
                                <span class="font-semibold tabular-nums shrink-0">{{ item.amount | number: '1.0-0' }}</span>
                            </div>
                            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-color mt-1">
                                <span>{{ item.id }}</span
                                >·<span>{{ typeLabel[item.type] }}</span
                                >·<span>{{ item.projectCode }}</span>
                                @if (item.approvalLevel === 'owner') {
                                    <span class="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">รอคุณอนุมัติ</span>
                                }
                            </div>
                        </li>
                    } @empty {
                        <li class="text-muted-color py-6 text-center">ไม่มีรายการรออนุมัติ</li>
                    }
                </ul>
                <a pButton routerLink="/approvals" label="ไปที่ศูนย์อนุมัติ" icon="pi pi-arrow-right" iconPos="right" class="w-full mt-4"></a>
            </section>
        </div>

        <!-- กำไร-ขาดทุนรายโครงการ -->
        @if (canViewFinance()) {
            <section class="card mb-6" aria-labelledby="pl-heading">
                <div class="flex flex-wrap justify-between items-center gap-3 mb-4">
                    <h2 id="pl-heading" class="text-lg font-semibold m-0">กำไร-ขาดทุนรายโครงการ</h2>
                    <span class="text-sm text-muted-color">หน่วย: บาท · รายได้รับรู้ตามความคืบหน้า</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm border-collapse" style="min-width: 64rem">
                        <thead>
                            <tr class="border-b border-surface text-muted-color text-left">
                                <th class="py-3 pr-3 font-semibold">โครงการ</th>
                                <th class="py-3 pr-3 font-semibold text-right">มูลค่าสัญญา</th>
                                <th class="py-3 pr-3 font-semibold text-right">ความคืบหน้า</th>
                                <th class="py-3 pr-3 font-semibold text-right">รายได้รับรู้</th>
                                <th class="py-3 pr-3 font-semibold text-right">ต้นทุนจริง</th>
                                <th class="py-3 pr-3 font-semibold text-right">กำไรขั้นต้น</th>
                                <th class="py-3 pr-3 font-semibold text-right">อัตรากำไร</th>
                                <th class="py-3 pr-3 font-semibold text-right">คาดการณ์กำไรเมื่อจบ</th>
                                <th class="py-3 font-semibold">สถานะ</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (row of financeRows(); track row.projectCode) {
                                <tr
                                    class="border-b border-surface cursor-pointer hover:bg-emphasis"
                                    tabindex="0"
                                    role="link"
                                    [attr.aria-label]="'เปิดโครงการ ' + row.projectCode"
                                    (click)="openProject(row.projectCode)"
                                    (keydown.enter)="openProject(row.projectCode)"
                                >
                                    <td class="py-3 pr-3">
                                        <div class="font-semibold">{{ row.projectCode }}</div>
                                        <div class="text-xs text-muted-color">{{ row.customerName }}</div>
                                    </td>
                                    <td class="py-3 pr-3 text-right tabular-nums">{{ row.contractValue | number: '1.0-0' }}</td>
                                    <td class="py-3 pr-3 text-right tabular-nums">
                                        {{ row.progress }}%
                                        @if (row.progress < 100) {
                                            <div class="text-xs text-muted-color">แผน {{ row.plannedProgress }}%</div>
                                        }
                                    </td>
                                    <td class="py-3 pr-3 text-right tabular-nums">{{ row.earnedRevenue | number: '1.0-0' }}</td>
                                    <td class="py-3 pr-3 text-right tabular-nums">{{ row.actualCost | number: '1.0-0' }}</td>
                                    <td class="py-3 pr-3 text-right tabular-nums font-semibold">{{ row.grossProfit | number: '1.0-0' }}</td>
                                    <td class="py-3 pr-3 text-right tabular-nums">{{ row.margin | number: '1.1-1' }}%</td>
                                    <td class="py-3 pr-3 text-right tabular-nums">{{ row.forecastProfit | number: '1.0-0' }}</td>
                                    <td class="py-3">
                                        <span class="inline-flex items-center gap-2 whitespace-nowrap">
                                            <i class="pi" [ngClass]="health[row.health].icon" [style.color]="health[row.health].color" aria-hidden="true"></i>
                                            {{ health[row.health].label }}
                                        </span>
                                    </td>
                                </tr>
                            } @empty {
                                <tr>
                                    <td colspan="9" class="py-8 text-center text-muted-color">{{ summaryResource.isLoading() ? 'กำลังโหลด...' : 'ไม่มีข้อมูล' }}</td>
                                </tr>
                            }
                        </tbody>
                        <tfoot>
                            <tr class="font-semibold">
                                <td class="py-3 pr-3">รวมทุกโครงการ</td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.contractValue | number: '1.0-0' }}</td>
                                <td></td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.earnedRevenue | number: '1.0-0' }}</td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.actualCost | number: '1.0-0' }}</td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.grossProfit | number: '1.0-0' }}</td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.margin | number: '1.1-1' }}%</td>
                                <td class="py-3 pr-3 text-right tabular-nums">{{ totals()?.forecastProfit | number: '1.0-0' }}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>
        }

        <!-- กิจกรรมล่าสุด -->
        <section class="card" aria-labelledby="activity-heading">
            <div class="flex justify-between items-center gap-3 mb-2">
                <h2 id="activity-heading" class="text-lg font-semibold m-0">กิจกรรมล่าสุดในระบบ</h2>
                <a routerLink="/system/audit-log" class="flex items-center gap-1 text-sm font-semibold text-color hover:text-primary">ดู Audit Log ทั้งหมด <i class="pi pi-chevron-right text-xs"></i></a>
            </div>
            <ul class="list-none p-0 m-0">
                @for (entry of recentActivity(); track entry.id) {
                    <li class="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 border-b border-surface last:border-b-0">
                        <span class="text-xs text-muted-color w-28 shrink-0">{{ entry.at | thaiDate: 'dateTime' }}</span>
                        <span class="font-semibold">{{ entry.user.name }}</span>
                        <span
                            >{{ entry.action }} <span class="font-semibold">{{ entry.target }}</span></span
                        >
                        @if (entry.detail) {
                            <span class="text-sm text-muted-color">{{ entry.detail }}</span>
                        }
                    </li>
                }
            </ul>
        </section>
    `
})
export class Dashboard {
    private readonly router = inject(Router);
    private readonly layoutService = inject(LayoutService);
    private readonly approvals = inject(ApprovalService);
    private readonly auditLog = inject(AuditLogService);
    private readonly finance = inject(CompanyFinanceService);
    private readonly projects = inject(ProjectService);
    private readonly auth = inject(AuthService);

    /** ตัวเลขการเงินระดับบริษัท (กำไร-ขาดทุน กระแสเงินสด) เฉพาะผู้มีสิทธิ์ finance.company */
    readonly canViewFinance = computed(() => this.auth.can('finance.company'));

    readonly today = todayAsDate();
    readonly health = HEALTH_DISPLAY;
    readonly typeLabel = APPROVAL_TYPE_LABEL;
    readonly showCashTable = signal(false);

    readonly summaryResource = apiResource({ params: () => this.canViewFinance() || undefined, stream: () => this.finance.summary() });
    readonly cashFlowResource = apiResource({ params: () => this.canViewFinance() || undefined, stream: () => this.finance.cashFlow(6), defaultValue: [] });
    readonly totals = computed(() => (this.summaryResource.hasValue() ? this.summaryResource.value().totals : undefined));
    readonly financeRows = computed(() => (this.summaryResource.hasValue() ? this.summaryResource.value().projects : []));
    readonly cashFlow = computed(() => (this.cashFlowResource.hasValue() ? this.cashFlowResource.value() : []));

    readonly portfolioResource = apiResource({ stream: () => this.projects.portfolio() });
    readonly portfolio = computed(() => (this.portfolioResource.hasValue() ? this.portfolioResource.value() : undefined));
    readonly warranties = computed(() => (this.portfolio()?.warranties ?? []).slice(0, 5));
    readonly expiringDays = WARRANTY_EXPIRING_DAYS;
    /** เช่น "ประกันงานสถาปัตยกรรม 1 ปี · งานโครงสร้าง 5 ปี" */
    readonly warrantyTermsText = computed(() => {
        const terms = this.portfolio()?.warrantyTerms ?? [];
        return terms.length ? 'ประกัน' + terms.map((term) => `${term.label} ${warrantyPeriod(term.months)}`).join(' · ') : 'ประกันผลงาน';
    });

    termLabel(type: WarrantyType) {
        return this.portfolio()?.warrantyTerms.find((term) => term.type === type)?.label ?? '';
    }
    readonly statusLabel = PROJECT_STATUS_LABEL;
    readonly getProjectSeverity = getProjectSeverity;
    readonly activeStatuses: Exclude<ProjectStatus, 'pending-contract' | 'completed'>[] = ['planning', 'in-progress', 'near-handover', 'delayed'];
    readonly portfolioTiles = computed((): Array<{ group: ProjectGroup; label: string; icon: string; count: string; hint: string }> => {
        const data = this.portfolio();
        const count = (value: number | undefined) => (value === undefined ? '–' : String(value));
        const counts = data?.counts;
        return [
            {
                group: 'in-hand',
                label: 'โครงการในมือ',
                icon: 'pi-briefcase',
                count: count(counts?.inHand),
                hint: data?.inHandValue !== undefined ? `งานมีสัญญา ${formatBaht(data.inHandValue, true)}` : 'รอทำสัญญา + กำลังดำเนินการ'
            },
            {
                group: 'active',
                label: 'กำลังดำเนินการ',
                icon: 'pi-wrench',
                count: count(counts?.active),
                hint: data ? (data.activeByStatus.delayed ? `ล่าช้า ${data.activeByStatus.delayed} โครงการ` : 'ไม่มีโครงการล่าช้า') : ''
            },
            { group: 'pending-contract', label: 'รอทำสัญญา', icon: 'pi-file-edit', count: count(counts?.pendingContract), hint: 'เปิดโครงการแล้ว ยังไม่เซ็นสัญญา' },
            { group: 'completed', label: 'เสร็จแล้ว', icon: 'pi-check-circle', count: count(counts?.completed), hint: 'ส่งมอบงานแล้ว' },
            {
                group: 'warranty',
                label: 'อยู่ในประกัน',
                icon: 'pi-shield',
                count: count(counts?.warranty),
                hint: data ? this.warrantyTermsText() : ''
            }
        ];
    });
    readonly financeError = computed(() => {
        const error = this.summaryResource.error() ?? this.cashFlowResource.error();
        return error ? problemMessage(error) : '';
    });
    readonly pendingCount = computed(() => this.approvals.summary()?.pending ?? 0);
    // Both lists reload whenever the approval summary changes (i.e. after any decision).
    private readonly topPendingResource = apiResource({
        params: () => this.approvals.summary(),
        stream: () => this.approvals.list({ status: 'pending', sort: 'priority', pageSize: 5 })
    });
    readonly topPending = computed(() => (this.topPendingResource.hasValue() ? this.topPendingResource.value().items : []));
    private readonly activityResource = apiResource({
        params: () => this.approvals.summary(),
        stream: () => this.auditLog.list({ pageSize: 6 })
    });
    readonly recentActivity = computed(() => (this.activityResource.hasValue() ? this.activityResource.value().items : []));

    readonly kpis = computed(() => {
        const totals = this.totals();
        const summary = this.approvals.summary();
        const loading = 'กำลังโหลด...';
        const finance = this.canViewFinance();
        return [
            { label: 'มูลค่างานในมือ', icon: 'pi-briefcase', value: totals ? formatBaht(totals.backlog, true) : '–', hint: totals ? `${totals.activeProjects} โครงการกำลังดำเนินการ` : loading, link: '/projects' },
            { label: 'รายได้รับรู้สะสม', icon: 'pi-chart-line', value: totals ? formatBaht(totals.earnedRevenue, true) : '–', hint: totals ? `จากมูลค่าสัญญารวม ${formatBaht(totals.contractValue, true)}` : loading },
            { label: 'กำไรขั้นต้นสะสม', icon: 'pi-wallet', value: totals ? formatBaht(totals.grossProfit, true) : '–', hint: totals ? `อัตรากำไร ${totals.margin.toFixed(1)}%` : loading },
            { label: 'เงินค้างรับจากลูกค้า', icon: 'pi-inbox', value: totals ? formatBaht(totals.receivable, true) : '–', hint: totals ? `รับแล้ว ${formatBaht(totals.cashReceived, true)}` : loading },
            {
                label: 'รออนุมัติ',
                icon: 'pi-check-square',
                value: summary ? `${summary.pending} รายการ` : '–',
                hint: summary ? `รวม ${formatBaht(summary.pendingAmount, true)}` : 'กำลังโหลด...',
                link: '/approvals'
            }
        ].filter((tile) => finance || tile.label === 'รออนุมัติ');
    });

    readonly cashTotals = computed(() => this.cashFlow().reduce((sum, month) => ({ cashIn: sum.cashIn + month.cashIn, cashOut: sum.cashOut + month.cashOut }), { cashIn: 0, cashOut: 0 }));

    readonly chartData = computed(() => {
        const colors = this.layoutService.isDarkTheme() ? CHART_COLORS.dark : CHART_COLORS.light;
        const months = this.cashFlow();
        const dataset = (label: string, color: string, values: number[]) => ({ label, data: values, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, maxBarThickness: 22, borderSkipped: 'bottom' });
        return {
            labels: months.map((month) => month.label),
            datasets: [
                dataset(
                    'เงินรับ',
                    colors.cashIn,
                    months.map((month) => Math.round(month.cashIn))
                ),
                dataset(
                    'เงินจ่าย',
                    colors.cashOut,
                    months.map((month) => Math.round(month.cashOut))
                )
            ]
        };
    });

    readonly chartOptions = computed(() => {
        const colors = this.layoutService.isDarkTheme() ? CHART_COLORS.dark : CHART_COLORS.light;
        return {
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end', labels: { color: colors.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10 } },
                tooltip: { callbacks: { label: (context: { dataset: { label: string }; parsed: { y: number } }) => `${context.dataset.label}: ${formatBaht(context.parsed.y)}` } }
            },
            scales: {
                x: { ticks: { color: colors.muted }, grid: { display: false }, border: { color: colors.grid } },
                y: {
                    ticks: { color: colors.muted, callback: (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} ล.` : `${Math.round(value / 1000)}k`) },
                    grid: { color: colors.grid },
                    border: { display: false }
                }
            }
        };
    });

    errorText(error: unknown) {
        return problemMessage(error); 
    }

    openProject(code: string) {
        this.router.navigate(['/projects', code]);
    }
}
