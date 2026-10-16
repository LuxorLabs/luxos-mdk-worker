'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['config', 'summary'], ['events'], (sections) => n.status(sections))
