import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePartialSettingsUpdateInput,
  parseSettingsUpdateInput,
} from "./input";

test("settings input accepts valid due days and SMS templates", () => {
  assert.deepEqual(
    parseSettingsUpdateInput({
      invoiceDueDays: 14,
      paymentReminderTemplate:
        "Reminder {customerName} {meterNumber} {amountDue} {dueDate}",
      paymentConfirmationTemplate:
        "Paid {customerName} {amountPaid} {meterNumber} {paymentReference} balance {balanceDue}",
      newBillTemplate:
        "Bill {previousReading} {currentReading} {consumption} {billAmount} {dueDate}",
      announcementTemplate: "Notice {announcementText}",
    }),
    {
      invoiceDueDays: 14,
      paymentReminderTemplate:
        "Reminder {customerName} {meterNumber} {amountDue} {dueDate}",
      paymentConfirmationTemplate:
        "Paid {customerName} {amountPaid} {meterNumber} {paymentReference} balance {balanceDue}",
      newBillTemplate:
        "Bill {previousReading} {currentReading} {consumption} {billAmount} {dueDate}",
      announcementTemplate: "Notice {announcementText}",
    },
  );
});

test("settings input rejects invalid due days and blank templates", () => {
  const base = {
    invoiceDueDays: 14,
    paymentReminderTemplate:
      "Reminder {customerName} {meterNumber} {amountDue} {dueDate}",
    paymentConfirmationTemplate:
      "Paid {customerName} {amountPaid} {meterNumber} {paymentReference} balance {balanceDue}",
    newBillTemplate:
      "Bill {previousReading} {currentReading} {consumption} {billAmount} {dueDate}",
    announcementTemplate: "Notice {announcementText}",
  };
  assert.equal(
    parseSettingsUpdateInput({ ...base, invoiceDueDays: 0 }),
    null,
  );
  assert.equal(
    parseSettingsUpdateInput({ ...base, announcementTemplate: " " }),
    null,
  );
  assert.equal(
    parseSettingsUpdateInput({ ...base, extra: "not allowed" }),
    null,
  );
});

test("settings input rejects deleted required placeholders", () => {
  const valid = {
    invoiceDueDays: 14,
    paymentReminderTemplate:
      "Dear {customerName}, meter {meterNumber}, balance {amountDue}, due {dueDate}",
    paymentConfirmationTemplate:
      "Dear {customerName}, paid {amountPaid}, meter {meterNumber}, reference {paymentReference}, balance {balanceDue}",
    newBillTemplate:
      "Previous {previousReading}, current {currentReading}, usage {consumption}, bill {billAmount}, due {dueDate}",
    announcementTemplate: "Notice: {announcementText}",
  };
  assert.ok(parseSettingsUpdateInput(valid));
  assert.equal(
    parseSettingsUpdateInput({
      ...valid,
      paymentReminderTemplate: "Dear customer, you owe money",
    }),
    null,
  );
  assert.equal(
    parseSettingsUpdateInput({
      ...valid,
      announcementTemplate: "Notice: {unknownPlaceholder}",
    }),
    null,
  );
});

test("partial settings input accepts due days and one SMS template", () => {
  assert.deepEqual(
    parsePartialSettingsUpdateInput({
      kind: "invoice_due_days",
      invoiceDueDays: 14,
    }),
    { kind: "invoice_due_days", invoiceDueDays: 14 },
  );
  assert.deepEqual(
    parsePartialSettingsUpdateInput({
      kind: "sms_template",
      templateKey: "announcementTemplate",
      template: "Notice: {announcementText}",
    }),
    {
      kind: "sms_template",
      templateKey: "announcementTemplate",
      template: "Notice: {announcementText}",
    },
  );
});
