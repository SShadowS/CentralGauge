codeunit 88526 "HX171 Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefuseContractNo: Code[20];
        RefuseLineNo: Integer;
        WatchContractNo: Code[20];
        AdjustContractNo: Code[20];
        Raised: Integer;
        SeenInBuffer: Integer;
        PartnerRefusalErr: Label 'Partner refuses lease %1 at line %2.', Comment = '%1 = lease number, %2 = line number';

    procedure RefuseAt(ContractNo: Code[20]; LineNo: Integer)
    begin
        RefuseContractNo := ContractNo;
        RefuseLineNo := LineNo;
    end;

    procedure AdjustAmounts(ContractNo: Code[20])
    begin
        AdjustContractNo := ContractNo;
    end;

    procedure Watch(ContractNo: Code[20])
    begin
        WatchContractNo := ContractNo;
    end;

    procedure RaisedCount(): Integer
    begin
        exit(Raised);
    end;

    procedure SeenInBufferCount(): Integer
    begin
        exit(SeenInBuffer);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Collection Line Check", 'OnAfterCollectionLineAdded', '', false, false)]
    local procedure HandleHX171LineAdded(var PreviewLine: Record "CGR Collection Preview Line" temporary)
    var
        ContractNo: Code[20];
        LineNo: Integer;
        LineAmount: Decimal;
    begin
        ContractNo := PreviewLine."Contract No.";
        LineNo := PreviewLine."Line No.";
        LineAmount := PreviewLine.Amount;
        if (WatchContractNo <> '') and (ContractNo = WatchContractNo) then begin
            Raised += 1;
            if PreviewLine.Get(ContractNo, LineNo) then
                if PreviewLine.Amount = LineAmount then
                    SeenInBuffer += 1;
        end;
        if (AdjustContractNo <> '') and (ContractNo = AdjustContractNo) then begin
            PreviewLine.Amount += 1;
            PreviewLine.Modify();
        end;
        if (RefuseContractNo <> '') and (ContractNo = RefuseContractNo) and (LineNo = RefuseLineNo) then
            Error(PartnerRefusalErr, ContractNo, LineNo);
    end;
}
