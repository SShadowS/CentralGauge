codeunit 85843 "HX019 Post Runner"
{
    TableNo = "CGR Rental Contract";

    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Post(Rec."No.");
    end;
}
