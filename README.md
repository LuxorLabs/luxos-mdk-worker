# luxos-mdk-worker

[Tether MDK](https://github.com/tetherto/mdk) worker for miners running
Luxor's [LuxOS](https://luxor.tech/firmware) firmware. It reads hashrate,
power, temperatures, fans, hashboards, pools and active events, and it can
reboot the miner, blink the locate LED, curtail it, change its profile and
replace its pools.

The worker talks to the LuxOS TCP API on port 4028. Compatibility follows
the firmware, not the hardware model: any miner that runs LuxOS answers the
same API.

Built and tested against MDK v0.10.0. See [USAGE.md](USAGE.md) for every
telemetry channel, command and error code.

## Install

MDK is not on the npm registry yet, so both MDK and this worker install from
git. Pin each one to a commit SHA, not a branch:

```bash
npm install github:tetherto/mdk#<mdk-sha> github:LuxorLabs/luxos-mdk-worker#<worker-sha>
npm --prefix node_modules/@tetherto/mdk install --ignore-scripts
```

The worker has no runtime dependencies and no install scripts.

## Usage

The package is a directory-loaded worker plugin: `mdk-contract.json` plus
the handler files it names. Point `WorkerRuntimeV2` at the package directory
and list one device per miner:

```js
const path = require('node:path')
const WorkerRuntimeV2 = require('@tetherto/mdk/backend/core/mdk-worker/lib/worker-runtime-v2')

async function main () {
  const runtime = new WorkerRuntimeV2(
    path.dirname(require.resolve('luxos-mdk-worker/mdk-contract.json')),
    {
      workerId: 'luxos-site-1',
      storeDir: './store/luxos-site-1',
      devices: [
        { deviceId: 'rack1-slot1', config: { address: '10.0.1.21' } },
        { deviceId: 'rack1-slot2', config: { address: '10.0.1.22', port: 4028, timeout: 10000 } }
      ]
    }
  )

  await runtime.start()
  // Register this public key with your Kernel.
  console.log(runtime.getPublicKey().toString('hex'))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
```

| Device config | Default | Meaning |
| --- | --- | --- |
| `address` | Required | Miner IP or hostname (`host` also works) |
| `port` | `4028` | LuxOS TCP API port |
| `timeout` | `10000` | Per-request timeout in milliseconds |

The LuxOS API has no authentication. Anyone who can reach port 4028 can
read and change the miner, so keep miners on a trusted network.

## Develop and test

Use Node.js 24 or later and npm 11:

```bash
npm ci --ignore-scripts
npm run setup:mdk
npm test
```

The tests run against a local fake of the LuxOS TCP API, so they need no
miner. `npm run mock` starts the fake on `127.0.0.1:14028`. The integration
suite also registers the worker with a real MDK Kernel and checks that it
reaches `READY`, serves every telemetry channel and runs a command end to end.

To check a real miner without changing it, run:

```bash
npm run test:live -- <miner-ip>
```

The script never opens a session and never writes. It prints every channel
and exits nonzero if any channel fails.

To check the commands on controlled test hardware, name the steps to run:

```bash
npm run test:live:writes -- <miner-ip> --steps led,power,profile,pools,reboot
```

`power` and `profile` confirm the change on the miner, then restore the
previous state and confirm that too, also after a failure or a first Ctrl-C;
if a restore fails, the script says what state it left the miner in. The LED
blinks for 10 seconds and then goes back to automatic, which only someone at
the miner can confirm. `pools` replaces the pool list with the same URLs and
users and checks the result. LuxOS never returns pool passwords, so every
pool gets `--pool-password`, which is required for this step. `reboot` waits
for the miner to come back. Curtailing, re-profiling and rebooting
stop hashing for a while, so run these only on a miner you can take offline.
Switching the profile restarts LuxOS autotuning, so after the `profile` step
the miner can run at reduced hashrate for a while even though the profile is
back. Pass `--profile <name>` to pick a neighbouring profile; the default is
the first other profile LuxOS lists, often the lowest.

All five commands were verified this way on an Antminer S21 running LuxOS
2026.7.31.
