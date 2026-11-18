import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShellCommand } from "../src/features/dc-scan-guard/dc-scan-guard.ts";

test("Layer 0: blocks destructive Git commands that discard local work", () => {
  // git reset --hard
  assert.equal(classifyShellCommand("git reset --hard").block, true);
  assert.equal(classifyShellCommand("git reset --hard HEAD~1").block, true);
  assert.equal(classifyShellCommand("git reset -q --hard").block, true);

  // git clean -f / -fd / -fx
  assert.equal(classifyShellCommand("git clean -f").block, true);
  assert.equal(classifyShellCommand("git clean -fd").block, true);
  assert.equal(classifyShellCommand("git clean -fdx").block, true);
  assert.equal(classifyShellCommand("git clean -f -d").block, true);
  assert.equal(classifyShellCommand("git clean --force").block, true);

  // git checkout/restore wiping current workspace
  assert.equal(classifyShellCommand("git checkout -- .").block, true);
  assert.equal(classifyShellCommand("git checkout -f .").block, true);
  assert.equal(classifyShellCommand("git checkout --force .").block, true);
  assert.equal(classifyShellCommand("git restore .").block, true);
  assert.equal(classifyShellCommand("git restore --worktree .").block, true);

  // git stash drop
  assert.equal(classifyShellCommand("git stash drop").block, true);
  assert.equal(classifyShellCommand("git stash drop stash@{0}").block, true);

  // git branch -D master / main
  assert.equal(classifyShellCommand("git branch -D master").block, true);
  assert.equal(classifyShellCommand("git branch -D main").block, true);

  // Safe git operations should be ALLOWED
  assert.equal(classifyShellCommand("git status").block, false);
  assert.equal(classifyShellCommand("git diff").block, false);
  assert.equal(classifyShellCommand("git log -n 5").block, false);
  assert.equal(classifyShellCommand("git branch").block, false);
  assert.equal(classifyShellCommand("git checkout -b feat/my-feature").block, false);
  assert.equal(classifyShellCommand("git add src/index.ts").block, false);
  assert.equal(classifyShellCommand("git commit -m 'feat: test'").block, false);
  assert.equal(classifyShellCommand("git restore src/index.ts").block, false); // specific file is allowed
});

test("Layer 0: blocks destructive IaC and database reset commands", () => {
  // IaC destroy
  assert.equal(classifyShellCommand("terraform destroy").block, true);
  assert.equal(classifyShellCommand("terraform destroy -auto-approve").block, true);
  assert.equal(classifyShellCommand("pulumi destroy").block, true);
  assert.equal(classifyShellCommand("cdk destroy").block, true);
  assert.equal(classifyShellCommand("npx prisma migrate reset --force").block, true);

  // Safe IaC operations allowed
  assert.equal(classifyShellCommand("terraform plan").block, false);
  assert.equal(classifyShellCommand("terraform apply").block, false);
  assert.equal(classifyShellCommand("pulumi preview").block, false);
});

test("Layer 0: blocks destructive OS keyring and credential manager purging", () => {
  // Windows Credential Manager
  assert.equal(classifyShellCommand("cmdkey /delete:target").block, true);
  assert.equal(classifyShellCommand("cmdkey /delete target").block, true);

  // macOS Keychain
  assert.equal(classifyShellCommand("security delete-generic-password -s test").block, true);

  // Linux secret-tool
  assert.equal(classifyShellCommand("secret-tool clear service test").block, true);

  // Safe inspection allowed
  assert.equal(classifyShellCommand("cmdkey /list").block, false);
});

test("Layer 0: blocks indiscriminate pkill commands with short patterns (<4 chars)", () => {
  // Indiscriminate pkill
  assert.equal(classifyShellCommand("pkill -f agy").block, true);
  assert.equal(classifyShellCommand("pkill -f node").block, true);
  assert.equal(classifyShellCommand("pkill -9 -f py").block, true);

  // Specific, non-broad kills allowed
  assert.equal(classifyShellCommand("pkill -f dc-control-daemon").block, false);
  assert.equal(classifyShellCommand("kill -9 12345").block, false);
});

test("Layer 0: blocks deletion of .git metadata and critical user config directories", () => {
  // rm .git
  assert.equal(classifyShellCommand("rm -rf .git").block, true);
  assert.equal(classifyShellCommand("rm -rf .git/").block, true);
  assert.equal(classifyShellCommand("rm -rf ./.git").block, true);

  // rm critical config
  assert.equal(classifyShellCommand("rm -rf ~/.config").block, true);
  assert.equal(classifyShellCommand("rm -rf ~/.pi").block, true);
  assert.equal(classifyShellCommand("rm -rf ~/.gemini").block, true);

  // Safe scoped cleanup allowed
  assert.equal(classifyShellCommand("rm -rf .test-build").block, false);
  assert.equal(classifyShellCommand("rm -rf dist").block, false);
  assert.equal(classifyShellCommand("rm -rf node_modules/.cache").block, false);
});
