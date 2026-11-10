codeunit 80621 "CGR Fuel Charge Runner"
{
    var
        FuelContractNo: Code[20];

    trigger OnRun()
    var
        FuelCharge: Codeunit "CGR Fuel Charge";
    begin
        FuelCharge.ChargeFuel(FuelContractNo);
    end;

    procedure SetFuelContract(ContractNo: Code[20])
    begin
        FuelContractNo := ContractNo;
    end;
}
