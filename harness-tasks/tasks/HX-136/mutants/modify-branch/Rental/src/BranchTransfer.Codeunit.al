codeunit 70249 "CGR Branch Transfer"
{
    procedure TransferVehicle(VehicleNo: Code[20]; TargetBranch: Code[10]; TransferDate: Date): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'TRANSFER', TransferDate, TransferDate);
        Contract.Get(ContractNo);
        Contract."Branch Code" := TargetBranch;
        Contract."Pricing Method" := Contract."Pricing Method"::Zero;
        Contract.Modify(true);
        exit(ContractNo);
    end;
}
