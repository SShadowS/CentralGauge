codeunit 70214 "CGR Batch Post Contract"
{
    TableNo = "CGR Rental Contract";

    trigger OnRun()
    begin
        PostContract(Rec);
    end;

    local procedure PostContract(var Contract: Record "CGR Rental Contract")
    var
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        RentalPost.Run(Contract);
    end;
}
