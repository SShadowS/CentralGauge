codeunit 80178 "CGR Closer Naive Runner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        PartnerHoldTxt: Label 'HX131 naive hold', Locked = true;
        PartnerRefusedErr: Label 'Partner app refused contract %1.', Comment = '%1 = contract number';

    procedure RefuseRunnerClosing(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    procedure RunnerRefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Close Contract", 'OnBeforeCloseContract', '', false, false)]
    local procedure HoldAndRefuse(var Contract: Record "CGR Rental Contract")
    begin
        if (RefusedContractNo = '') or (Contract."No." <> RefusedContractNo) then
            exit;
        Contract."Damage Description" := PartnerHoldTxt;
        Contract.Modify();
        Error(PartnerRefusedErr, Contract."No.");
    end;
}
