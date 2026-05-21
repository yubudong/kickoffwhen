import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kickoffwhen.com',
  trailingSlash: 'always',
  integrations: [
    tailwind(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          ja: 'ja',
          ko: 'ko',
          zh: 'zh-Hant',
        },
      },
      filter: (page) => !page.endsWith('.ics'),
    }),
  ],
  i18n: {
    locales: ['en', 'ja', 'ko', 'zh'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
