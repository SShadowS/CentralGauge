codeunit 70361 "CGR Lease Due Line Run"
{
    TableNo = "CGR Lease Schedule Line";

    trigger OnRun()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.Init();
        InvoiceLine."Contract No." := Rec."Contract No.";
        InvoiceLine."Schedule Line No." := Rec."Line No.";
        InvoiceLine."Due Date" := Rec."Due Date";
        InvoiceLine.Amount := Rec.Amount;
        InvoiceLine.Insert(true);
        Rec.Invoiced := true;
        Rec.Modify(true);
        OnAfterInvoiceLine(Rec);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterInvoiceLine(Line: Record "CGR Lease Schedule Line")
    begin
    end;
}
