import { Routes } from '@angular/router';
import { AppLayout } from './app/layout/component/app.layout';
import { ApprovalCenter } from './app/pages/approvals/approval-center';
import { AuditLog } from './app/pages/system/audit-log';
import { Roles } from './app/pages/system/roles';
import { Dashboard } from './app/pages/dashboard/dashboard';
import { Notfound } from './app/pages/notfound/notfound';
import { PersonnelDetail } from './app/pages/personnel/personnel-detail';
import { PersonnelList } from './app/pages/personnel/personnel-list';
import { SubcontractorList } from './app/pages/subcontractors/subcontractor-list';
import { ProjectCreate } from './app/pages/projects/project-create';
import { ProjectList } from './app/pages/projects/project-list';
import { ProjectManagement } from './app/pages/projects/project-management';
import { ProjectSetup } from './app/pages/projects/project-setup';

export const appRoutes: Routes = [
    {
        path: '',
        component: AppLayout,
        children: [
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            { path: 'dashboard', component: Dashboard },
            { path: 'master/personnel', component: PersonnelList },
            { path: 'master/personnel/:id', component: PersonnelDetail },
            { path: 'master/subcontractors', component: SubcontractorList },
            { path: 'projects', component: ProjectList },
            { path: 'projects/new', component: ProjectCreate },
            { path: 'projects/:code', component: ProjectManagement },
            { path: 'projects/:code/setup', component: ProjectSetup },
            { path: 'approvals', component: ApprovalCenter },
            { path: 'system/roles', component: Roles },
            { path: 'system/audit-log', component: AuditLog }
        ]
    },
    { path: 'notfound', component: Notfound },
    { path: 'auth', loadChildren: () => import('./app/pages/auth/auth.routes') },
    { path: '**', redirectTo: '/notfound' }
];
