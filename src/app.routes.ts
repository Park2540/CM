import { Routes } from '@angular/router';
import { AppLayout } from './app/layout/component/app.layout';
import { Dashboard } from './app/pages/dashboard/dashboard';
import { Documentation } from './app/pages/documentation/documentation';
import { Landing } from './app/pages/landing/landing';
import { Notfound } from './app/pages/notfound/notfound';
import { PersonnelDetail } from './app/pages/personnel/personnel-detail';
import { PersonnelList } from './app/pages/personnel/personnel-list';
import { ProjectList } from './app/pages/projects/project-list';
import { ProjectManagement } from './app/pages/projects/project-management';

export const appRoutes: Routes = [
    {
        path: '',
        component: AppLayout,
        children: [
            { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
            { path: 'dashboard', component: Dashboard },
            { path: 'master/personnel', component: PersonnelList },
            { path: 'master/personnel/:id', component: PersonnelDetail },
            { path: 'projects', component: ProjectList },
            { path: 'projects/:code', component: ProjectManagement },
            { path: 'uikit', loadChildren: () => import('./app/pages/uikit/uikit.routes') },
            { path: 'documentation', component: Documentation },
            { path: 'pages', loadChildren: () => import('./app/pages/pages.routes') }
        ]
    },
    { path: 'landing', component: Landing },
    { path: 'notfound', component: Notfound },
    { path: 'auth', loadChildren: () => import('./app/pages/auth/auth.routes') },
    { path: '**', redirectTo: '/notfound' }
];
