'use strict'

const { createServer } = require('./mock/luxos-server')

module.exports = {
  async setup () {
    const mock = createServer({ host: '127.0.0.1', port: 0 })
    const address = await mock.ready
    return {
      deviceId: 'luxos-0',
      config: { address: '127.0.0.1', port: address.port },
      commands: {
        setLED: { enabled: true },
        setPowerMode: { mode: 'normal' },
        setProfile: { profile: '450MHz' },
        setupPools: { pools: [{ url: 'stratum+tcp://pool.example:3333', user: 'acct.worker', password: 'x' }] },
        reboot: {}
      },
      teardown: () => mock.close()
    }
  }
}
