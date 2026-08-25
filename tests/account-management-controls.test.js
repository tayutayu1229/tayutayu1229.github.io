const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('account_management.html', 'utf8');

for (const action of [
  'close-modal',
  'sort',
  'approve-user',
  'disable-user',
  'open-user-detail',
  'enable-user',
  'delete-user',
  'promote-admin',
  'revoke-admin',
  'copy-user-email',
]) {
  assert.match(html, new RegExp(`data-account-action=["']${action}["']`), `missing delegated action: ${action}`);
}

for (const changeAction of ['select-all', 'bulk-selection']) {
  assert.match(html, new RegExp(`data-account-change=["']${changeAction}["']`), `missing delegated change action: ${changeAction}`);
}

assert.doesNotMatch(
  html,
  /onclick=["'](?:openUserDetail|approveUser|disableUser|enableUser|deleteUser|promoteAdmin|revokeAdmin|toggleSort|copyUserEmail)\(/,
  'dynamically rendered account controls must not use inline click handlers',
);
assert.doesNotMatch(
  html,
  /onchange=["'](?:toggleSelectAll|updateBulkButtons)\(/,
  'dynamically rendered account checkboxes must not use inline change handlers',
);

console.log('account management controls tests: ok');
