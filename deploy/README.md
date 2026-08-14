# deploy/

Everything needed to get from a blank SD card to a TV showing the board.

| File | What it is |
| --- | --- |
| `setup-wizard.sh` | Interactive walkthrough of the human-only steps (OS, packages, Tailscale, Funnel, secrets, webhooks). Run it on the Pi. Re-runnable. |
| `install.sh` | Installs and enables both systemd units for this checkout. Called by the wizard; safe to re-run by hand. |
| `pr-arcade.service` | System unit for the Node server. Restarts on crash, starts at boot, env from `/etc/pr-arcade.env`. |
| `pr-arcade-kiosk.service` | User unit for the Chromium kiosk. Starts with the Pi's autologin desktop session. |

Both units deliberately omit `User`/`WorkingDirectory`/`ExecStart` — `install.sh` writes those into systemd drop-ins from the actual checkout, user and `npm` path, so there's one source of truth and no templating. A unit without its drop-in refuses to start rather than running something wrong.
| `kiosk.sh` | What the kiosk unit runs: wait for the server, kill the cursor and blanking, launch Chromium fullscreen. |
| `deploy.sh` | The one-command update: pull, reinstall deps if they changed, restart. |

## Happy path (blank SD card → TV)

1. Flash Raspberry Pi OS **Bookworm, 64-bit, desktop** with SSH enabled (the wizard prints the exact Imager settings).
2. `ssh pi@pr-arcade.local`
3. `git clone <repo-url> ~/pr-arcade && ~/pr-arcade/deploy/setup-wizard.sh`
4. Follow the nine stages. Each one verifies itself before moving on; anything it can't do is listed again at the end.

## Updating

```sh
ssh pi@pr-arcade.local pr-arcade/deploy/deploy.sh
```

Pulls, runs `npm ci` only if `package.json`/`package-lock.json` changed, restarts the server, and restarts the kiosk so client changes reach the TV.

## Notes

- **Secrets** live only in `/etc/pr-arcade.env`, mode 0600, owned by the display user. Never in the repo. Contains `PORT`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`.
- **Tracked Repos** live in `config.json` at the repo root — in git, not a secret. The server won't start without it. Editing it on the Pi will make the next `deploy.sh` refuse to fast-forward; change it in git instead.
- **Port** is 3000 in two places: `/etc/pr-arcade.env` and the URL in `kiosk.sh`. Change both.
- **`npm ci`, not `npm ci --omit=dev`**: `npm start` runs the server through `tsx`, which is a devDependency. Switch to `--omit=dev` if that ever changes.
- **`deploy.sh` assumes passwordless sudo** (the stock Pi OS default) and git credentials that don't prompt — the wizard sets up `gh auth setup-git` or points you at a deploy key.
- **Kiosk restarts over SSH** need a live user session (`XDG_RUNTIME_DIR`); if `deploy.sh` or `install.sh` says it skipped the kiosk, reboot the Pi or run it from the desktop session.

## Poking at it

```sh
sudo systemctl status pr-arcade          # server
journalctl -u pr-arcade -f               # server logs
systemctl --user status pr-arcade-kiosk  # kiosk (run on the Pi's own session)
tailscale funnel status                  # is the public URL live
```

## Exiting the kiosk

Escape/Ctrl+C won't work — `--kiosk` Chromium ignores them, and the unit would
restart it anyway. Stop the unit instead (from SSH, or Ctrl+Alt+F2 for a console):

```sh
systemctl --user stop pr-arcade-kiosk            # exit until next boot/start
systemctl --user disable --now pr-arcade-kiosk   # exit and stay off after reboots
systemctl --user start pr-arcade-kiosk           # bring the board back
```
