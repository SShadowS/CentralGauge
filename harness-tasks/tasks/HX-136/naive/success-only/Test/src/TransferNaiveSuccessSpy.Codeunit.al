codeunit 80383 "CGR Xfer Success Spy"
{
    EventSubscriberInstance = Manual;

    var
        SeenBranchCode: Code[10];
        SeenCount: Integer;
        RefusalMessage: Text;

    procedure RefuseWith(NewRefusalMessage: Text)
    begin
        RefusalMessage := NewRefusalMessage;
    end;

    procedure BranchWhenTold(): Code[10]
    begin
        exit(SeenBranchCode);
    end;

    procedure TimesTold(): Integer
    begin
        exit(SeenCount);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterCreateContract', '', false, false)]
    local procedure WatchTransferContract(var Contract: Record "CGR Rental Contract")
    begin
        if Contract."Customer Name" <> 'TRANSFER' then
            exit;
        SeenCount += 1;
        SeenBranchCode := Contract."Branch Code";
        if RefusalMessage <> '' then
            Error('%1', RefusalMessage);
    end;
}
