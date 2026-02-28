import type { RouteRecordRaw } from "vue-router";

const routes: RouteRecordRaw[] = [
  {
    path: "/activate",
    component: () => import("pages/ActivationPage.vue"),
  },
  {
    path: "/",
    component: () => import("pages/IndexPage.vue"),
  },
  {
    path: "/workflow-editor/:id?",
    component: () => import("pages/WorkflowEditorPage.vue"),
  },
  {
    path: "/:catchAll(.*)*",
    component: () => import("pages/ErrorNotFound.vue"),
  },
];

export default routes;
