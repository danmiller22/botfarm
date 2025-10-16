# TMS Telegram Bot (Deno Deploy, step 1)

Purpose: minimal bot that runs a questionnaire and captures an invoice as photo or PDF. 
This step stores data in memory and replies with a summary. Next steps will push to Google Sheets and Drive.

## Deploy (Deno Deploy)
1. Create a new Deno Deploy project. Upload this repo.
2. Set Environment Variables:
   - `TELEGRAM_TOKEN` — bot token from BotFather.
   - `ALLOWED_CHAT_IDS` — comma-separated chat IDs allowed to use the bot (optional; empty = allow all).
   - `TZ` — e.g. `America/Chicago`.
3. Set the project as public (or keep private) and note the deploy URL, e.g. `https://<app>.deno.dev`.
4. Set Telegram webhook:
```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/setWebhook"   -d "url=https://<app>.deno.dev/telegram"   -d "drop_pending_updates=true"
```
5. Test:
   - Send `/start` in Telegram.
   - Press **New report** → follow the prompts.
   - At the end you will see a summary. Data is not stored permanently in this step.

## Endpoints
- `GET /health` — returns 200 OK.
- `POST /telegram` — Telegram webhook receiver.

## Next steps (to be added later)
- Upload invoice to Google Drive.
- Append a row to Google Sheet.
- Add admin-only weekly/monthly broadcast endpoints.
