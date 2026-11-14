import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // activeTab lets the popup read the current tab's address when the icon is clicked.
    // scripting + host access start Khatt in tabs that were already open at install or update.
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_actionTitle__',
    },
    web_accessible_resources: [
      {
        resources: ['fonts/*'],
        matches: ['<all_urls>'],
        use_dynamic_url: true,
      },
    ],
  },
});
