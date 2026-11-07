codeunit 70237 "CGR Close Contract"
{
    TableNo = "CGR Rental Contract";

    var
        ClosingDate: Date;
        NotClosedTxt: Label 'Contract %1 was not closed.', Comment = '%1 = contract number';

    procedure SetClosingDate(NewClosingDate: Date)
    begin
        ClosingDate := NewClosingDate;
    end;

    trigger OnRun()
    var
        Failure: Record "CGR Close Failure";
    begin
        Failure.Init();
        Failure."Contract No." := Rec."No.";
        Failure."Error Text" := StrSubstNo(NotClosedTxt, Rec."No.");
        Failure."Logged At" := CurrentDateTime();
        Failure.Insert(true);
        OnBeforeCloseContract(Rec);
        Rec.Status := Rec.Status::Closed;
        Rec."Closed On" := ClosingDate;
        Rec.Modify(true);
        Failure.Delete(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCloseContract(var Contract: Record "CGR Rental Contract")
    begin
    end;
}
