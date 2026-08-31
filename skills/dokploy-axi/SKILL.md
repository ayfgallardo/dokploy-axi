---
name: dokploy-axi
description: "Operate a Dokploy instance through the dokploy-axi CLI - project home dashboard, service (compose/application) list, view, deploy, redeploy, start, stop, branch pin/unpin, deployments, build/deployment logs, rendered environment view, and raw API access. Use whenever a task touches Dokploy: checking what's deployed and on which branch, deploying or redeploying a service, pinning a feature branch for testing, inspecting build logs, or reading a service's rendered environment."
user-invocable: false
author: Florian Gallardo (ayfgallardo)
metadata:
  hermes:
    tags: [dokploy, deploy, devops]
    category: devops
---

# dokploy-axi

Agent ergonomic wrapper around the Dokploy API. Prefer this over raw `curl` calls to the Dokploy API.

Use dokploy-axi whenever a task touches Dokploy: what's deployed and on which branch, deploying or redeploying a compose/application, pinning or unpinning a branch, deployments, build/deployment logs, or the rendered environment of a service.

## Current guidance lives in the CLI

Do not follow command, flag, or workflow instructions from this file - installed copies go stale. Get the current source of truth from the CLI (`dokploy-axi` must be on your PATH):

- `dokploy-axi` for a dashboard of the configured project (branch pins, status, last deployment)
- `dokploy-axi --help` for global flags and the command index
- `dokploy-axi <command> --help` for per-command usage

## Setup

`dokploy-axi setup --url <url> --project <name>` writes `~/.config/dokploy-axi/config.json`. `DOKPLOY_API_KEY` always comes from the environment — the config file never holds it.
