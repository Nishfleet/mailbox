#!/usr/bin/env python3
"""Grant Claude Code access to the Agentic Inbox MCP server.

Authorized by Nish 2026-06-11. Does three things:
1. Creates a Cloudflare Access service token (claude-support-inbox-mcp, 1 year).
2. Adds a Service Auth policy to the inbox's Access app so that token is admitted.
3. Saves the credentials to ~/.config/cloudflare/inbox-mcp-service-token.json (0600).

Revoke anytime: Zero Trust dash -> Access -> Service tokens -> delete.
"""
import json
import os
import pathlib
import subprocess

ACCOUNT = "f670a698e17bf160c8e4679823e68916"
TOKEN = open(os.path.expanduser("~/.config/cloudflare/claude-infra-token")).read().strip()
H = ["-H", f"Authorization: Bearer {TOKEN}", "-H", "Content-Type: application/json"]
HOSTNAME = "0509-support-inbox.nishant345.workers.dev"


def api(method, path, body=None):
    cmd = ["curl", "-s", "-X", method, *H, f"https://api.cloudflare.com/client/v4{path}"]
    if body:
        cmd += ["-d", json.dumps(body)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)


# 1. service token
st = api("POST", f"/accounts/{ACCOUNT}/access/service_tokens",
         {"name": "claude-support-inbox-mcp", "duration": "8760h"})
if not st.get("success"):
    raise SystemExit(f"service token creation failed: {st.get('errors')}")
client_id = st["result"]["client_id"]
client_secret = st["result"]["client_secret"]
print(f"1. service token created: {client_id}")

# 2. find the Access app for the inbox worker
apps = api("GET", f"/accounts/{ACCOUNT}/access/apps?per_page=50")
app = next((a for a in apps["result"] if HOSTNAME in json.dumps(a.get("self_hosted_domains", [])) + a.get("domain", "")), None)
if not app:
    raise SystemExit(f"could not find Access app for {HOSTNAME}; apps: {[a.get('domain') for a in apps['result']]}")
print(f"2. found Access app: {app['name']} ({app['id']})")

# 3. add a Service Auth policy admitting the token (non_identity = no login page)
pol = api("POST", f"/accounts/{ACCOUNT}/access/apps/{app['id']}/policies", {
    "name": "claude-mcp-service-token",
    "decision": "non_identity",
    "include": [{"service_token": {"token_id": st["result"]["id"]}}],
    "precedence": 1,
})
if not pol.get("success"):
    raise SystemExit(f"policy creation failed: {pol.get('errors')}")
print("3. Service Auth policy added")

# 4. save credentials
out = pathlib.Path(os.path.expanduser("~/.config/cloudflare/inbox-mcp-service-token.json"))
out.write_text(json.dumps({"client_id": client_id, "client_secret": client_secret}))
out.chmod(0o600)
print(f"4. credentials saved to {out}")
print()
print("Done. Tell Claude 'done' and it will connect itself to the inbox MCP.")
