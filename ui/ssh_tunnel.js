import { spawn } from "node:child_process"

export function openSshTunnel(target, localPort, remotePort) {
  if (!target) {
    return null
  }
  return spawn("ssh", ["-N", "-L", `${localPort}:127.0.0.1:${remotePort}`, target], { stdio: "inherit" })
}
