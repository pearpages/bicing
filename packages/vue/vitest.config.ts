import vue from '@vitejs/plugin-vue';
import { defineProject } from 'vitest/config';

// SFCs need the Vue plugin, and mounting components needs a DOM.
export default defineProject({
  plugins: [vue()],
  test: { environment: 'jsdom' },
});
