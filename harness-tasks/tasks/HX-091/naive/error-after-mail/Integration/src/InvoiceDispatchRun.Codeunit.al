codeunit 70434 "CGR Invoice Dispatch Run"
{
    TableNo = "CGR Invoice Dispatch Entry";

    trigger OnRun()
    var
        Delivery: Codeunit "CGR Invoice Delivery";
        Mark: Record "CGR Invoice Delivery Mark";
    begin
        if not Mark.Get(Rec."Contract No.", Mark.Channel::Mail) then begin
            Delivery.SendInvoiceMail(Rec."Contract No.");
            Rec.Error := true;
            Rec.Modify();
            MarkDelivered(Rec."Contract No.", Mark.Channel::Mail);
        end;
        if not Mark.Get(Rec."Contract No.", Mark.Channel::Export) then begin
            Delivery.ExportInvoice(Rec."Contract No.");
            MarkDelivered(Rec."Contract No.", Mark.Channel::Export);
        end;
        OnAfterDeliverInvoice(Rec."Contract No.");
        Mark.Reset();
        Mark.SetRange("Contract No.", Rec."Contract No.");
        Mark.DeleteAll();
        Rec.Delete();
    end;

    local procedure MarkDelivered(ContractNo: Code[20]; Channel: Enum "CGR Invoice Channel")
    var
        Mark: Record "CGR Invoice Delivery Mark";
    begin
        Mark.Init();
        Mark."Contract No." := ContractNo;
        Mark.Channel := Channel;
        Mark."Delivered At" := CurrentDateTime();
        Mark.Insert();
        Commit();
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterDeliverInvoice(ContractNo: Code[20])
    begin
    end;
}
