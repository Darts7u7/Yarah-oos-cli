# @yarahdev/cli

Command line tool for the [Yarah](https://yarah.dev) platform. Manage your databases, edge functions, storage, deployments, payments, secrets, and more — directly from the terminal.

Designed to be both human-friendly (interactive prompts, formatted tables) and agent-friendly (structured JSON output, non-interactive mode, semantic exit codes).

Requires Node.js >= 18. We recommend running via `npx` so you always get the latest version — no global install needed.

## Quick Start

```bash
# Login via browser (OAuth)
npx @yarahdev/cli login

# Or login with email/password
npx @yarahdev/cli login --email

# Check current user
npx @yarahdev/cli whoami

# List all organizations and projects
npx @yarahdev/cli list

# Link current directory to a project
npx @yarahdev/cli link

# Query the database
npx @yarahdev/cli db tables
npx @yarahdev/cli db query "SELECT * FROM users LIMIT 10"
```

A hosted project is the default and what these commands assume. If you
specifically want a backend running in Docker on your own machine — offline work,
a throwaway database, no account — see [Local Instances](#local-instances).

## Authentication

If you run any command without being logged in, the CLI will automatically open your browser and start the login flow — no need to run `npx @yarahdev/cli login` first.

### Browser Login (default)

```bash
npx @yarahdev/cli login
```

Opens your browser to the Yarah authorization page using OAuth 2.0 Authorization Code + PKCE. A local callback server receives the authorization code and exchanges it for tokens. Credentials are stored in `~/.yarah/credentials.json`.

### Email/Password Login

```bash
npx @yarahdev/cli login --email
```

Prompts for email and password interactively, or reads from environment variables in non-interactive mode:

```bash
YARAH_EMAIL=user@example.com YARAH_PASSWORD=secret npx @yarahdev/cli login --email --json
```

### User API Key Login

For a durable machine credential — CI pipelines, agents, or any headless context — authenticate with a `uak_` user API key instead of short-lived session tokens:

```bash
npx @yarahdev/cli login --user-api-key uak_xxxxxxxx --json
```

Create the key in the dashboard (Profile → API Keys). Keys default to a 90-day expiry, or can be created with no expiry for a permanent credential. The key is sent directly as the bearer credential on every request — there is no hourly token expiry or refresh-token rotation to manage, and it works for accounts that sign in via OAuth providers (e.g. Google), where email/password login does not apply.

Alternatively, skip the login step entirely and pass the key per-invocation via the environment:

```bash
YARAH_ACCESS_TOKEN=uak_xxxxxxxx npx @yarahdev/cli db query "SELECT 1" --json
```

### Logout

```bash
npx @yarahdev/cli logout
```

## Global Options

Global flags (available on all commands unless noted otherwise):

| Flag                | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `--json`            | Output in JSON format (useful for scripts and AI agents) |
| `--api-url <url>`   | Override the Platform API URL                            |
| `-y, --yes`         | Skip confirmation prompts                                |
| `--forger`          | Play the Forger animation (root command only: `yarah --forger`) |

`--forger` is ignored with a warning when combined with a subcommand (e.g. `yarah login --forger`).

The `--project-id <id>` flag is command-specific and is supported by `link`
when you want to link a directory directly to a known project.

## Commands

> The `orgs`, `projects`, and `records` command groups are registered but hidden
> (`hidden: true` in `src/index.ts`) and are intentionally excluded from this
> reference. Use `npx @yarahdev/cli list` instead of `orgs`/`projects`; `records`
> is internal and not supported for direct use.

### Local Instances

Run a full Yarah backend on your own machine in Docker: Postgres, PostgREST,
the backend, and the edge-functions runtime. No account, no repository clone.

**One instance per directory.** The compose project name includes a hash of the
directory path, so every app folder gets its own containers, volumes, and
database — including two folders that share a name.

#### `npx @yarahdev/cli local start`

Starts the stack, waits for it to become healthy, links the directory, and seeds
`.env.local`.

```bash
npx @yarahdev/cli local start
npx @yarahdev/cli local start --storage minio   # bundled S3-compatible store
npx @yarahdev/cli local start --pull            # re-pull images
npx @yarahdev/cli local start --port-app 8130   # relocate a port
npx @yarahdev/cli local start --json
```

| Option | Description |
| --- | --- |
| `--storage <backend>` | `local` (filesystem, default), `minio`, or `rustfs`. The bundled stores stay on the internal Docker network and enable the S3-compatible gateway at `/storage/v1/s3`. |
| `--pull` | Re-pull images even when present locally. |
| `--port-app`, `--port-auth`, `--port-deno`, `--port-postgres`, `--port-postgrest` | Host port overrides. Defaults are 7130 / 7131 / 7133 / 5432 / 5430. A port set here is never relocated. |

Afterwards every other command targets the local backend — no login, because the
directory is linked with the instance's own API key:

```bash
npx @yarahdev/cli db query "select 1"
npx @yarahdev/cli storage create-bucket avatars
npx @yarahdev/cli functions deploy
```

**Where the stack comes from.** The first start fetches
[`deploy/setup.sh`](https://github.com/Darts7u7/Yarah-oos/blob/main/deploy/setup.sh)
from the Yarah repository and runs it into `.yarah/checkout/`. That script
is what self-hosting uses, so a local instance runs the same compose file, init
SQL, and images as a deployed one — the CLI adds one overlay, which sets the
telemetry stamp and binds the published ports to loopback. Every start re-runs it,
picking up upstream changes; the generated `.env` is left alone.

Images track `:latest`. A directory's first start pulls, because Docker will not
re-fetch a tag it already has — without it a machine that pulled months ago runs
that image and reports its version, with nothing to suggest a newer one exists.
Later starts do not pull: an image moving under an instance that has data is how
the backend ends up running migrations its volume did not expect. `--pull` asks
for it deliberately.

`.yarah/checkout/.env` is where the instance's secrets are generated, and the
only copy of most of them — the Postgres password, JWT secret, encryption key,
and admin password appear nowhere else. (The API key is also in
`.yarah/project.json`, the anon key in `.env.local`.) If the file is missing
while volumes still exist, `local start` refuses rather than generating new ones:
Postgres reads its password only when the cluster is created, so fresh secrets
would leave the database unreachable.

**Ports.** The first instance on a machine gets 7130 / 7131 / 7133 / 5432 / 5430.
When those are taken the whole block shifts by ten — a second instance lands on
7140, a third on 7150 — and `start` prints what moved. Ports a directory has
already used stay put across restarts, so `.env.local` keeps pointing at the
right place.

Every published port binds to `127.0.0.1` — a development backend has no business
being reachable from the rest of the network. Services reach each other over the
project's internal Docker network, which is not published at all.

#### `npx @yarahdev/cli local stop`

```bash
npx @yarahdev/cli local stop                # stop; data is kept
npx @yarahdev/cli local stop --delete-data  # also destroy the volumes
npx @yarahdev/cli local stop --unlink       # restore the previous cloud link
```

`--delete-data` is irreversible and classified `critical` by the human-in-the-loop
guard, so with the guard enabled it requires approval. A plain `stop` never prompts.

If the directory was linked to a cloud project, `local start` saves that link to
`.yarah/project.cloud.json` rather than overwriting it, and `local stop
--unlink` puts it back.

#### `npx @yarahdev/cli local status`

```bash
npx @yarahdev/cli local status
npx @yarahdev/cli local status --show-keys   # print keys in full
npx @yarahdev/cli local status --json
```

Shows health, ports, the backend version, the compose project name, and
per-container state. Keys are masked by default, and `--json` omits them unless
`--show-keys` is passed — so its output is safe to paste into an issue.

**Requirements.** Docker with Compose 2.24.4 or newer, and roughly 1.5 GB
available to the daemon. Any Docker-compatible runtime works (Docker Desktop,
OrbStack, Colima, Rancher Desktop). Without Docker, `yarah create` gives you a
hosted project instead.

### Top-Level

#### `npx @yarahdev/cli whoami`

Show the current authenticated user.

```bash
npx @yarahdev/cli whoami
npx @yarahdev/cli whoami --json
```

#### `npx @yarahdev/cli list`

List all organizations and their projects in a grouped table.

```bash
npx @yarahdev/cli list
npx @yarahdev/cli list --json
```

#### `npx @yarahdev/cli create`

Create a new Yarah project interactively.

```bash
npx @yarahdev/cli create
npx @yarahdev/cli create --name "my-app" --org-id <org-id> --region us-east
npx @yarahdev/cli create --name "my-app" --template nextjs --auth better-auth   # scaffold from a built-in template
npx @yarahdev/cli create --name "my-app" --marketplace <slug>                   # install a marketplace template
```

**Options:**

- `--name <name>`: Project name
- `--org-id <id>`: Organization ID
- `--region <region>`: Deployment region (`us-east`, `us-west`, `eu-central`, `ap-southeast`)
- `--template <template>`: Built-in template (`react`, `nextjs`, `chatbot`, `crm`, `e-commerce`, `todo`, or `empty`)
- `--marketplace <slug>`: Install a marketplace template by slug (browse: https://yarah.dev/templates)
- `--auth <provider>`: Wire a third-party auth provider into the chosen template (currently: `better-auth`)

#### `npx @yarahdev/cli link`

Link the current directory to a Yarah project. Creates `.yarah/project.json` with the project ID, API key, and OSS host URL.

```bash
# Interactive: select from a list
npx @yarahdev/cli link

# Non-interactive (platform login)
npx @yarahdev/cli link --project-id <id> --org-id <org-id>

# OSS / self-hosted: link via host URL + API key (no platform login required)
npx @yarahdev/cli link \
  --api-base-url https://<app-key>.<region>.apps.yarah.dev \
  --api-key <your-project-api-key>
```

For OSS or self-hosted deployments, you can link directly using the host URL and API key — the CLI skips the platform OAuth flow and writes the credentials straight into `.yarah/project.json`. The host URL format is `https://{app_key}.{region}.apps.yarah.dev` (e.g. `https://uhzx8md3.us-east.apps.yarah.dev`).

#### `npx @yarahdev/cli current`

Show current CLI context (authenticated user, linked project).

```bash
npx @yarahdev/cli current
npx @yarahdev/cli current --json
```

#### `npx @yarahdev/cli metadata`

Show backend metadata including auth configuration, database tables, storage buckets, edge functions, AI models, and realtime channels.

```bash
npx @yarahdev/cli metadata
npx @yarahdev/cli metadata --json
```

#### `npx @yarahdev/cli logs`

Fetch backend container logs.

```bash
npx @yarahdev/cli logs <source> [options]
```

**Sources:** `yarah.logs`, `postgREST.logs`, `postgres.logs`, `function.logs`

**Options:**

- `--limit <n>`: Number of log entries to return (default: 20)

**Examples:**

```bash
npx @yarahdev/cli logs yarah.logs
npx @yarahdev/cli logs postgres.logs --limit 50
npx @yarahdev/cli logs function.logs --json
```

#### `npx @yarahdev/cli docs`

Browse Yarah SDK documentation.

```bash
npx @yarahdev/cli docs [feature] [language]
```

**Features:** `db`, `storage`, `functions`, `auth`, `ai`, `realtime`, `instructions`
**Languages:** `typescript`, `swift`, `kotlin`, `rest-api`

**Examples:**

```bash
# List all available docs
npx @yarahdev/cli docs

# Specific feature/language docs
npx @yarahdev/cli docs instructions           # Show backend setup instructions
npx @yarahdev/cli docs db typescript          # Show TypeScript database SDK docs
npx @yarahdev/cli docs auth swift             # Show Swift auth SDK docs
npx @yarahdev/cli docs storage rest-api       # Show REST API storage docs
```

---

### Branch — `npx @yarahdev/cli branch`

Manage backend branches of the currently linked project.

#### `npx @yarahdev/cli branch list`

List branches of the currently linked project.

```bash
npx @yarahdev/cli branch list
npx @yarahdev/cli branch list --json
```

#### `npx @yarahdev/cli branch create <name>`

Create a branch from the currently linked project.

```bash
npx @yarahdev/cli branch create feature-x
npx @yarahdev/cli branch create feature-x --mode schema-only   # full | schema-only (default: full)
npx @yarahdev/cli branch create feature-x --no-switch          # do not auto-switch context after creation
```

#### `npx @yarahdev/cli branch switch [name]`

Switch this directory's context to a branch (or back to the parent project).

```bash
npx @yarahdev/cli branch switch feature-x
npx @yarahdev/cli branch switch --parent   # switch back to the parent project
```

#### `npx @yarahdev/cli branch merge <name>`

Merge a branch back to its parent project.

```bash
npx @yarahdev/cli branch merge feature-x
npx @yarahdev/cli branch merge feature-x --dry-run            # compute the diff and print rendered SQL; do not apply
npx @yarahdev/cli branch merge feature-x --save-sql diff.sql  # write rendered SQL preview to a file
```

#### `npx @yarahdev/cli branch reset <name>`

Reset a branch's database back to T0 (the parent snapshot at branch creation).

```bash
npx @yarahdev/cli branch reset feature-x
```

#### `npx @yarahdev/cli branch delete <name>`

Delete a branch.

```bash
npx @yarahdev/cli branch delete feature-x
```

---

### AI — `npx @yarahdev/cli ai`

Configure local development for the Yarah Model Gateway. The setup command fetches the linked project's active OpenRouter key from the Yarah backend and writes it as the server-only `OPENROUTER_API_KEY` variable.

```bash
npx @yarahdev/cli ai setup
npx @yarahdev/cli ai setup --env-file .env
npx @yarahdev/cli ai setup --json
```

By default the CLI writes `.env.local` and adds `.env*.local` to `.gitignore` when needed. For deployments such as Vercel, add `OPENROUTER_API_KEY` to the provider's server/runtime environment. Do not rename the key to `NEXT_PUBLIC_`, `VITE_`, or `PUBLIC_`; those prefixes expose values to browser code.

---

### Database — `npx @yarahdev/cli db`

#### `npx @yarahdev/cli db query <sql>`

Execute a raw SQL query.

```bash
npx @yarahdev/cli db query "SELECT * FROM users LIMIT 10"
npx @yarahdev/cli db query "SELECT count(*) FROM orders" --json
```

#### `npx @yarahdev/cli db tables`

List all database tables.

```bash
npx @yarahdev/cli db tables
npx @yarahdev/cli db tables --json
```

#### `npx @yarahdev/cli db functions`

List all database functions.

```bash
npx @yarahdev/cli db functions
```

#### `npx @yarahdev/cli db indexes`

List all database indexes.

```bash
npx @yarahdev/cli db indexes
```

#### `npx @yarahdev/cli db policies`

List all RLS policies.

```bash
npx @yarahdev/cli db policies
```

#### `npx @yarahdev/cli db triggers`

List all database triggers.

```bash
npx @yarahdev/cli db triggers
```

#### `npx @yarahdev/cli db rpc <functionName>`

Call a database function via RPC.

```bash
npx @yarahdev/cli db rpc my_function --data '{"param1": "value"}'
```

#### `npx @yarahdev/cli db export`

Export database schema and/or data.

```bash
npx @yarahdev/cli db export --output schema.sql
npx @yarahdev/cli db export --data-only --output data.sql
```

#### `npx @yarahdev/cli db import <file>`

Import database from a local SQL file.

```bash
npx @yarahdev/cli db import schema.sql
```

#### `npx @yarahdev/cli db migrations`

Manage database migration files.

```bash
npx @yarahdev/cli db migrations list          # list applied remote migrations
npx @yarahdev/cli db migrations fetch         # fetch applied remote migrations into migrations/
npx @yarahdev/cli db migrations new add-users # create a new local migration file (lowercase, digits, hyphens only)
npx @yarahdev/cli db migrations up --all      # apply all pending local migrations
npx @yarahdev/cli db migrations up --to 20260101_add-users  # apply up to a version/file
```

#### `npx @yarahdev/cli db connection-string`

Print the project Postgres connection URL (cloud projects only).

```bash
npx @yarahdev/cli db connection-string
```

---

### Functions — `npx @yarahdev/cli functions`

#### `npx @yarahdev/cli functions list`

List all edge functions.

```bash
npx @yarahdev/cli functions list
npx @yarahdev/cli functions list --json
```

#### `npx @yarahdev/cli functions code <slug>`

View the source code of an edge function.

```bash
npx @yarahdev/cli functions code my-function
npx @yarahdev/cli functions code my-function --json
```

#### `npx @yarahdev/cli functions deploy <slug>`

Deploy an edge function. Creates the function if it doesn't exist, or updates it.

```bash
npx @yarahdev/cli functions deploy my-function --file ./handler.ts
npx @yarahdev/cli functions deploy my-function --file ./handler.ts --name "My Function" --description "Does something"
```

#### `npx @yarahdev/cli functions invoke <slug>`

Invoke an edge function.

```bash
npx @yarahdev/cli functions invoke my-function --data '{"key": "value"}'
npx @yarahdev/cli functions invoke my-function --method GET
npx @yarahdev/cli functions invoke my-function --data '{"key": "value"}' --json
```

#### `npx @yarahdev/cli functions delete <slug>`

Delete an edge function.

```bash
npx @yarahdev/cli functions delete my-function
npx @yarahdev/cli functions delete my-function -y  # skip confirmation
```

---

### Storage — `npx @yarahdev/cli storage`

#### `npx @yarahdev/cli storage buckets`

List all storage buckets.

```bash
npx @yarahdev/cli storage buckets
npx @yarahdev/cli storage buckets --json
```

#### `npx @yarahdev/cli storage create-bucket <name>`

Create a new storage bucket.

```bash
npx @yarahdev/cli storage create-bucket images
npx @yarahdev/cli storage create-bucket private-docs --private
```

#### `npx @yarahdev/cli storage delete-bucket <name>`

Delete a storage bucket and all its objects.

```bash
npx @yarahdev/cli storage delete-bucket images
npx @yarahdev/cli storage delete-bucket images -y   # skip confirmation
```

#### `npx @yarahdev/cli storage list-objects <bucket>`

List objects in a storage bucket.

```bash
npx @yarahdev/cli storage list-objects images
npx @yarahdev/cli storage list-objects images --prefix "avatars/" --limit 50
```

#### `npx @yarahdev/cli storage upload <file>`

Upload a file to a storage bucket.

```bash
npx @yarahdev/cli storage upload ./photo.png --bucket images
npx @yarahdev/cli storage upload ./photo.png --bucket images --key "avatars/user-123.png"
```

#### `npx @yarahdev/cli storage download <objectKey>`

Download a file from a storage bucket.

```bash
npx @yarahdev/cli storage download avatars/user-123.png --bucket images
npx @yarahdev/cli storage download avatars/user-123.png --bucket images --output ./downloaded.png
```

---

### Deployments — `npx @yarahdev/cli deployments`

#### `npx @yarahdev/cli deployments deploy [directory]`

Deploy a frontend project. Zips the source, uploads it, and polls for build completion (up to 2 minutes).

```bash
npx @yarahdev/cli deployments deploy
npx @yarahdev/cli deployments deploy ./my-app
npx @yarahdev/cli deployments deploy --env '{"API_URL": "https://api.example.com"}'
```

To exclude files from the upload, add a `.vercelignore` file to the deploy directory. It uses `.gitignore` syntax (including `!` negation) and is applied on top of the built-in excludes (`node_modules`, `.git`, `.env`, etc. — these always stay excluded and cannot be re-included).

```gitignore
# .vercelignore
*.md
drafts/
!IMPORTANT.md
```

#### `npx @yarahdev/cli deployments list`

List all deployments.

```bash
npx @yarahdev/cli deployments list
npx @yarahdev/cli deployments list --limit 5 --json
```

#### `npx @yarahdev/cli deployments status <id>`

Get deployment details and status.

```bash
npx @yarahdev/cli deployments status abc-123
npx @yarahdev/cli deployments status abc-123 --sync   # sync status from Vercel first
```

#### `npx @yarahdev/cli deployments cancel <id>`

Cancel a running deployment.

```bash
npx @yarahdev/cli deployments cancel abc-123
```

#### `npx @yarahdev/cli deployments env`

Manage deployment environment variables.

```bash
npx @yarahdev/cli deployments env list                       # list all deployment env vars
npx @yarahdev/cli deployments env set API_URL https://api.example.com  # create or update a variable
npx @yarahdev/cli deployments env delete <id>                # delete a variable by ID
```

#### `npx @yarahdev/cli deployments metadata`

Show current deployment metadata and domain URLs.

```bash
npx @yarahdev/cli deployments metadata
npx @yarahdev/cli deployments metadata --json
```

#### `npx @yarahdev/cli deployments slug [slug]`

Show, set, or remove the custom deployment slug.

```bash
npx @yarahdev/cli deployments slug
npx @yarahdev/cli deployments slug my-app
npx @yarahdev/cli deployments slug --remove
```

---

### Domains — `npx @yarahdev/cli domains`

Register a domain through the user's Cloudflare account, attach it to the linked Yarah deployment, sync Cloudflare DNS records, and verify SSL/custom domain readiness.

Cloudflare is connected through OAuth and saved locally in `~/.yarah/cloudflare.json`:

```bash
npx @yarahdev/cli domains cloudflare login
npx @yarahdev/cli domains cloudflare login --account-id <cloudflare-account-id>  # skip account selection
```

The CLI opens Cloudflare in the browser, receives the OAuth callback on
`http://127.0.0.1:8787/callback`, stores the returned Cloudflare tokens locally,
and discovers the Cloudflare account selected during authorization. For
non-browser environments, pass `--skip-browser` and open the printed URL
manually. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ACCESS_TOKEN` can override the
local OAuth credentials for automation.

Use the split commands when you want to inspect or resume a workflow:

```bash
npx @yarahdev/cli domains search my-app
npx @yarahdev/cli domains search my-app --tlds com,app,dev   # optional local filter
npx @yarahdev/cli domains check my-app.dev
npx @yarahdev/cli domains buy my-app.dev
npx @yarahdev/cli domains attach my-app.dev
npx @yarahdev/cli domains dns sync my-app.dev
npx @yarahdev/cli domains verify my-app.dev
npx @yarahdev/cli domains status my-app.dev --cloudflare
```

Cloudflare only allows programmatic registration for TLDs currently supported
by its Registrar API. The CLI surfaces Cloudflare's availability reason when a
TLD is dashboard-only or not supported by the API.

For agent runs, use explicit purchase confirmations. The global `--yes` flag does not bypass domain purchase confirmation:

```bash
npx @yarahdev/cli domains buy-and-attach my-app.dev \
  --confirm-domain my-app.dev \
  --confirm-price 10.11 \
  --confirm-currency USD \
  --confirm-cloudflare-billing \
  --confirm-non-refundable \
  --json
```

If Cloudflare registration is still in progress, retry with:

```bash
npx @yarahdev/cli domains resume my-app.dev
```

---

### Payments — `npx @yarahdev/cli payments`

Manage the payments foundation for the linked Yarah project. Provider-specific commands live under `payments stripe` and `payments razorpay`. These commands are intended for developers and agents configuring provider keys, syncing mirrored provider state, inspecting customers, and managing provider catalog records. Runtime checkout/order/subscription calls should usually be made from the app via the SDK.

#### `npx @yarahdev/cli payments <provider> status`

Show key, account, sync, and webhook status for test/live environments.

```bash
npx @yarahdev/cli payments stripe status
npx @yarahdev/cli payments razorpay status
npx @yarahdev/cli payments stripe status --json
```

#### `npx @yarahdev/cli payments <provider> config`

Set or remove provider keys. `config set` validates the keys and automatically syncs provider state when the key or account changes. Use `payments <provider> status` to inspect key, account, sync, and webhook health.

```bash
npx @yarahdev/cli payments stripe config set --environment test sk_test_xxx
npx @yarahdev/cli payments stripe config set --environment live        # prompts securely
npx @yarahdev/cli payments stripe config remove --environment test -y
npx @yarahdev/cli payments razorpay config set --environment test --key-id rzp_test_xxx --key-secret xxx
npx @yarahdev/cli payments razorpay config remove --environment test -y
```

#### `npx @yarahdev/cli payments <provider> sync`

Manually refresh or retry provider catalog, customers, subscriptions, and transaction projections from configured environments. `config set` already syncs automatically when keys or accounts change.

```bash
npx @yarahdev/cli payments stripe sync
npx @yarahdev/cli payments stripe sync --environment test
npx @yarahdev/cli payments razorpay sync --environment test
npx @yarahdev/cli payments stripe sync --environment live --json
```

#### `npx @yarahdev/cli payments stripe webhooks configure --environment <environment>`

Create or recreate the Yarah-managed Stripe webhook endpoint for an environment.

```bash
npx @yarahdev/cli payments stripe webhooks configure --environment test
```

#### `npx @yarahdev/cli payments razorpay webhooks setup --environment <environment>`

Show the webhook URL and secret to use when manually creating the webhook in Razorpay Dashboard.

```bash
npx @yarahdev/cli payments razorpay webhooks setup --environment test
npx @yarahdev/cli payments razorpay webhooks setup --environment live --json
```

#### `npx @yarahdev/cli payments razorpay webhooks rotate-secret --environment <environment>`

Rotate the webhook secret for an environment. Existing Razorpay webhook deliveries fail until the new secret is updated in Razorpay Dashboard. The command asks for confirmation; use `--yes` to skip the prompt. JSON mode requires `--yes`.

```bash
npx @yarahdev/cli payments razorpay webhooks rotate-secret --environment test
npx @yarahdev/cli payments razorpay webhooks rotate-secret --environment live --yes --json
```

Razorpay webhooks must still be created manually in Razorpay Dashboard. Copy the URL and secret returned by `webhooks setup`, select the recommended events, and save the webhook for the matching environment.

#### `npx @yarahdev/cli payments <provider> catalog --environment <environment>`

Inspect mirrored provider catalog records for one environment.

```bash
npx @yarahdev/cli payments stripe catalog --environment test
npx @yarahdev/cli payments razorpay catalog --environment test
npx @yarahdev/cli payments stripe catalog --environment test --json
```

#### `npx @yarahdev/cli payments <provider> customers --environment <environment>`

List mirrored provider customers for admin/debugging workflows.

```bash
npx @yarahdev/cli payments stripe customers --environment test
npx @yarahdev/cli payments razorpay customers --environment test
npx @yarahdev/cli payments stripe customers --environment test --limit 20 --json
```

#### `npx @yarahdev/cli payments stripe products`

List, inspect, create, update, or delete Stripe products.

```bash
npx @yarahdev/cli payments stripe products list --environment test
npx @yarahdev/cli payments stripe products get prod_123 --environment test
npx @yarahdev/cli payments stripe products create --environment test --name "Pro Plan"
npx @yarahdev/cli payments stripe products update prod_123 --environment test --description "Updated"
npx @yarahdev/cli payments stripe products delete prod_123 --environment test -y
```

#### `npx @yarahdev/cli payments stripe prices`

List, inspect, create, update, or archive Stripe prices.

```bash
npx @yarahdev/cli payments stripe prices list --environment test
npx @yarahdev/cli payments stripe prices create --environment test --product prod_123 --currency usd --unit-amount 2000
npx @yarahdev/cli payments stripe prices create --environment test --product prod_123 --currency usd --unit-amount 2000 --interval month
npx @yarahdev/cli payments stripe prices update price_123 --environment test --active false
npx @yarahdev/cli payments stripe prices archive price_123 --environment test
```

#### `npx @yarahdev/cli payments razorpay items`

List, create, or update Razorpay items.

```bash
npx @yarahdev/cli payments razorpay items list --environment test
npx @yarahdev/cli payments razorpay items create --environment test --name "Pro Plan" --amount 200000 --currency inr
npx @yarahdev/cli payments razorpay items update item_123 --environment test --active false
```

#### `npx @yarahdev/cli payments razorpay plans`

List or create Razorpay subscription plans.

```bash
npx @yarahdev/cli payments razorpay plans list --environment test
npx @yarahdev/cli payments razorpay plans create --environment test --period monthly --interval 1 --item-name "Pro Plan" --item-amount 200000 --item-currency inr
```

Use `--notes '{"key":"value"}'` when the Razorpay Plan needs native Razorpay notes.

#### `npx @yarahdev/cli payments <provider> subscriptions --environment <environment>`

List mirrored provider subscriptions for admin/debugging workflows.

```bash
npx @yarahdev/cli payments stripe subscriptions --environment test
npx @yarahdev/cli payments razorpay subscriptions --environment test
npx @yarahdev/cli payments stripe subscriptions --environment test --subject-type team --subject-id team_123
```

#### `npx @yarahdev/cli payments <provider> transactions --environment <environment>`

List mirrored payment transactions for admin/debugging workflows. `--subject-type` and `--subject-id` refer to the app billing subject passed to Yarah, such as `team:team_123` or `user:user_123`; they are not provider customer, payment, order, or subscription ids.

```bash
npx @yarahdev/cli payments stripe transactions --environment test
npx @yarahdev/cli payments razorpay transactions --environment test
npx @yarahdev/cli payments stripe transactions --environment test --limit 20 --json
```

---

### Secrets — `npx @yarahdev/cli secrets`

#### `npx @yarahdev/cli secrets list`

List all secrets (metadata only, values are hidden). Inactive (deleted) secrets are hidden by default.

```bash
npx @yarahdev/cli secrets list
npx @yarahdev/cli secrets list --all   # include inactive secrets
npx @yarahdev/cli secrets list --json
```

#### `npx @yarahdev/cli secrets get <key>`

Get the decrypted value of a secret.

```bash
npx @yarahdev/cli secrets get STRIPE_API_KEY
npx @yarahdev/cli secrets get STRIPE_API_KEY --json
```

#### `npx @yarahdev/cli secrets add <key> <value>`

Create a new secret.

```bash
npx @yarahdev/cli secrets add STRIPE_API_KEY sk_live_xxx
npx @yarahdev/cli secrets add STRIPE_API_KEY sk_live_xxx --reserved
npx @yarahdev/cli secrets add TEMP_TOKEN abc123 --expires "2025-12-31T00:00:00Z"
```

#### `npx @yarahdev/cli secrets update <key>`

Update an existing secret.

```bash
npx @yarahdev/cli secrets update STRIPE_API_KEY --value sk_live_new_xxx
npx @yarahdev/cli secrets update STRIPE_API_KEY --active false
npx @yarahdev/cli secrets update STRIPE_API_KEY --reserved true
npx @yarahdev/cli secrets update STRIPE_API_KEY --expires null   # remove expiration
```

#### `npx @yarahdev/cli secrets delete <key>`

Delete a secret (soft delete — marks as inactive).

```bash
npx @yarahdev/cli secrets delete STRIPE_API_KEY
npx @yarahdev/cli secrets delete STRIPE_API_KEY -y   # skip confirmation
```

### Schedules — `npx @yarahdev/cli schedules`

Manage scheduled tasks (cron jobs).

#### `npx @yarahdev/cli schedules list`

List all schedules in the current project.

```bash
npx @yarahdev/cli schedules list
npx @yarahdev/cli schedules list --json
```

#### `npx @yarahdev/cli schedules create`

Create a new scheduled task.

```bash
npx @yarahdev/cli schedules create --name "daily-cleanup" --cron "0 0 * * *" --url "https://api.example.com/cleanup" --method POST
npx @yarahdev/cli schedules create --name "hourly-sync" --cron "0 * * * *" --url "https://api.example.com/sync" --method GET --headers '{"Authorization": "Bearer xxx"}'
```

#### `npx @yarahdev/cli schedules get <id>`

Get details of a specific schedule.

```bash
npx @yarahdev/cli schedules get <id>
npx @yarahdev/cli schedules get 123 --json
```

#### `npx @yarahdev/cli schedules update <id>`

Update an existing schedule.

```bash
npx @yarahdev/cli schedules update <id> --name "weekly-cleanup" --cron "0 0 * * 0"
npx @yarahdev/cli schedules update 123 --active false
```

#### `npx @yarahdev/cli schedules delete <id>`

Delete a schedule.

```bash
npx @yarahdev/cli schedules delete <id>
npx @yarahdev/cli schedules delete 123 -y
```

#### `npx @yarahdev/cli schedules logs <id>`

Fetch execution logs for a specific schedule.

```bash
npx @yarahdev/cli schedules logs <id>
npx @yarahdev/cli schedules logs 123 --limit 100
```

---

### Compute — `npx @yarahdev/cli compute`

Manage compute services (Docker containers on Fly.io).

#### `npx @yarahdev/cli compute list`

List all compute services.

```bash
npx @yarahdev/cli compute list
```

#### `npx @yarahdev/cli compute get <id>`

Get details of a compute service.

```bash
npx @yarahdev/cli compute get my-api
```

#### `npx @yarahdev/cli compute deploy [dir]`

Deploy a compute service. Source mode runs a `flyctl` remote build and push (requires `flyctl` on PATH, no Docker needed); image mode deploys a pre-built image (no `flyctl`/Docker required).

```bash
# Source mode
npx @yarahdev/cli compute deploy ./api --name my-api
# Image mode
npx @yarahdev/cli compute deploy --image registry.example.com/my-api:latest --name my-api
# Common options
npx @yarahdev/cli compute deploy ./api --name my-api \
  --port 8080 --cpu shared-1x --memory 512 --region iad \
  --env '{"LOG_LEVEL":"info"}'        # or --env-file .env
```

**Options:**

- `--name <name>`: Service name (required)
- `--image <url>`: Container image URL (image mode)
- `--port <port>`: Container port (default: `8080`)
- `--cpu <tier>`: CPU tier (default: `shared-1x`)
- `--memory <mb>`: Memory in MB (default: `512`)
- `--region <region>`: Deploy region (default: `iad`)
- `--env <json>`: Environment variables as JSON
- `--env-file <path>`: Load environment variables from a file
- `--protocol <http|tcp>`: Service protocol (default: `http`)

#### `npx @yarahdev/cli compute update <id>`

Update a compute service.

```bash
npx @yarahdev/cli compute update my-api --memory 1024
npx @yarahdev/cli compute update my-api --env-set LOG_LEVEL=debug   # set/update one var (repeatable)
npx @yarahdev/cli compute update my-api --env-unset OLD_KEY         # remove one var (repeatable)
```

**Options:**

- `--image <image>`: Container image URL
- `--port <port>`: Container port
- `--cpu <tier>`: CPU tier
- `--memory <mb>`: Memory in MB
- `--region <region>`: Deploy region
- `--env <json>`: Environment variables as JSON (replaces ALL vars)
- `--env-set <KEY=VALUE>`: Set/update one variable (repeatable, merges)
- `--env-unset <KEY>`: Remove one variable (repeatable, merges)

#### `npx @yarahdev/cli compute start <id>` / `stop <id>`

Start a stopped, or stop a running, compute service.

```bash
npx @yarahdev/cli compute start my-api
npx @yarahdev/cli compute stop my-api
```

#### `npx @yarahdev/cli compute events <id>`

Get compute service machine events (start/stop/exit/restart).

```bash
npx @yarahdev/cli compute events my-api --limit 50
```

#### `npx @yarahdev/cli compute delete <id>`

Delete a compute service and its Fly.io resources.

```bash
npx @yarahdev/cli compute delete my-api
```

---

### Diagnose — `npx @yarahdev/cli diagnose`

Backend diagnostics. Run with no subcommand for a full health report.

```bash
npx @yarahdev/cli diagnose
npx @yarahdev/cli diagnose --ai "why is my database slow?"   # ask AI to analyze diagnostic data
```

#### `npx @yarahdev/cli diagnose advisor`

Display latest advisor scan results and issues.

```bash
npx @yarahdev/cli diagnose advisor --severity critical --category security --limit 50
```

#### `npx @yarahdev/cli diagnose db`

Run database health checks (connections, bloat, index usage, etc.).

```bash
npx @yarahdev/cli diagnose db
npx @yarahdev/cli diagnose db --check connections,bloat
```

#### `npx @yarahdev/cli diagnose logs`

Aggregate error-level logs from all backend sources.

```bash
npx @yarahdev/cli diagnose logs --source postgres.logs --limit 100
```

#### `npx @yarahdev/cli diagnose metrics`

Display EC2 instance metrics (CPU, memory, disk, network).

```bash
npx @yarahdev/cli diagnose metrics --range 6h
```

#### `npx @yarahdev/cli diagnose incident`

Explain why the project is down or returning gateway timeouts (504). The report is built entirely on the platform side, so the command works even while the instance itself is unreachable. Requires Yarah Platform login (`npx @yarahdev/cli login`); not available when the project is linked via `--api-key`.

```bash
npx @yarahdev/cli diagnose incident
npx @yarahdev/cli --json diagnose incident
```

---

### Web Scraper — `npx @yarahdev/cli webscraper`

Connect a web scraper provider to the linked Yarah project. Provider-specific commands live under `webscraper <provider>` (Apify is the first provider). These commands are intended for developers and agents who want to scrape or pull external data into a project: connect the account once, then let the local agent run the provider's tools using a Yarah-managed token. Runtime data calls should fetch a fresh token from Yarah rather than embedding a personal key.

#### `npx @yarahdev/cli webscraper apify connect`

Connect your Apify account to your Yarah project via OAuth, then automatically run the auth bridge (token login + agent skills) so the local agent is immediately usable.

```bash
npx @yarahdev/cli webscraper apify connect
npx @yarahdev/cli webscraper apify connect --skip-browser   # only print the OAuth URL, do not auto-open the browser
```

#### `npx @yarahdev/cli webscraper apify login`

Authenticate the local Apify CLI/agent using your Yarah-managed token (no browser). Re-run this on any Apify `401`/"not logged in" error; Yarah re-fetches a fresh token. Never use the plain `apify login` browser flow.

```bash
npx @yarahdev/cli webscraper apify login
```

---

### PostHog — `npx @yarahdev/cli posthog`

Manage PostHog product analytics integration.

#### `npx @yarahdev/cli posthog setup`

Connect PostHog to your Yarah dashboard, then run the official PostHog wizard to wire it into your app.

```bash
npx @yarahdev/cli posthog setup
npx @yarahdev/cli posthog setup --skip-browser   # only print the OAuth URL, do not auto-open the browser
```

---

### Config — `npx @yarahdev/cli config`

Manage `yarah.toml` (declarative project configuration).

#### `npx @yarahdev/cli config export`

Pull live project config and write `yarah.toml`.

```bash
npx @yarahdev/cli config export
npx @yarahdev/cli config export --out yarah.toml --force
```

#### `npx @yarahdev/cli config plan`

Show the diff between `yarah.toml` and live project state.

```bash
npx @yarahdev/cli config plan
npx @yarahdev/cli config plan --file yarah.toml
```

#### `npx @yarahdev/cli config apply`

Apply `yarah.toml` to the live project.

```bash
npx @yarahdev/cli config apply
npx @yarahdev/cli config apply --dry-run        # show plan, do not apply
npx @yarahdev/cli config apply --auto-approve   # skip confirmation prompt
```

---

## Project Configuration

Running `npx @yarahdev/cli link` creates a `.yarah/` directory in your project:

```text
.yarah/
└── project.json    # project_id, org_id, appkey, region, api_key, oss_host
```

Add `.yarah/` to your `.gitignore` — it contains your project API key.

`local start` adds the following and writes a `.yarah/.gitignore` covering
them, so the generated secrets cannot be committed even by `git add -A`:

```text
.yarah/
├── local.json           # ports, storage backend, compose project name
├── setup.sh             # the script fetched from the Yarah repository
├── checkout/            # the stack that script wrote
│   ├── .env             # generated secrets, mode 0600
│   └── deploy/…         # the compose file and what it mounts
└── project.cloud.json   # only when a cloud link was displaced
```

`checkout/.env` is written once and re-read on every later start. Deleting it
loses the secrets that live nowhere else — among them the Postgres password,
which the database only ever read at cluster creation. `local start` refuses
rather than regenerating them.

### Declarative project config — `yarah.toml`

Use `config export`, `config plan`, and `config apply` to manage project settings through `yarah.toml`:

```bash
npx @yarahdev/cli config export --out yarah.toml
npx @yarahdev/cli config plan --file yarah.toml
npx @yarahdev/cli config apply --file yarah.toml --auto-approve
```

Supported TOML sections include auth redirects and verification flags, password policy, SMTP, storage upload size, realtime/schedule retention, and cloud deployment subdomain:

```toml
[auth]
allowed_redirect_urls = ["https://app.example.com"]
require_email_verification = true
verify_email_method = "link"
reset_password_method = "code"
disable_signup = false

[auth.password]
min_length = 12
require_number = true
require_lowercase = true
require_uppercase = false
require_special_char = true

[auth.smtp]
enabled = true
host = "smtp.example.com"
port = 587
username = "mailer@example.com"
password = "env(SMTP_PASSWORD)"
sender_email = "noreply@example.com"
sender_name = "Example"
min_interval_seconds = 60

[storage]
max_file_size_mb = 100

[realtime]
retention_days = 7

[schedules]
retention_days = 0 # 0 disables retention cleanup

[deployments]
subdomain = "my-app"
```

`config apply` uses backend admin APIs and skips sections that the connected backend version does not expose. It does not manage external provider resources such as OAuth apps, storage bucket lifecycle, realtime channels, deployment environment variables, functions, or secrets.

Global configuration is stored in `~/.yarah/`:

```
~/.yarah/
├── credentials.json    # access_token, refresh_token, user profile
└── config.json         # default_org_id, platform_api_url
```

## Agent Skills

When you run `npx @yarahdev/cli create` or `npx @yarahdev/cli link`, the CLI automatically installs a set of [Yarah agent skills](https://github.com/Darts7u7/Yarah-oos-skills) into your project for all supported AI coding agents (Claude Code, Cursor, Windsurf, Cline, Roo, Gemini CLI, GitHub Copilot, Qwen, Qoder, Trae, Kilo, Codex, Augment, Antigravity). These skills teach your coding agent how to work with Yarah — database queries, auth, storage, edge functions, realtime, etc. — so it can generate correct code for your backend without you copy-pasting docs.

It also installs [`find-skills`](https://github.com/vercel-labs/skills) so agents can discover available skills on demand.

Skill files are written to per-agent directories (e.g. `.claude/`, `.cursor/`, `.windsurf/`) and are automatically added to your `.gitignore`. You can re-run `npx @yarahdev/cli link` at any time to reinstall or update skills.

For bare agent harnesses that follow the open [agents.md](https://agents.md) standard (a single `AGENTS.md` at the project root) rather than the per-agent skill directories, the CLI also writes an `AGENTS.md` into your project. It contains a delimited `<!-- YARAH:START -->…<!-- YARAH:END -->` block with Yarah context (where credentials live, when to reach for the SDK vs. the CLI, and a few correctness patterns). If you already have an `AGENTS.md`, the block is appended once and refreshed in place on subsequent runs, leaving your own content untouched. Unlike the per-agent skill files, `AGENTS.md` is **not** gitignored, so you can commit and share it.

## Analytics

The CLI reports anonymous usage events to [PostHog](https://posthog.com) so we can understand which features are being used and prioritize improvements.

We capture only non-sensitive metadata: the command name, subcommand, outcome (`success`, `applied`, `aborted`, `dry_run`, `no_changes`, `all_skipped`, `error`), flag shape (e.g. `dry_run`, `json_mode`), section names from `yarah.toml` schema (e.g. `auth.smtp`), region, and an OSS-vs-cloud flag. We never send SQL, TOML file contents, credentials, environment variable values, or any free text you type.

If you build the CLI from source without setting `POSTHOG_API_KEY` at build time, analytics become a no-op automatically.

## Environment Variables

| Variable                | Description                        |
| ----------------------- | ---------------------------------- |
| `YARAH_ACCESS_TOKEN` | Override the stored access token (JWT or `uak_` user API key) |
| `YARAH_PROJECT_ID`   | Override the linked project ID     |
| `YARAH_API_URL`      | Override the Platform API URL      |
| `YARAH_EMAIL`        | Email for non-interactive login    |
| `YARAH_PASSWORD`     | Password for non-interactive login |

## Non-Interactive / CI Usage

All commands support `--json` for structured output and `-y` to skip confirmation prompts:

```bash
# Login in CI with a user API key (durable, no hourly expiry; works for OAuth/Google accounts)
npx @yarahdev/cli login --user-api-key "$YARAH_USER_API_KEY" --json

# Or pass the key per-invocation without a login step
YARAH_ACCESS_TOKEN=$YARAH_USER_API_KEY npx @yarahdev/cli db query "SELECT 1" --json

# Login in CI with email/password (email accounts only)
YARAH_EMAIL=$EMAIL YARAH_PASSWORD=$PASSWORD npx @yarahdev/cli login --email --json

# Link a project
npx @yarahdev/cli link --project-id $PROJECT_ID --org-id $ORG_ID -y

# Query and pipe results
npx @yarahdev/cli db query "SELECT * FROM users" --json | jq '.rows[].email'

# Deploy frontend
npx @yarahdev/cli deployments deploy ./dist --json

# Upload a build artifact
npx @yarahdev/cli storage upload ./dist/bundle.js --bucket assets --key "v1.2.0/bundle.js" --json
```

## Exit Codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| 0    | Success                                                 |
| 1    | General error                                           |
| 2    | Authentication failure                                  |
| 3    | Project not linked (run `npx @yarahdev/cli link` first) |
| 4    | Resource not found                                      |
| 5    | Permission denied                                       |

## Development

```bash
git clone <repo-url>
cd yarah-CLI
npm install
npm run build
npm link        # makes `yarah` available globally

npm run dev     # watch mode for development
```

### Testing

#### Unit tests

```bash
npm run test:unit
```

#### Real project integration tests

Run locally:

```bash
INTEGRATION_TEST_ENABLED=true \
INTEGRATION_LOG_SOURCE=yarah.logs \
npm run test:integration:real
```

Prerequisites:

- Logged in (`npx @yarahdev/cli login`) so `~/.yarah/credentials.json` exists
- Linked project in this repo (`npx @yarahdev/cli link`) so `.yarah/project.json` exists

Optional environment variables:

- `YARAH_API_URL`: Platform API URL override (defaults to `https://api.yarah.dev`)
- `INTEGRATION_LOG_SOURCE`: Log source for `logs` test (default `yarah.logs`)

Current real-project checks:

- `whoami --json`
- `metadata --json`
- `logs <source> --json`
- `docs instructions --json`

## Releasing

Bump the version, push the tag, and create a GitHub Release — the CI will publish to npm automatically.

```bash
# Bump version (creates commit + tag)
npm version patch   # 0.1.3 → 0.1.4
# or
npm version minor   # 0.1.3 → 0.2.0

# Push commit and tag
git push && git push --tags
```

Then go to GitHub → Releases → **Draft a new release**, select the tag (e.g. `v0.1.4`), and publish. The [publish workflow](.github/workflows/publish.yml) will run `npm publish` automatically.

## License

Apache-2.0
