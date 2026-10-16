'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['version'], ['config'], ({ version, config }) => n.firmwareInfo(version, config))
