import { defineConfig } from 'wxt';

const ACTION_TITLE = '__MSG_actionTitle__';

export default defineConfig({
  hooks: {
    // WXT fills the action title from the popup page's <title>, which cannot be
    // localised; put the message reference back so the tooltip follows the UI language.
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.action) manifest.action.default_title = ACTION_TITLE;
    },
  },
  manifest: {
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // scripting + host access start Khatt in tabs that were already open at install or update.
    // Host access also lets the popup read the current tab's address.
    permissions: ['storage', 'scripting'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: ACTION_TITLE,
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
