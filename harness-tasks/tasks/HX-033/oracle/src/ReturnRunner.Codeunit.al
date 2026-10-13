// Runs one CGR Rental Mgt.Return in its own Codeunit.Run transaction (runner shape, P9/U1).
codeunit 86133 "HX033 Return Runner"
{
    var
        ContractNo: Code[20];
        ReturnKm: Integer;
        DamageDescription: Text[100];

    trigger OnRun()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        RentalMgt.Return(ContractNo, ReturnKm, DamageDescription);
    end;

    procedure SetReturn(NewContractNo: Code[20]; NewReturnKm: Integer; NewDamageDescription: Text[100])
    begin
        ContractNo := NewContractNo;
        ReturnKm := NewReturnKm;
        DamageDescription := NewDamageDescription;
    end;
}
