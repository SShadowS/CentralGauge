---
bc-version: [all]
domain: ui
keywords: [notification, recall, notification-id, createguid, notification-lifecycle-mgt, sendnotification, sendnotificationwithadditionalcontext, recallnotificationsforrecord, handledelayedinsert, notification-context]
technologies: [al]
countries: [w1]
application-area: [all]
---

# A notification that must be recalled needs an Id the code can find again

## Description

`Notification.Recall()` withdraws the notification whose `Id` it carries. When `Id` is left unassigned, `Send()` assigns one. What matters is whether the `Notification` that `Recall()` runs on carries the same Id as the one that was sent, not whether that Id is a literal, a `CreateGuid()` value, or assigned by `Send()`. Microsoft Learn's own `Id`/`Recall` example uses a predefined Id "so that the notification can be recalled", and the Recall page states that a notification "can be recalled successfully even if it hasn't been sent".

Code can keep the sent identity in any of these ways:

- **A fixed Id**, returned from a procedure or assigned as a literal, recalled before each send. `Analysis View.ShowResetNeededNotification` does this with plain `Send()`. `Sales Line.SendBlockedItemNotification` does it for line records, passing the fixed Id to `"Notification Lifecycle Mgt.".SendNotification`, which keeps an Id that is already set. Showing only the latest line's warning is a deliberate design choice there, not a defect. Learn does not document what `Send()` does when a notification with the same Id is already displayed, so recall first rather than relying on `Send()` to replace it.
- **A retained instance**: a global `Notification` variable on the page or codeunit that is sent and later recalled. `VAT Bus. Post. Grp. Part` assigns `Format(CreateGuid())` once in `OnOpenPage` and recalls the same global instance before re-sending and in `HideNotification`. The `Certificate` page never assigns an Id; it sends its global `PasswordNotification` and `ExpiredNotification` and later recalls the same instances.
- **A saved generated Id**: `Data Search Lines` sends a local notification without an Id, saves `ChangedSetupNotification.Id` (assigned by `Send()`) in a global Guid, and later assigns that saved Id to a new local `Notification` to recall it.
- **Tracked per record** through codeunit 1511 `"Notification Lifecycle Mgt."`. `SendNotification(Notification, RecId)` assigns `CreateGuid()` when `Id` is null, sends, and then reads `NotificationToSend.Id` to store it against the `RecordId` in the temporary table `"Notification Context"`. `RecallNotificationsForRecord(RecId, HandleDelayedInsert)` recalls every tracked notification for that record. When one record can carry several independent warnings, pass a fixed GUID per reason to `SendNotificationWithAdditionalContext` and `RecallNotificationsForRecordWithAdditionalContext`. `Item-Check Avail.` does this: a `CreateGuid()` Id per notification, its fixed availability GUID as the additional context.

The defect is a `Recall()` whose Id cannot be the sent one: a fresh local `Notification` with no Id, or a new `CreateGuid()` assigned at recall time, while the sent instance and its Id are not kept anywhere. Such a warning cannot be withdrawn when its condition clears. It stays until the user dismisses it or the page instance closes.

## Best Practice

Keep the identity of every notification the code will recall, and recall with that identity: a fixed Id recalled before re-sending updated content, a retained global `Notification` instance, or a generated Id (from `CreateGuid()` or assigned by `Send()`) saved after `Send()` and assigned again before `Recall()`. See sample: [`notification-recall-needs-known-id.good.al`](notification-recall-needs-known-id.good.al).

When notifications for several records must be visible together, `"Notification Lifecycle Mgt."` is the recommended way to track them, though correct direct tracking of per-record Ids is equally valid. The codeunit is `SingleInstance`, so tracking lasts for the session. While a record does not exist yet, its notification is stored under the table's empty `RecordId`. Pass `HandleDelayedInsert = true` when recalling for a record that may not be inserted yet, and `false` when recalling after the record is deleted, as Base App's own delete subscribers do. Base App's `"Notification Lifecycle Handler"` (codeunit 1508) moves tracked notifications on insert and rename, and recalls them on delete, only for the Base App tables it subscribes to, such as `Sales Line`. For another table, call `SetRecordID`, `UpdateRecordID`, and `RecallNotificationsForRecord` from that table's own insert, rename, and delete paths.

## Anti Pattern

