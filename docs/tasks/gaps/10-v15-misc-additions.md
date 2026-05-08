# v15 misc additions: RecordRef.SetAutoCalcFields, HttpClient.UseServerCertificateValidation, JsonObject.WriteWithSecretsTo

**Priority batch:** 10
**AL extension version(s):** 15.0, 15.1
**BC release wave:** 2025 W1 / W2
**Suggested CG-AL task ID(s):** CG-AL-M028 (RecordRef), CG-AL-M029 (HttpClient cert), CG-AL-M030 (JSON secrets)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- `RecordRef.SetAutoCalcFields(...)`
- `HttpClient.UseServerCertificateValidation` property
- `JsonObject.WriteWithSecretsTo(Secrets: Dictionary of [Text, SecretText]; var Result: SecretText)`

## Feature summary

Three independent v15 surface additions. **`RecordRef.SetAutoCalcFields`** (runtime 15.0) brings the existing `Record.SetAutoCalcFields` ergonomics to dynamic record access so FlowFields auto-calc on retrieval without per-row `CalcFields`. **`HttpClient.UseServerCertificateValidation`** (runtime 15.0) is a per-instance Boolean that selectively disables server cert validation; default is `true`, and it replaces the tenant-wide `HttpServerCertificateValidation` feature key (removed in v27). **`JsonObject.WriteWithSecretsTo`** (runtime 15.1) serializes a JsonObject to `SecretText`, swapping JPath-targeted placeholders with `SecretText` values so credentials never materialize as plain `Text`.

## AL surface

```AL
// 1. RecordRef.SetAutoCalcFields - runtime 15.0
[Ok := ] RecordRef.SetAutoCalcFields([Fields: Integer,...])

// 2. HttpClient.UseServerCertificateValidation - runtime 15.0
// Default value of UseServerCertificateValidation is true.
// Property-access syntax also supported.
[CurrentUseServerCertificateValidation := ]
    HttpClient.UseServerCertificateValidation(UseServerCertificateValidation: Boolean)

// 3. JsonObject.WriteWithSecretsTo - runtime 15.1 (two overloads)
// Both overloads share identical Ok-return semantics per MS Learn:
//   - true  : write succeeded
//   - false : write failed
//   - omitted Ok + failure -> runtime error
[Ok := ] JsonObject.WriteWithSecretsTo(Path: Text; Secret: SecretText; var Result: SecretText)
[Ok := ] JsonObject.WriteWithSecretsTo(Secrets: Dictionary of [Text, SecretText]; var Result: SecretText)
```

## MS Learn references

- [RecordRef.SetAutoCalcFields([Integer,...]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/recordref/recordref-setautocalcfields-method) - signature, runtime 15.0 note, optional `Ok` return.
- [HttpClient.UseServerCertificateValidation(Boolean) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/httpclient/httpclient-useservercertificatevalidation-method) - signature, default `true`, feature key removal in v27.
- [JsonObject.WriteWithSecretsTo(Text, SecretText, var SecretText)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-writewithsecretsto-text-secrettext-secrettext-method) - single-path overload.
- [JsonObject.WriteWithSecretsTo(Dictionary of [Text, SecretText], var SecretText)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-writewithsecretsto-dictionary%5Btext,secrettext%5D-secrettext-method) - Dictionary overload; same `Ok` return semantics as the Path overload (`true` on success, `false` otherwise; runtime error if return is omitted and operation fails).
- [JsonObject data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-data-type) - confirms both Path and Dictionary overloads of `WriteWithSecretsTo`.

## Test approach sketch

- **Assertions:**
  - SetAutoCalcFields: open RecordRef on a table with FlowField, call SetAutoCalcFields(<FieldNo>), then `FindFirst`/`Get` and assert FlowField is populated without manual `CalcFields`.
  - UseServerCertificateValidation: assert default optional return is `true` after construction; after calling with `false`, assert returned current value flips to `false`.
  - WriteWithSecretsTo: build JsonObject with placeholder values, invoke Dictionary overload with two JPath keys, assert resulting `SecretText` (via `SecretText.IsEmpty()` plus a wrapper that exposes length or a hash) is non-empty and was produced without exception.
- **Required prereqs:** small table with one Decimal FlowField (Sum) over a child table for the RecordRef test.
- **Boundary cases:** SetAutoCalcFields with zero args (clears auto-calc), HttpClient toggle round-trip, WriteWithSecretsTo with an empty Dictionary (Path overload only) and with a JPath that does not match.
- **Known model traps:**
  - `HttpClient.UseServerCertificateValidation` requires a return-value capture in some method-call forms (GitHub microsoft/AL#7993); models often write `HttpClient.UseServerCertificateValidation(false);` as a statement and get a compile error. Recommend property-access syntax or `_ :=` capture.
  - Models confuse the two `WriteWithSecretsTo` overloads and pass a Dictionary into the three-arg form.
  - Models call `Record.SetAutoCalcFields` syntax on a RecordRef before runtime 15.0 was available.

## Open questions

- Unverified: exact behavior when `SetAutoCalcFields` is called on a RecordRef opened against a temporary table (MS Learn does not call this out, and the community write-ups at [yzhums.com](https://yzhums.com/62745/), [bcaihub.com](https://bcaihub.com/2025/04/16/business-central-2025-wave-1-bc26-setautocalcfields-method-on-recordref/), and [sauravdhyani.com](https://www.sauravdhyani.com/2025/05/new-in-business-central-2025-wave-1-use.html) demonstrate only the regular-table `Customer` example without addressing temp tables; FlowFields generally do not auto-resolve against in-memory temp records, but the AL runtime tolerates the `SetAutoCalcFields` call without error). Test approach: open a temporary RecordRef, call `SetAutoCalcFields(<FieldNo>)`, insert in-memory rows, and observe whether the FlowField returns 0 or the underlying calculation - keep the assertion outside the benchmark scoring path until BC docs land an explicit statement.

## Source

AL ext v18.0.2293710 `changelog.md` - version 15.0 sections "RecordRef" and "HttpClient"; version 15.1 section "New method to add SecretText values to JSON objects - WriteWithSecretsTo".
