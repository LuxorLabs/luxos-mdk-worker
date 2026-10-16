'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['pools'], [], ({ pools }) => n.poolUrl(pools))
