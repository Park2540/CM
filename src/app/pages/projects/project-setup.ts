import { NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { debounceTime, map } from 'rxjs';
import { ApiProblem, problemMessage } from '@/app/api/api';
import { AuthService } from '@/app/pages/service/auth.service';
import { ConstructionOptionGroup, ConstructionOptionValue, CustomTask, ProjectSetupInput, ProjectSetupService, SetupOptions, SetupPreview, SetupPreviewTask, isOptionVisible } from '@/app/pages/service/project-setup.service';
import { InputTextModule } from 'primeng/inputtext';
import { ProjectService, isContracted } from '@/app/pages/service/project.service';
import { ThaiDatePipe } from './thai-date.pipe';

/**
 * ตั้งค่างานก่อสร้าง (หลังบันทึกสัญญา): เลือกว่าบ้านหลังนี้มีอะไรบ้าง เช่น จำนวนชั้น ประเภทฐานราก ระบบพิเศษ
 * หลังบ้านคัดงานจากแม่แบบตามตัวเลือกและสร้างไทม์ไลน์ — ฟอร์มสร้างจาก GET /settings/construction-options ทั้งหมด
 */
@Component({
    selector: 'app-project-setup',
    standalone: true,
    imports: [ButtonModule, DialogModule, InputTextModule, NgClass, RouterLink, SkeletonModule, TagModule, ThaiDatePipe, ToastModule],
    providers: [MessageService],
    template: `
        <p-toast />
        <a [routerLink]="['/projects', code()]" class="inline-flex items-center gap-2 text-muted-color hover:text-primary mb-4">
            <i class="pi pi-arrow-left"></i>
            <span>กลับไปหน้าโครงการ</span>
        </a>

        @if (projectResource.error()) {
            <div class="card flex items-start gap-3" role="alert">
                <i class="pi pi-exclamation-triangle mt-1"></i>
                <div>
                    <div class="font-semibold">เปิดหน้าตั้งค่าไม่ได้</div>
                    <div class="text-muted-color mt-1">{{ loadError() }}</div>
                </div>
            </div>
        } @else if (project(); as project) {
            <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                        <span class="px-2 py-1 rounded-md bg-emphasis text-sm font-semibold">{{ project.code }}</span>
                        @if (setup()?.configured) {
                            <p-tag value="ตั้งค่าแล้ว" severity="success" />
                        } @else {
                            <p-tag value="ยังไม่ได้ตั้งค่า" severity="warn" />
                        }
                    </div>
                    <h1 class="text-2xl font-bold m-0">ตั้งค่างานก่อสร้าง</h1>
                    <p class="text-muted-color mt-1 mb-0">{{ project.name }} · ระยะสัญญา {{ project.startDate | thaiDate }} – {{ project.deliveryDate | thaiDate }}</p>
                </div>
                @if (setup()?.configured && canEdit()) {
                    @if (editing()) {
                        <div class="flex flex-wrap gap-2">
                            <button pButton type="button" label="ยกเลิก" icon="pi pi-times" severity="secondary" [outlined]="true" [disabled]="saving()" (click)="cancelEdit()"></button>
                            <button pButton type="button" label="ยืนยันการแก้ไข" icon="pi pi-check" [disabled]="!dirty() || !preview()" (click)="confirmOpen.set(true)"></button>
                        </div>
                    } @else {
                        <button pButton type="button" label="แก้ไข" icon="pi pi-pencil" [outlined]="true" [disabled]="!preview()" (click)="startEdit()"></button>
                    }
                } @else if (setup()?.configured && canManage() && setup()?.locked) {
                    <!-- แสดงไว้ให้รู้ว่ามีการแก้ไข แต่ล็อกอยู่ (เหตุผลอยู่ในแถบด้านล่าง) -->
                    <button pButton type="button" label="แก้ไข" icon="pi pi-lock" [outlined]="true" [disabled]="true" aria-describedby="setup-lock-reason"></button>
                }
            </div>

            @if (editing()) {
                <div class="rounded-lg px-4 py-3 mb-6 flex items-start gap-3 bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-100" role="status">
                    <i class="pi pi-pencil mt-1"></i>
                    <div>
                        <div class="font-semibold">กำลังแก้ไขการตั้งค่า</div>
                        <div class="text-sm mt-1">เปลี่ยนตัวเลือกแล้วกด "ยืนยันการแก้ไข" — ไทม์ไลน์และงวดงานจะถูกสร้างใหม่ตามตัวเลือกใหม่ ถ้าไม่ต้องการเปลี่ยนให้กด "ยกเลิก"</div>
                    </div>
                </div>
            }

            @if (setup()?.locked) {
                <div class="rounded-lg px-4 py-3 mb-6 flex items-start gap-3 bg-surface-100 dark:bg-surface-800" role="status">
                    <i class="pi pi-lock mt-1"></i>
                    <div>
                        <div class="font-semibold">ดูได้อย่างเดียว</div>
                        <div id="setup-lock-reason" class="text-sm text-muted-color mt-1">{{ setup()?.lockedReason }}</div>
                    </div>
                </div>
            } @else if (!canManage()) {
                <div class="rounded-lg px-4 py-3 mb-6 flex items-start gap-3 bg-surface-100 dark:bg-surface-800" role="status">
                    <i class="pi pi-lock mt-1"></i>
                    <div class="text-sm">ต้องมีสิทธิ์จัดการโครงการจึงจะแก้การตั้งค่าได้</div>
                </div>
            }

            <div class="grid grid-cols-12 gap-6">
                <!-- ตัวเลือก -->
                <div class="col-span-12 xl:col-span-7 flex flex-col gap-6">
                    <nav class="card m-0 py-0 overflow-x-auto" aria-label="ขั้นตอนการตั้งค่า">
                        <div class="flex gap-1 min-w-max" role="tablist">
                            @for (item of steps; track item.value; let n = $index) {
                                <button
                                    type="button"
                                    role="tab"
                                    [id]="'setup-step-' + item.value"
                                    [attr.aria-selected]="step() === item.value"
                                    class="flex items-center gap-2 px-4 py-4 bg-transparent border-0 border-b-2 cursor-pointer whitespace-nowrap"
                                    [ngClass]="step() === item.value ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted-color hover:text-color'"
                                    (click)="step.set(item.value)"
                                >
                                    <span class="w-6 h-6 rounded-full text-xs flex items-center justify-center" [ngClass]="step() === item.value ? 'bg-primary text-primary-contrast' : 'bg-emphasis'">{{ n + 1 }}</span>
                                    {{ item.label }}
                                    @if (item.value === 'tasks' && preview(); as data) {
                                        <span class="text-xs px-2 py-0.5 rounded-full bg-emphasis text-color">{{ data.taskCount }} งาน</span>
                                    }
                                </button>
                            }
                        </div>
                    </nav>

                    @if (step() === 'tasks') {
                        <section class="card m-0" aria-labelledby="task-detail-heading">
                            <div class="flex flex-wrap justify-between items-start gap-3 mb-4">
                                <div class="min-w-0 flex-1">
                                    <h2 id="task-detail-heading" class="text-lg font-semibold m-0">งานย่อยรายขั้นตอน</h2>
                                    <p class="text-sm text-muted-color mt-1 mb-0">ระบบเลือกงานย่อยตามตัวเลือกในขั้นที่ 1 ให้แล้ว ติ๊กออกงานที่โครงการนี้ไม่ต้องทำ หรือเพิ่มงานเองในแต่ละขั้นตอน — จุดตรวจและหมุดหมายต้องมีทุกโครงการ</p>
                                </div>
                                <div class="flex gap-1">
                                    <button pButton type="button" [text]="true" size="small" label="เปิดทั้งหมด" (click)="expandAllTaskPhases()"></button>
                                    <button pButton type="button" [text]="true" size="small" label="ปิดทั้งหมด" (click)="taskPhases.set(emptySet())"></button>
                                </div>
                            </div>
                            @for (key of ['excludedTasks', 'customTasks']; track key) {
                                @if (errors()[key]) {
                                    <div class="rounded-lg px-3 py-2 mb-3 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ errors()[key] }}</div>
                                }
                            }

                            @if (preview(); as data) {
                                <ol class="list-none p-0 m-0">
                                    @for (phase of data.phases; track phase.code) {
                                        <li class="border-b border-surface last:border-b-0">
                                            <button
                                                type="button"
                                                class="w-full flex items-center gap-3 py-3 bg-transparent border-0 cursor-pointer text-left text-color"
                                                [attr.aria-expanded]="taskPhases().has(phase.code)"
                                                [attr.aria-controls]="'task-phase-' + phase.code"
                                                (click)="toggleTaskPhase(phase.code)"
                                            >
                                                <span class="w-8 h-8 rounded-full bg-emphasis font-semibold flex items-center justify-center shrink-0">{{ phase.step }}</span>
                                                <span class="flex-1 min-w-0">
                                                    <span class="block font-semibold">{{ phase.name }}</span>
                                                    <span class="block text-xs text-muted-color">{{ phase.start | thaiDate: 'dayMonth' }} – {{ phase.end | thaiDate: 'dayMonth' }}</span>
                                                </span>
                                                <span class="text-sm text-muted-color shrink-0">ใช้ {{ includedCount(phase.tasks) }}/{{ phase.tasks.length }} งาน</span>
                                                <i class="pi text-xs text-muted-color" [ngClass]="taskPhases().has(phase.code) ? 'pi-chevron-up' : 'pi-chevron-down'"></i>
                                            </button>

                                            @if (taskPhases().has(phase.code)) {
                                                <div [id]="'task-phase-' + phase.code" class="pb-4 sm:pl-11">
                                                    <ul class="list-none p-0 m-0 flex flex-col gap-1">
                                                        @for (task of phase.tasks; track task.code) {
                                                            <li class="task-row" [ngClass]="{ 'task-excluded': !task.included }">
                                                                <label class="flex items-start gap-3 flex-1 min-w-0" [class.cursor-pointer]="canToggle(task)">
                                                                    <input
                                                                        type="checkbox"
                                                                        class="mt-1 shrink-0 accent-[var(--p-primary-color)]"
                                                                        [checked]="task.included"
                                                                        [disabled]="!canToggle(task)"
                                                                        [attr.aria-describedby]="task.required ? 'required-task-note' : null"
                                                                        (change)="toggleTask(task.code)"
                                                                    />
                                                                    <span class="min-w-0 flex-1">
                                                                        <span class="block">
                                                                            <span class="text-muted-color mr-2 tabular-nums">{{ task.code }}</span>
                                                                            <span [class.line-through]="!task.included">{{ task.name }}</span>
                                                                            @if (task.isHoldPoint) {
                                                                                <span class="task-badge bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200"><i class="pi pi-lock text-[0.6rem] mr-1"></i>จุดตรวจ</span>
                                                                            }
                                                                            @if (task.isMilestone) {
                                                                                <span class="task-badge bg-emphasis text-muted-color"><i class="pi pi-lock text-[0.6rem] mr-1"></i>หมุดหมาย</span>
                                                                            }
                                                                            @if (task.optional) {
                                                                                <span class="task-badge text-primary border border-primary">ตามตัวเลือก</span>
                                                                            }
                                                                            @if (task.custom) {
                                                                                <span class="task-badge bg-primary text-primary-contrast">เพิ่มเอง</span>
                                                                            }
                                                                        </span>
                                                                        <span class="block text-xs text-muted-color mt-0.5">
                                                                            {{ task.team }} · {{ task.start | thaiDate: 'dayMonth' }}{{ task.end !== task.start ? ' – ' + (task.end | thaiDate: 'dayMonth') : '' }}
                                                                            @if (!task.included) {
                                                                                · ไม่อยู่ในไทม์ไลน์
                                                                            }
                                                                        </span>
                                                                        @if (task.customId && errors()['customTasks.' + task.customId]) {
                                                                            <small class="block text-red-600 dark:text-red-400">{{ errors()['customTasks.' + task.customId] }}</small>
                                                                        }
                                                                    </span>
                                                                </label>
                                                                @if (task.custom && !readOnly()) {
                                                                    <button
                                                                        pButton
                                                                        type="button"
                                                                        icon="pi pi-trash"
                                                                        [text]="true"
                                                                        [rounded]="true"
                                                                        severity="danger"
                                                                        size="small"
                                                                        [attr.aria-label]="'ลบงาน ' + task.name"
                                                                        (click)="removeCustom(task.customId!)"
                                                                    ></button>
                                                                }
                                                            </li>
                                                        }
                                                    </ul>

                                                    @if (!readOnly()) {
                                                        @if (adding(); as draft) {
                                                            @if (draft.phaseCode === phase.code) {
                                                                <form class="add-task mt-3" (submit)="$event.preventDefault(); addCustom()" [attr.aria-label]="'เพิ่มงานย่อยในขั้นตอน ' + phase.shortName">
                                                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                        <div class="sm:col-span-2">
                                                                            <label [for]="'new-task-name-' + phase.code" class="block text-sm font-semibold mb-1">ชื่องาน <span class="text-red-600" aria-hidden="true">*</span></label>
                                                                            <input
                                                                                pInputText
                                                                                [id]="'new-task-name-' + phase.code"
                                                                                class="w-full"
                                                                                maxlength="200"
                                                                                [value]="draft.name"
                                                                                (input)="patchAdding({ name: inputValue($event) })"
                                                                                [attr.aria-invalid]="!!addError()"
                                                                            />
                                                                        </div>
                                                                        <div>
                                                                            <label [for]="'new-task-team-' + phase.code" class="block text-sm font-semibold mb-1">ทีม/ผู้รับผิดชอบ</label>
                                                                            <input pInputText [id]="'new-task-team-' + phase.code" class="w-full" placeholder="ผู้รับเหมา" [value]="draft.team" (input)="patchAdding({ team: inputValue($event) })" />
                                                                        </div>
                                                                        <div>
                                                                            <label [for]="'new-task-days-' + phase.code" class="block text-sm font-semibold mb-1">ระยะเวลา (วัน) <span class="text-red-600" aria-hidden="true">*</span></label>
                                                                            <input
                                                                                pInputText
                                                                                type="number"
                                                                                min="1"
                                                                                max="120"
                                                                                step="1"
                                                                                [id]="'new-task-days-' + phase.code"
                                                                                class="w-full"
                                                                                [value]="draft.durationDays"
                                                                                (input)="patchAdding({ durationDays: +inputValue($event) })"
                                                                            />
                                                                        </div>
                                                                        <div class="sm:col-span-2">
                                                                            <label [for]="'new-task-after-' + phase.code" class="block text-sm font-semibold mb-1">ทำต่อจากงาน</label>
                                                                            <select [id]="'new-task-after-' + phase.code" class="native-select w-full" [value]="draft.afterCode" (change)="patchAdding({ afterCode: inputValue($event) })">
                                                                                @for (anchor of anchorTasks(phase.tasks); track anchor.code) {
                                                                                    <option [value]="anchor.code" [selected]="anchor.code === draft.afterCode">{{ anchor.code }} {{ anchor.name }}</option>
                                                                                }
                                                                            </select>
                                                                        </div>
                                                                        <label class="sm:col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                                                                            <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="draft.isHoldPoint" (change)="patchAdding({ isHoldPoint: !draft.isHoldPoint })" />
                                                                            เป็นจุดตรวจ (Hold Point) — ต้องผ่านการตรวจก่อนทำงานถัดไป
                                                                        </label>
                                                                    </div>
                                                                    @if (addError()) {
                                                                        <small class="block mt-2 text-red-600 dark:text-red-400" role="alert">{{ addError() }}</small>
                                                                    }
                                                                    <div class="flex justify-end gap-2 mt-3">
                                                                        <button pButton type="button" label="ยกเลิก" [text]="true" severity="secondary" (click)="adding.set(null)"></button>
                                                                        <button pButton type="submit" label="เพิ่มงาน" icon="pi pi-plus"></button>
                                                                    </div>
                                                                </form>
                                                            } @else {
                                                                <button pButton type="button" class="mt-2" [text]="true" size="small" icon="pi pi-plus" label="เพิ่มงานย่อยในขั้นตอนนี้" (click)="startAdd(phase.code, phase.tasks)"></button>
                                                            }
                                                        } @else {
                                                            <button pButton type="button" class="mt-2" [text]="true" size="small" icon="pi pi-plus" label="เพิ่มงานย่อยในขั้นตอนนี้" (click)="startAdd(phase.code, phase.tasks)"></button>
                                                        }
                                                    }
                                                </div>
                                            }
                                        </li>
                                    }
                                </ol>
                                <p id="required-task-note" class="text-xs text-muted-color mt-4 mb-0">
                                    <i class="pi pi-lock text-[0.65rem] mr-1"></i>จุดตรวจและหมุดหมายตัดออกไม่ได้ · งานที่เพิ่มเองลบได้ด้วยปุ่มถังขยะ · วันที่จัดให้พอดีกับระยะสัญญาโดยอัตโนมัติ
                                </p>
                            } @else {
                                <p-skeleton height="20rem" />
                            }
                        </section>
                    } @else {
                        @if (optionsResource.isLoading() || setupResource.isLoading()) {
                            @for (i of [1, 2, 3]; track i) {
                                <div class="card m-0"><p-skeleton height="8rem" /></div>
                            }
                        }
                        @for (section of sections(); track section.name; let i = $index) {
                            <section class="card m-0" [attr.aria-labelledby]="'setup-section-' + i">
                                <h2 [id]="'setup-section-' + i" class="text-lg font-semibold m-0 mb-4">{{ i + 1 }}. {{ section.name }}</h2>
                                <div class="flex flex-col gap-5">
                                    @for (group of section.groups; track group.key) {
                                        @if (isVisible(group)) {
                                            <div>
                                                <fieldset class="border-0 p-0 m-0 min-w-0" [disabled]="readOnly()">
                                                    @if (group.type !== 'boolean') {
                                                        <legend class="font-semibold mb-1 p-0">{{ group.label }}</legend>
                                                        @if (group.description) {
                                                            <p class="text-sm text-muted-color mt-0 mb-3">{{ group.description }}</p>
                                                        } @else {
                                                            <div class="mb-3"></div>
                                                        }
                                                    }

                                                    @switch (group.type) {
                                                        @case ('single') {
                                                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                @for (choice of group.choices; track choice.value) {
                                                                    <label class="choice" [ngClass]="{ 'choice-active': selected()[group.key] === choice.value }">
                                                                        <input
                                                                            type="radio"
                                                                            class="mt-1 accent-[var(--p-primary-color)]"
                                                                            [name]="group.key"
                                                                            [value]="choice.value"
                                                                            [checked]="selected()[group.key] === choice.value"
                                                                            (change)="setValue(group.key, choice.value)"
                                                                        />
                                                                        <span>
                                                                            <span class="block font-semibold">{{ choice.label }}</span>
                                                                            @if (choice.description) {
                                                                                <span class="block text-sm text-muted-color mt-1">{{ choice.description }}</span>
                                                                            }
                                                                        </span>
                                                                    </label>
                                                                }
                                                            </div>
                                                        }
                                                        @case ('multiple') {
                                                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                @for (choice of group.choices; track choice.value) {
                                                                    <label class="choice" [ngClass]="{ 'choice-active': isChecked(group.key, choice.value) }">
                                                                        <input type="checkbox" class="mt-1 accent-[var(--p-primary-color)]" [checked]="isChecked(group.key, choice.value)" (change)="toggleChoice(group.key, choice.value)" />
                                                                        <span>
                                                                            <span class="block font-semibold">{{ choice.label }}</span>
                                                                            @if (choice.description) {
                                                                                <span class="block text-sm text-muted-color mt-1">{{ choice.description }}</span>
                                                                            }
                                                                        </span>
                                                                    </label>
                                                                }
                                                            </div>
                                                        }
                                                        @case ('boolean') {
                                                            <label class="choice" [ngClass]="{ 'choice-active': selected()[group.key] === true }">
                                                                <input type="checkbox" class="mt-1 accent-[var(--p-primary-color)]" [checked]="selected()[group.key] === true" (change)="setValue(group.key, selected()[group.key] !== true)" />
                                                                <span>
                                                                    <span class="block font-semibold">{{ group.label }}</span>
                                                                    @if (group.description) {
                                                                        <span class="block text-sm text-muted-color mt-1">{{ group.description }}</span>
                                                                    }
                                                                </span>
                                                            </label>
                                                        }
                                                    }
                                                    @if (errors()[group.key]) {
                                                        <small class="block mt-2 text-red-600 dark:text-red-400">{{ errors()[group.key] }}</small>
                                                    }
                                                </fieldset>
                                                @if (group.affectsPhases.length) {
                                                    <div class="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-muted-color">
                                                        <span>มีผลกับขั้นตอน:</span>
                                                        @for (phase of group.affectsPhases; track phase.code) {
                                                            <button type="button" class="phase-chip" [attr.aria-label]="'ดูงานขั้นตอน ' + phase.shortName + ' ในตัวอย่าง'" (click)="showPhase(phase.code)">{{ phase.shortName }}</button>
                                                        }
                                                    </div>
                                                }
                                            </div>
                                        }
                                    }
                                </div>
                            </section>
                        }
                        @if (sections().length) {
                            <div class="flex justify-end">
                                <button pButton type="button" label="ถัดไป: เลือกงานย่อยรายขั้นตอน" icon="pi pi-arrow-right" iconPos="right" [outlined]="true" (click)="goToTasks()"></button>
                            </div>
                        }
                    }
                </div>

                <!-- ตัวอย่างไทม์ไลน์ -->
                <aside class="col-span-12 xl:col-span-5" aria-labelledby="preview-heading">
                    <div class="card m-0 xl:sticky xl:top-24">
                        <div class="flex items-center justify-between gap-2 mb-4">
                            <h2 id="preview-heading" class="text-lg font-semibold m-0">งานที่จะอยู่ในไทม์ไลน์</h2>
                            @if (previewResource.isLoading()) {
                                <i class="pi pi-spin pi-spinner text-muted-color" aria-label="กำลังคำนวณ"></i>
                            }
                        </div>

                        @if (preview(); as preview) {
                            <dl class="grid grid-cols-3 gap-3 m-0 mb-4 text-center" aria-live="polite">
                                <div class="rounded-lg p-3 bg-emphasis">
                                    <dt class="text-xs text-muted-color">งานทั้งหมด</dt>
                                    <dd class="m-0 text-2xl font-bold">{{ preview.taskCount }}</dd>
                                </div>
                                <div class="rounded-lg p-3 bg-emphasis">
                                    <dt class="text-xs text-muted-color">จุดตรวจ</dt>
                                    <dd class="m-0 text-2xl font-bold">{{ preview.holdPointCount }}</dd>
                                </div>
                                <div class="rounded-lg p-3 bg-emphasis">
                                    <dt class="text-xs text-muted-color">ตามตัวเลือก</dt>
                                    <dd class="m-0 text-2xl font-bold text-primary">{{ preview.optionalTaskCount }}</dd>
                                </div>
                            </dl>
                            @if (preview.excludedCount || preview.customCount) {
                                <p class="text-sm m-0 mb-4">
                                    <i class="pi pi-sliders-h text-muted-color mr-1"></i>ปรับงานย่อย: ตัดออก {{ preview.excludedCount }} งาน · เพิ่มเอง {{ preview.customCount }} งาน
                                    <button type="button" class="link-button" (click)="step.set('tasks')">ดูรายละเอียด</button>
                                </p>
                            }

                            @if (step() === 'options') {
                                <label class="flex items-center gap-2 text-sm mb-3 cursor-pointer">
                                    <input type="checkbox" class="accent-[var(--p-primary-color)]" [checked]="onlyOptional()" (change)="onlyOptional.set(!onlyOptional())" />
                                    แสดงเฉพาะงานที่มาจากตัวเลือก
                                </label>

                                <ol class="list-none p-0 m-0 flex flex-col gap-1 max-h-[28rem] overflow-y-auto pr-1">
                                    @for (phase of preview.phases; track phase.code) {
                                        @let tasks = onlyOptional() ? optionalTasks(phase.tasks) : phase.tasks;
                                        @if (tasks.length) {
                                            <li [id]="'preview-phase-' + phase.code">
                                                <button
                                                    type="button"
                                                    class="w-full flex items-center gap-3 px-2 py-2 rounded-lg border-0 bg-transparent cursor-pointer text-left text-color hover:bg-emphasis"
                                                    [attr.aria-expanded]="expanded().has(phase.code)"
                                                    (click)="togglePhase(phase.code)"
                                                >
                                                    <span class="w-7 h-7 rounded-full bg-emphasis text-sm font-semibold flex items-center justify-center shrink-0">{{ phase.step }}</span>
                                                    <span class="flex-1 min-w-0">
                                                        <span class="block font-semibold truncate">{{ phase.shortName }}</span>
                                                        <span class="block text-xs text-muted-color">{{ phase.start | thaiDate: 'dayMonth' }} – {{ phase.end | thaiDate: 'dayMonth' }}</span>
                                                    </span>
                                                    <span class="text-sm text-muted-color shrink-0">{{ tasks.length }} งาน</span>
                                                    @if (optionalTasks(phase.tasks).length) {
                                                        <span class="text-xs font-semibold text-primary shrink-0">+{{ optionalTasks(phase.tasks).length }}</span>
                                                    }
                                                    <i class="pi text-xs text-muted-color" [ngClass]="expanded().has(phase.code) ? 'pi-chevron-up' : 'pi-chevron-down'"></i>
                                                </button>
                                                @if (expanded().has(phase.code)) {
                                                    <ul class="list-none p-0 m-0 ml-12 mb-2 flex flex-col gap-1.5">
                                                        @for (task of tasks; track $index) {
                                                            <li class="text-sm flex items-start gap-2" [ngClass]="{ 'text-primary': task.optional }">
                                                                <span class="text-muted-color w-10 shrink-0">{{ task.code }}</span>
                                                                <span class="flex-1">
                                                                    {{ task.name }}
                                                                    @if (task.isHoldPoint) {
                                                                        <span class="ml-1 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200">จุดตรวจ</span>
                                                                    }
                                                                    @if (task.isMilestone) {
                                                                        <span class="ml-1 text-xs px-1.5 py-0.5 rounded bg-emphasis text-muted-color">หมุดหมาย</span>
                                                                    }
                                                                </span>
                                                            </li>
                                                        }
                                                    </ul>
                                                }
                                            </li>
                                        }
                                    }
                                </ol>
                                <p class="text-xs text-muted-color mt-3 mb-0"><span class="text-primary font-semibold">สีหลัก</span> = งานที่เพิ่มเพราะตัวเลือก · วันที่จัดให้พอดีกับระยะสัญญาโดยอัตโนมัติ</p>
                            }
                        } @else {
                            <p-skeleton height="16rem" />
                        }

                        @if (generalError()) {
                            <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
                        }

                        @if (editing()) {
                            <div class="flex flex-col gap-2 mt-5 pt-4 border-t border-surface">
                                <p class="text-sm m-0" [class.text-muted-color]="!dirty()">
                                    @if (dirty()) {
                                        เปลี่ยน {{ changes().length }} รายการ
                                        @if (baseline() && preview()) {
                                            · งาน {{ baseline()?.taskCount }} → {{ preview()?.taskCount }}
                                        }
                                    } @else {
                                        ยังไม่มีการเปลี่ยนแปลง
                                    }
                                </p>
                                <div class="grid grid-cols-2 gap-2">
                                    <button pButton type="button" label="ยกเลิก" severity="secondary" [outlined]="true" [disabled]="saving()" (click)="cancelEdit()"></button>
                                    <button pButton type="button" label="ยืนยันการแก้ไข" icon="pi pi-check" [disabled]="!dirty() || !preview()" (click)="confirmOpen.set(true)"></button>
                                </div>
                            </div>
                        } @else if (!setup()?.configured && canEdit()) {
                            <div class="mt-5 pt-4 border-t border-surface">
                                <button pButton type="button" icon="pi pi-check" class="w-full" label="บันทึกและสร้างไทม์ไลน์" [loading]="saving()" [disabled]="!preview()" (click)="save()"></button>
                            </div>
                        } @else if (setup()?.configuredAt) {
                            <div class="flex flex-wrap items-center justify-between gap-2 mt-5 pt-4 border-t border-surface">
                                <p class="text-sm text-muted-color m-0">ตั้งค่าโดย {{ setup()?.configuredBy }} เมื่อ {{ setup()?.configuredAt | thaiDate: 'dateTime' }}</p>
                                @if (canEdit()) {
                                    <button pButton type="button" label="แก้ไข" icon="pi pi-pencil" size="small" [outlined]="true" [disabled]="!preview()" (click)="startEdit()"></button>
                                }
                            </div>
                        }
                    </div>
                </aside>
            </div>

            <p-dialog [visible]="confirmOpen()" (visibleChange)="!$event && !saving() && confirmOpen.set(false)" [modal]="true" [draggable]="false" [closable]="!saving()" [style]="{ width: 'min(36rem, 95vw)' }" header="ยืนยันการแก้ไขการตั้งค่า">
                <p class="mt-0 mb-4">ตรวจสอบรายการที่เปลี่ยน เมื่อยืนยัน ระบบจะสร้างไทม์ไลน์และงวดงานของ {{ project.code }} ใหม่ตามตัวเลือกนี้</p>
                <table class="w-full text-sm border-collapse">
                    <caption class="sr-only">
                        ตัวเลือกที่เปลี่ยน
                    </caption>
                    <thead>
                        <tr class="border-b border-surface text-left text-muted-color">
                            <th scope="col" class="py-2 pr-3 font-semibold">ตัวเลือก</th>
                            <th scope="col" class="py-2 pr-3 font-semibold">เดิม</th>
                            <th scope="col" class="py-2 font-semibold">ใหม่</th>
                        </tr>
                    </thead>
                    <tbody>
                        @for (change of changes(); track change.key) {
                            <tr class="border-b border-surface align-top">
                                <th scope="row" class="py-2 pr-3 font-semibold text-left">{{ change.label }}</th>
                                <td class="py-2 pr-3 text-muted-color line-through">{{ change.from }}</td>
                                <td class="py-2 text-primary font-semibold">{{ change.to }}</td>
                            </tr>
                        }
                    </tbody>
                </table>
                @if (baseline(); as before) {
                    @if (preview(); as after) {
                        <div class="grid grid-cols-2 gap-3 mt-4 text-sm">
                            <div class="rounded-lg p-3 bg-emphasis">
                                <div class="text-muted-color">จำนวนงาน</div>
                                <div class="font-semibold mt-1">{{ before.taskCount }} → {{ after.taskCount }} ({{ signed(after.taskCount - before.taskCount) }})</div>
                            </div>
                            <div class="rounded-lg p-3 bg-emphasis">
                                <div class="text-muted-color">จุดตรวจ (Hold Point)</div>
                                <div class="font-semibold mt-1">{{ before.holdPointCount }} → {{ after.holdPointCount }} ({{ signed(after.holdPointCount - before.holdPointCount) }})</div>
                            </div>
                        </div>
                    }
                }
                @if (generalError()) {
                    <div class="rounded-lg px-3 py-2 mt-4 text-sm bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-200" role="alert">{{ generalError() }}</div>
                }
                <ng-template #footer>
                    <button pButton type="button" label="กลับไปแก้ไข" [text]="true" severity="secondary" [disabled]="saving()" (click)="confirmOpen.set(false)"></button>
                    <button pButton type="button" label="ยืนยันและสร้างไทม์ไลน์ใหม่" icon="pi pi-check" [loading]="saving()" (click)="save()"></button>
                </ng-template>
            </p-dialog>
        } @else {
            <div class="card"><p-skeleton height="20rem" /></div>
        }
    `,
    styles: `
        .choice {
            display: flex;
            align-items: flex-start;
            gap: 0.75rem;
            padding: 0.875rem 1rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: var(--p-content-border-radius);
            cursor: pointer;
            transition: border-color 0.15s;
        }
        .choice:hover {
            border-color: var(--p-primary-color);
        }
        .choice-active {
            border-color: var(--p-primary-color);
            background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
        }
        .task-row {
            display: flex;
            align-items: flex-start;
            gap: 0.5rem;
            padding: 0.5rem 0.625rem;
            border-radius: var(--p-content-border-radius);
        }
        .task-row:hover {
            background: var(--p-content-hover-background);
        }
        .task-excluded {
            color: var(--p-text-muted-color);
        }
        .task-badge {
            display: inline-flex;
            align-items: center;
            margin-left: 0.375rem;
            padding: 0 0.375rem;
            border-radius: 0.25rem;
            font-size: 0.7rem;
            line-height: 1.25rem;
            white-space: nowrap;
        }
        .add-task {
            padding: 1rem;
            border: 1px dashed var(--p-primary-color);
            border-radius: var(--p-content-border-radius);
        }
        .native-select {
            padding: 0.5rem 0.75rem;
            border: 1px solid var(--p-inputtext-border-color, var(--p-content-border-color));
            border-radius: var(--p-inputtext-border-radius, 6px);
            background: var(--p-inputtext-background, transparent);
            color: var(--p-text-color);
            font: inherit;
        }
        .link-button {
            margin-left: 0.25rem;
            padding: 0;
            border: 0;
            background: transparent;
            color: var(--p-primary-color);
            font: inherit;
            text-decoration: underline;
            cursor: pointer;
        }
        .phase-chip {
            padding: 0.125rem 0.5rem;
            border: 1px solid var(--p-content-border-color);
            border-radius: 999px;
            background: transparent;
            color: inherit;
            font-size: inherit;
            cursor: pointer;
        }
        .phase-chip:hover {
            border-color: var(--p-primary-color);
            color: var(--p-primary-color);
        }
        fieldset:disabled .choice {
            cursor: default;
        }
        fieldset:disabled .choice:hover {
            border-color: var(--p-content-border-color);
        }
        fieldset:disabled .choice:not(.choice-active) {
            opacity: 0.55;
        }
        fieldset:disabled .choice-active:hover {
            border-color: var(--p-primary-color);
        }
    `
})
export class ProjectSetup {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly auth = inject(AuthService);
    private readonly projectService = inject(ProjectService);
    private readonly setupService = inject(ProjectSetupService);
    private readonly messages = inject(MessageService);

    readonly code = toSignal(this.route.paramMap.pipe(map((params) => params.get('code') ?? '')), { initialValue: '' });

    readonly projectResource = rxResource({ params: () => this.code() || undefined, stream: ({ params: code }) => this.projectService.get(code) });
    readonly project = computed(() => {
        const project = this.projectResource.value();
        return isContracted(project) ? project : null;
    });
    readonly loadError = computed(() => problemMessage(this.projectResource.error(), 'ไม่พบโครงการ'));

    readonly optionsResource = rxResource({ stream: () => this.setupService.options(), defaultValue: [] });
    readonly setupResource = rxResource({ params: () => (this.project() ? this.code() : undefined), stream: ({ params: code }) => this.setupService.get(code) });
    readonly setup = computed(() => this.setupResource.value());

    readonly canManage = computed(() => this.auth.can('project.manage'));
    /** แก้ได้เมื่อมีสิทธิ์และยังไม่เริ่มรายงานความคืบหน้า */
    readonly canEdit = computed(() => this.canManage() && !!this.setup() && !this.setup()!.locked);
    /** โครงการที่ตั้งค่าแล้วเปิดมาแบบดูอย่างเดียว ต้องกด "แก้ไข" ก่อน; ตั้งค่าครั้งแรกแก้ได้ทันที */
    readonly editing = signal(false);
    readonly readOnly = computed(() => !this.canEdit() || (!!this.setup()?.configured && !this.editing()));
    readonly confirmOpen = signal(false);

    /** ค่าที่กำลังเลือก เริ่มจากค่าที่บันทึกไว้ (หรือค่าเริ่มต้นจากหลังบ้าน) */
    readonly selected = linkedSignal<SetupOptions>(() => this.setup()?.options ?? {});
    /** ค่าที่จะส่งจริง: ตัวเลือกที่ถูกซ่อน (visibleWhen ไม่ตรง) กลับเป็นค่าเริ่มต้น เหมือนที่หลังบ้านทำ */
    readonly normalized = computed<SetupOptions>(() => {
        const options = { ...this.selected() };
        for (const group of this.optionsResource.value()) if (!isOptionVisible(group, options)) options[group.key] = group.default;
        return options;
    });
    readonly dirty = computed(() => this.changes().length > 0);
    /** รายการที่เปลี่ยนจากค่าที่บันทึกไว้ สำหรับหน้ายืนยัน */
    readonly changes = computed(() => {
        const saved = this.setup()?.options ?? {};
        const current = this.normalized();
        return this.optionsResource
            .value()
            .filter((group) => JSON.stringify(current[group.key]) !== JSON.stringify(saved[group.key]))
            .map((group) => ({ key: group.key, label: group.label, from: this.describe(group, saved[group.key]), to: this.describe(group, current[group.key]) }))
            .concat(this.taskChanges());
    });
    /** การเปลี่ยนแปลงงานย่อย (ขั้นที่ 2) สำหรับหน้ายืนยัน */
    private readonly taskChanges = computed(() => {
        const rows: Array<{ key: string; label: string; from: string; to: string }> = [];
        const names = new Map((this.preview()?.phases ?? []).flatMap((phase) => phase.tasks).map((task) => [task.code, task.name]));
        const describeCodes = (codes: string[]) =>
            codes.length
                ? [...codes]
                      .sort()
                      .map((code) => `${code} ${names.get(code) ?? ''}`.trim())
                      .join(', ')
                : 'ไม่มี';
        const savedExcluded = [...(this.setup()?.excludedTasks ?? [])].sort();
        const excluded = [...this.excludedTasks()].sort();
        if (JSON.stringify(savedExcluded) !== JSON.stringify(excluded)) rows.push({ key: 'excludedTasks', label: 'งานย่อยที่ตัดออก', from: describeCodes(savedExcluded), to: describeCodes(excluded) });
        const describeCustom = (tasks: CustomTask[]) => (tasks.length ? tasks.map((task) => `${task.name} (${task.durationDays} วัน)`).join(', ') : 'ไม่มี');
        const savedCustom = this.setup()?.customTasks ?? [];
        if (JSON.stringify(savedCustom) !== JSON.stringify(this.customTasks())) rows.push({ key: 'customTasks', label: 'งานที่เพิ่มเอง', from: describeCustom(savedCustom), to: describeCustom(this.customTasks()) });
        return rows;
    });
    /** งานย่อยจากแม่แบบที่ตัดออก และงานที่เพิ่มเอง (ขั้นที่ 2) */
    readonly excludedTasks = linkedSignal<string[]>(() => this.setup()?.excludedTasks ?? []);
    readonly customTasks = linkedSignal<CustomTask[]>(() => this.setup()?.customTasks ?? []);
    /** สิ่งที่ส่งให้หลังบ้าน (ตัวอย่างและบันทึก) */
    readonly draft = computed<ProjectSetupInput>(() => ({ options: this.normalized(), excludedTasks: this.excludedTasks(), customTasks: this.customTasks() }));

    /** ตัวอย่างงานของการตั้งค่าที่บันทึกไว้ (เก็บไว้ตอนเริ่มแก้ไข เพื่อเทียบจำนวนงาน) */
    readonly baseline = signal<SetupPreview | undefined>(undefined);

    readonly sections = computed(() => {
        const sections: Array<{ name: string; groups: ConstructionOptionGroup[] }> = [];
        for (const group of this.setup() ? this.optionsResource.value() : []) {
            const section = sections.find((item) => item.name === group.section) ?? sections[sections.push({ name: group.section, groups: [] }) - 1];
            section.groups.push(group);
        }
        return sections;
    });

    private readonly debouncedDraft = toSignal(toObservable(this.draft).pipe(debounceTime(250)));
    readonly previewResource = rxResource({
        params: () => {
            const input = this.debouncedDraft();
            return this.setup() && input && Object.keys(input.options).length ? { code: this.code(), input } : undefined;
        },
        stream: ({ params }) => this.setupService.preview(params.code, params.input)
    });
    readonly preview = computed(() => (this.previewResource.hasValue() ? this.previewResource.value() : undefined));

    readonly onlyOptional = signal(false);
    /** ขั้นตอนที่เปิดดูรายการงาน — เริ่มจากขั้นตอนฐานราก (ตัวอย่างที่ตัวเลือกมีผลชัดที่สุด) */
    readonly expanded = signal(new Set<string>(['05']));
    readonly steps: Array<{ value: 'options' | 'tasks'; label: string }> = [
        { value: 'options', label: 'ตัวเลือกงาน' },
        { value: 'tasks', label: 'งานย่อยรายขั้นตอน' }
    ];
    readonly step = signal<'options' | 'tasks'>('options');
    /** ขั้นตอนที่เปิดดูในขั้นที่ 2 */
    readonly taskPhases = signal(new Set<string>(['01']));
    /** ฟอร์มเพิ่มงานเอง (เปิดได้ทีละขั้นตอน) */
    readonly adding = signal<{ phaseCode: string; name: string; team: string; afterCode: string; durationDays: number; isHoldPoint: boolean } | null>(null);
    readonly addError = signal('');
    readonly saving = signal(false);
    readonly errors = signal<Record<string, string>>({});
    readonly generalError = signal('');

    isVisible(group: ConstructionOptionGroup) {
        return isOptionVisible(group, this.selected());
    }

    isChecked(key: string, value: string) {
        const current = this.selected()[key];
        return Array.isArray(current) && current.includes(value);
    }

    setValue(key: string, value: ConstructionOptionValue) {
        this.selected.update((options) => ({ ...options, [key]: value }));
    }

    toggleChoice(key: string, value: string) {
        const current = this.selected()[key];
        const list = Array.isArray(current) ? current : [];
        this.setValue(key, list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
    }

    optionalTasks<T extends { optional: boolean }>(tasks: T[]) {
        return tasks.filter((task) => task.optional);
    }

    /** เปิดรายการงานของขั้นตอนนั้นในตัวอย่างและเลื่อนไปให้เห็น */
    showPhase(code: string) {
        this.expanded.update((set) => new Set(set).add(code));
        setTimeout(() => document.getElementById(`preview-phase-${code}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }

    togglePhase(code: string) {
        this.expanded.update((set) => {
            const next = new Set(set);
            if (!next.delete(code)) next.add(code);
            return next;
        });
    }

    goToTasks() {
        this.step.set('tasks');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    emptySet() {
        return new Set<string>();
    }

    expandAllTaskPhases() {
        this.taskPhases.set(new Set((this.preview()?.phases ?? []).map((phase) => phase.code)));
    }

    toggleTaskPhase(code: string) {
        this.taskPhases.update((set) => {
            const next = new Set(set);
            if (!next.delete(code)) next.add(code);
            return next;
        });
    }

    includedCount(tasks: SetupPreviewTask[]) {
        return tasks.filter((task) => task.included).length;
    }

    /** ตัดออก/เลือกกลับได้เฉพาะงานจากแม่แบบที่ไม่ใช่จุดตรวจ/หมุดหมาย (งานที่เพิ่มเองใช้ปุ่มลบ) */
    canToggle(task: SetupPreviewTask) {
        return !this.readOnly() && !task.required && !task.custom;
    }

    toggleTask(code: string) {
        this.excludedTasks.update((list) => (list.includes(code) ? list.filter((item) => item !== code) : [...list, code]));
    }

    /** งานที่ใช้เป็นจุดอ้างอิง "ทำต่อจาก" ได้ (งานจากแม่แบบที่ไม่ใช่หมุดหมาย) */
    anchorTasks(tasks: SetupPreviewTask[]) {
        return tasks.filter((task) => !task.custom && !task.isMilestone);
    }

    startAdd(phaseCode: string, tasks: SetupPreviewTask[]) {
        this.addError.set('');
        this.adding.set({ phaseCode, name: '', team: '', afterCode: this.anchorTasks(tasks).at(-1)?.code ?? '', durationDays: 1, isHoldPoint: false });
        setTimeout(() => document.getElementById(`new-task-name-${phaseCode}`)?.focus());
    }

    patchAdding(patch: Partial<{ name: string; team: string; afterCode: string; durationDays: number; isHoldPoint: boolean }>) {
        this.adding.update((draft) => (draft ? { ...draft, ...patch } : draft));
    }

    inputValue(event: Event) {
        return (event.target as HTMLInputElement | HTMLSelectElement).value;
    }

    addCustom() {
        const draft = this.adding();
        if (!draft) return;
        const name = draft.name.trim();
        if (!name) return this.addError.set('กรุณาระบุชื่องาน');
        if (!Number.isInteger(draft.durationDays) || draft.durationDays < 1 || draft.durationDays > 120) return this.addError.set('ระยะเวลาต้องเป็นจำนวนเต็ม 1-120 วัน');
        const task: CustomTask = {
            id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            phaseCode: draft.phaseCode,
            name,
            durationDays: draft.durationDays,
            isHoldPoint: draft.isHoldPoint,
            ...(draft.team.trim() ? { team: draft.team.trim() } : {}),
            ...(draft.afterCode ? { afterCode: draft.afterCode } : {})
        };
        this.customTasks.update((list) => [...list, task]);
        this.adding.set(null);
    }

    removeCustom(id: string) {
        this.customTasks.update((list) => list.filter((task) => task.id !== id));
    }

    startEdit() {
        this.baseline.set(this.preview());
        this.errors.set({});
        this.generalError.set('');
        this.editing.set(true);
    }

    cancelEdit() {
        this.selected.set(this.setup()?.options ?? {});
        this.excludedTasks.set(this.setup()?.excludedTasks ?? []);
        this.customTasks.set(this.setup()?.customTasks ?? []);
        this.adding.set(null);
        this.errors.set({});
        this.generalError.set('');
        this.editing.set(false);
    }

    signed(value: number) {
        return value > 0 ? `+${value}` : value === 0 ? 'เท่าเดิม' : String(value);
    }

    private describe(group: ConstructionOptionGroup, value: ConstructionOptionValue | undefined): string {
        const label = (item: string) => group.choices.find((choice) => choice.value === item)?.label ?? item;
        if (group.type === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
        if (Array.isArray(value)) return value.length ? value.map(label).join(', ') : 'ไม่มี';
        return value === undefined ? '-' : label(String(value));
    }

    save() {
        const isEdit = !!this.setup()?.configured;
        this.saving.set(true);
        this.errors.set({});
        this.generalError.set('');
        this.setupService.save(this.code(), this.draft()).subscribe({
            next: (setup) => {
                if (!isEdit) {
                    this.router.navigate(['/projects', this.code()], { queryParams: { tab: 'timeline' } });
                    return;
                }
                this.saving.set(false);
                this.confirmOpen.set(false);
                this.editing.set(false);
                this.setupResource.set(setup);
                this.messages.add({ severity: 'success', summary: 'บันทึกการแก้ไขแล้ว', detail: 'สร้างไทม์ไลน์และงวดงานใหม่ตามการตั้งค่าแล้ว' });
            },
            error: (error) => {
                this.saving.set(false);
                const problem = error instanceof HttpErrorResponse ? (error.error as Partial<ApiProblem> | null) : null;
                if (problem?.errors) {
                    this.errors.set(problem.errors);
                    // ข้อผิดพลาดของงานย่อยอยู่ในขั้นที่ 2
                    if (Object.keys(problem.errors).some((key) => key.startsWith('excludedTasks') || key.startsWith('customTasks'))) this.step.set('tasks');
                }
                this.generalError.set(problemMessage(error, 'บันทึกการตั้งค่าไม่สำเร็จ'));
            }
        });
    }
}
