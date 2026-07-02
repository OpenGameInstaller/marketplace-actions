#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const marketplacePath = 'marketplace.json';
const issueTemplatePath = '.github/ISSUE_TEMPLATE/addon-update.yml';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^.*[:/]([^/]+?)(?:\.git)?$/i, '$1')
    .replace(/\.git$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferAddonId(addon) {
  return (
    addon.id ||
    addon.addonId ||
    addon.addon_id ||
    slugify(addon.source || addon.git || addon.repositoryUrl || addon.url || addon.name)
  );
}

const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'));
const addons = Array.isArray(marketplace) ? marketplace : marketplace.addons || [];
const addonIds = [
  ...new Set(
    addons
      .map(inferAddonId)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  ),
];

const options = addonIds.length ? addonIds : ['no-addons-available'];
const generatedBlock = [
  '      # BEGIN GENERATED ADDON ID OPTIONS - run `node scripts/update-addon-issue-template.mjs`',
  '      options:',
  ...options.map((id) => `        - ${JSON.stringify(id)}`),
  '      default: 0',
  '      # END GENERATED ADDON ID OPTIONS',
].join('\n');

const template = readFileSync(issueTemplatePath, 'utf8');
const generatedBlockPattern = /      # BEGIN GENERATED ADDON ID OPTIONS[\s\S]*?      # END GENERATED ADDON ID OPTIONS/;
if (!generatedBlockPattern.test(template)) {
  throw new Error('Could not find generated addon ID options block in issue template.');
}

const nextTemplate = template.replace(generatedBlockPattern, generatedBlock);
writeFileSync(issueTemplatePath, nextTemplate);
console.log(`Updated addon update issue template with ${addonIds.length} addon ID option(s).`);
