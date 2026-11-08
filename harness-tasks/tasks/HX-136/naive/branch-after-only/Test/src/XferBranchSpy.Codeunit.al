codeunit 80385 "CGR Xfer Branch Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusalMessage: Text;

    procedure SayNo(NewRefusalMessage: Text)
    begin
        RefusalMessage := NewRefusalMessage;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Mgt", 'OnAfterCreateContract', '', false, false)]
    local procedure RefuseTransferContract(var Contract: Record "CGR Rental Contract")
    begin
        if (Contract."Customer Name" = 'TRANSFER') and (RefusalMessage <> '') then
            Error('%1', RefusalMessage);
    end;
}
