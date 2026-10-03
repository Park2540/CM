import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import type { ApiProblem } from '../api/api.js';

/** ข้อผิดพลาดตามรูปแบบ Problem ในสัญญา API — โยนจาก route แล้ว errorHandler แปลงเป็น response */
export class HttpProblem extends Error {
    constructor(
        readonly status: number,
        readonly title: string,
        readonly detail?: string,
        readonly errors?: Record<string, string>
    ) {
        super(title);
    }
}

/** 422 พร้อมข้อผิดพลาดรายช่อง (detail = ข้อความแรก) */
export const validationProblem = (errors: Record<string, string>, title = 'ข้อมูลไม่ถูกต้อง') => new HttpProblem(422, title, Object.values(errors)[0], errors);

function sendProblem(res: Response, problem: ApiProblem) {
    res.status(problem.status).type('application/problem+json').json(problem);
}

export const notFoundHandler: RequestHandler = (req, res) => {
    sendProblem(res, { type: 'about:blank', status: 404, title: 'ไม่พบ endpoint นี้', detail: `${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpProblem) {
        sendProblem(res, { type: 'about:blank', status: error.status, title: error.title, detail: error.detail, errors: error.errors });
        return;
    }
    // JSON ที่ส่งมาอ่านไม่ได้ (express.json)
    if (error?.type === 'entity.parse.failed') {
        sendProblem(res, { type: 'about:blank', status: 400, title: 'รูปแบบข้อมูลไม่ถูกต้อง' });
        return;
    }
    // error จาก library ที่มีรหัส 4xx (เช่น ไฟล์ไม่พบ ขนาดเกิน) ตอบตามรหัสนั้น
    const status = Number(error?.status ?? error?.statusCode);
    if (status >= 400 && status < 500) {
        sendProblem(res, { type: 'about:blank', status, title: status === 404 ? 'ไม่พบข้อมูล' : 'คำขอไม่ถูกต้อง' });
        return;
    }
    console.error(error);
    sendProblem(res, { type: 'about:blank', status: 500, title: 'เกิดข้อผิดพลาดในระบบ' });
};
