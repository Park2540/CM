import { HttpResponse, delay, http } from 'msw';
import { dashboardSummary, monthlyCashFlow } from '../data/finance';
import { projectPortfolio } from '../data/projects';
import { CURRENT_USER } from '../data/users';
import { api, problem } from '../utils';

/** ข้อมูลการเงินระดับบริษัท เฉพาะเจ้าของบริษัท */
const canViewCompanyFinance = () => CURRENT_USER.permissions.includes('finance.company');

export const dashboardHandlers = [
    http.get(api('/dashboard/summary'), async () => {
        await delay(300);
        if (!canViewCompanyFinance()) return problem(403, 'ไม่มีสิทธิ์ดูข้อมูลการเงินของบริษัท');
        return HttpResponse.json(dashboardSummary());
    }),

    http.get(api('/dashboard/projects'), async () => {
        await delay(200);
        // จำนวนโครงการดูได้ทุกคนที่เห็น Dashboard ส่วนมูลค่าเฉพาะผู้มีสิทธิ์การเงินบริษัท
        return HttpResponse.json(projectPortfolio(canViewCompanyFinance()));
    }),

    http.get(api('/dashboard/cash-flow'), async ({ request }) => {
        await delay(300);
        if (!canViewCompanyFinance()) return problem(403, 'ไม่มีสิทธิ์ดูข้อมูลการเงินของบริษัท');
        const months = Math.min(24, Math.max(1, Number(new URL(request.url).searchParams.get('months')) || 6));
        return HttpResponse.json(monthlyCashFlow(months));
    })
];
