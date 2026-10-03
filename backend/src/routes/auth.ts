import { Router } from 'express';
import type { ApiSchemas } from '../api/api.js';
import { approveRegistration, listRegistrations, rejectRegistration, submitRegistration } from '../domain/registrations.js';
import { login } from '../domain/session.js';
import { activateAccount, canApproveRegistrations, canManageUsers, createAccount, listAccounts, resetPassword, suspendAccount, updateAccount } from '../domain/user-accounts.js';
import { USERS, currentUserSnapshot } from '../domain/users.js';
import { ROLE_CATALOG } from '../domain/roles.js';
import { body, fail, query, send } from '../http/respond.js';

/** เข้าสู่ระบบ สมัครสมาชิก ผู้ใช้ บัญชีผู้ใช้ และบทบาท */
export const authRouter = Router();

// ---------- ไม่ต้องล็อกอิน ----------

authRouter.post('/auth/login', (req, res) => {
    send(res, login(body<ApiSchemas['LoginInput']>(req)));
});

authRouter.post('/auth/register', (req, res) => {
    const outcome = submitRegistration(body<ApiSchemas['RegistrationInput']>(req));
    if (!('ok' in outcome)) return send(res, outcome);
    res.status(202).json({ id: outcome.ok.id, status: 'pending', submittedAt: outcome.ok.submittedAt });
});

// token เป็นแบบ stateless: ออกจากระบบ = หน้าบ้านลบ token ทิ้ง
authRouter.post('/auth/logout', (_req, res) => {
    res.status(204).end();
});

// ---------- ต้องล็อกอิน (ผ่าน requireAuth ใน app.ts) ----------

export const userRouter = Router();

userRouter.get('/auth/me', (_req, res) => {
    res.json(currentUserSnapshot());
});

userRouter.get('/users', (_req, res) => {
    res.json(Object.values(USERS));
});

userRouter.get('/roles', (_req, res) => {
    res.json(ROLE_CATALOG);
});

const requireUserManage = () => {
    if (!canManageUsers()) fail(403, 'ไม่มีสิทธิ์จัดการผู้ใช้');
};

userRouter.get('/user-accounts', (req, res) => {
    requireUserManage();
    res.json(listAccounts({ q: query(req, 'q'), roleId: query(req, 'roleId'), status: query(req, 'status'), personnelId: query(req, 'personnelId') }));
});

userRouter.post('/user-accounts', (req, res) => {
    requireUserManage();
    send(res, createAccount(body<ApiSchemas['UserAccountCreateInput']>(req)), 201);
});

userRouter.put('/user-accounts/:id', (req, res) => {
    requireUserManage();
    send(res, updateAccount(req.params['id']!, body<ApiSchemas['UserAccountInput']>(req)));
});

userRouter.post('/user-accounts/:id/suspend', (req, res) => {
    requireUserManage();
    send(res, suspendAccount(req.params['id']!, body<{ reason: string }>(req).reason));
});

userRouter.post('/user-accounts/:id/activate', (req, res) => {
    requireUserManage();
    send(res, activateAccount(req.params['id']!));
});

userRouter.post('/user-accounts/:id/reset-password', (req, res) => {
    requireUserManage();
    send(res, resetPassword(req.params['id']!));
});

// ---------- คำขอสมัครสมาชิก: ดูได้เมื่อมี user.manage ตัดสินได้เฉพาะแอดมิน/เจ้าของบริษัท ----------

const requireApprover = () => {
    if (!canApproveRegistrations()) fail(403, 'อนุมัติได้เฉพาะแอดมินหรือเจ้าของบริษัท');
};

userRouter.get('/registrations', (req, res) => {
    requireUserManage();
    res.json(listRegistrations(query(req, 'status')));
});

userRouter.post('/registrations/:id/approve', (req, res) => {
    requireApprover();
    send(res, approveRegistration(req.params['id']!, body<ApiSchemas['UserAccountInput'] & { personnelId: string }>(req)));
});

userRouter.post('/registrations/:id/reject', (req, res) => {
    requireApprover();
    send(res, rejectRegistration(req.params['id']!, body<{ reason: string }>(req).reason));
});
