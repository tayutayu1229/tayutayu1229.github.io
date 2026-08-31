"use strict";

const assert = require("node:assert/strict");
const { outputDateFrom, sameTrain, trainKeyFrom, validateString, writeText } = require("./app");

assert.equal(validateString("  東京総合指令室  ", 120), "東京総合指令室");
assert.equal(validateString("bad\nvalue", 120), null);
assert.equal(validateString("", 120), null);

const key = trainKeyFrom({ trainKey: {
  trainNumber: "9171M",
  startDate: "2026/08/22",
  line: "高崎線",
  origin: "東京",
  destination: "高崎",
} });
assert.deepEqual(key, {
  trainNumber: "9171M",
  startDate: "2026/08/22",
  line: "高崎線",
  origin: "東京",
  destination: "高崎",
});
assert.equal(sameTrain({ ...key, stops: [] }, key), true);
assert.equal(sameTrain({ ...key, destination: "籠山口" }, key), false);
assert.equal(trainKeyFrom({ trainKey: { trainNumber: "9171M" } }), null);
assert.equal(outputDateFrom("2026-08-23"), "2026/08/23");
assert.equal(outputDateFrom(""), null);
assert.equal(outputDateFrom("2026-02-30"), null);
assert.equal(outputDateFrom("2026/08/23"), null);

const normalCell = {};
writeText(normalCell, "9171M", 40);
assert.equal(normalCell.value, "9171M");
const formulaCell = {
  _draftData: {},
  set value(value) {
    this._draftData.value = value;
    this._draftData.valueType = value.startsWith("=") ? "formulaValue" : "stringValue";
  },
};
writeText(formulaCell, "=1+1", 40);
assert.equal(formulaCell._draftData.value, "=1+1");
assert.equal(formulaCell._draftData.valueType, "stringValue");

console.log("timetable output tests: ok");
