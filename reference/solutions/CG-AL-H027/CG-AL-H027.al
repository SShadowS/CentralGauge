codeunit 70260 "CG H027 Watcher"
{
    SingleInstance = true;

    [EventSubscriber(ObjectType::Table, Database::Customer, OnBeforeModifyEvent, '', false, false)]
    local procedure OnBeforeModifyCustomer(var Rec: Record Customer; var xRec: Record Customer; RunTrigger: Boolean)
    var
        PersistedCustomer: Record Customer;
        ChangeCounter: Codeunit "CG H027 Change Counter";
    begin
        if Rec.IsTemporary() then
            exit;

        // Read the value currently persisted in the database to guarantee
        // reliable change detection regardless of how the caller modified
        // the record (xRec is not guaranteed to hold the database state).
        if not PersistedCustomer.Get(Rec."No.") then
            exit;

        if PersistedCustomer."CG H027 Watched" <> Rec."CG H027 Watched" then
            ChangeCounter.Increment();
    end;
}