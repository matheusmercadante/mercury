# A self-hosted cloud

The managed cloud's server (`cloud/gateway/`) can run on a machine of your own
instead of AWS. A Mac uses it the way it uses the managed cloud: cloud runs go
there when the Mac is full, or when a run is moved to the cloud, and come home
the same way. Nothing in `main/` changes.

| AWS did                         | The self-hosted cloud does                                          |
|---------------------------------|---------------------------------------------------------------------|
| AgentCore, a machine a session  | one docker container of `cloud/sandbox` a session (`sessions.mjs`) |
| S3, presigned URLs, the bucket's rules | a folder on its disk with links that expire (`bucket.mjs`)   |
| The S3 notice of a `done.json`  | the bucket tells the gateway when one lands                         |
| EventBridge                     | timers in the server                                                |
| The database's word on a session | the session's signature, checked against the database's JWKS (`whois.mjs`) |
| Stripe and the plans            | one plan, `self`: as many agents at once as the machine holds     |

The phone's replies with the computer shut, paying and teams are not part of it.

## The machine

Linux with docker and Node 22.18 or newer, and a checkout of this repository
with `npm ci` done. Build the sandbox image from `cloud/sandbox` with the Claude
Code and Codex versions it should run:

```sh
docker build -t mercury-sandbox --build-arg CLAUDE_CODE_VERSION=<version> --build-arg CODEX_VERSION=<version> cloud/sandbox
```

The sessions run on a docker network of their own. A container runs as root
inside, with the memory, CPU and process limits of the config, and its
`/invocations` takes no key: keep that network unreachable from anywhere but
this server.

## One address for the server

Every link the server signs names it by `publicUrl`, and both the Mac and the
sandboxes open those links. So that address must reach the server from both:

- **Inside the sessions' network:** `sandbox.addHosts` maps the name to the
  server's address on that network.
- **On the Mac:** for example, an SSH tunnel to the server's port, with the
  name in `/etc/hosts` pointing at 127.0.0.1.

## The config

```json
{
  "dataDir": "/var/lib/mercury-cloud",
  "publicUrl": "http://cloud-server:8787",
  "listen": [{ "host": "127.0.0.1", "port": 8787 }, { "host": "172.31.250.1", "port": 8787 }],
  "people": ["<the database's user id of each person it is for>"],
  "issuer": "https://<the database>/auth/v1",
  "jwksFile": "/etc/mercury-cloud/jwks.json",
  "secretFile": "/etc/mercury-cloud/secret",
  "agents": 2,
  "sandbox": {
    "image": "mercury-sandbox",
    "network": "mercury-cloud",
    "memory": "3g",
    "cpus": "2",
    "pids": 1024,
    "addHosts": ["cloud-server:172.31.250.1"]
  }
}
```

- **`jwksFile`:** the database's public keys, from
  `<the database>/auth/v1/.well-known/jwks.json`.
- **`secretFile`:** signs the links. Keep it to the server's user (0600).
- **`people`:** only these people get in; anyone else is turned away.

Start it with `node cloud/selfhost/server.mjs /path/to/config.json`.

## The Mac

1. `~/.mercury/cloud.public.json`: `{ "gateway": "<publicUrl>", "supabaseUrl": "https://<the database>", "anonKey": "<its anon key>" }`.
   The Mac signs in for the cloud against that database.
2. In Settings, sign in for the cloud. Signing in writes `~/.mercury/cloud.json`
   and this Mac's key; from then on runs can go to this server. Do not write
   `cloud.json` by hand: with one there, the app takes the cloud as set up and
   never shows the sign-in.
3. Sign in to Claude for the cloud. That sign-in is made inside a sandbox, and
   is kept on the server.
