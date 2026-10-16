'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['events'], [], ({ events }) => n.errors(events))
