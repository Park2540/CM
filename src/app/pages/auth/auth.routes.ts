import { Routes } from '@angular/router';
import { guestGuard } from '@/app/pages/service/auth.guard';
import { Login } from './login';
import { Register } from './register';

export default [
    { path: 'login', component: Login, canActivate: [guestGuard] },
    { path: 'register', component: Register, canActivate: [guestGuard] }
] as Routes;
