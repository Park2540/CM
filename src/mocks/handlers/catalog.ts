import { HttpResponse, delay, http } from 'msw';
import { HOUSE_PLANS } from '../data/house-plans';
import { ROLE_CATALOG } from '../data/roles';
import { api, problem } from '../utils';

/** ข้อมูลอ้างอิง: แบบบ้าน และบทบาท/สิทธิ์ */
export const catalogHandlers = [
    http.get(api('/house-plans'), async () => {
        await delay(150);
        return HttpResponse.json(HOUSE_PLANS);
    }),

    http.get(api('/house-plans/:code'), async ({ params }) => {
        await delay(200);
        const plan = HOUSE_PLANS.find((item) => item.code === params['code']);
        return plan ? HttpResponse.json(plan) : problem(404, 'ไม่พบแบบบ้าน');
    }),

    http.get(api('/roles'), async () => {
        await delay(150);
        return HttpResponse.json(ROLE_CATALOG);
    })
];
