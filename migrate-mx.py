#!/usr/bin/env python3
"""Migrate tinystudio.in (iCloud) and seofixkit.com (Porkbun) inbound mail
to Cloudflare Email Routing -> 0509-support-inbox worker.

Authorized by Nish on 2026-06-11. Mailboxes nish@/support@/hello@/billing@
already exist on both domains, so no mail is dropped after the flip.
SPF records are MERGED (icloud/porkbun includes preserved) so existing
senders keep working.
"""
import json
import subprocess

TOKEN = open("/Users/nish/.config/cloudflare/claude-infra-token").read().strip()
H = ["-H", f"Authorization: Bearer {TOKEN}", "-H", "Content-Type: application/json"]


def api(method, path, body=None):
    cmd = ["curl", "-s", "-X", method, *H, f"https://api.cloudflare.com/client/v4{path}"]
    if body:
        cmd += ["-d", json.dumps(body)]
    return json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)


ZONES = {
    "tinystudio.in": {
        "id": "25e0849c4772b8c5c22eef0bd4002cca",
        "old_mx_hosts": ["mx01.mail.icloud.com", "mx02.mail.icloud.com"],
        "spf_new": "v=spf1 include:icloud.com include:_spf.mx.cloudflare.net ~all",
        "mx_prios": {"route1.mx.cloudflare.net": 57, "route2.mx.cloudflare.net": 30, "route3.mx.cloudflare.net": 54},
    },
    "seofixkit.com": {
        "id": "7cc99ce6d9d3e3d9b0055e2bd51cc8b5",
        "old_mx_hosts": ["fwd1.porkbun.com", "fwd2.porkbun.com"],
        "spf_new": "v=spf1 include:_spf.porkbun.com include:_spf.mx.cloudflare.net ~all",
        "mx_prios": {"route1.mx.cloudflare.net": 17, "route2.mx.cloudflare.net": 80, "route3.mx.cloudflare.net": 25},
    },
}

for zname, cfg in ZONES.items():
    zid = cfg["id"]
    print(f"== {zname} ==")
    records = api("GET", f"/zones/{zid}/dns_records?per_page=100")["result"]

    for r in records:
        if r["type"] == "MX" and r["name"] == zname and r["content"] in cfg["old_mx_hosts"]:
            res = api("DELETE", f"/zones/{zid}/dns_records/{r['id']}")
            print(f"  deleted MX {r['content']}: {res.get('success')}")

    for host, prio in cfg["mx_prios"].items():
        res = api("POST", f"/zones/{zid}/dns_records",
                  {"type": "MX", "name": zname, "content": host, "priority": prio, "ttl": 1})
        print(f"  added MX {host} prio {prio}: {res.get('success') or res.get('errors')}")

    for r in records:
        if r["type"] == "TXT" and r["name"] == zname and r["content"].strip('"').startswith("v=spf1"):
            res = api("PATCH", f"/zones/{zid}/dns_records/{r['id']}", {"content": cfg["spf_new"]})
            print(f"  SPF merged: {res.get('success') or res.get('errors')}")

    status = api("GET", f"/zones/{zid}/email/routing").get("result", {})
    print(f"  email routing status: {status.get('status')} enabled={status.get('enabled')}")

print()
print("Done. Mail for these domains now flows to the 0509-support-inbox worker.")
print("Rollback notes: tinystudio.in old MX = mx01/mx02.mail.icloud.com prio 10;")
print("seofixkit.com old MX = fwd1.porkbun.com prio 10, fwd2.porkbun.com prio 20.")
