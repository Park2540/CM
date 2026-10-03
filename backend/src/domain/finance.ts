import type { ApiSchemas } from '../api/api.js';
import { isContracted } from './shared.js';
import { generatedRecords } from './project-records.js';
import { listProjects } from './projects.js';

type ProjectFinance = ApiSchemas['ProjectFinance'];

/** สมมติฐานต้นทุนตัวอย่างต่อโครงการ: สัดส่วนงบต้นทุนต่อมูลค่าสัญญา และอัตราต้นทุนจริงเทียบงบ (หลังบ้านจริงใช้ข้อมูลบัญชี/จัดซื้อ) */
const SAMPLE_COST_ASSUMPTIONS: Record<string, { budgetRatio: number; costOverrun: number }> = {
    CR690001: { budgetRatio: 0.78, costOverrun: 1.04 },
    CR690002: { budgetRatio: 0.8, costOverrun: 0.98 },
    BKK690001: { budgetRatio: 0.85, costOverrun: 1.2 },
    CNX690001: { budgetRatio: 0.79, costOverrun: 1.09 },
    PKT690001: { budgetRatio: 0.77, costOverrun: 1.01 }
};
const DEFAULT_ASSUMPTION = { budgetRatio: 0.8, costOverrun: 1 };

const DAY_MS = 86_400_000;
const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const todayUtc = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/** โครงการพร้อมงวดเงินที่สร้างจากไทม์ไลน์ปัจจุบัน (เปลี่ยนตามการอัปเดตงาน) */
function projectData() {
    // โครงการที่ยังไม่บันทึกสัญญาไม่มีมูลค่า จึงไม่นับในการเงินบริษัท
    return (
        listProjects()
            .filter(isContracted)
            // งวดงานสร้างหลังตั้งค่างานก่อสร้าง ก่อนหน้านั้นนับเฉพาะมูลค่าสัญญา
            .map((project) => ({ project, records: generatedRecords(project.code) ?? { installments: [] } }))
    );
}

export function projectFinance(): ProjectFinance[] {
    const today = todayUtc().getTime();
    return projectData().map(({ project, records }) => {
        const { budgetRatio, costOverrun } = SAMPLE_COST_ASSUMPTIONS[project.code] ?? DEFAULT_ASSUMPTION;
        const progress = project.progress / 100;
        // รวมงานเพิ่ม-ลดที่อนุมัติแล้ว
        const value = project.revisedValue ?? project.value;
        const budgetCost = value * budgetRatio;
        const earnedRevenue = value * progress;
        const actualCost = budgetCost * progress * costOverrun;
        const grossProfit = earnedRevenue - actualCost;
        const forecastProfit = value - budgetCost * costOverrun;

        const start = Date.parse(`${project.startDate}T00:00:00Z`);
        const end = Date.parse(`${project.deliveryDate}T00:00:00Z`);
        const plannedProgress = Math.round(Math.min(1, Math.max(0, (today - start) / (end - start))) * 100);
        const health: ProjectFinance['health'] = forecastProfit < 0 ? 'loss' : costOverrun > 1.05 ? 'over-budget' : project.progress < 100 && plannedProgress - project.progress > 10 ? 'behind' : 'normal';

        return {
            projectCode: project.code,
            customerName: project.customerName,
            contractValue: value,
            progress: project.progress,
            plannedProgress,
            budgetCost,
            earnedRevenue,
            actualCost,
            grossProfit,
            margin: earnedRevenue ? (grossProfit / earnedRevenue) * 100 : 0,
            forecastProfit,
            cashReceived: records.installments.filter((item) => item.status === 'paid').reduce((sum, item) => sum + item.amount, 0),
            receivable: records.installments.filter((item) => item.status === 'due').reduce((sum, item) => sum + item.amount, 0),
            health
        };
    });
}

export function dashboardSummary(): ApiSchemas['DashboardSummary'] {
    const rows = projectFinance();
    const sum = (pick: (row: ProjectFinance) => number) => rows.reduce((total, row) => total + pick(row), 0);
    const earnedRevenue = sum((row) => row.earnedRevenue);
    const grossProfit = sum((row) => row.grossProfit);
    return {
        asOf: new Date().toISOString(),
        totals: {
            contractValue: sum((row) => row.contractValue),
            backlog: sum((row) => row.contractValue - row.earnedRevenue),
            activeProjects: rows.filter((row) => row.progress < 100).length,
            earnedRevenue,
            actualCost: sum((row) => row.actualCost),
            grossProfit,
            margin: earnedRevenue ? (grossProfit / earnedRevenue) * 100 : 0,
            forecastProfit: sum((row) => row.forecastProfit),
            cashReceived: sum((row) => row.cashReceived),
            receivable: sum((row) => row.receivable)
        },
        projects: rows
    };
}

/** เงินรับ (งวดที่ลูกค้าชำระ) และเงินจ่าย (ต้นทุนจริงกระจายตามวันที่ทำงาน) ย้อนหลัง n เดือน รวมเดือนปัจจุบัน */
export function monthlyCashFlow(monthsShown: number): ApiSchemas['MonthlyCashFlow'][] {
    const today = todayUtc();
    const months = Array.from({ length: monthsShown }, (_, i) => ({ month: monthKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (monthsShown - 1 - i), 1))), cashIn: 0, cashOut: 0 }));
    const byKey = new Map(months.map((month) => [month.month, month]));
    const finance = new Map(projectFinance().map((row) => [row.projectCode, row]));

    for (const { project, records } of projectData()) {
        for (const installment of records.installments) {
            if (installment.paidDate) {
                const month = byKey.get(monthKey(installment.paidDate));
                if (month) month.cashIn += installment.amount;
            }
        }
        const actualCost = finance.get(project.code)?.actualCost ?? 0;
        const start = Date.parse(`${project.startDate}T00:00:00Z`);
        const end = Math.min(today.getTime(), Date.parse(`${project.deliveryDate}T00:00:00Z`));
        const days = Math.max(1, Math.round((end - start) / DAY_MS));
        for (let day = 0; day < days; day++) {
            const month = byKey.get(monthKey(new Date(start + day * DAY_MS)));
            if (month) month.cashOut += actualCost / days;
        }
    }
    return months.map((month) => ({ ...month, cashIn: Math.round(month.cashIn), cashOut: Math.round(month.cashOut) }));
}
