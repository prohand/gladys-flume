# Security policy

## Supported versions

Only the latest release of the Flume integration receives security fixes.
Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-flume](https://github.com/prohand/gladys-flume/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove e-mails, passwords, client secrets and tokens first).

You should get a first answer within 7 days. A fix is released as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and the
Flume cloud and API (report to Flume, Inc.).

## What the integration does with your credentials

- The Flume password and the client secret are stored by Gladys in `secret` fields and
  only sent to `https://api.flumewater.com`, over HTTPS.
- The access and refresh tokens Flume returns stay in memory: nothing is written to
  disk, and they are dropped when the credentials change.
- None of them is ever logged, nor put in an error message shown in Gladys.

## Good practices for users

- Keep the Flume password and the client secret only in the integration's secret fields.
- If you think your API client leaked, delete it on portal.flumewater.com (Settings,
  API Access), create a new one and paste it in Gladys.
- Keep Gladys and the integration up to date.
