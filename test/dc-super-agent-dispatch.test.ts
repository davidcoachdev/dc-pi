import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const dispatchHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-dispatch-home-"));
process.env.HOME = dispatchHome;
process.env.XDG_CONFIG_HOME = path.join(dispatchHome, "xdg");
process.env.PI_CODING_AGENT_DIR = path.join(dispatchHome, "pi");

const { DcIssueDispatcher } = await import("../src/features/dc-agents/daemon/dc-issue-dispatcher.ts");
const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
const { DcWorktreeManager } = await import("../src/features/dc-agents/core/dc-worktree-manager.ts");
import type { GitHubIssuePayload } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";

const createdRoots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dc-dispatch-"));
  createdRoots.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(root, "tracked"), "base\n");
  git("add", "."); git("commit", "-m", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git("checkout", "-b", "user-feature");
  fs.writeFileSync(path.join(root, "feature-only"), "must not leak");
  git("add", "."); git("commit", "-m", "feature fixture");
  const repo = { repoRoot: root, owner: "fixture", repo: path.basename(root), fullNwo: `fixture/${path.basename(root)}`, remoteUrl: "https://github.com/fixture/repo" };
  const payload = { action: "opened", issue: { number: 81, title: "Fix", body: "verbatim", user: { login: "fixture-author" }, html_url: "" }, repository: { full_name: repo.fullNwo, name: repo.repo, owner: { login: "fixture" }, html_url: "" } } satisfies GitHubIssuePayload;
  return { root, git, repo, payload };
}

test("dispatcher claims before authorization await and returns no second launch grant", async () => {
  const f = fixture();
  getCollaboratorsDatabase().setCollaborator("fixture-author", "PENDING", "CONTRIBUTOR", "fixture");
  const dispatcher = new DcIssueDispatcher();
  let approve!: (allowed: boolean) => void;
  let approvals = 0;
  const authorization = () => { approvals++; return new Promise<boolean>(resolve => { approve = resolve; }); };
  const first = dispatcher.dispatchIssue(f.payload, f.repo, undefined, authorization);
  const second = dispatcher.dispatchIssue(f.payload, f.repo, undefined, authorization);
  // A second approval must never replace the first pending resolver.
  assert.equal(approvals, 1);
  approve(true);
  const grants = await Promise.all([first, second]);
  assert.equal(grants.filter(Boolean).length, 1);
  assert.equal(await dispatcher.dispatchIssue(f.payload, f.repo), null);
  const task = dispatcher.getDispatch(f.repo.fullNwo, 81)!;
  assert.ok(task);
  assert.equal(fs.existsSync(path.join(task.worktreePath, "feature-only")), false);
  assert.equal((task as unknown as { baseBranch: string }).baseBranch, "main");
});

test("blocked authorization releases the claim for a later approved retry", async () => {
  const f = fixture();
  const db = getCollaboratorsDatabase();
  db.setCollaborator("fixture-author", "BLOCK", "EXTERNAL", "fixture");
  const dispatcher = new DcIssueDispatcher();
  assert.equal(await dispatcher.dispatchIssue(f.payload, f.repo), null);
  assert.equal(dispatcher.getActiveDispatches().length, 0);
  db.setCollaborator("fixture-author", "ALLOW", "CONTRIBUTOR", "fixture");
  assert.ok(await dispatcher.dispatchIssue(f.payload, f.repo));
});

test("restart adopts only matching ownership without overwriting edits, spec or roadmap", async () => {
  const f = fixture();
  getCollaboratorsDatabase().setCollaborator("fixture-author", "ALLOW", "CONTRIBUTOR", "fixture");
  const first = await new DcIssueDispatcher().dispatchIssue(f.payload, f.repo);
  assert.ok(first);
  const specPath = path.join(first.worktreePath, "odd/tasks/issue-81.md");
  const retained = fs.readFileSync(specPath, "utf8") + "\nretained roadmap and manual edits\n";
  fs.writeFileSync(specPath, retained);
  fs.writeFileSync(path.join(first.worktreePath, "tracked"), "retained tracked edit");
  fs.writeFileSync(path.join(first.worktreePath, "untracked"), "retained untracked edit");
  const recovered = await new DcIssueDispatcher().dispatchIssue(f.payload, f.repo);
  assert.ok(recovered);
  assert.equal(recovered.worktreePath, first.worktreePath);
  assert.equal(fs.readFileSync(specPath, "utf8"), retained);
  assert.equal(fs.readFileSync(path.join(first.worktreePath, "tracked"), "utf8"), "retained tracked edit");
  assert.equal(fs.readFileSync(path.join(first.worktreePath, "untracked"), "utf8"), "retained untracked edit");
});

test("worktree recovery rejects mismatched branch occupancy and preserves generic create semantics", async () => {
  const f = fixture();
  const target = path.join(f.root, "../", `${path.basename(f.root)}-worker`);
  const options = { repoRoot: f.root, taskId: "recovery", taskSlug: "recovery", customWorktreeDir: target, useSymlinkNodeModules: false };
  const handle = await new DcWorktreeManager().createForTask(options);
  assert.equal(fs.existsSync(path.join(target, "feature-only")), true);
  await assert.rejects(new DcWorktreeManager().createForTask(options));
  execFileSync("git", ["-C", target, "checkout", "-b", "unrelated-occupant"], { stdio: "ignore" });
  await assert.rejects(new DcWorktreeManager().createForTask({ ...options, ...{ reuseExisting: true } }), /ownership|occupancy/i);
  assert.equal(fs.existsSync(path.join(handle.worktreePath, "feature-only")), true);
});

test.after(() => {
  try {
    getCollaboratorsDatabase().close();
  } catch {
    /* defensive */
  }
  for (const root of createdRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      const worker = `${root}-worker`;
      if (fs.existsSync(worker)) fs.rmSync(worker, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
  try {
    fs.rmSync(dispatchHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});
