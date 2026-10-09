import express, { type RequestHandler } from 'express';
import { saveState } from './db/state.js';
import { authenticate } from './domain/session.js';
import { requestContext } from './domain/users.js';
import { errorHandler, notFoundHandler } from './http/problem.js';
import { fail } from './http/respond.js';
import { approvalRouter } from './routes/approvals.js';
import { authRouter, userRouter } from './routes/auth.js';
import { fileRouter, uploadRouter } from './routes/files.js';
import { projectRouter } from './routes/projects.js';
import { procurementRouter } from './routes/procurement.js';
import { estimatesRouter } from './routes/estimates.js';
import { recordsRouter } from './routes/records.js';
import { teamRouter } from './routes/team.js';

/** ผู้ใช้ของแต่ละคำขอแยกกัน (ตรรกะทางธุรกิจอ่านผ่าน CURRENT_USER) */
const withRequestContext: RequestHandler = (_req, _res, next) => {
    requestContext.run({ user: null }, next);
};

/** ทุก endpoint หลังจากนี้ต้องมี access token ที่ถูกต้อง */
const requireAuth: RequestHandler = (req, _res, next) => {
    if (!authenticate(req.headers.authorization)) fail(401, 'กรุณาเข้าสู่ระบบ', 'เซสชันหมดอายุหรือบัญชีใช้งานไม่ได้แล้ว');
    next();
};

/** คำขอที่แก้ข้อมูลสำเร็จ → เขียนลงฐานข้อมูล */
const persistChanges: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET') {
        res.on('finish', () => {
            if (res.statusCode < 400) saveState().catch((error) => console.error('บันทึกฐานข้อมูลไม่สำเร็จ', error));
        });
    }
    next();
};

/** เส้นทางทั้งหมดอยู่ใต้ /api ตาม servers ใน openapi.yaml */
export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '2mb' }));

    const api = express.Router();
    api.use(withRequestContext, persistChanges);
    api.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });
    // ไม่ต้องล็อกอิน: เข้าสู่ระบบ สมัครสมาชิก และไฟล์ (ใช้ใน <img>/ลิงก์ดาวน์โหลด)
    api.use(authRouter, fileRouter);
    api.use(requireAuth);
    api.use(userRouter, projectRouter, procurementRouter, estimatesRouter, teamRouter, approvalRouter, recordsRouter, uploadRouter);

    app.use('/api', api);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
}
