# Dograh AI assistant: setup aur hosting

Disha ki jagah ab [Dograh](https://github.com/dograh-hq/dograh) (open-source, self-host hone wala voice/chat agent platform) use hota hai.

```
Browser (inventory app) ──widget──▶ Dograh server  (STT + LLM + TTS, conversation)
                                         │  HTTPS tool calls (Bearer key)
                                         ▼
                              Inventory app /api/agent/*  ──▶ PostgreSQL
```

* **Dograh** = baat-cheet (awaaz, LLM, widget). Alag server par chalta hai.
* **Inventory app** = sirf data. Agent koi stock number khud nahi banata; har number tool se aata hai.
* Stock badalna **do step** mein hota hai: `prepare_*` (kuch nahi badalta, token deta hai) → user "haan" bole → `confirm_action`. Token 5 minute mein expire hota hai, ek hi baar chalta hai, aur stock beech mein badal jaye to change ruk jata hai.

## 1. Inventory app deploy (Railway/Render, pehle jaisa)

1. Code GitHub par push karein, Railway par deploy karein (`Procfile` already hai).
2. Variables mein ek lamba random secret set karein:
   `DOGRAH_TOOL_API_KEY=<python -c "import secrets;print(secrets.token_urlsafe(40))">`
3. App ka public HTTPS URL note karein (jaise `https://inventory.up.railway.app`). Dograh server ko ye URL internet se dikhna chahiye.
4. Test: `curl -X POST https://<app>/api/agent/app_status -H "Authorization: Bearer <key>"` → JSON milna chahiye. Bina key ke 401 aata hai.

## 2. Dograh server host karein

Dograh ek poora Docker stack hai (API, UI, PostgreSQL, Redis, MinIO, TURN). Isliye **alag VPS** chahiye (inventory app ke saath Railway par nahi):

* Minimum **8 GB RAM, 4 vCPU**, fresh Ubuntu server, public IP.
* Firewall mein khulein: TCP 80, 443, 3478, 5349 aur UDP 3478, 5349, 49152–49200 (WebRTC voice ke liye zaroori).
* Server par (root):

```bash
curl -o setup_remote.sh https://raw.githubusercontent.com/dograh-hq/dograh/main/scripts/setup_remote.sh && chmod +x setup_remote.sh && sudo ./setup_remote.sh
```

Script public IP par automatically HTTPS certificate (sslip.io) laga deta hai aur URL print karta hai, jaise `https://203-0-113-10.sslip.io`. Microphone ke liye HTTPS zaroori hai. Apna domain lagana ho to Dograh docs ka "Custom Domain" page dekhein. Signup ke baad apna account bana kar `.env` mein `ENABLE_SIGNUP=false` karke `./remote_up.sh` dobara chalayein.

## 3. Dograh dashboard mein agent banayein

1. **Providers / Models**: apna LLM, speech-to-text aur text-to-speech chunein (BYOK mein apni keys; Hindi/Hinglish ke liye Hindi support karne wale STT/TTS voice chunein). Ye keys Dograh ke andar rehti hain, inventory app mein nahi.
2. **Tools** → har ek ke liye *HTTP API tool* banayein. Poori list `dograh/tools.json` mein hai (11 tools, URL, description, parameters). Authentication: *Bearer token* = `DOGRAH_TOOL_API_KEY`. Jin tools mein `workflow_run_id` hai wahan use **Preset Parameter** banayein, value `{{initial_context.workflow_run_id}}` (type number).
3. **Agent (workflow)** banayein: Start Call node + ek Agent node. Agent node ke Prompt mein `dograh/agent_prompt.md` ka text paste karein aur **sabhi 11 tools** us node par attach karein.
4. Dashboard ke web call se test karein: "Blue kurta M ka stock batao", phir "5 add karo" → agent summary bolega, "haan" kehne par hi change hoga.

## 3b. MCP se tools jodein (HTTP tools ka behtar vikalp)

11 HTTP tools haath se banane ki jagah inventory app ek **MCP server** bhi deta hai (`backend/mcp_server.py`, wahi 11 tools, wahi do-step confirmation, wahi key).

1. Dograh → **Credentials** → naya **Bearer Token** credential, token = `DOGRAH_TOOL_API_KEY`.
2. **Tools → Create → MCP Server**: Name `Inventory`, URL `https://<inventory-domain>/mcp/` (aakhir mein `/` zaroori), us credential ko select karein, Description: "Clothing inventory: stock lookup, alerts, reorder, sales, and confirmed stock changes". Save karte hi Dograh 11 tools khud discover kar leta hai.
3. Agent node par ye MCP tool attach karein aur saare 11 functions select karein; prompt wahi `dograh/agent_prompt.md`.
4. MCP mein `workflow_run_id` automatic nahi jata (optional hai). Confirmation token phir bhi single-use, 5 minute ka aur stale-stock-safe hai.

HTTP tools aur MCP dono ek saath attach na karein (duplicate tools se LLM confuse hota hai); koi ek chunein.

Test (terminal se): `curl -X POST https://<domain>/mcp/ -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

### Dograh ko Claude Code se control karna (optional)

Dograh ka apna MCP server bhi hai: Claude Code/Codex se aap agents dekh aur edit kar sakte hain. Dograh mein API key banayein (`/api-keys`), phir:

```bash
claude mcp add --transport http dograh https://<dograh-server>/api/v1/mcp/ --header "X-API-Key: YOUR_API_KEY"
```

Is repo ki `.mcp.json` mein ye pehle se likha hai; `DOGRAH_URL` aur `DOGRAH_API_KEY` environment variables set karke Claude Code kholein. (Self-signed certificate ho to `NODE_TLS_REJECT_UNAUTHORIZED=0 claude`.)

## 4. App mein widget jodein

1. Agent → **Settings → Add to Website → Configure Widget**: Embedding enable, **Allowed Domains** mein inventory app ka domain daalein, Widget Type **Voice** (ya Chat), mode **Floating Widget**, Save.
2. Generated snippet mein `js.src = '...'` wala URL copy karein.
3. Railway Variables mein: `DOGRAH_EMBED_SCRIPT_URL=<wo URL>` (optional `DOGRAH_AGENT_NAME`). Redeploy.
4. App kholein: kone mein Dograh ka button dikhna chahiye. Variable khali ho to assistant chhupa rehta hai aur baaki app normal chalta hai.

## Local test

```bash
pip install -r requirements.txt
set DOGRAH_TOOL_API_KEY=testkey      # Linux/Mac: export
cd backend && uvicorn main:app --reload --port 8000
python tests/test_agent_api.py       # REST tools
python tests/test_mcp_server.py      # MCP server
```

## Dhyan rakhein

* Pehle wala Disha chat history, product photo preview aur WhatsApp draft assistant se hata diye gaye hain; ye app ke normal pages mein pehle jaise hain. Dograh alag se webhook/other tools se extend ho sakta hai.
* Stock products delete/archive/price edit assistant se nahi hota (jaanboojh kar); sirf stock add/set, naya design, aur order dispatch (confirmation ke saath).
* App mein user login nahi hai, isliye widget kholne wala koi bhi stock badal sakta hai. Production mein app ko login/VPN ke peeche rakhein aur Dograh ke **Allowed Domains** tight rakhein.
* `DOGRAH_TOOL_API_KEY` kabhi browser code ya GitHub mein na daalein. Key badalni ho to Railway aur Dograh dono tools mein badlein.
