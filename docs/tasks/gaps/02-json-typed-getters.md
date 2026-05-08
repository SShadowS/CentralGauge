# JsonObject / JsonArray typed getters (remaining 9 types)

**Priority batch:** 2
**AL extension version(s):** 15.0
**BC release wave:** 2025 W1
**Suggested CG-AL task ID(s):** CG-AL-M021 (JsonObject) / CG-AL-M022 (JsonArray)
**Suggested difficulty:** medium

## Closes TestGaps.md items

- [ ] `JsonObject.GetBigInteger(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetByte(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetChar(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetOption(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetDateTime(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetDate(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetTime(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetDuration(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonObject.GetObject(Key, [DefaultIfNotFound])` (v15.0)
- [ ] `JsonArray.GetBigInteger(Index)` (v15.0)
- [ ] `JsonArray.GetByte(Index)` (v15.0)
- [ ] `JsonArray.GetChar(Index)` (v15.0)
- [ ] `JsonArray.GetOption(Index)` (v15.0)
- [ ] `JsonArray.GetDateTime(Index)` (v15.0)
- [ ] `JsonArray.GetDate(Index)` (v15.0)
- [ ] `JsonArray.GetTime(Index)` (v15.0)
- [ ] `JsonArray.GetDuration(Index)` (v15.0)
- [ ] `JsonArray.GetObject(Index)` (v15.0)

## Feature summary

Runtime 15.0 added typed getters on `JsonObject` and `JsonArray` so AL devs no
longer need a `JsonToken` round-trip plus `AsValue().AsX()` to read scalars.
CG-AL-M020 / CG-AL-H014 already cover Boolean / Integer / Decimal / Text /
Array. This spec closes the remaining nine value types on both surfaces
(18 overloads). JsonObject overloads accept an optional `DefaultIfNotFound`
that returns the type's zero value when the key is missing; JsonArray
overloads do **not** take that flag and throw on out-of-range index.

## AL surface

```al
// JsonObject - Key: Text, optional DefaultIfNotFound: Boolean
biVal  := JsonObj.GetBigInteger('big', true);   // 0 if missing
byVal  := JsonObj.GetByte('b', true);           // 0 if missing
chVal  := JsonObj.GetChar('c', true);           // 0 if missing
optVal := JsonObj.GetOption('opt', true);       // 0 if missing
dtVal  := JsonObj.GetDateTime('dt', true);      // 0DT if missing
dVal   := JsonObj.GetDate('d', true);           // 0D if missing
tVal   := JsonObj.GetTime('t', true);           // 0T if missing
durVal := JsonObj.GetDuration('dur', true);     // 0 if missing
inner  := JsonObj.GetObject('inner', true);     // empty obj if missing

// JsonArray - Index: Integer (0-based, no DefaultIfNotFound)
biVal  := JsonArr.GetBigInteger(0);
byVal  := JsonArr.GetByte(1);
chVal  := JsonArr.GetChar(2);
optVal := JsonArr.GetOption(3);
dtVal  := JsonArr.GetDateTime(4);
dVal   := JsonArr.GetDate(5);
tVal   := JsonArr.GetTime(6);
durVal := JsonArr.GetDuration(7);
inner  := JsonArr.GetObject(8);
```

### Wire format for temporal types

The typed getters are documented on the runtime-15.0 `JsonObject` /
`JsonArray` pages, but those pages omit examples. The actual parsing is
delegated to the runtime-1.0 `JsonValue.AsX()` methods, whose MS Learn
pages spell out the expected JSON literal:

