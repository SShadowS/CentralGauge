---
name: al-events-interfaces
description: Extending Business Central behavior across apps with events, subscribers, interfaces and extensible enums. Use when behavior must change without editing another app's code, or when choosing between an event and an interface.
---

# Events and interfaces in AL

## Publishing an event

```al
[IntegrationEvent(false, false)]
local procedure OnBeforePostDocument(var Header: Record "My Header"; var IsHandled: Boolean)
begin
end;
```

- `IntegrationEvent` is the contract other apps build on; keep its signature stable.
- Pass records `var` when subscribers may change them.
- The IsHandled pattern: the publisher raises the event, then skips its own logic when a
  subscriber set `IsHandled := true`. Raise the event before the default logic runs.

## Subscribing

```al
[EventSubscriber(ObjectType::Codeunit, Codeunit::"My Posting", 'OnBeforePostDocument', '', false, false)]
local procedure HandleBeforePost(var Header: Record "My Header"; var IsHandled: Boolean)
begin
end;
```

- The subscriber lives in a codeunit of the subscribing app. Parameter names and types must
  match the publisher; you may omit parameters you do not use.
- Table events (`OnAfterInsertEvent`, `OnBeforeValidateEvent` and so on) use
  `ObjectType::Table` and the field name as the fourth argument for field events.
- A subscriber codeunit with `EventSubscriberInstance = Manual` runs only while bound with
  `BindSubscription` (and until `UnbindSubscription` or the bound variable goes out of scope).
  Default is `StaticAutomatic`: always on.

## Interfaces

```al
interface "Price Calculator"
{
    procedure Calculate(Amount: Decimal): Decimal;
}

codeunit 50110 "Standard Price" implements "Price Calculator"
{
    procedure Calculate(Amount: Decimal): Decimal
    begin
        exit(Amount);
    end;
}
```

- An interface has no ID. A codeunit implements it by declaring `implements` and every
  procedure with the exact signature.
- Combine with an extensible enum so other apps can add implementations:

```al
enum 50110 "Price Method" implements "Price Calculator"
{
    Extensible = true;
    value(0; Standard) { Implementation = "Price Calculator" = "Standard Price"; }
}
```

Then `Calculator := Setup."Price Method";` picks the implementation, and another app adds
a value in an `enumextension` with its own codeunit.

- Use an interface when callers need one of several interchangeable behaviors; use an event
  when other apps react to, or veto, something that happens.
