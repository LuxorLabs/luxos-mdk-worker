'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['config', 'version'], [], ({ config, version }) => n.deviceInfo(config, version))
