# First-time CI/CD manual checklist

Complete outside chat. Confirm completion without sending secret values.

## DNS

- [ ] Production hostname points to VPS/load balancer IP.
- [ ] `www` and API subdomains have intended records.
- [ ] TLS issuer can reach port 80 for certificate issuance.
- [ ] Record TTL and propagation checked.

`*` wildcard does not override leftover specific subdomain records. Lower TTL before an IP move; caches can still serve old values.

## GitHub secrets and variables

- [ ] Production secrets configured: `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_KNOWN_HOSTS`.
- [ ] Non-secret host/app/port/image variables configured where workflow expects them.
- [ ] Environment protection rules and deployment approvals configured if required.
- [ ] Secret names match workflow plan exactly.

For `PRODUCTION_SSH_KEY`, CI must set `umask 077`, write with `printf` to a temporary file, `chmod 600` it, use `IdentitiesOnly=yes`, then delete it after the job. Never echo, shell-trace, or log PEM content.

Regenerate `PRODUCTION_KNOWN_HOSTS` out-of-band when server IP changes, using `ssh-keyscan` only while updating the secret after verifying the fingerprint. Do not run runtime `ssh-keyscan` as deployment trust establishment.

## VPS

- [ ] Docker installed; daemon enabled and running.
- [ ] Docker daemon DNS works for image pulls and runtime needs.
- [ ] `/opt/<app>` exists with correct owner and persistent volumes.
- [ ] Ports 80 and 443 are free for reverse proxy.
- [ ] Firewall permits required inbound traffic only.

## App environment

- [ ] Production `.env` stored on VPS, outside Git and image layers.
- [ ] Production `.env` is owned by deployment user and `chmod 600`.
- [ ] Required runtime variables set; secrets not echoed by deploy commands.
- [ ] Backup, migration, and rollback paths documented when stateful data exists.

## Registry

- [ ] VPS can authenticate to GHCR with least-privilege read token.
- [ ] Image name, owner, and package visibility match deployment plan.

## Laptop SSH

- [ ] SSH host entry or command works with production user/key.
- [ ] Host fingerprint verified before adding to local known hosts.
- [ ] Operator can access logs and run documented rollback command.

CI SSH must pin `StrictHostKeyChecking=yes` and `UserKnownHostsFile` to a temporary known-hosts file populated from `PRODUCTION_KNOWN_HOSTS`. Never use `StrictHostKeyChecking=no` or runtime keyscan-as-trust.

## Health

- [ ] Public health URL selected and returns a non-sensitive success response.
- [ ] Health endpoint checks required dependencies at intended depth.
- [ ] Expected status code and timeout documented for CI/CD verification.