Code that both sends and recalls a notification where the `Notification` passed to `Recall()` cannot carry the sent Id: for example `Send()` on a local variable when a condition holds and `Recall()` on a fresh local variable when it clears, with no Id assigned, or with a new `CreateGuid()` assigned on each call, and neither the sent instance nor its Id kept in a global variable, a record, or `"Notification Lifecycle Mgt."`. The per-record form: notifications for several records must be visible at the same time, but they share one fixed Id sent and recalled directly, so recalling one record's warning cannot leave the others in place. See sample: [`notification-recall-needs-known-id.bad.al`](notification-recall-needs-known-id.bad.al).

Flag this only with evidence that the recalled identity differs from, or cannot recover, the sent identity: trace the variable passed to `Recall()` back to its Id assignment, and the sent variable forward to where its instance or Id is kept.

Not this pattern:

- A one-off informational notification that the code never recalls. Learn's own Sales Order example sends without an Id.
- A global or page-level `Notification` instance that is sent and later recalled, whether its Id was assigned by `CreateGuid()` (once, for example in `OnOpenPage`) or left for `Send()` to assign.
- A generated Id, from `CreateGuid()` or assigned by `Send()`, saved after `Send()` and assigned to the `Notification` used for `Recall()`.
- Per-record Ids tracked correctly by the code itself, without `"Notification Lifecycle Mgt."`.
- A notification sent through `"Notification Lifecycle Mgt."` without an Id, because the codeunit assigns and tracks one.
- A fixed Id shared across records when one warning at a time is intended, recalled before re-send, with or without `SendNotification`, as in `Sales Line`'s blocked-item notification or `Over-Receipt Mgt.`.

## References

- [Notification.Id method](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/methods-auto/notification/notification-id-method): an unassigned Id is assigned at `Send()`; the example sets a predefined Id so the notification can be recalled.
- [Notification.Recall method](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/methods-auto/notification/notification-recall-method): a notification can be recalled more than once, and before it is sent. The same page lists client communication failure, or recalling a notification with no instance, as reasons `Recall()` can return `false`, and an uncaptured failure is a runtime error. Base App's unconditional recall-before-send (Analysis View, Sales Line) shows that recalling a fixed Id with nothing on screen is safe in practice.
- [Using nonintrusive notifications](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/developer/devenv-notifications-developing): notifications remain for the page instance or until dismissed.
- [NotificationLifecycleMgt.Codeunit.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Modules/System/Notifications/NotificationLifecycleMgt.Codeunit.al): `SendNotification` and `SendNotificationWithAdditionalContext` (lines 17-36; `Send()` then `CreateNotificationContext(NotificationToSend.Id, RecId)` at 22-24), `RecallNotificationsForRecord` (38-44), `GetUsableRecordId` (177-191). [NotificationLifecycleHandler.Codeunit.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/System/Notifications/NotificationLifecycleHandler.Codeunit.al): `Sales Line` insert, rename, and delete subscribers (lines 27-52).
- Retained instances and saved Ids: [VATBusPostGrpPart.Page.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Finance/VAT/Setup/VATBusPostGrpPart.Page.al) (`CreateGuid()` in `OnOpenPage` at line 86, global at 93, recall at 99 and 115), [Certificate.Page.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/System/IsolatedStorage/Certificate.Page.al) (globals at 189-190 with no Id, sent at 226 and 245, recalled at 248-252), and [DataSearchLines.page.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Apps/W1/DataSearch/App/DataSearchLines.page.al) (`Send()` then `LastChangedSetupNotification := ChangedSetupNotification.Id` at 218-219, recall with the saved Id at 260-269).
- Base App usage: [AnalysisView.Table.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Finance/Analysis/AnalysisView.Table.al) (`ShowResetNeededNotification`, lines 1039-1051), [SalesLine.Table.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Sales/Document/SalesLine.Table.al) (`SendBlockedItemNotification`, lines 10126-10135), [OverReceiptMgt.Codeunit.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Purchases/Document/OverReceiptMgt.Codeunit.al) (lines 212-228), and [ItemCheckAvail.Codeunit.al](https://github.com/microsoft/BCApps/blob/837ef802485ee457e52310d2ecaa08b93d0122fd/src/Layers/W1/BaseApp/Inventory/Availability/ItemCheckAvail.Codeunit.al) (recall at lines 89-90, `CreateGuid()` Id and send at 636-646).
