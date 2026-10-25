---
bc-version: [all]
domain: performance
keywords: [get, findfirst, primary-key, setrange, lookup, filters, blocked]
technologies: [al]
countries: [w1]
application-area: [all]
---

# Use Get for primary-key lookups without losing filter conditions

## Description

`Get(...)` retrieves a record by primary key, but ignores normal record filters. Replacing a `FindFirst()` filtered only by the full primary key with `Get` expresses the lookup directly. The same replacement is not equivalent when additional filters enforce business conditions, such as requiring an unblocked customer. Security filters are a separate mechanism: their effect on `Get` depends on Security Filter Mode.

## Best Practice

When all primary-key fields are available and no additional normal filter constrains the result, call `Get` with them. Reserve `FindFirst` for filtered searches, including partial keys, secondary fields, or additional business conditions.

Before recommending a replacement, inspect the effective filters at the call site, including filters set by callers or helpers. If additional conditions matter, retain the filtered `FindFirst` or explicitly enforce equivalent conditions after a successful `Get`, before using the record. Do not flag `FindFirst` merely because all primary-key fields are filtered when a non-key filter must also hold. A `SetRange` before `Get` does not enforce that condition.

See sample: [`use-get-instead-of-findfirst-on-full-primary-key.good.al`](use-get-instead-of-findfirst-on-full-primary-key.good.al).

## Anti Pattern

Composing `SetRange` calls that cover only the full primary key and then calling `FindFirst` obscures a direct key lookup. Do not extend this finding to a lookup with additional business filters unless the proposed correction preserves them.

Replacing a filtered lookup with `Get` while assuming a normal filter still excludes records is a correctness defect: a blocked or otherwise ineligible record can pass the lookup. Recommending that replacement without preserving the condition is also an incorrect review finding.

See sample: [`use-get-instead-of-findfirst-on-full-primary-key.bad.al`](use-get-instead-of-findfirst-on-full-primary-key.bad.al).

## References

- [Record.Get remarks: primary-key lookup and filter semantics](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/record/record-get-method).
