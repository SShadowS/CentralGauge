codeunit 85881 "HX021 Posting Extension"
{
    EventSubscriberInstance = Manual;

    var
        MarkedContracts: Dictionary of [Code[20], Code[20]];
        CommittingContracts: List of [Code[20]];
        RejectedContracts: List of [Code[20]];
        RejectedErr: Label 'HX021 rejects %1.', Comment = '%1 = contract number';

    procedure MarkContract(ContractNo: Code[20]; MarkerVehicleNo: Code[20])
    begin
        MarkedContracts.Set(ContractNo, MarkerVehicleNo);
    end;

    procedure CommitOnContract(ContractNo: Code[20])
    begin
        if not CommittingContracts.Contains(ContractNo) then
            CommittingContracts.Add(ContractNo);
    end;

    procedure RejectContract(ContractNo: Code[20])
    begin
        if not RejectedContracts.Contains(ContractNo) then
            RejectedContracts.Add(ContractNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental-Post", 'OnAfterPostRentalContract', '', false, false)]
    local procedure HandleAfterPostRentalContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)
    var
        Vehicle: Record "CGR Vehicle";
        MarkerVehicleNo: Code[20];
    begin
        if MarkedContracts.Get(RentalContract."No.", MarkerVehicleNo) then begin
            Vehicle.Init();
            Vehicle."No." := MarkerVehicleNo;
            Vehicle.Description := 'HX021 extension marker';
            Vehicle.Insert();
        end;
        if CommittingContracts.Contains(RentalContract."No.") then
            Commit();
        if RejectedContracts.Contains(RentalContract."No.") then
            Error(RejectedErr, RentalContract."No.");
    end;
}
