codeunit 70434 "CGR Invoice Dispatch Run"
{
    TableNo = "CGR Invoice Dispatch Entry";

    trigger OnRun()
    var
        Delivery: Codeunit "CGR Invoice Delivery";
        Mark: Record "CGR Invoice Delivery Mark";
    begin
        if not Mark.Get(Rec."Entry No.", Mark.Channel::Mail) then begin
            Delivery.SendInvoiceMail(Rec."Contract No.");
            MarkDelivered(Rec."Entry No.", Mark.Channel::Mail);
        end;
        if not Mark.Get(Rec."Entry No.", Mark.Channel::Export) then begin
            Delivery.ExportInvoice(Rec."Contract No.");
            MarkDelivered(Rec."Entry No.", Mark.Channel::Export);
        end;
        OnAfterDeliverInvoice(Rec."Contract No.");
        Mark.Reset();
        Mark.SetRange("Dispatch Entry No.", Rec."Entry No.");
        Mark.DeleteAll();
        Rec.Delete();
    end;

    local procedure MarkDelivered(EntryNo: Integer; Channel: Enum "CGR Invoice Channel")
    var
        Mark: Record "CGR Invoice Delivery Mark";
    begin
        Mark.Init();
        Mark."Dispatch Entry No." := EntryNo;
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
