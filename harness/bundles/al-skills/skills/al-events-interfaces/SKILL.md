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

- An interface declares procedure signatures only. It has no ID, no variables and no
  code.
- A codeunit implements an interface by naming it after `implements` in its declaration
  and defining every procedure of the interface with exactly the same signature. One
  codeunit can implement several interfaces.
- A variable of an interface type can hold any codeunit that implements it; a call through
  the variable runs the procedure of the codeunit it currently holds.
- An enum can also declare that it implements an interface. Each of its values then names,
  in its `Implementation` property, the codeunit that implements the interface for that
  value, and assigning an enum value to an interface variable selects that codeunit.
  `DefaultImplementation` covers values that name none.
- When the enum is extensible, another app can add values in an enum extension, each with
  its own implementing codeunit, without changing the app that owns the enum or the
  interface.

- Use an interface when callers need one of several interchangeable behaviors; use an event
  when other apps react to, or veto, something that happens.
