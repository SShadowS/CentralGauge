codeunit 80172 "CGR Close Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedContractNo: Code[20];
        PartnerHoldTxt: Label 'HX131 partner hold', Locked = true;
        PartnerRefusedErr: Label 'Partner app refused to close contract %1.', Comment = '%1 = contract number';

    procedure RefuseClosing(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    procedure ClosingRefusalText(ContractNo: Code[20]): Text
    begin
        exit(StrSubstNo(PartnerRefusedErr, ContractNo));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Close Contract", 'OnBeforeCloseContract', '', false, false)]
    local procedure HoldThenRefuse(var Contract: Record "CGR Rental Contract")
    begin
        if (RefusedContractNo = '') or (Contract."No." <> RefusedContractNo) then
            exit;
        Contract."Damage Description" := PartnerHoldTxt;
        Contract.Modify();
        Error(PartnerRefusedErr, Contract."No.");
    end;
}
