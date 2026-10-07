# GitHub Setup

Use whichever method is more comfortable: GitHub Desktop, VS Code's Source Control UI, or the terminal.

## Option A — GitHub Desktop / VS Code

1. Create an empty GitHub repository. Avoid generating a conflicting README if possible.
2. Clone it to your computer.
3. Copy **the contents of `concert-finder-spec/`** into the root of the cloned repository. Do not make `concert-finder-spec` an unnecessary nested folder unless you want that structure.
4. Open the repository folder in VS Code.
5. Review the files.
6. Commit with a message such as:
   `docs: add initial product architecture and agent context`
7. Push to `main`.
8. Give each AI the appropriate prompt from `docs/project/ai-start-prompts.md`.

## Option B — Terminal

If the repository is already cloned locally:

```bash
cd /path/to/your/repository
cp -R /path/to/concert-finder-spec/. .
git status
git add .
git commit -m "docs: add initial product architecture and agent context"
git push origin main
```

If you downloaded the ZIP from ChatGPT, unzip it first and copy the files from inside the `concert-finder-spec` directory into the repository root.

## Recommended first branch

After the documentation commit is on `main`, the first implementation task should use a branch such as:

```bash
git checkout -b chore/bootstrap-foundation
```

Antigravity can own that branch for Phase 0.

## Recommended first-agent order

1. ChatGPT Personal: spec audit + Phase 0 task breakdown.
2. Claude: independent risk/data-model/testing review.
3. You resolve any genuine disagreements.
4. Antigravity: implement the approved Phase 0 task on its branch.
5. ChatGPT and/or Claude: review the resulting diff/PR.
6. Antigravity: address concrete review findings.
7. Merge after tests pass.

## Important rule

Do not ask all three agents to freely edit `main`. Give one agent ownership of an implementation branch and use the others as reviewers.
