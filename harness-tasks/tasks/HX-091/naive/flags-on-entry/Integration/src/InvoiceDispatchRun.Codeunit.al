codeunit 70434 "CGR Invoice Dispatch Run"
{
    TableNo = "CGR Invoice Dispatch Entry";

    trigger OnRun()
    var
        Delivery: Codeunit "CGR Invoice Delivery";
    begin
        if not Rec."Mail Sent" then begin
            Delivery.SendInvoiceMail(Rec."Contract No.");
            Rec."Mail Sent" := true;
            Rec.Modify();
            Commit();
        end;
        if not Rec."Export Sent" then begin
            Delivery.ExportInvoice(Rec."Contract No.");
            Rec."Export Sent" := true;
            Rec.Modify();
            Commit();
        end;
        OnAfterDeliverInvoice(Rec."Contract No.");
        Rec."Mail Sent" := false;
        Rec."Export Sent" := false;
        Rec.Modify();
        Rec.Delete();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeliverInvoice(ContractNo: Code[20])
    begin
    end;
}
