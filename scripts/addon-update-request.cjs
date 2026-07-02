const fs = require('fs');
const { execFileSync } = require('child_process');

function parseIssueForm(body) {
  const fields = {};
  const regex = /###\s+(.+?)\s*\n+([\s\S]*?)(?=\n###\s+|$)/g;
  for (const match of String(body || '').matchAll(regex)) {
    const value = match[2].replace(/<!--[\s\S]*?-->/g, '').trim();
    fields[match[1].trim().toLowerCase()] = /^_no response_$/i.test(value) ? '' : value;
  }
  return fields;
}

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
  return addon.id || addon.addonId || addon.addon_id || slugify(addon.source || addon.git || addon.repositoryUrl || addon.url || addon.name);
}

function addonSource(addon) {
  return addon.source || addon.git || addon.repositoryUrl || addon.url;
}

function getTargetRef(fields) {
  return Object.entries(fields).find(([key]) => key.startsWith('target commit, tag, or branch'))?.[1] || '';
}

function readMarketplace(path = 'marketplace.json') {
  const marketplace = JSON.parse(fs.readFileSync(path, 'utf8'));
  return { marketplace, addons: Array.isArray(marketplace) ? marketplace : marketplace.addons || [] };
}

function parsePayload(body) {
  const fields = parseIssueForm(body);
  return {
    addonId: fields['addon id'],
    targetRef: getTargetRef(fields),
    notes: fields['update notes'],
  };
}

function validate(body, options = {}) {
  const payload = parsePayload(body);
  const errors = [];

  if (!payload.addonId || payload.addonId === 'no-addons-available') errors.push('Missing addon ID.');
  if (!payload.notes) errors.push('Missing update notes.');
  if (options.banned) errors.push(`@${options.user || 'this user'} is banned from addon requests.`);

  let addon;
  try {
    const { addons } = readMarketplace();
    addon = addons.find((entry) => inferAddonId(entry) === payload.addonId);
    if (!addon) errors.push('No matching addon ID was found in marketplace.json.');
    if (addon && !addonSource(addon)) errors.push('Marketplace entry is missing a source/git/repositoryUrl/url field.');
  } catch (error) {
    errors.push(`Could not read marketplace.json: ${error.message}`);
  }

  const repoUrl = addon && addonSource(addon);
  const summary = [
    '## Addon update request validation',
    '',
    `**Addon ID:** ${payload.addonId || '_missing_'}`,
    addon ? `**Addon:** ${addon.name || '_unnamed_'}` : '',
    `**Repository:** ${repoUrl || '_inferred after addon match_'}`,
    `**Requested target:** ${payload.targetRef || '_latest created tag will be resolved on approval_'}`,
    addon ? `**Current pinned commit/ref:** ${addon.pinnedCommit || addon.targetRef || '_unset_'}` : '',
    options.trusted ? `**Requester trust:** @${options.user} is trusted; this request can be auto-approved.` : '',
    '',
    errors.length ? `❌ **Validation failed**\n\n${errors.map((error) => `- ${error}`).join('\n')}` : '✅ **Validation passed**',
    '',
    errors.length ? 'Edit the issue to fix the problems above.' : (options.trusted ? 'Trusted requester: this update will be applied automatically.' : 'A maintainer with write access can approve this update by commenting `/approve`.'),
  ].filter(Boolean).join('\n');

  return { payload, addon, errors, summary };
}

function resolveTargetRef(source, requestedRef) {
  if (requestedRef) return requestedRef;

  const tmp = fs.mkdtempSync('/tmp/ogi-addon-tags-');
  try {
    execFileSync('git', ['init', '--bare', tmp], { stdio: 'inherit' });
    execFileSync('git', ['--git-dir', tmp, 'remote', 'add', 'origin', source], { stdio: 'inherit' });
    execFileSync('git', ['--git-dir', tmp, 'fetch', '--tags', '--force', 'origin', '+refs/tags/*:refs/tags/*'], { stdio: 'inherit' });

    const latestTag = execFileSync(
      'git',
      ['--git-dir', tmp, 'for-each-ref', '--sort=-creatordate', '--format=%(refname:short)', '--count=1', 'refs/tags'],
      { encoding: 'utf8' }
    ).trim();

    if (latestTag) {
      return execFileSync('git', ['--git-dir', tmp, 'rev-list', '-n', '1', latestTag], { encoding: 'utf8' }).trim();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return execFileSync('git', ['ls-remote', source, 'HEAD'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
}

function applyUpdate(body) {
  const payload = parsePayload(body);
  if (!payload.addonId || payload.addonId === 'no-addons-available') throw new Error('Missing required field: addonId');
  if (!payload.notes) throw new Error('Missing required field: notes');

  const path = 'marketplace.json';
  const { marketplace, addons } = readMarketplace(path);
  const addon = addons.find((entry) => inferAddonId(entry) === payload.addonId);
  if (!addon) throw new Error(`No matching addon found for ID ${payload.addonId}`);

  const source = addonSource(addon);
  if (!source) throw new Error('Marketplace entry is missing a source/git/repositoryUrl/url field.');

  addon.pinnedCommit = resolveTargetRef(source, payload.targetRef);
  addon.updatedAt = new Date().toISOString();
  addon.updateNotes = payload.notes;

  fs.writeFileSync(path, `${JSON.stringify(marketplace, null, 2)}\n`);
  return { payload, pinnedCommit: addon.pinnedCommit };
}

function replaceTargetRef(body, targetRef) {
  if (!targetRef) throw new Error('Usage: /bump <commit, tag, or branch>');
  const pattern = /(###\s+Target commit, tag, or branch[^\n]*\n+)([\s\S]*?)(?=\n###\s+|$)/i;
  if (!pattern.test(body)) throw new Error('Could not find the target ref field in the issue body.');
  return body.replace(pattern, (_, heading) => `${heading}${targetRef}\n`);
}

module.exports = { parseIssueForm, parsePayload, validate, applyUpdate, replaceTargetRef };

if (require.main === module) {
  const command = process.argv[2];
  const body = process.env.ISSUE_BODY || fs.readFileSync(0, 'utf8');
  if (command === 'validate') {
    process.stdout.write(JSON.stringify(validate(body, {
      banned: process.env.REQUESTER_BANNED === 'true',
      trusted: process.env.REQUESTER_TRUSTED === 'true',
      user: process.env.REQUESTER_LOGIN || '',
    })));
  } else if (command === 'apply') {
    process.stdout.write(JSON.stringify(applyUpdate(body)));
  } else if (command === 'bump') {
    process.stdout.write(replaceTargetRef(body, process.env.BUMP_REF || process.argv[3] || ''));
  } else {
    throw new Error('Usage: addon-update-request.cjs <validate|apply|bump>');
  }
}
