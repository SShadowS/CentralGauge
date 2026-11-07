codeunit 70248 "CGR Rental Posting Check Unit"
{
    TableNo = "CGR Rental Contract";

    var
        CheckOkErr: Label 'CGR-CHECK-OK', Locked = true;

    trigger OnRun()
    begin
        PostThenUndo(Rec);
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure PostThenUndo(var Contract: Record "CGR Rental Contract")
    var
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        RentalPost.Run(Contract);
        Error(CheckOkErr);
    end;
}
