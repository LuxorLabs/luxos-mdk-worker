'use strict'

const assert = require('node:assert')
const { test } = require('node:test')

// The suite needs no test framework: node:test plus these five assertion names
// give the test context the API the tests were written against.
//
// brittle's t.exception fails when what was thrown is a native error (TypeError,
// RangeError, ...), so a type bug cannot pass as the expected failure. Keep that:
// only user Errors get as far as the pattern check.
const NATIVE = [TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError, AggregateError]

function validate (pattern, msg) {
  return (err) => {
    const native = NATIVE.find((C) => err instanceof C)
    if (native) {
      throw new assert.AssertionError({
        message: `expected a user error, got native ${native.name}: ${err.message}${msg ? ` (${msg})` : ''}`
      })
    }
    if (pattern instanceof RegExp && !pattern.test(err.message)) {
      throw new assert.AssertionError({
        message: `error message ${JSON.stringify(err.message)} does not match ${pattern}${msg ? ` (${msg})` : ''}`
      })
    }
    return true
  }
}

function wrapped (body) {
  return async (t) => {
    t.is = (actual, expected, msg) => t.assert.strictEqual(actual, expected, msg)
    t.alike = (actual, expected, msg) => t.assert.deepStrictEqual(actual, expected, msg)
    t.ok = (value, msg) => t.assert.ok(value, msg)
    t.absent = (value, msg) => t.assert.ok(!value, msg)
    t.exception = (fnOrPromise, pattern, msg) => typeof fnOrPromise === 'function'
      ? t.assert.throws(fnOrPromise, validate(pattern, msg))
      : t.assert.rejects(fnOrPromise, validate(pattern, msg))
    t.teardown = (fn) => t.after(fn)
    return body(t)
  }
}

const run = (name, options, body) => typeof options === 'function'
  ? test(name, wrapped(options))
  : test(name, options, wrapped(body))

run.skip = test.skip
run.todo = test.todo

module.exports = run
