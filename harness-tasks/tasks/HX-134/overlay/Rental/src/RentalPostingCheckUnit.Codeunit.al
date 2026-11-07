codeunit 70248 "CGR Rental Posting Check Unit"
{
    TableNo = "CGR Rental Contract";

    var
        CheckOkErr: Label 'CGR-CHECK-OK', Locked = true;

    trigger OnRun()
    var
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        RentalPost.Run(Rec);
        Error(CheckOkErr);
    end;
}
