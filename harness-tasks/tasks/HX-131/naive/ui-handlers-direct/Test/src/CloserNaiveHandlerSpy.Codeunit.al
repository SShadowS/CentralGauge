codeunit 80174 "CGR Closer Naive Handler Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        PartnerRefusedErr: Label 'Partner app refused contract %1.', Comment = '%1 = contract number';

    procedure RefuseHandlerClosing(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    procedure HandlerRefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Close Contract", 'OnBeforeCloseContract', '', false, false)]
    local procedure RefuseNaively(var Contract: Record "CGR Rental Contract")
    begin
        if (RefusedContractNo = '') or (Contract."No." <> RefusedContractNo) then
            exit;
        Error(PartnerRefusedErr, Contract."No.");
    end;
}
