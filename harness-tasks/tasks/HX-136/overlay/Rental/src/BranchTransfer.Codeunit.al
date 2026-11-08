codeunit 70249 "CGR Branch Transfer"
{
    procedure TransferVehicle(VehicleNo: Code[20]; TargetBranch: Code[10]; TransferDate: Date): Code[20]
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        SessionContext: Codeunit "CGR Session Context";
        OldBranch: Code[10];
        ContractNo: Code[20];
    begin
        OldBranch := SessionContext.CurrentBranch();
        SessionContext.SetCurrentBranch(TargetBranch);
        ContractNo := RentalMgt.CreateContract(VehicleNo, 'TRANSFER', TransferDate, TransferDate);
        SessionContext.SetCurrentBranch(OldBranch);
        Contract.Get(ContractNo);
        Contract."Pricing Method" := Contract."Pricing Method"::Zero;
        Contract.Modify(true);
        exit(ContractNo);
    end;
}
