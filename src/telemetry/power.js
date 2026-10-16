'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['power'], [], ({ power }) => n.power(power))
