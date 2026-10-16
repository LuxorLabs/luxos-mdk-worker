'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['fans'], [], ({ fans }) => n.fans(fans))
