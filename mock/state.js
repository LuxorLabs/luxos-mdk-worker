'use strict'

// Canned LuxOS state for an air-cooled Antminer S19 XP, shaped after the
// examples in the LuxOS API docs. Hashrates follow the API units: GH/s in
// summary, MH/s in devs.
module.exports = () => ({
  version: { API: '3.7', CompileTime: 'Mon Sep 21 13:19:55 UTC 2026', LUXminer: '2026.9.21.131955-0a1b2c3d', Miner: '2026.9.21.131955', Type: 'Antminer S19 XP' },
  config: {
    'ASC Count': 3,
    ControlBoardType: 'amlogic',
    Cooling: 'Air',
    CurtailMode: 'None',
    DHCP: true,
    Hostname: 'luxos-mock',
    IPAddr: '127.0.0.1',
    MACAddr: 'd4:33:b2:00:00:01',
    Model: 'Antminer S19 XP',
    NameplateTHS: 140,
    OS: 'LuxOS',
    PSULabel: 'APW12',
    Profile: 'default',
    SerialNumber: 'MOCKSERIAL0001',
    SystemStatus: 'Normal',
    GreenLed: 'auto',
    RedLed: 'auto'
  },
  summary: { Accepted: 179, Rejected: 2, Stale: 1, Elapsed: 2330, 'GHS 5s': 140250.5, 'GHS 30m': 139800, 'GHS av': 139500.25, 'Hardware Errors': 19 },
  devs: [0, 1, 2].map((id) => ({
    ASC: id,
    ID: id,
    Connector: `J${id + 6}`,
    Enabled: 'Y',
    Status: 'Alive',
    Profile: 'default',
    SerialNumber: `MOCKBOARD000${id}`,
    'MHS 5s': 46750166.8,
    'MHS av': 46500083.4,
    'Nominal MHS': 46666666.7,
    Temperature: 70 + id,
    'Hardware Errors': id,
    IsRamping: false,
    IsUserShutdown: false
  })),
  temps: {
    METADATA: [{ BottomLeft: { Label: 'Board Outlet' }, BottomRight: { Label: 'Chip Outlet' }, TopLeft: { Label: 'Board Inlet' }, TopRight: { Label: 'Chip Inlet' } }],
    TEMPS: [0, 1, 2].map((id) => ({ ID: id, TEMP: id, BottomLeft: 58, BottomRight: 70 + id, TopLeft: 45, TopRight: 60 }))
  },
  fans: [0, 1, 2, 3].map((id) => ({ FAN: `J${12 + id}`, ID: id, RPM: 3900 - id * 60, Speed: 49 })),
  power: { PSU: true, Watts: 3010 },
  // A tuned miner keeps this informational event, as real LuxOS 2026.7 does.
  events: [{ Code: 'MINER_TUNED', CreatedAt: '2026-01-01T00:00:00+00:00', Description: 'Miner has completed tuning and is maintaining current performance.', DocUrl: 'https://docs.luxor.tech/firmware/kb/eventstroubleshooting#miner-tuned', Severity: 'Info', Target: 'MINER' }],
  pools: [
    { POOL: 0, Priority: 0, GROUP: 0, URL: 'stratum+tcp://btc.global.luxor.tech:700', User: 'account.worker', Status: 'Alive', 'Stratum Active': true, Accepted: 179, Rejected: 2, Stale: 1, Quota: 1 }
  ],
  profiles: ['default', '450MHz', '750MHz'],
  session: '',
  led: { red: 'auto', green: 'auto' },
  reboots: 0
})
