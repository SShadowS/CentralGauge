codeunit 70398 "CGR Lease Activity Logger"
{
    [EventSubscriber(ObjectType::Table, Database::"CGR Lease Invoice Line", 'OnAfterInsertEvent', '', false, false)]
    local procedure LogNewInvoiceLine(var Rec: Record "CGR Lease Invoice Line"; RunTrigger: Boolean)
    var
        Entry: Record "CGR Lease Activity Entry";
        Logged: Record "CGR Lease Activity Entry";
    begin
        Logged.SetRange("Contract No.", Rec."Contract No.");
        Logged.SetRange("Reference No.", Rec."Schedule Line No.");
        Logged.SetRange(Activity, 'INVOICE LINE');
        if not Logged.IsEmpty() then
            exit;
        Entry.Init();
        Entry."Contract No." := Rec."Contract No.";
        Entry.Activity := 'INVOICE LINE';
        Entry."Reference No." := Rec."Schedule Line No.";
        Entry.Amount := Rec.Amount;
        Entry.Insert(true);
    end;
}
