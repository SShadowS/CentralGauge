codeunit 80381 "CGR Transfer Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        SeenContractNo: Code[20];
        SeenBranchCode: Code[10];
        SeenCount: Integer;
        RefusalMessage: Text;

    procedure RefuseTransfers(NewRefusalMessage: Text)
    begin
        RefusalMessage := NewRefusalMessage;
    end;

    procedure TransferContractSeen(): Code[20]
    begin
        exit(SeenContractNo);
    end;

    procedure TransferBranchSeen(): Code[10]
    begin
        exit(SeenBranchCode);
    end;

    procedure TransferNoticeCount(): Integer
    begin
        exit(SeenCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterCreateContract', '', false, false)]
    local procedure RecordTransferNotice(var Contract: Record "CGR Rental Contract")
    begin
        if Contract."Customer Name" <> 'TRANSFER' then
            exit;
        SeenCount += 1;
        SeenContractNo := Contract."No.";
        SeenBranchCode := Contract."Branch Code";
        if RefusalMessage <> '' then
            Error('%1', RefusalMessage);
    end;
}
