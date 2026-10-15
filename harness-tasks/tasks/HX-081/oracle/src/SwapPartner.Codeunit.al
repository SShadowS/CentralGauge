// Partner portal spy on OnAfterDeskSwap: records every call's parameters and the contract's vehicle as the
// database shows it at that moment, and refuses one configured new vehicle (a partner app raising an error).
codeunit 87081 "HX081 Swap Partner"
{
    EventSubscriberInstance = Manual;

    var
        CallContracts: List of [Code[20]];
        CallOldVehicles: List of [Code[20]];
        CallNewVehicles: List of [Code[20]];
        CallDbVehicles: List of [Code[20]];
        RefusedVehicleNo: Code[20];
        RefusedErr: Label 'HX081 portal refused %1.', Comment = '%1 = vehicle number';

    procedure HX81Refuse(VehicleNo: Code[20])
    begin
        RefusedVehicleNo := VehicleNo;
    end;

    procedure HX81RefusalText(): Text
    begin
        exit(StrSubstNo(RefusedErr, RefusedVehicleNo));
    end;

    procedure HX81Calls(): Integer
    begin
        exit(CallContracts.Count());
    end;

    procedure HX81CallContract(Index: Integer): Code[20]
    begin
        exit(CallContracts.Get(Index));
    end;

    procedure HX81CallOld(Index: Integer): Code[20]
    begin
        exit(CallOldVehicles.Get(Index));
    end;

    procedure HX81CallNew(Index: Integer): Code[20]
    begin
        exit(CallNewVehicles.Get(Index));
    end;

    procedure HX81CallDbVehicle(Index: Integer): Code[20]
    begin
        exit(CallDbVehicles.Get(Index));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Desk Swap", 'OnAfterDeskSwap', '', false, false)]
    local procedure HX81RecordSwap(ContractNo: Code[20]; OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        DbVehicleNo: Code[20];
    begin
        if Contract.Get(ContractNo) then
            DbVehicleNo := Contract."Vehicle No.";
        CallContracts.Add(ContractNo);
        CallOldVehicles.Add(OldVehicleNo);
        CallNewVehicles.Add(NewVehicleNo);
        CallDbVehicles.Add(DbVehicleNo);
        if (RefusedVehicleNo <> '') and (NewVehicleNo = RefusedVehicleNo) then
            Error(RefusedErr, RefusedVehicleNo);
    end;
}
