'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['devs'], [], ({ devs }) => n.hashrateIdeal(devs))
