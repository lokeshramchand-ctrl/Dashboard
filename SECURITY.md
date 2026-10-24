# Security policy

This project controls virtual machines, so please report vulnerabilities privately instead of opening a public issue: use GitHub's "Report a vulnerability" (Security tab) on this repository.

Include the affected version or commit, reproduction steps and impact. Expect an acknowledgement within a few days.

## Deployment guidance

- Serve over HTTPS and set `COOKIE_SECURE=true`.
- Use Proxmox and Grafana tokens with minimal roles. The guest detail page needs write privileges (config, snapshot, backup, console); grant only the ones you use.
- Leave `SHELL_ENABLED` off unless you need it: it gives anyone with a dashboard login a root shell in every non-protected guest. Protect the login (strong password, HTTPS) accordingly.
- Set `PROTECTED_VMIDS` for guests that must never be controlled from the dashboard (including the dashboard's own guest).
- Do not expose MongoDB; the compose file keeps it on the internal network only.
