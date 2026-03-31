const eventName = process.env.GITHUB_EVENT_NAME ?? '';
const author = (process.env.PR_AUTHOR ?? '').trim();
const approvedReviewers = (process.env.APPROVED_REVIEWERS ?? '')
  .split(',')
  .map((reviewer) => reviewer.trim())
  .filter(Boolean);

if (eventName !== 'pull_request') {
  console.log('Peer-review validation is advisory and only evaluated for pull_request events.');
  process.exit(0);
}

if (!author) {
  console.log(
    'PR_AUTHOR is not available in this context; branch protection remains source of truth.',
  );
  process.exit(0);
}

const nonAuthorApprovals = approvedReviewers.filter((reviewer) => reviewer !== author).length;

if (nonAuthorApprovals < 1) {
  console.error('Peer-review advisory check failed: expected at least one non-author approval.');
  console.error(`Author: ${author}`);
  console.error(`Approved reviewers: ${approvedReviewers.join(', ') || '(none)'}`);
  process.exit(1);
}

console.log(`Peer-review advisory check passed with ${nonAuthorApprovals} non-author approval(s).`);
