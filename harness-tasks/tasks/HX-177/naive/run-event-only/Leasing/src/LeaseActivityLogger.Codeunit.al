codeunit 70398 "CGR Lease Activity Logger"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Lease Invoicing", 'OnAfterCreateInvoiceLine', '', false, false)]
    local procedure LogNewInvoiceLine(ScheduleLine: Record "CGR Lease Schedule Line"; var InvoiceLine: Record "CGR Lease Invoice Line")
    var
        Entry: Record "CGR Lease Activity Entry";
    begin
        Entry.Init();
        Entry."Contract No." := InvoiceLine."Contract No.";
        Entry.Activity := 'INVOICE LINE';
        Entry."Reference No." := InvoiceLine."Schedule Line No.";
        Entry.Amount := InvoiceLine.Amount;
        Entry.Insert(true);
    end;
}
