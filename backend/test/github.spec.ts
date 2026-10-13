import { chmod, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { GithubCliService } from '../src/runs/services/github-cli.service';
import { RunTopologyService } from '../src/runs/services/run-topology.service';

async function runTests() {
  console.log('\n=============================================');
  console.log('🧪 RUNNING GITHUB CLI TESTS');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  async function rejects(promise: Promise<unknown>, pattern: RegExp, message: string) {
    try {
      await promise;
      assert(false, `${message} (did not throw)`);
    } catch (error: any) {
      assert(pattern.test(String(error?.message)), `${message} (${error?.message})`);
    }
  }

  // A fake gh that echoes its arguments and stdin as JSON, or fails when asked to.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'github-spec-')));
  const fakeGh = join(root, 'fake-gh.js');
  await writeFile(fakeGh, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    'let stdin = "";',
    'process.stdin.on("data", (c) => (stdin += c));',
    'process.stdin.on("end", () => {',
    '  if (args.includes("--fail")) { process.stderr.write("HTTP 404: Not Found"); process.exit(1); }',
    '  if (args[0] === "pr" && args[1] === "create") { process.stdout.write("https://github.com/o/r/pull/77\\n"); return; }',
    '  process.stdout.write(JSON.stringify({ args, stdin, cwd: process.cwd() }));',
    '});',
  ].join('\n'));
  await chmod(fakeGh, 0o755);
  process.env.GH_CLI_BIN = fakeGh;

  const project = { metadata: { repositoryPath: root, allowedRepositoryRoots: [] } };
  const projectModel = { findById: () => ({ lean: () => ({ exec: async () => project }) }) };
  const service = new GithubCliService(projectModel as any);
  const projectId = '64b7f0f0f0f0f0f0f0f0f0f0';
  const run = (input: Record<string, any>) => service.execute({ projectId, ...input });

  try {
    // 1. PR view builds --json fields and --repo
    const view = await run({ action: 'pr-view', number: 42, repo: 'octo/hello' });
    assert(view.success === true, 'pr-view succeeds');
    assert(view.data.args.slice(0, 3).join(' ') === 'pr view 42', 'pr-view passes the PR number');
    assert(view.data.args.includes('--repo') && view.data.args.includes('octo/hello'), 'pr-view passes --repo');
    assert(view.data.args.includes('--json'), 'pr-view requests JSON output');
    assert(view.workingDirectory === root, 'Runs in the project repositoryPath');

    // 2. PR create returns URL and parsed number
    const created = await run({ action: 'pr-create', title: 'feat: x', body: 'Body', base: 'main', draft: true, labels: 'a, b', reviewers: 'alice' });
    assert(created.url === 'https://github.com/o/r/pull/77', 'pr-create extracts the PR URL');
    assert(created.number === 77, 'pr-create extracts the PR number');
    assert(/--draft/.test(created.command) && /--label a --label b/.test(created.command), 'pr-create passes draft and labels');
    await rejects(run({ action: 'pr-create', title: '' }), /requires a title/, 'pr-create requires a title');

    // 3. Review, merge and list options
    const review = await run({ action: 'pr-review', number: 5, reviewType: 'request-changes', body: 'Please fix' });
    assert(review.data.args.includes('--request-changes'), 'pr-review maps the review type');
    await rejects(run({ action: 'pr-review', number: 5, reviewType: 'comment' }), /requires a body/, 'pr-review comment requires a body');
    const merge = await run({ action: 'pr-merge', number: 5, mergeMethod: 'rebase', deleteBranch: 'true' });
    assert(merge.data.args.includes('--rebase') && merge.data.args.includes('--delete-branch'), 'pr-merge maps method and delete-branch');
    const list = await run({ action: 'pr-list', state: 'merged', limit: 500, search: 'author:@me' });
    assert(list.data.args.includes('merged') && list.data.args.includes('200'), 'pr-list clamps limit and passes state');

    // 4. Clone stays inside allowed roots
    const clone = await run({ action: 'repo-clone', repo: 'octo/hello', cloneDepth: 1 });
    assert(clone.clonedPath === join(root, 'hello'), 'repo-clone defaults to the repository name');
    assert(clone.data.args.slice(-3).join(' ') === '-- --depth 1', 'repo-clone passes shallow depth to git');
    await rejects(run({ action: 'repo-clone', repo: 'octo/hello', cloneDirectory: '../escape' }), /outside the allowed/, 'repo-clone rejects paths outside roots');
    await rejects(run({ action: 'pr-view', repo: 'bad repo; rm -rf' }), /OWNER\/REPO/, 'Rejects malformed repositories');

    // 5. API with JSON body via stdin
    const api = await run({ action: 'api', apiEndpoint: '/repos/{owner}/{repo}/issues', apiMethod: 'post', apiBody: { title: 'Hi' } });
    assert(api.data.args.join(' ') === 'api repos/{owner}/{repo}/issues --method POST --input -', 'api builds method and stdin input');
    assert(api.data.stdin === '{"title":"Hi"}', 'api sends the JSON body on stdin');
    await rejects(run({ action: 'api', apiEndpoint: 'https://evil.example/x' }), /relative REST path/, 'api rejects absolute URLs');

    // 6. Custom command parsing and safety
    const custom = await run({ action: 'custom', args: 'gh release list --limit 5 --json "tagName,name"' });
    assert(custom.data.args.join('|') === 'release|list|--limit|5|--json|tagName,name', 'custom splits quoted arguments');
    await rejects(run({ action: 'custom', args: 'auth token' }), /auth subcommands/, 'custom blocks gh auth token');
    await rejects(run({ action: 'custom', args: 'auth status --show-token' }), /auth subcommands/, 'custom blocks --show-token');

    // 7. Failure handling
    await rejects(run({ action: 'pr-view', number: 1, extraArgs: '--fail' }), /HTTP 404/, 'failOnError=true throws gh stderr');
    const soft = await run({ action: 'pr-view', number: 1, extraArgs: '--fail', failOnError: false });
    assert(soft.success === false && soft.exitCode === 1 && /404/.test(soft.error), 'failOnError=false returns error details');

    // 8. Branch routing
    const topology = new RunTopologyService();
    const node = { id: 'gh', data: { definitionType: 'github' } } as any;
    const edges = [
      { source: 'gh', target: 'ok', sourceHandle: 'done' },
      { source: 'gh', target: 'bad', sourceHandle: 'onFailed' },
    ];
    assert(topology.resolveNextTargets(node, { success: true }, edges).join() === 'ok', 'Success routes to done');
    assert(topology.resolveNextTargets(node, { success: false }, edges).join() === 'bad', 'Failure routes to onFailed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  console.log(`\n📊 GitHub CLI tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
