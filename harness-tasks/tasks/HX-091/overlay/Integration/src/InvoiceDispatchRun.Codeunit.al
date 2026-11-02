codeunit 70434 "CGR Invoice Dispatch Run"
{
    TableNo = "CGR Invoice Dispatch Entry";

    trigger OnRun()
    var
        Delivery: Codeunit "CGR Invoice Delivery";
    begin
        Delivery.SendInvoiceMail(Rec."Contract No.");
        Delivery.ExportInvoice(Rec."Contract No.");
        OnAfterDeliverInvoice(Rec."Contract No.");
        Rec.Delete();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeliverInvoice(ContractNo: Code[20])
    begin
    end;
}
