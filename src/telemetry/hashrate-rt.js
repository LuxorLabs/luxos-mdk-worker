'use strict'

const read = require('./read')
const n = require('../../lib/normalize')

module.exports = read(['summary'], [], ({ summary }) => n.hashrateRt(summary))
