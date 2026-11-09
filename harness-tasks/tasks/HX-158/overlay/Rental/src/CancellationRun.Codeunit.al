codeunit 70281 "CGR Cancellation Run"
{
    TableNo = "CGR Rental Contract";

    var
        CancelOn: Date;
        WaiveFee: Boolean;
        NotOpenErr: Label 'Rental contract %1 is not open.', Comment = '%1 = contract number';

    procedure SetCancellation(CancelDate: Date; Waive: Boolean)
    begin
        CancelOn := CancelDate;
        WaiveFee := Waive;
    end;

    trigger OnRun()
    var
        Entry: Record "CGR Cancellation Entry";
        FeeCalc: Codeunit "CGR Cancellation Fee";
    begin
        if Rec.Status <> Rec.Status::Open then
            Error(NotOpenErr, Rec."No.");
        Entry.Init();
        Entry."Contract No." := Rec."No.";
        Entry."Branch Code" := Rec."Branch Code";
        Entry.Waived := WaiveFee;
        Entry."Fee Amount" := FeeCalc.CalcCancellationFee(Rec, CancelOn, WaiveFee);
        Entry.Insert(true);
        OnAfterCancellationWritten(Entry);
        OnAfterCancellationCompleted(Entry);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCancellationWritten(Entry: Record "CGR Cancellation Entry")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCancellationCompleted(Entry: Record "CGR Cancellation Entry")
    begin
    end;
}
