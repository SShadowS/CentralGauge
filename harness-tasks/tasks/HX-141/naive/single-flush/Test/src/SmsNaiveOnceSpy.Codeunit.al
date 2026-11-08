codeunit 80499 "CGR SMS Naive Once Spy"
{
    EventSubscriberInstance = Manual;

    var
        OnceKeyBoxVehicleNo: Code[20];
        OnceRefusedContractNo: Code[20];
        OnceSentContracts: List of [Code[20]];
        OnceKeyBoxErr: Label 'Keys of vehicle %1 are locked.', Comment = '%1 = vehicle number';
        OnceGatewayErr: Label 'No signal for contract %1.', Comment = '%1 = contract number';

    procedure OnceLockKeys(VehicleNo: Code[20])
    begin
        OnceKeyBoxVehicleNo := VehicleNo;
    end;

    procedure OnceKeyBoxText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(OnceKeyBoxErr, VehicleNo));
    end;

    procedure OnceRefuseSms(ContractNo: Code[20])
    begin
        OnceRefusedContractNo := ContractNo;
    end;

    procedure OnceSentCount(): Integer
    begin
        exit(OnceSentContracts.Count());
    end;

    procedure OnceWasSent(ContractNo: Code[20]): Boolean
    begin
        exit(OnceSentContracts.Contains(ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure OnceKeyBox(VehicleNo: Code[20])
    begin
        if (OnceKeyBoxVehicleNo <> '') and (VehicleNo = OnceKeyBoxVehicleNo) then
            Error(OnceKeyBoxErr, VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR SMS Send", 'OnSendSms', '', false, false)]
    local procedure OnceGateway(ContractNo: Code[20]; MessageText: Text)
    begin
        if (OnceRefusedContractNo <> '') and (ContractNo = OnceRefusedContractNo) then
            Error(OnceGatewayErr, ContractNo);
        OnceSentContracts.Add(ContractNo);
    end;
}
