# MCP Server to Databricks Workspace Mapping

Generated from `~/.gtm-genie/home/config.toml` on 2026-10-26.

## Managed GTM MCP Servers

The managed GTM layer is defined in `~/.gtm-genie/home/clf.config.toml`.

| MCP server | Service | Databricks routing workspace | Backing service / residency |
|---|---|---|---|
| `gtm_sage_context_mcp` | Sage Context Catalog | `gtm-ai-agent` — workspace ID `7474646471015793` | Custom gateway resource `gtm_ai_context_sage_mcp`; its runtime workspace is not exposed. |
| `gtm_fevm_mcp` | FE Vending Machine | `gtm-ai-agent` — workspace ID `7474646471015793` | Custom gateway resource `gtm_ai_fevm_mcp`; its runtime workspace is not exposed. |
| `gtm_glean_mcp` | Glean | `gtm-ai-agent` — workspace ID `7474646471015793` | Custom gateway resource `gtm_ai_glean_mcp`; Glean is the external source. |
| `gtm_google_calendar_mcp` | Google Calendar | `gtm-ai-agent` — workspace ID `7474646471015793` | Databricks system MCP `system.ai.google_calendar`; Google is the external source. |
| `gtm_google_drive_mcp` | Google Drive | `gtm-ai-agent` — workspace ID `7474646471015793` | Databricks system MCP `system.ai.google_drive`; Google is the external source. |
| `gtm_atlassian_mcp` | Jira and Confluence | `gtm-ai-agent` — workspace ID `7474646471015793` | Databricks system MCP `system.ai.atlassian`; Atlassian is the external source. |
| `gtm_slack_mcp` | Slack | `gtm-ai-agent` — workspace ID `7474646471015793` | Databricks system MCP `system.ai.slack`; Slack is the external source. |
| `gtm_web_search_mcp` | Public web search | `gtm-ai-agent` — workspace ID `7474646471015793` | Databricks system MCP `system.ai.web_search`; its internal runtime workspace is not exposed. |
| `clf-databricks-genie_one_mcp` | Genie One | Logfood — workspace ID `2548836972759138`, profile `clf-logfood` | Directly routed through Logfood's `system.ai.genie_one_mcp`. |
| `clf-databricks-governed_skills_mcp` | Governed UC Skills | Logfood — workspace ID `2548836972759138`, profile `clf-logfood` | Directly routed to the Skills MCP for `main.gtm_ai_tooling`. |

Eight managed servers enter through the `gtm-ai-agent` AI Gateway workspace. Genie One and Governed Skills enter through Logfood. A routing workspace is not necessarily the internal execution location or the external system's data residency.

| MCP server | Launch / endpoint | Databricks workspace | Confidence | Notes |
|---|---|---|---|---|
| `google` | Local `dbexec repo run mcp start-single google` process | Not exposed in local configuration | Confirmed unknown | The MCP process runs locally over stdio. Its managed backend workspace, if any, is hidden behind `dbexec`; Google itself is an external service. |
| `github` | Local `dbexec repo run mcp start-single github` process | Not exposed in local configuration | Confirmed unknown | The MCP process runs locally over stdio. Its managed backend workspace, if any, is hidden behind `dbexec`; GitHub itself is an external service. |
| `databricks-v2` | Local `dbexec repo run mcp start-single databricks-v2` process | Not exposed in local configuration | Confirmed unknown | The launcher configuration does not provide a Databricks workspace host or ID. |
| `salesforce` | Local `dbexec repo run mcp start-single salesforce` process | Not exposed in local configuration | Confirmed unknown | Enabled in the GTM Genie base config and native Genie config. It targets the production Salesforce gateway, but `dbexec` hides the gateway's Databricks workspace; Salesforce is the external system of record. |
| `sage-context-catalog` | Databricks App `mcp-sage-catalog-7474652802624799.aws.databricksapps.com` | Workspace ID `7474652802624799`; friendly name not available locally | High | The workspace ID is embedded in the Databricks Apps hostname. Authentication is proxied through `fe-ai-sage.cloud.databricks.com`. |
| `fe-vending-machine` | Databricks App `mcp-fevm-2481552415672103.aws.databricksapps.com` | Workspace ID `2481552415672103`; friendly name not available locally | High | The workspace ID is embedded in the Databricks Apps hostname. Authentication is proxied through `fe-vending-machine.cloud.databricks.com`. |
| `databricks-genie` | `adb-2548836972759138.18.azuredatabricks.net/api/2.0/mcp/genie` | Workspace ID `2548836972759138`; local profiles `logfood` and `clf-logfood` | Exact | Both the MCP endpoint and proxy host point directly to this Azure Databricks workspace. |

## Interpretation

- A local stdio launcher is not itself hosted in a Databricks workspace.
- For Databricks Apps, the numeric suffix in the app hostname identifies the hosting workspace, but the local config does not contain its friendly workspace name.
- The mapping covers the MCP servers enabled in the current GTM Genie config, not every server available in the plugin marketplace.
- No credentials or secret environment values are included.

## Configuration Locations

For the current GTM Genie setup:

- MCP and enabled-plugin configuration: `~/.gtm-genie/home/config.toml`
  - MCP entries: `[mcp_servers.<name>]`
  - Plugin entries: `[plugins."<plugin>@<marketplace>"]`
- Managed GTM MCP configuration: `~/.gtm-genie/home/clf.config.toml`
- Installed plugin cache: `~/.gtm-genie/home/plugins/cache/<marketplace>/<plugin>/<version>/`
- Native Genie config: `~/.genie/config.toml`
- Marketplace checkout/cache: `~/.genie/.tmp/marketplaces/`

