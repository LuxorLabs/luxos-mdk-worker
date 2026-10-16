'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['devs'], ['temps'], ({ devs, temps }) => n.hashboards(devs, temps))
