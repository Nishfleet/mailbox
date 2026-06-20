#!/usr/bin/env python3
"""Safely migrate selected domains to Cloudflare Email Routing.

Dry-runs by default. Use --apply only after the preflight shows:
- Email Routing is enabled and ready for the zone.
- An enabled routing rule or catch-all sends mail to the target Worker.
- Cloudflare's Email Routing DNS endpoint reports the required MX records.

The script adds/verifies Cloudflare MX and SPF first, then removes old MX.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any


ACCOUNT = "f670a698e17bf160c8e4679823e68916"
WORKER_NAME = "0509-support-inbox"
CLOUDFLARE_SPF_INCLUDE = "include:_spf.mx.cloudflare.net"
TOKEN_PATH = os.path.expanduser("~/.config/cloudflare/claude-infra-token")

ZONES = {
    "tinystudio.in": {
        "id": "25e0849c4772b8c5c22eef0bd4002cca",
        "old_mx_hosts": ["mx01.mail.icloud.com", "mx02.mail.icloud.com"],
    },
    "seofixkit.com": {
        "id": "7cc99ce6d9d3e3d9b0055e2bd51cc8b5",
        "old_mx_hosts": ["fwd1.porkbun.com", "fwd2.porkbun.com"],
    },
}


class CloudflareApiError(RuntimeError):
    def __init__(self, method: str, path: str, errors: Any) -> None:
        super().__init__(f"Cloudflare API failed for {method} {path}: {errors}")
        self.errors = errors


def is_auth_error(exc: CloudflareApiError) -> bool:
    return any(error.get("code") == 10000 for error in exc.errors or [])


def load_token() -> str:
    with open(TOKEN_PATH, encoding="utf-8") as handle:
        return handle.read().strip()


def api(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = [
        "-H",
        f"Authorization: Bearer {load_token()}",
        "-H",
        "Content-Type: application/json",
    ]
    cmd = ["curl", "-sS", "-X", method, *headers, f"https://api.cloudflare.com/client/v4{path}"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"Cloudflare API command failed: {proc.stderr.strip()}")
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Cloudflare API returned invalid JSON for {path}") from exc
    if not payload.get("success"):
        raise CloudflareApiError(method, path, payload.get("errors"))
    return payload


def run_wrangler_email(args: list[str]) -> str:
    proc = subprocess.run(
        ["wrangler", "email", "routing", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "Wrangler Email Routing command failed. If safe-deploy blocked it, "
            "rerun with SAFE_DEPLOY_APPROVED=email. "
            f"stderr: {proc.stderr.strip()}"
        )
    return proc.stdout


def wrangler_routing_settings(zone_name: str, zone_id: str) -> dict[str, Any]:
    output = run_wrangler_email(["settings", zone_name, "--zone-id", zone_id])
    enabled_match = re.search(r"Enabled:\s+(true|false)", output, re.IGNORECASE)
    status_match = re.search(r"Status:\s+([^\s]+)", output, re.IGNORECASE)
    if not enabled_match or not status_match:
        raise RuntimeError(f"{zone_name}: could not parse Wrangler Email Routing settings output")
    return {
        "enabled": enabled_match.group(1).lower() == "true",
        "status": status_match.group(1).lower(),
    }


def wrangler_routing_dns_records(zone_name: str, zone_id: str) -> list[dict[str, Any]]:
    output = run_wrangler_email(["dns", "get", zone_name, "--zone-id", zone_id])
    records: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if line == "MX record:":
            if current:
                records.append(current)
            current = {"type": "MX"}
            continue
        if line == "TXT record:":
            if current:
                records.append(current)
            current = {"type": "TXT"}
            continue
        if not current or ":" not in line:
            continue

        key, value = line.split(":", 1)
        value = value.strip().strip('"')
        if key == "Name":
            current["name"] = value
        elif key == "Content":
            current["content"] = value.rstrip(".") if current.get("type") == "MX" else value
        elif key == "Priority":
            current["priority"] = int(value)
        elif key == "TTL":
            current["ttl"] = int(value)

    if current:
        records.append(current)
    if not records:
        raise RuntimeError(f"{zone_name}: Wrangler Email Routing DNS returned no records")
    return records


def wrangler_rule_block_enabled_for_worker(block: str, worker_name: str) -> bool:
    enabled = bool(
        re.search(r"\bEnabled:\s*true\b", block, re.IGNORECASE)
        or re.search(r"\b(?:Catch-all rule|Rule|Routing rule)[^\n:]*:\s*enabled\b", block, re.IGNORECASE)
    )
    worker_values = [
        match.group(1).rstrip(".,;")
        for match in re.finditer(r"\bworker\s*:\s*([A-Za-z0-9_.-]+)", block, re.IGNORECASE)
    ]
    worker = any(value == worker_name for value in worker_values)
    return enabled and worker


def wrangler_worker_rule_enabled(zone_name: str, zone_id: str, worker_name: str) -> bool:
    output = run_wrangler_email(["rules", "list", zone_name, "--zone-id", zone_id])
    blocks = [block.strip() for block in re.split(r"\n\s*\n", output) if block.strip()]
    if any(wrangler_rule_block_enabled_for_worker(block, worker_name) for block in blocks):
        return True

    catch_all = run_wrangler_email(["rules", "get", zone_name, "catch-all", "--zone-id", zone_id])
    return wrangler_rule_block_enabled_for_worker(catch_all, worker_name)


def normalize_dns_content(record: dict[str, Any]) -> str:
    content = str(record.get("content") or "").strip().strip('"')
    if record.get("type") == "MX":
        return content.rstrip(".").lower()
    return content


def required_record_present(required: dict[str, Any], records: list[dict[str, Any]]) -> bool:
    required_type = required.get("type")
    required_name = required.get("name")
    required_content = normalize_dns_content(required)

    for record in records:
        if record.get("type") != required_type or record.get("name") != required_name:
            continue
        content = normalize_dns_content(record)
        if required_type == "TXT" and required_content.lower().startswith("v=spf1"):
            if CLOUDFLARE_SPF_INCLUDE in content:
                return True
            continue
        if content != required_content:
            continue
        if required_type == "MX" and record.get("priority") != required.get("priority"):
            continue
        return True
    return False


def missing_required_records(required: list[dict[str, Any]], records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record for record in required if not required_record_present(record, records)]


def zone_records(zone_id: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = api("GET", f"/zones/{zone_id}/dns_records?per_page=100&page={page}")
        records.extend(payload.get("result") or [])
        info = payload.get("result_info") or {}
        total_pages = int(info.get("total_pages") or page)
        if page >= total_pages:
            return records
        page += 1


def routing_dns_report(zone_id: str, zone_name: str | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        result = api("GET", f"/zones/{zone_id}/email/routing/dns").get("result")
    except CloudflareApiError as exc:
        if zone_name and is_auth_error(exc):
            required = wrangler_routing_dns_records(zone_name, zone_id)
            return required, missing_required_records(required, zone_records(zone_id))
        raise
    if isinstance(result, list):
        return result, []
    if isinstance(result, dict):
        return result.get("record") or [], result.get("errors") or []
    return [], []


def routing_dns_records(zone_id: str, zone_name: str) -> list[dict[str, Any]]:
    records, _errors = routing_dns_report(zone_id, zone_name)
    return records


def worker_action_enabled(rule: dict[str, Any] | None, worker_name: str) -> bool:
    if not rule or not rule.get("enabled"):
        return False
    for action in rule.get("actions") or []:
        if action.get("type") != "worker":
            continue
        value = action.get("value") or []
        values = value if isinstance(value, list) else [value]
        if any(item == worker_name for item in values):
            return True
    return False


def assert_routing_ready(zone_id: str, zone_name: str, worker_name: str) -> None:
    try:
        settings = api("GET", f"/zones/{zone_id}/email/routing")["result"]
    except CloudflareApiError as exc:
        if not is_auth_error(exc):
            raise
        settings = wrangler_routing_settings(zone_name, zone_id)
    if not settings.get("enabled") or settings.get("status") != "ready":
        raise RuntimeError(f"{zone_name}: Email Routing is not ready: {settings}")

    try:
        rules = api("GET", f"/zones/{zone_id}/email/routing/rules?per_page=100").get("result") or []
        catch_all = api("GET", f"/zones/{zone_id}/email/routing/rules/catch_all").get("result") or {}
    except CloudflareApiError as exc:
        if is_auth_error(exc) and wrangler_worker_rule_enabled(zone_name, zone_id, worker_name):
            return
        raise
    if not any(worker_action_enabled(rule, worker_name) for rule in [*rules, catch_all]):
        raise RuntimeError(f"{zone_name}: no enabled routing rule sends to Worker {worker_name}")


def root_records(records: list[dict[str, Any]], zone_name: str, record_type: str) -> list[dict[str, Any]]:
    return [
        record
        for record in records
        if record.get("type") == record_type and record.get("name") == zone_name
    ]


def spf_records(records: list[dict[str, Any]], zone_name: str) -> list[dict[str, Any]]:
    return [
        record
        for record in root_records(records, zone_name, "TXT")
        if str(record.get("content", "")).strip('"').lower().startswith("v=spf1")
    ]


def merge_spf(existing: str | None, include_term: str) -> str:
    if not existing:
        return f"v=spf1 {include_term} ~all"

    parts = existing.strip('"').split()
    if not parts or parts[0].lower() != "v=spf1":
        raise RuntimeError(f"Invalid SPF record: {existing}")
    if include_term in parts:
        return " ".join(parts)
    if any(part.startswith("redirect=") for part in parts[1:]):
        raise RuntimeError("SPF record uses redirect=; merge manually instead of appending mechanisms")

    all_index = next((index for index, part in enumerate(parts) if part.endswith("all")), None)
    if all_index is None:
        parts.append(include_term)
    else:
        parts.insert(all_index, include_term)
    return " ".join(parts)


def required_mx_records(zone_id: str, zone_name: str) -> list[dict[str, Any]]:
    records = [record for record in routing_dns_records(zone_id, zone_name) if record.get("type") == "MX"]
    if not records:
        raise RuntimeError("Cloudflare Email Routing DNS endpoint returned no required MX records")
    return records


def is_spf_txt(record: dict[str, Any]) -> bool:
    return record.get("type") == "TXT" and normalize_dns_content(record).lower().startswith("v=spf1")


def upsert_mx(zone_id: str, zone_name: str, records: list[dict[str, Any]], required: dict[str, Any], apply: bool) -> None:
    content = required.get("content")
    priority = required.get("priority")
    exists = any(record.get("content") == content for record in root_records(records, zone_name, "MX"))
    if exists:
        print(f"  MX already present: {content}")
        return

    body = {"type": "MX", "name": zone_name, "content": content, "priority": priority, "ttl": required.get("ttl", 1)}
    if apply:
        api("POST", f"/zones/{zone_id}/dns_records", body)
    print(f"  {'added' if apply else 'would add'} MX {content} prio {priority}")


def upsert_spf(zone_id: str, zone_name: str, records: list[dict[str, Any]], apply: bool) -> None:
    matches = spf_records(records, zone_name)
    if len(matches) > 1:
        raise RuntimeError(f"{zone_name}: multiple SPF records found; clean up manually before migration")

    current = matches[0]["content"] if matches else None
    merged = merge_spf(current, CLOUDFLARE_SPF_INCLUDE)
    if current and current.strip('"') == merged:
        print("  SPF already includes Cloudflare")
        return

    if apply and matches:
        api("PATCH", f"/zones/{zone_id}/dns_records/{matches[0]['id']}", {"content": merged})
    elif apply:
        api("POST", f"/zones/{zone_id}/dns_records", {"type": "TXT", "name": zone_name, "content": merged, "ttl": 1})
    print(f"  {'updated' if apply else 'would update'} SPF: {merged}")


def upsert_required_txt_records(
    zone_id: str,
    records: list[dict[str, Any]],
    required_records: list[dict[str, Any]],
    apply: bool,
) -> None:
    for required in required_records:
        if required.get("type") != "TXT" or is_spf_txt(required):
            continue
        if required_record_present(required, records):
            print(f"  TXT already present: {required.get('name')}")
            continue

        body = {
            "type": "TXT",
            "name": required.get("name"),
            "content": normalize_dns_content(required),
            "ttl": required.get("ttl", 1),
        }
        if apply:
            api("POST", f"/zones/{zone_id}/dns_records", body)
        print(f"  {'added' if apply else 'would add'} TXT {required.get('name')}")


def verify_cloudflare_records(zone_id: str, zone_name: str, required_mx: list[dict[str, Any]]) -> list[dict[str, Any]]:
    _required_records, missing_routing_records = routing_dns_report(zone_id, zone_name)
    if missing_routing_records:
        raise RuntimeError(f"{zone_name}: Cloudflare still reports missing Email Routing DNS records: {missing_routing_records}")

    records = zone_records(zone_id)
    existing_mx = {record.get("content") for record in root_records(records, zone_name, "MX")}
    missing_mx = [record.get("content") for record in required_mx if record.get("content") not in existing_mx]
    if missing_mx:
        raise RuntimeError(f"{zone_name}: missing Cloudflare MX records after add: {missing_mx}")

    matches = spf_records(records, zone_name)
    if not matches or CLOUDFLARE_SPF_INCLUDE not in matches[0].get("content", ""):
        raise RuntimeError(f"{zone_name}: SPF does not include {CLOUDFLARE_SPF_INCLUDE}")
    return records


def delete_old_mx(zone_id: str, zone_name: str, records: list[dict[str, Any]], old_hosts: list[str], apply: bool) -> None:
    for record in root_records(records, zone_name, "MX"):
        if record.get("content") not in old_hosts:
            continue
        if apply:
            api("DELETE", f"/zones/{zone_id}/dns_records/{record['id']}")
        print(f"  {'deleted' if apply else 'would delete'} old MX {record['content']}")


def migrate_zone(zone_name: str, cfg: dict[str, Any], apply: bool, worker_name: str) -> None:
    zone_id = cfg["id"]
    print(f"== {zone_name} ==")
    assert_routing_ready(zone_id, zone_name, worker_name)
    required_records = routing_dns_records(zone_id, zone_name)
    required_mx = [record for record in required_records if record.get("type") == "MX"]
    if not required_mx:
        raise RuntimeError("Cloudflare Email Routing DNS endpoint returned no required MX records")
    records = zone_records(zone_id)

    print("  preflight passed: routing ready and worker rule enabled")
    for record in required_mx:
        upsert_mx(zone_id, zone_name, records, record, apply)
    upsert_required_txt_records(zone_id, records, required_records, apply)
    upsert_spf(zone_id, zone_name, records, apply)

    verified_records = verify_cloudflare_records(zone_id, zone_name, required_mx) if apply else records
    delete_old_mx(zone_id, zone_name, verified_records, cfg["old_mx_hosts"], apply)


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely migrate MX to Cloudflare Email Routing.")
    parser.add_argument("--apply", action="store_true", help="Actually mutate DNS. Default is dry-run.")
    parser.add_argument("--worker-name", default=WORKER_NAME, help="Required Worker destination in routing rules.")
    args = parser.parse_args()

    if not args.apply:
        print("Dry run only. Re-run with --apply after reviewing the plan.")

    for zone_name, cfg in ZONES.items():
        migrate_zone(zone_name, cfg, args.apply, args.worker_name)

    print()
    print("Done. No destructive MX deletion occurs until Cloudflare MX and SPF are verified.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
