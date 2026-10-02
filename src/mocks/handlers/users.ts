import { HttpResponse, delay, http } from 'msw';
import { CURRENT_USER, USERS } from '../data/users';
import { api } from '../utils';

export const userHandlers = [
    http.get(api('/auth/me'), async () => {
        await delay(100);
        return HttpResponse.json(CURRENT_USER);
    }),

    http.post(api('/auth/logout'), async () => {
        await delay(150);
        return new HttpResponse(null, { status: 204 });
    }),

    http.get(api('/users'), async () => {
        await delay(150);
        return HttpResponse.json(Object.values(USERS));
    })
];
