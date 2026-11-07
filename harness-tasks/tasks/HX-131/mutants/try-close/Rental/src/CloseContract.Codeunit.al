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
        CloseInPlace(Rec);
    end;

    procedure CloseInPlace(var Contract: Record "CGR Rental Contract")
    begin
        OnBeforeCloseContract(Contract);
        Contract.Status := Contract.Status::Closed;
        Contract."Closed On" := ClosingDate;
        Contract.Modify(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCloseContract(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