> Avoid sharing `config.toml`; MCP environment sections may contain sensitive values.

## Plugin Sources

All currently enabled plugins come from the `fe-vibe` marketplace:

- Source repository: `https://github.com/databricks-field-eng/vibe.git`
- Tracked ref: `main`
- Local marketplace checkout: `~/.genie/.tmp/marketplaces/fe-vibe/`
- Installed artifacts: `~/.gtm-genie/home/plugins/cache/fe-vibe/`

| Enabled plugin | Marketplace | Installed version |
|---|---|---|
| `fe-ai-tools` | `fe-vibe` | `1.2.2` |
| `databricks-impeccable` | `fe-vibe` | `0.1.4` |
| `fe-ssagent` | `fe-vibe` | `1.3.2` |
| `lakebridge-profilers` | `fe-vibe` | `0.2.1` |

The plugin key format `plugin@marketplace` links each enabled entry in `config.toml` to its marketplace definition. Genie checks out the marketplace repository, then installs versioned plugin artifacts into the GTM Genie cache. Built-in skills under `~/.gtm-genie/home/skills/.system/` are shipped by Genie and are not marketplace plugins.

## Installing Individual MCP Servers

The verified syntax for a local stdio MCP server is:

```bash
genie mcp add <name> \
  --env KEY=value \
  -- <command> <arguments...>
```

The Salesforce command is valid:

```bash
genie mcp add salesforce \
  --env SALESFORCE_GATEWAY_ENV=prod \
  --env I_DANGEROUSLY_OPT_IN_TO_UNSUPPORTED_ALPHA_TOOLS=true \
  -- dbexec repo run mcp start-single salesforce
```

This creates the global `[mcp_servers.salesforce]` entry in `~/.genie/config.toml`. The `--` separator is required: everything after it is the stdio server launch command. A backslash must be the final character on its line; trailing spaces after `\` break shell continuation.

For a streamable HTTP MCP server, use:

```bash
genie mcp add <name> --url <https://server.example/mcp>
```

Use `--bearer-token-env-var <ENV_VAR>` or the OAuth options only when required by that user-added HTTP server. GTM Genie's managed field tools use the Databricks sign-in bridge and should not be reinstalled or authenticated this way.

## Tool Permission Matrix

This classification reflects tools exposed in the current session. **Write** means a tool can mutate source-system or workspace state; cancelling an in-flight query alone is not treated as a data write.

### Managed GTM Servers

| MCP server | Access | Tool evidence |
|---|---|---|
| `gtm_sage_context_mcp` | Read/write | Reads with `ask`, `discover`, `read`, and `profile`; writes with `add`, `update`, `delete`, `tag`, and `relate`. |
| `gtm_fevm_mcp` | Read/write | Reads templates, deployments, quota, and grants; writes with `create_deployment`, `create_addon`, `add_workspace_admin`, extension actions, and `request_metastore_permission`. |
| `gtm_glean_mcp` | Read-only | Search, document read, employee lookup, meeting lookup, code search, and chat; no source mutation tool is exposed. |
| `gtm_google_calendar_mcp` | Read-only | Lists calendars/events, gets events, and checks free/busy; no create, update, or delete tool is exposed. |
| `gtm_google_drive_mcp` | Read-only | Search, metadata, permissions inspection, download, file read, and comment read; no mutation tool is exposed. |
| `gtm_atlassian_mcp` | Read-only | Jira/Confluence get, lookup, fetch, and search operations; no create, comment, transition, update, or delete tool is exposed. |
| `gtm_slack_mcp` | Read-only | Search and read tools for messages, channels, threads, canvases, reactions, members, and profiles; no send, react, update, or delete tool is exposed. |
| `gtm_web_search_mcp` | Read-only | Only `web_search` is exposed. |
| `clf-databricks-genie_one_mcp` | Read/query | Asks questions and retrieves SQL results. `genie_cancel_response` changes only an in-flight request, not governed data. |
| `clf-databricks-governed_skills_mcp` | Read plus indirect actions | Lists, loads, and reads skills. `create_skill`, `update_skill`, and `delete_skill` return CLI commands but do not execute the mutation themselves. Loaded skills may perform their own actions and must be assessed individually. |

### Additional Configured Servers

| MCP server | Access | Tool evidence / status |
|---|---|---|
| `google` | Read/write | Exposes reads plus Calendar event creation/update/deletion, Drive file/comment/permission mutation, Gmail send/modify, Docs edits, Sheets updates, Slides updates, and Tasks mutation. |
| `github` | Read/write | Exposes both `github_read_api_call` and `github_write_api_call`. |
| `databricks-v2` | Read/write | Exposes reads plus SQL execution, job runs, dashboard execution, and cancellation operations. SQL permissions ultimately depend on the connected workspace identity. |
| `sage-context-catalog` | Read/write | Same underlying Sage capability class; the legacy entry is disabled in the managed GTM configuration. |
| `fe-vending-machine` | Read/write | Same underlying FEVM capability class; the legacy entry is disabled in the managed GTM configuration. |
| `databricks-genie` | Read/query | Asks Genie and retrieves query results; cancellation affects only an in-flight response. |
| `salesforce` | Read/write | Discovers objects and fields and reads records with SOQL. Writes create or update exactly one record through `execute_upsert`, which requires a previewed field-level diff and explicit human approval before commit. The server targets the production Salesforce instance. |

Actual authorization remains constrained by the signed-in user's source-system and Databricks permissions even when a write-capable tool is exposed.
