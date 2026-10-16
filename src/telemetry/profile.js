'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['config'], [], ({ config }) => n.profile(config))
