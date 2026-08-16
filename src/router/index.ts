import type { RouteRecordRaw } from 'vue-router'

import { createRouter, createWebHashHistory } from 'vue-router'

import Bubble from '../pages/bubble/index.vue'
import Chat from '../pages/chat/index.vue'
import Composer from '../pages/composer/index.vue'
import Main from '../pages/main/index.vue'
import NotifyEdge from '../pages/notify-edge/index.vue'
import Preference from '../pages/preference/index.vue'

const routes: Readonly<RouteRecordRaw[]> = [
  {
    path: '/',
    component: Main,
  },
  {
    path: '/preference',
    component: Preference,
  },
  {
    path: '/chat',
    component: Chat,
  },
  {
    path: '/composer',
    component: Composer,
  },
  {
    path: '/bubble',
    component: Bubble,
  },
  {
    path: '/notify-edge',
    component: NotifyEdge,
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export default router
