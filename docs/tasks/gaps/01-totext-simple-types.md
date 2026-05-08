# `ToText` on remaining simple types + `TextConstant` text methods

**Priority batch:** 1
**AL extension version(s):** 15.0, 15.1, 15.2
**BC release wave:** 2025 W1 (GA Apr 1, 2025)
**Suggested CG-AL task ID(s):** CG-AL-E056 (`ToText` on 7 missing simple types) / CG-AL-E057 (`TextConstant` text methods)
**Suggested difficulty:** easy

## Closes TestGaps.md items

- `ToText()` on `BigInteger`
- `ToText()` on `Byte`
- `ToText()` on `DateTime`
- `ToText()` on `Duration`
- `ToText()` on `Guid`
- `ToText()` on `Time`
- `ToText()` on `Version`
- `TextConstant` text methods (post-removal of static `Label` methods)

## Feature summary

Runtime 15.0 added a `ToText` method to every simple type (`BigInteger`,
`Boolean`, `Byte`, `Date`, `DateTime`, `Decimal`, `Duration`, `Guid`,
`Integer`, `Time`, `Version`), giving devs a fluent shorthand for
`Format(value, 0, 0)`. Runtime 15.1 added an optional
`Invariant: Boolean` overload to `Boolean.ToText` (`true` ==
`Format(value, 0, 9)`). Runtime 15.2 then fixed `ToText` on `Decimal`,
`Boolean`, `Byte`, `Guid` and added the same instance text methods that
`Text` already had (`Contains`, `Substring`, `Trim`, `Split`, `Replace`,
etc.) to `TextConstant`, while removing static methods on `Label`.
CG-AL-E052 already exercises `Integer`, `Decimal`, `Boolean`, `Date`;
this batch covers the seven remaining simple types plus the
`TextConstant` instance methods.

## AL surface

```al
// 15.0: ToText on remaining simple types. No-arg form == Format(value, 0, 0).
BigIntText  := BigIntVar.ToText();                         // BigInteger.ToText()
ByteText    := ByteVar.ToText();                           // Byte.ToText()
GuidText    := GuidVar.ToText();                           // Guid.ToText()
VersionText := VersionVar.ToText();                        // Version.ToText()

// 15.0: optional Invariant: Boolean. true == Format(value, 0, 9).
DtInv  := DateTimeVar.ToText(true);                        // DateTime.ToText([Invariant: Boolean])
DurInv := DurationVar.ToText(true);                        // Duration.ToText([Invariant: Boolean])
TimInv := TimeVar.ToText(true);                            // Time.ToText([Invariant: Boolean])

// 15.1: Boolean.ToText also gained the optional Invariant overload.
BoolInv := BoolVar.ToText(true);                           // Boolean.ToText([Invariant: Boolean])

// 15.2: TextConstant gains the same instance methods as Text.
var Greeting: TextConstant ENU = 'Hello, World!', DAN = 'Hej, Verden!';
Lower    := Greeting.ToLower();
HasHello := Greeting.Contains('Hello');           // Boolean
Trimmed  := Greeting.Trim();
Parts    := Greeting.Split(',');                  // List of [Text]
Padded   := Greeting.PadRight(20, '.');
Idx      := Greeting.IndexOf('World');            // 1-based
```

## MS Learn references

- [BigInteger.ToText() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/biginteger/biginteger-totext-method) - no-arg, returns `Text`, equivalent to `Format(value, 0, 0)`.
- [Boolean.ToText([Boolean]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/boolean/boolean-totext-boolean-method) - runtime 15.1 added optional `Invariant: Boolean`; `true` == `Format(value, 0, 9)`. Sits alongside the original no-arg [Boolean.ToText() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/boolean/boolean-totext-method) (15.0).
- [Byte.ToText() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/byte/byte-totext-method) - no-arg, returns `Text`.
- [DateTime.ToText([Boolean]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/datetime/datetime-totext-method) - optional `Invariant: Boolean`; `true` == `Format(value, 0, 9)`.
- [Duration.ToText([Boolean]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/duration/duration-totext-method) - optional `Invariant: Boolean`.
- [Guid.ToText() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/guid/guid-totext-method) - no-arg, returns `Text`.
- [Time.ToText([Boolean]) Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/time/time-totext-method) - optional `Invariant: Boolean`.
- [Version.ToText() Method](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/version/version-totext-method) - no-arg, returns `Text`.
- [TextConst data type](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/methods-auto/textconst/textconst-data-type) - lists `Contains`, `EndsWith`, `IndexOf`, `IndexOfAny`, `LastIndexOf`, `PadLeft`, `PadRight`, `Remove`, `Replace`, `Split` (3 overloads), `StartsWith`, `Substring`, `ToLower`, `ToUpper`, `Trim`, `TrimEnd`, `TrimStart`.
- [Convert simple type values to text using new ToText method (release plan)](https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave1/smb/dynamics365-business-central/convert-simple-type-values-text-using-new-totext-method) - 2025 W1, GA Apr 1, 2025.

## Test approach sketch

- **Assertions (CG-AL-E056):** for each of the 7 types, assert `Var.ToText()`
  equals `Format(Var, 0, 0)` for a known value. For `DateTime`, `Duration`,
  `Time`, also assert `Var.ToText(true)` equals `Format(Var, 0, 9)`.
  Optionally re-cover `Boolean.ToText(true)` (runtime 15.1 invariant
  overload, distinct from the 15.0 no-arg form already exercised by
  CG-AL-E052) so the scoreboard captures models that miss the 15.1
  addition.
- **Assertions (CG-AL-E057):** declare a `TextConstant` and assert at least
  `Contains`, `IndexOf` (1-based), `Substring`, `Split` (returns `List of [Text]`),
  `ToUpper`/`ToLower`, `Trim`, `Replace`, `PadLeft`/`PadRight` return values
  match the equivalent calls on the same literal cast to `Text`.
- **Required prereqs:** none. Pure language features.
- **Boundary cases:** zero `BigInteger`, `0DT` `DateTime`, empty `Guid`,
  zero `Duration`, `000000T` `Time`, default `Version`, `TextConstant`
  with leading/trailing whitespace for `Trim`, multi-separator `Split`.
- **Known model traps:**
  - Models may emit `Format(v)` instead of `v.ToText()` and pass the
    test by accident; lock the test to method-call form via the prompt.
  - `IndexOf` on `Text`/`TextConstant` is **1-based**, not 0-based.
  - `DateTime.ToText(true)` is `Format(value, 0, 9)`, not `Format(value, 0, 0)`.
  - Models may try non-existent overloads with a format string
    (`v.ToText('<Year4>')`); only the optional `Invariant: Boolean`
    exists.
  - Models may instantiate `TextConstant` as `Label` and lose the
    instance-method surface (Label retains different methods).

## Open questions

- Should CG-AL-E056 and CG-AL-E057 ship as two tasks or one combined
  task? Splitting matches the changelog (15.0 vs 15.2) and lets the
  scoreboard distinguish models that learned `ToText` from models that
  learned the `TextConstant` text surface.

## Source

AL ext v18.0.2293710 `changelog.md` - version 15.0 - "Added ToText
method to simple types..."; version 15.2 - "Added text methods to the
TextConstant data type and removed static methods on the Label type."
