import { approvalHandlers } from './approvals';
import { auditLogHandlers } from './audit-logs';
import { catalogHandlers } from './catalog';
import { dashboardHandlers } from './dashboard';
import { personnelHandlers } from './personnel';
import { projectHandlers } from './projects';
import { teamHandlers } from './team';
import { userHandlers } from './users';

/** endpoint จำลองทั้งหมด — เพิ่ม endpoint ใหม่ให้ใส่ในรายการนี้ */
export const handlers = [...userHandlers, ...catalogHandlers, ...approvalHandlers, ...auditLogHandlers, ...projectHandlers, ...teamHandlers, ...dashboardHandlers, ...personnelHandlers];
