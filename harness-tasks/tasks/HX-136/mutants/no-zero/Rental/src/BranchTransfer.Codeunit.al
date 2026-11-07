codeunit 70249 "CGR Branch Transfer"
{
    procedure TransferVehicle(VehicleNo: Code[20]; TargetBranch: Code[10]; TransferDate: Date): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContractForBranch(VehicleNo, 'TRANSFER', TransferDate, TransferDate, TargetBranch));
    end;
}
