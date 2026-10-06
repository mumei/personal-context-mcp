/**
 * Provides index capabilities for the web UI layer.
 * Responsibility: This module owns the index behavior and contracts declared here.
 * Non-responsibility: This module does not own unrelated workflows or concerns assigned to other layers.
 *
 * Web UI層のindex機能を提供します。
 * 責務: このモジュールは、ここで宣言するindexの振る舞いと契約を担当します。
 * 非責務: このモジュールは、無関係なワークフローや他の層に割り当てられた関心事を担当しません。
 *
 * @packageDocumentation
 */

import { createRouter, createWebHistory } from "vue-router";
import { initialRouteToRestore, readWebRequestContext } from "#webUi/navigation/requestContext";
import ActivityPage from "#webUi/pages/ActivityPage.vue";
import GlobalPage from "#webUi/pages/GlobalPage.vue";
import HelpPage from "#webUi/pages/HelpPage.vue";
import KnowledgePage from "#webUi/pages/KnowledgePage.vue";
import PeoplePage from "#webUi/pages/PeoplePage.vue";
import ReportPage from "#webUi/pages/ReportPage.vue";
import SettingsPage from "#webUi/pages/SettingsPage.vue";
import SummaryPage from "#webUi/pages/SummaryPage.vue";
import TaskPage from "#webUi/pages/TaskPage.vue";
import TicketsPage from "#webUi/pages/TicketsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/summary" },
    { path: "/summary", name: "summary", component: SummaryPage },
    { path: "/activity", name: "activity", component: ActivityPage },
    { path: "/tickets", name: "tickets", component: TicketsPage },
    { path: "/report/:format(text|markdown)?", name: "report", component: ReportPage },
    { path: "/global", name: "global", component: GlobalPage },
    { path: "/knowledge", name: "knowledge", component: KnowledgePage },
    { path: "/people/:personId?", name: "people", component: PeoplePage },
    { path: "/help", name: "help", component: HelpPage },
    { path: "/settings", name: "settings", component: SettingsPage },
    { path: "/tasks/:taskId/:view(current|overview|context|memory)?", name: "task", component: TaskPage },
    { path: "/:pathMatch(.*)*", redirect: "/summary" },
  ],
});

const serverRequestedRoute = readWebRequestContext();
let initialRoutePending = true;
router.beforeEach((to) => {
  if (!initialRoutePending) return true;
  initialRoutePending = false;
  return initialRouteToRestore(serverRequestedRoute, to.fullPath) ?? true;
});
