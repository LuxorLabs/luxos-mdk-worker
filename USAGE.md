# Usage

Runtime reference for the LuxOS MDK worker: telemetry channels, commands,
sessions, failure semantics, the mock miner and live testing.

All device I/O goes through the LuxOS TCP API on port 4028. The API follows
the CGMiner pattern: one JSON request per connection, one JSON answer, then
the miner closes the connection. Every request has a finite timeout and no
request is retried silently.

## Telemetry channels

The worker reads every source in one multi-command request
(`version+config+summary+devs+pools+temps+fans+power+events`) and caches the
result for 2 seconds. A metrics pull that calls all 20 handlers at once
sends one request to the miner. If one command in the request fails, only
the channels that need it report an error. If the whole request fails, the
failure is also kept for 2 seconds: MDK collects a metrics pull one channel
at a time, so an unreachable miner costs one timeout per pull, not one per
channel.

LuxOS reports hashrate in GH/s (summary) and MH/s (devs). The worker exposes
TH/s.

| Channel | Unit | Source |
| --- | --- | --- |
| `hashrate_rt` | TH/s | summary `GHS 5s` |
| `hashrate_avg` | TH/s | summary `GHS av`, since the miner application started |
| `hashrate_ideal` | TH/s | sum of devs `Nominal MHS` |
| `power` | W | power `Watts` |
| `efficiency` | W/TH | `power` divided by summary `GHS 30m`. `null` while not hashing |
| `temperature` | °C | highest devs `Temperature`. `null` when no board reports one |
| `fans` | RPM | fans `FANS` as `{ index, rpm, speed_pct, connector }`. Empty on hydro and immersion machines |
| `status` | | `error`, `sleeping`, `mining` or `not_mining`, see below |
| `uptime` | s | summary `Elapsed` |
| `power_mode` | | `sleep` when config `CurtailMode` is `Sleep`, else `normal` |
| `profile` | | config `Profile` |
| `accepted_shares` | | summary `Accepted` |
| `rejected_shares` | | summary `Rejected` |
| `pool_url` | | first `Alive` pool, else the first pool by priority |
| `pools` | | pools in priority order. The API never returns passwords |
| `hashboards` | | devs per board, with `temps` readings named by their METADATA labels |
| `errors` | | active LuxOS events with code, description, severity, target and doc URL |
| `device_info` | | model, serial, MAC, IP, hostname, control board, cooling, PSU, nameplate TH/s |
| `firmware_info` | | LuxOS version, API version, compile time |
| `snap` | | all of the above in one object. A failed source shows `{ error }` in its place |

`status` is `error` while LuxOS reports an active event with a severity
other than `Info`, `sleeping` while the miner is curtailed, and otherwise `mining` or
`not_mining` from the 5-second hashrate. Firmware without the `events` command still reports a
status; the `errors` channel then fails with `ERR_API_STATUS_ERROR`.
Informational events such as `MINER_TUNED`, which a healthy miner keeps
after autotuning, still appear in `errors`. An event without a severity
counts as an error.

A missing or malformed reading is an `ERR_API_RESPONSE_INVALID` error, never
a zero.

## Commands

| Command | Parameters | LuxOS API | Effect |
| --- | --- | --- | --- |
| `reboot` | — | `rebootdevice` | Reboots the miner. 5-minute cooldown, consumed by every attempt |
| `setLED` | `enabled: boolean` | `ledset <s>,red,blink\|auto` | Blinks the red LED to locate the miner, or returns it to automatic |
| `setPowerMode` | `mode: normal \| sleep` | `curtail <s>,wakeup\|sleep` | Curtails or wakes up the miner |
| `setProfile` | `profile: string` | `profileset <s>,<name>` | Applies a profile to all boards. The name must exist in `profiles`. LuxOS names use letters, digits, `_`, `-`, `+`, `.` and spaces |
| `setupPools` | `pools: array` | `addpool`, `removepool` | Replaces the pool list with 1-3 pools |

A sleeping miner stays asleep across reboots until `setPowerMode` with
`normal` wakes it up. A profile change and a wake-up both ramp the boards,
so hashrate is low for some minutes afterwards.

`setupPools` takes `{ url, user, password }` entries. It also accepts the
Antminer worker's `worker_name` and `worker_password`. The LuxOS API takes
comma-separated parameters, so values that contain a comma are rejected.

LuxOS pool IDs are positions in the pool list, and `addpool` appends to the
first group. So the worker:

1. Refuses with `ERR_POOLS_GROUPS_UNSUPPORTED` when the miner has pools in
   more than one group. Change multi-group setups by hand.
2. Adds the new pools.
3. Reads the list again and checks that the old pools still hold the first
   positions and the new pools follow them, by URL and user.
4. Removes the old pools, highest position first.

The miner always has a pool. If a step fails, or the list after step 2 is
not as expected, the worker stops and returns `ERR_POOLS_PARTIAL`, which
says which pools are in place. It never removes a pool it cannot identify.

## Sessions

LuxOS requires a session for writes. The worker opens one with `logon`,
runs the write, and always drops it with `logoff`, also when the write
fails. If another tool or operator holds the session, `logon` fails and the
worker returns `ERR_SESSION_BUSY`. The worker never calls `kill`; take over a
session only by hand, after you know who holds it.

## Failure semantics

- Never retry a write automatically. A timeout or a broken connection can
  mean the miner did the write and the answer was lost.
- `reboot` rejects with `ERR_COMMAND_COOLDOWN` within 5 minutes of any
  earlier attempt, successful or not, and every command rejects with
  `ERR_COMMAND_IN_PROGRESS` while the same command runs for that device.
- Each write prints one `physical_command` audit line as JSON on stdout,
  with the command, device ID, outcome and error code.
- An unreachable miner does not fail at load time. The runtime reports the
  device online, and the error appears in each telemetry channel or command
  that touched the network.
- The full error map is in [mdk-contract.json](mdk-contract.json) under
  `capabilities.errors`.

## Mock miner

`npm run mock` starts a stateful fake LuxOS API on `127.0.0.1:14028`
(override with `PORT`). It answers the documented response shapes, ends each
answer with a NUL byte like CGMiner, enforces LuxOS sessions, applies writes
to its state and records every request. In tests,
`createServer({ port: 0, state, failCommands })` picks a free port,
`failCommands` makes the named commands answer `STATUS E`, and `ready`
resolves to the bound address.

## Live testing

`npm run test:live -- <ip> [port]` reads every channel from a real miner and
never writes. Test commands on a real miner by hand, one at a time, on a
machine you can reach physically.