| AL type    | JSON form                              | Example literal                  | Notes                                                                                                                                          |
| ---------- | -------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DateTime` | string, round-trip ("o") format        | `"2024-01-15T10:30:00.0000000Z"` | `AsDateTime` errors on any other shape; missing TZ specifier is treated as UTC, local-TZ specifier is converted to UTC                         |
| `Date`     | string, `yyyy-MM-dd`                   | `"2017-01-17"`                   | exact format; no time component                                                                                                                |
| `Time`     | string, `HH:mm:ss.FFFFFFF`             | `"10:30:00.0000000"`             | seven-digit fractional-second field; trailing zeros required to parse cleanly                                                                  |
| `Duration` | integer or numeric string (BigInteger) | `60000` or `"60000"`             | underlying value is the 64-bit millisecond count; `SetValue(Duration)` writes a BigInteger, `AsDuration` accepts a number or string-as-integer |

A `Duration` value of one minute therefore round-trips as the JSON
literal `60000`, **not** as `"PT1M"` or `"00:01:00"`. (Different code
paths exist — BC telemetry payloads emit TimeSpan strings like
`"04:39:50.9489215"` (community: duiliotacconi.com) — but those are
written by an internal serializer, not by `JsonObject.Add(..., Duration)`,
and `AsDuration` will reject them.)

## MS Learn references

- [JsonObject data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-data-type) — full method index
- [JsonObject.GetOption(Text [, Boolean])](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-getoption-method) — confirms `DefaultIfNotFound=true` returns 0
- [JsonObject.GetDate(Text [, Boolean])](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonobject/jsonobject-getdate-method) — confirms `0D` default
- [JsonArray data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonarray/jsonarray-data-type) — lists every typed getter, 0-based
- [JsonArray.GetBigInteger(Integer)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonarray/jsonarray-getbiginteger-method) — confirms array variant takes `Index` only
- [JsonValue.AsDateTime()](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonvalue/jsonvalue-asdatetime-method) — wire format is round-trip ("o"); missing TZ specifier treated as UTC
- [JsonValue.AsDate()](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonvalue/jsonvalue-asdate-method) — wire format is `"yyyy-MM-dd"` (e.g. `"2017-01-17"`)
- [JsonValue.AsTime()](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonvalue/jsonvalue-astime-method) — wire format is `"HH:mm:ss.FFFFFFF"`
- [JsonValue.AsDuration()](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonvalue/jsonvalue-asduration-method) — wire format is "a number or a string which can be converted without loss of precision to a BigInteger" (i.e. millisecond count)
- [JsonValue.SetValue(Duration)](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/jsonvalue/jsonvalue-setvalue-duration-method) — confirms Duration "underlying value, representing a 64-bit integer, is stored and serialized as a BigInteger"

## Test approach sketch

- **Assertions:** for each of the 18 overloads, build a JSON literal via
  `ReadFrom`, call the getter, assert `AreEqual` against a known value.
  For JsonObject, also call with a missing key + `DefaultIfNotFound=true`
  and assert the zero value (`0`, `0D`, `0T`, `0DT`, empty `JsonObject`).
- **Required prereqs:** none — pure platform API.
- **Boundary cases:** missing key with default flag (JsonObject only);
  GetObject on nested empty object `{}`; Option as integer; Char from
  small int; DateTime as round-trip "o" string (e.g.
  `"2024-01-15T10:30:00.0000000Z"`); Date as `"yyyy-MM-dd"`; Time as
  `"HH:mm:ss.FFFFFFF"`; Duration as integer millisecond count (e.g.
  `60000` for one minute) — `AsDuration` rejects ISO-8601 / TimeSpan
  strings even though they look plausible.
- **Known model traps:** (1) reaching for `AsToken().AsValue().AsX()` out
  of habit; (2) assuming JsonArray getters accept `DefaultIfNotFound`
  (changelog implies parity, MS Learn shows `Index` only); (3) using
  1-based array indexing; (4) writing Duration as an ISO-8601 string
  like `"PT1M"` or a TimeSpan like `"00:01:00"` — `AsDuration` requires
  an integer (or numeric string) millisecond count; (5) using a
  non-round-trip DateTime literal like `"2024-01-15 10:30:00"` —
  `AsDateTime` requires the "o" format with `T` separator and seven
  fractional-second digits.

## Open questions

- Decide whether to split into two task IDs (M021 object + M022 array)
  or one combined task with 18 sub-tests.

## Source

AL ext v15.0 changelog — section "New methods access properties and
array elements" — cross-checked against MS Learn (links above).
