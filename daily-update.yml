name: Daily CG Current Affairs Update

on:
  schedule:
    # 1:30 UTC = 7:00 AM IST, roz
    - cron: "30 1 * * *"
  workflow_dispatch: {}   # "Run workflow" button se manually bhi chala sakte ho

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repo
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Fetch today's Chhattisgarh current affairs
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: node scripts/update.mjs

      - name: Commit and push if data.json changed
        run: |
          git config user.name "cg-digest-bot"
          git config user.email "actions@github.com"
          if git diff --quiet -- data.json; then
            echo "Koi naya change nahi — commit skip."
          else
            git add data.json
            git commit -m "chore: auto-update CG current affairs ($(date -u +%Y-%m-%d))"
            git push
          fi
