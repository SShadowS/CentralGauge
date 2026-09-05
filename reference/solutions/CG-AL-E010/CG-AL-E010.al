codeunit 70001 "Item Event Subscriber"
{
    Access = Internal;

    [EventSubscriber(ObjectType::Table, Database::Item, OnAfterInsertEvent, '', false, false)]
    local procedure OnAfterInsertItem(var Rec: Record Item; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;

        Message(NewItemCreatedMsg, Rec."No.", Rec.Description);
    end;

    var
        NewItemCreatedMsg: Label 'A new item has been created. No.: %1, Description: %2', Comment = '%1 = Item No., %2 = Item Description';
}