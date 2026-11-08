codeunit 70237 "CGR Close Contract"
{
    TableNo = "CGR Rental Contract";

    var
        ClosingDate: Date;

    procedure SetClosingDate(NewClosingDate: Date)
    begin
        ClosingDate := NewClosingDate;
    end;

    trigger OnRun()
    begin
        OnBeforeCloseContract(Rec);
        Rec.Status := Rec.Status::Closed;
        Rec."Closed On" := ClosingDate;
        Rec.Modify(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCloseContract(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
