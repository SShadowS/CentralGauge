codeunit 80497 "CGR SMS Naive Happy Spy"
{
    EventSubscriberInstance = Manual;

    var
        HappyRefusedContractNo: Code[20];
        HappySentContracts: List of [Code[20]];
        HappyRefusedErr: Label 'Gateway down for contract %1.', Comment = '%1 = contract number';

    procedure HappyRefuse(ContractNo: Code[20])
    begin
        HappyRefusedContractNo := ContractNo;
    end;

    procedure HappySentCount(): Integer
    begin
        exit(HappySentContracts.Count());
    end;

    procedure HappyWasSent(ContractNo: Code[20]): Boolean
    begin
        exit(HappySentContracts.Contains(ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR SMS Send", 'OnSendSms', '', false, false)]
    local procedure HappyGateway(ContractNo: Code[20]; MessageText: Text)
    begin
        if (HappyRefusedContractNo <> '') and (ContractNo = HappyRefusedContractNo) then
            Error(HappyRefusedErr, ContractNo);
        HappySentContracts.Add(ContractNo);
    end;
}
